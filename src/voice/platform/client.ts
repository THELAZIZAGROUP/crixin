/**
 * Crixin platform REST client. When CRIXIN_API_KEY is set, the six voice
 * tools route through Crixin's hosted platform instead of direct Twilio —
 * no TWILIO_* creds needed on the local machine.
 *
 * Wire contract (mirrored by the platform side):
 *   - Base: {CRIXIN_API_BASE || https://crixin-platform.vercel.app}/api/v1/mcp
 *   - Auth: `Authorization: Bearer crx_live_…` on every request
 *   - Envelope: success `{ success: true, data, meta }` → unwrap to `data`;
 *     error `{ success: false, error: { code, message } }` + non-2xx status
 *     → PlatformApiError. Non-JSON bodies surface as code "HTTP_ERROR".
 */

export const DEFAULT_PLATFORM_BASE_URL = "https://crixin-platform.vercel.app";

const USER_AGENT = "crixin-cli/0.7.2";

export class PlatformApiError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "PlatformApiError";
  }
}

interface SuccessEnvelope {
  success?: boolean;
  data?: unknown;
  meta?: unknown;
  error?: { code?: string; message?: string };
}

export interface PlatformClientOptions {
  /** Platform origin, e.g. https://crixin-platform.vercel.app (no path). */
  baseUrl: string;
  /** crx_live_… key issued by the Crixin dashboard. */
  apiKey: string;
}

export class PlatformClient {
  private readonly baseUrl: string;
  private readonly apiKey: string;

  constructor(opts: PlatformClientOptions) {
    this.baseUrl = opts.baseUrl.replace(/\/+$/, "");
    this.apiKey = opts.apiKey;
  }

  async get<T = unknown>(
    path: string,
    query?: Record<string, string | number | undefined>,
  ): Promise<T> {
    let url = `${this.baseUrl}/api/v1/mcp${path}`;
    if (query) {
      const params = new URLSearchParams();
      for (const [key, value] of Object.entries(query)) {
        if (value !== undefined) params.set(key, String(value));
      }
      const qs = params.toString();
      if (qs) url += `?${qs}`;
    }
    return this.request<T>("GET", url);
  }

  async post<T = unknown>(path: string, body: Record<string, unknown>): Promise<T> {
    return this.request<T>("POST", `${this.baseUrl}/api/v1/mcp${path}`, body);
  }

  private async request<T>(
    method: string,
    url: string,
    body?: Record<string, unknown>,
  ): Promise<T> {
    const headers: Record<string, string> = {
      Authorization: `Bearer ${this.apiKey}`,
      "User-Agent": USER_AGENT,
    };
    let payload: string | undefined;
    if (body !== undefined) {
      headers["Content-Type"] = "application/json";
      // JSON.stringify drops undefined-valued keys — "omit undefined" for free.
      payload = JSON.stringify(body);
    }

    const res = await fetch(url, { method, headers, body: payload });
    const text = await res.text().catch(() => "");

    let parsed: SuccessEnvelope | null;
    try {
      parsed = text ? (JSON.parse(text) as SuccessEnvelope) : null;
    } catch {
      parsed = null;
    }

    if (parsed === null) {
      throw new PlatformApiError(
        res.status,
        "HTTP_ERROR",
        text || `Platform returned HTTP ${res.status} with an empty body.`,
      );
    }

    if (!res.ok || parsed.success === false) {
      const code = parsed.error?.code ?? "HTTP_ERROR";
      const message =
        parsed.error?.message ?? (text ? text.slice(0, 240) : `HTTP ${res.status}`);
      throw new PlatformApiError(res.status, code, message);
    }

    return parsed.data as T;
  }
}
