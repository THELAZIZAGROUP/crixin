import type { CrixinVoiceEnv } from "../env.js";

/**
 * Tiny Twilio REST client — just the endpoints crixin voice needs.
 * Avoids the full `twilio` npm package so the install footprint stays at
 * `@modelcontextprotocol/sdk` only.
 */
export class TwilioClient {
  private readonly baseUrl: string;
  private readonly accountSid: string;
  private readonly authHeader: string;
  readonly fromNumber: string;

  constructor(env: CrixinVoiceEnv) {
    // If a subaccount is configured, route everything through it. Otherwise
    // use the master account credentials directly.
    const sid = env.twilio.subaccountSid ?? env.twilio.accountSid;
    const token = env.twilio.subaccountToken ?? env.twilio.authToken;

    if (!sid || !token) {
      // Reachable in platform mode (CRIXIN_API_KEY set, TWILIO_* absent) when
      // a Twilio-only operation is invoked. Fail loudly instead of sending
      // garbage credentials over the wire.
      throw new Error(
        "This operation talks to Twilio directly and needs TWILIO_ACCOUNT_SID / TWILIO_AUTH_TOKEN. " +
          "Platform mode (CRIXIN_API_KEY) doesn't cover it.",
      );
    }

    this.accountSid = sid;
    this.fromNumber = env.twilio.fromNumber;
    this.authHeader = "Basic " + Buffer.from(`${sid}:${token}`).toString("base64");
    this.baseUrl = `https://api.twilio.com/2010-04-01/Accounts/${sid}`;
  }

  async post<T = unknown>(path: string, body: Record<string, string>): Promise<T> {
    const res = await fetch(`${this.baseUrl}${path}`, {
      method: "POST",
      headers: {
        Authorization: this.authHeader,
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: new URLSearchParams(body),
    });
    return this.handleResponse<T>(res, "POST", path);
  }

  async get<T = unknown>(path: string, query?: Record<string, string>): Promise<T> {
    const url = query
      ? `${this.baseUrl}${path}?${new URLSearchParams(query).toString()}`
      : `${this.baseUrl}${path}`;
    const res = await fetch(url, {
      method: "GET",
      headers: { Authorization: this.authHeader },
    });
    return this.handleResponse<T>(res, "GET", path);
  }

  /** Some Twilio sub-resources (e.g. Recording media) live outside the JSON API. */
  async getRaw(path: string): Promise<Response> {
    return fetch(`${this.baseUrl}${path}`, {
      method: "GET",
      headers: { Authorization: this.authHeader },
    });
  }

  private async handleResponse<T>(res: Response, method: string, path: string): Promise<T> {
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      throw friendlyTwilioError(res.status, text, `${method} ${path}`);
    }
    return (await res.json()) as T;
  }
}

export class TwilioApiError extends Error {
  constructor(
    public readonly status: number,
    message: string,
    public readonly twilioCode?: number,
  ) {
    super(message);
    this.name = "TwilioApiError";
  }
}

/**
 * Translate Twilio's raw error body into a human-readable message. Twilio's
 * REST errors are JSON like `{ "code": 20003, "message": "Authenticate", ... }`
 * — the bare wire form is unhelpful when it lands in a CLI or MCP host. We
 * detect the most common codes and rewrite them.
 *
 * Reference: https://www.twilio.com/docs/api/errors
 */
function friendlyTwilioError(status: number, body: string, ctx: string): TwilioApiError {
  let parsed: { code?: number; message?: string; more_info?: string } | null = null;
  try {
    parsed = body ? JSON.parse(body) : null;
  } catch {
    parsed = null;
  }
  const code = parsed?.code;
  if (code === 20003) {
    // The single most common production failure: rotated / wrong auth token.
    // Generic "Authenticate" tells the user nothing actionable.
    return new TwilioApiError(
      status,
      "Twilio rejected your credentials (error 20003). " +
        "Your TWILIO_AUTH_TOKEN may have been rotated, or the SID/token pair doesn't match. " +
        "Re-copy both from https://console.twilio.com/ and verify with `crixin voice doctor`.",
      code,
    );
  }
  if (code === 20404) {
    return new TwilioApiError(
      status,
      `Twilio resource not found (error 20404). The ${ctx} target doesn't exist on this account.`,
      code,
    );
  }
  if (code === 21211 || code === 21214 || code === 21217) {
    return new TwilioApiError(
      status,
      `Twilio rejected the destination number (error ${code}: ${parsed?.message ?? "invalid number"}). ` +
        "Use E.164 format (e.g. +201001234567).",
      code,
    );
  }
  if (code === 21606 || code === 21210) {
    return new TwilioApiError(
      status,
      `Twilio rejected the From number (error ${code}: ${parsed?.message ?? "invalid sender"}). ` +
        "Set TWILIO_PHONE_NUMBER to a number you actually own on this account.",
      code,
    );
  }
  if (code === 21215) {
    return new TwilioApiError(
      status,
      "Twilio account doesn't have permission to call that destination (error 21215). " +
        "Enable the country at https://console.twilio.com/us1/develop/voice/manage/geo-permissions.",
      code,
    );
  }
  if (status === 401 || status === 403) {
    return new TwilioApiError(
      status,
      `Twilio auth failed (HTTP ${status}). Check TWILIO_ACCOUNT_SID / TWILIO_AUTH_TOKEN. ` +
        `Run \`crixin voice doctor\` to verify.`,
      code,
    );
  }
  // Fallback — surface the raw message but keep it bounded.
  const detail =
    parsed?.message ??
    (body ? body.slice(0, 240) : `HTTP ${status}`);
  return new TwilioApiError(
    status,
    `${ctx} failed: ${detail}${code ? ` (Twilio code ${code})` : ""}`,
    code,
  );
}
