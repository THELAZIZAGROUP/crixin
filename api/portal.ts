/**
 * POST /api/portal — open the Stripe Customer Portal so a user can cancel,
 * change payment method, or download invoices.
 *
 * Body: { customer_id: string } OR { email: string }  (we resolve email→customer
 * in Stripe at runtime to avoid storing customer ids ourselves).
 *
 * Required env vars:
 *   STRIPE_SECRET_KEY
 *   PUBLIC_SITE_URL
 */

import type { VercelRequest, VercelResponse } from "@vercel/node";
import { rateLimit, clientIp } from "./_lib/ratelimit.js";

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "method not allowed" });
  }
  if (!rateLimit(`portal:${clientIp(req)}`, 10, 60_000)) {
    return res.status(429).json({ error: "rate limit — try again in a minute" });
  }
  const secret = process.env["STRIPE_SECRET_KEY"];
  const siteUrl = process.env["PUBLIC_SITE_URL"] ?? "https://crixin.com";
  if (!secret) return res.status(500).json({ error: "Stripe is not configured." });

  const body = (req.body ?? {}) as { customer_id?: string; email?: string };
  let customerId = typeof body.customer_id === "string" ? body.customer_id : undefined;

  if (!customerId && body.email) {
    const lookup = await fetch(
      `https://api.stripe.com/v1/customers?email=${encodeURIComponent(body.email)}&limit=1`,
      { headers: { Authorization: `Bearer ${secret}` } },
    );
    if (lookup.ok) {
      const j = (await lookup.json()) as { data: { id: string }[] };
      customerId = j.data[0]?.id;
    }
  }

  if (!customerId) {
    return res
      .status(404)
      .json({ error: "No Stripe customer matched that email." });
  }

  const params = new URLSearchParams();
  params.append("customer", customerId);
  params.append("return_url", siteUrl);

  const r = await fetch("https://api.stripe.com/v1/billing_portal/sessions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${secret}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: params.toString(),
  });
  if (!r.ok) {
    return res
      .status(502)
      .json({ error: "stripe error", detail: (await r.text()).slice(0, 500) });
  }
  const session = (await r.json()) as { url: string };
  return res.status(200).json({ url: session.url });
}
