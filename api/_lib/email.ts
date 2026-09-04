/**
 * Resend transactional email helper. Templates live in this same file as
 * pure-string builders so they can be edited in-PR and there's no template-
 * engine dep for the serverless functions.
 */

const RESEND_BASE = "https://api.resend.com";

export interface SendOpts {
  to: string;
  subject: string;
  html: string;
  text: string;
  replyTo?: string;
}

export async function sendEmail(opts: SendOpts): Promise<void> {
  const apiKey = process.env["RESEND_API_KEY"];
  const from = process.env["RESEND_FROM"] ?? "Crixin <hello@hello.crixin.com>";
  if (!apiKey) throw new Error("Resend not configured");
  const r = await fetch(`${RESEND_BASE}/emails`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      from,
      to: opts.to,
      subject: opts.subject,
      html: opts.html,
      text: opts.text,
      ...(opts.replyTo ? { reply_to: opts.replyTo } : {}),
    }),
  });
  if (!r.ok) {
    throw new Error(`resend send failed: ${r.status} ${(await r.text()).slice(0, 240)}`);
  }
}

// ---------------------------------------------------------------------------
// Shared HTML wrapper — mirrors web/styles.css palette so the brand matches.
// ---------------------------------------------------------------------------

function shell(opts: { preheader: string; bodyHtml: string }): string {
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <meta name="color-scheme" content="dark light" />
    <title>Crixin</title>
  </head>
  <body style="margin:0;padding:0;background:#0b0d12;font-family:'Inter',-apple-system,'SF Pro Display',system-ui,sans-serif;color:#e6e8ef;">
    <span style="display:none;font-size:1px;color:#0b0d12;line-height:1px;max-height:0;max-width:0;opacity:0;overflow:hidden;">${escapeHtml(opts.preheader)}</span>
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:#0b0d12;padding:32px 16px;">
      <tr>
        <td align="center">
          <table role="presentation" width="560" cellpadding="0" cellspacing="0" border="0" style="max-width:560px;background:#161922;border:1px solid #272a35;border-radius:14px;overflow:hidden;">
            <tr>
              <td style="padding:24px 28px 16px 28px;border-bottom:1px solid #272a35;">
                <span style="color:#f5b452;font-weight:700;font-size:18px;letter-spacing:-0.01em;">crixin</span>
                <span style="color:#5b6075;font-size:11px;text-transform:uppercase;letter-spacing:0.10em;margin-left:8px;">v0.2 · local-first</span>
              </td>
            </tr>
            <tr>
              <td style="padding:28px;color:#e6e8ef;font-size:15px;line-height:1.55;">
                ${opts.bodyHtml}
              </td>
            </tr>
            <tr>
              <td style="padding:18px 28px;border-top:1px solid #272a35;color:#5b6075;font-size:11px;line-height:1.5;">
                You're getting this because you signed up at <a href="https://crixin.com" style="color:#7aa2f7;text-decoration:none;">crixin.com</a>.<br/>
                Crixin is local-first — nothing about your AI coding sessions is sent to us. This email is the only signal we keep.
              </td>
            </tr>
          </table>
        </td>
      </tr>
    </table>
  </body>
</html>`;
}

function escapeHtml(s: string): string {
  return String(s ?? "").replace(/[&<>"']/g, (c) =>
    c === "&" ? "&amp;" : c === "<" ? "&lt;" : c === ">" ? "&gt;" : c === '"' ? "&quot;" : "&#39;",
  );
}

// ---------------------------------------------------------------------------
// Templates
// ---------------------------------------------------------------------------

export const templates = {
  /** Magic-link sign-in / sign-up. The link is single-use and expires in 15 min. */
  magicLink(opts: { url: string; expiresInMinutes: number; isNewUser: boolean }): {
    subject: string;
    html: string;
    text: string;
  } {
    const subject = opts.isNewUser
      ? "Welcome to Crixin — confirm to sign in"
      : "Your Crixin sign-in link";
    const text = [
      opts.isNewUser ? "Welcome to Crixin." : "Hi —",
      "",
      `Click to sign in:`,
      opts.url,
      "",
      `This link expires in ${opts.expiresInMinutes} minutes and only works once.`,
      "",
      "If you didn't request this, ignore the email — no account was created.",
      "",
      "— Crixin",
    ].join("\n");
    const html = shell({
      preheader: opts.isNewUser
        ? "One click to finish creating your Crixin account."
        : "Click the button to sign in. Expires in 15 minutes.",
      bodyHtml: `
        <h1 style="font-family:'Instrument Serif',Georgia,serif;font-style:italic;font-size:32px;letter-spacing:-0.01em;margin:0 0 12px 0;font-weight:400;color:#f5b452;line-height:1.15;">${opts.isNewUser ? "Welcome." : "Sign in."}</h1>
        <p style="color:#9097a8;margin:0 0 22px 0;font-size:15px;line-height:1.55;">${opts.isNewUser ? "Click the button below to finish creating your Crixin account. The link only works once and expires in " + opts.expiresInMinutes + " minutes." : "Click the button below to sign in. The link only works once and expires in " + opts.expiresInMinutes + " minutes."}</p>
        <p style="margin:24px 0;">
          <a href="${escapeHtml(opts.url)}" style="display:inline-block;background:#f5b452;color:#0b0d12;text-decoration:none;font-weight:600;font-size:15px;padding:13px 26px;border-radius:8px;">Sign in to Crixin →</a>
        </p>
        <p style="color:#5b6075;font-size:13px;margin:18px 0 4px 0;">If the button doesn't work, copy this URL into your browser:</p>
        <p style="color:#9097a8;font-family:'Geist Mono','SF Mono',Menlo,monospace;font-size:12px;word-break:break-all;margin:0 0 22px 0;background:#0b0d12;padding:10px 12px;border-radius:6px;border:1px solid #272a35;">${escapeHtml(opts.url)}</p>
        <p style="color:#5b6075;font-size:12px;margin:18px 0 0 0;line-height:1.55;">Didn't ask to sign in? Ignore this email — no account was created. The link will expire on its own.</p>
        <p style="color:#5b6075;font-size:13px;margin:20px 0 0 0;">— Crixin</p>
      `,
    });
    return { subject, html, text };
  },

  /** Sent when Stripe confirms checkout.session.completed for a new sub. */
  trialStarted(opts: { trialEnd: string; manageUrl?: string; licenseToken?: string }): {
    subject: string;
    html: string;
    text: string;
  } {
    const subject = "Your Crixin Pro trial has started";
    const text = [
      "Your 3-day free trial is live.",
      "",
      `It runs through ${opts.trialEnd}. After that, the card on file is charged $5 and the subscription renews monthly until you cancel.`,
      "",
      "Cancel any time:",
      opts.manageUrl ?? "Reply to this email and we'll send you a portal link.",
      "",
      "Install:",
      "  npm i -g crixin",
      "  crixin license activate " + (opts.licenseToken ?? "<token-missing>"),
      "  crixin              # Pro features now unlocked",
      "",
      opts.licenseToken
        ? "Your license token (don't share — anyone with this string gets your Pro tier):"
        : "",
      opts.licenseToken ? opts.licenseToken : "",
      "",
      "Docs: https://crixin.com",
      "Source: https://github.com/THELAZIZAGROUP/crixin",
      "",
      "— Crixin",
    ].join("\n");
    const html = shell({
      preheader: `Your 3-day free trial runs through ${opts.trialEnd}.`,
      bodyHtml: `
        <h1 style="font-size:24px;letter-spacing:-0.01em;margin:0 0 12px 0;font-weight:700;color:#e6e8ef;">Your trial is live.</h1>
        <p style="color:#9097a8;margin:0 0 16px 0;">Three days, on us. After <strong style="color:#e6e8ef;">${escapeHtml(opts.trialEnd)}</strong> the card on file is charged <strong style="color:#f5b452;">$5</strong> and the subscription renews monthly. Cancel any time — no email-the-team gymnastics.</p>
        ${opts.licenseToken ? `
        <p style="color:#9097a8;margin:0 0 8px 0;font-size:14px;">Your Pro license — paste into your terminal:</p>
        <pre style="background:#0a0c11;border:1px solid #272a35;border-radius:8px;padding:14px 16px;color:#f5b452;font-family:'JetBrains Mono','SF Mono',ui-monospace,monospace;font-size:12px;margin:0 0 8px 0;overflow-x:auto;white-space:pre-wrap;word-break:break-all;">$ npm i -g crixin
$ crixin license activate ${escapeHtml(opts.licenseToken)}
$ crixin    <span style="color:#5b6075;"># Pro features unlocked</span></pre>
        <p style="color:#5b6075;font-size:11px;margin:0 0 18px 0;">Don't share the token above — it's an Ed25519-signed JWT scoped to your Stripe customer record. We can't recover it for you, but the customer portal lets you re-issue.</p>
        ` : `
        <pre style="background:#0a0c11;border:1px solid #272a35;border-radius:8px;padding:14px 16px;color:#f5b452;font-family:'JetBrains Mono','SF Mono',ui-monospace,monospace;font-size:13px;margin:18px 0;overflow-x:auto;">$ npx crixin</pre>
        `}
        <p style="margin:24px 0 8px 0;">
          <a href="https://crixin.com" style="display:inline-block;background:#f5b452;color:#0b0d12;text-decoration:none;font-weight:600;font-size:14px;padding:11px 22px;border-radius:8px;margin-right:8px;">Open the docs</a>
          ${opts.manageUrl ? `<a href="${escapeHtml(opts.manageUrl)}" style="display:inline-block;background:transparent;color:#e6e8ef;text-decoration:none;font-weight:600;font-size:14px;padding:11px 22px;border-radius:8px;border:1px solid #3a3f4d;">Manage subscription</a>` : ""}
        </p>
        <p style="color:#5b6075;font-size:13px;margin:24px 0 0 0;">— Crixin</p>
      `,
    });
    return { subject, html, text };
  },

  /** Sent ~24h before the trial ends. */
  trialEnding(opts: { trialEnd: string; manageUrl?: string }): {
    subject: string;
    html: string;
    text: string;
  } {
    const subject = "Your Crixin trial ends tomorrow";
    const text = [
      `Your trial ends ${opts.trialEnd}.`,
      "",
      "If you keep it, the first $5 charge lands tomorrow and renews monthly until you cancel.",
      "If it's not for you, cancel here and you won't be charged:",
      opts.manageUrl ?? "Reply to this email and we'll handle it.",
      "",
      "— Crixin",
    ].join("\n");
    const html = shell({
      preheader: `Trial ends ${opts.trialEnd}. Cancel anytime, no charge.`,
      bodyHtml: `
        <h1 style="font-size:22px;letter-spacing:-0.01em;margin:0 0 12px 0;font-weight:700;color:#e6e8ef;">Your trial ends tomorrow.</h1>
        <p style="color:#9097a8;margin:0 0 16px 0;">If Crixin's earned a place in your workflow, do nothing — the first $5 charge lands <strong style="color:#e6e8ef;">${escapeHtml(opts.trialEnd)}</strong>.</p>
        <p style="color:#9097a8;margin:0 0 16px 0;">If it hasn't, cancel here. No questions, no charge:</p>
        ${opts.manageUrl ? `<p style="margin:18px 0;"><a href="${escapeHtml(opts.manageUrl)}" style="display:inline-block;background:transparent;color:#e6e8ef;text-decoration:none;font-weight:600;font-size:14px;padding:11px 22px;border-radius:8px;border:1px solid #3a3f4d;">Cancel subscription</a></p>` : ""}
        <p style="color:#5b6075;font-size:13px;margin:24px 0 0 0;">— Crixin</p>
      `,
    });
    return { subject, html, text };
  },

  /** Receipt after each successful invoice (monthly renewal). */
  paymentReceipt(opts: { amount: number; periodEnd: string; manageUrl?: string }): {
    subject: string;
    html: string;
    text: string;
  } {
    const dollars = (opts.amount / 100).toFixed(2);
    const subject = `Crixin · receipt · $${dollars}`;
    const text = [
      `Payment received: $${dollars}`,
      `Next renewal: ${opts.periodEnd}`,
      "",
      "Manage your subscription:",
      opts.manageUrl ?? "Reply to this email.",
      "",
      "Thanks for using Crixin.",
    ].join("\n");
    const html = shell({
      preheader: `Receipt: $${dollars}. Next renewal ${opts.periodEnd}.`,
      bodyHtml: `
        <h1 style="font-size:22px;letter-spacing:-0.01em;margin:0 0 12px 0;font-weight:700;color:#e6e8ef;">Receipt — $${dollars}</h1>
        <p style="color:#9097a8;margin:0 0 16px 0;">Next renewal: <strong style="color:#e6e8ef;">${escapeHtml(opts.periodEnd)}</strong>.</p>
        ${opts.manageUrl ? `<p style="margin:18px 0;"><a href="${escapeHtml(opts.manageUrl)}" style="display:inline-block;background:transparent;color:#e6e8ef;text-decoration:none;font-weight:600;font-size:14px;padding:11px 22px;border-radius:8px;border:1px solid #3a3f4d;">Manage subscription</a></p>` : ""}
        <p style="color:#5b6075;font-size:13px;margin:24px 0 0 0;">Thanks for using Crixin.</p>
      `,
    });
    return { subject, html, text };
  },
};
