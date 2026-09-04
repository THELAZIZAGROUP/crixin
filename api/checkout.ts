/**
 * POST /api/checkout — create a Stripe Checkout Session for the Pro tier.
 *
 * Mode: subscription · 3-day free trial · $5/month · cancellable anytime
 * (via the Customer Portal — see /api/portal).
 *
 * Required env vars (set in your Vercel project):
 *   STRIPE_SECRET_KEY     — sk_test_… or sk_live_… from your Stripe dashboard
 *   STRIPE_PRICE_ID       — price_… for the $5/month recurring price
 *   PUBLIC_SITE_URL       — origin (e.g. https://crixin.com); used for redirect URLs
 *
 * Run scripts/setup-stripe.ts once with STRIPE_SECRET_KEY set to seed the
 * Product + Price and write the resulting price id to your env.
 */

import type { VercelRequest, VercelResponse } from "@vercel/node";
import { rateLimit, clientIp } from "./_lib/ratelimit.js";

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "method not allowed" });
  }
  if (!rateLimit(`checkout:${clientIp(req)}`, 10, 60_000)) {
    return res.status(429).json({ error: "rate limit — try again in a minute" });
  }
  const secret = process.env["STRIPE_SECRET_KEY"];
  const priceId = process.env["STRIPE_PRICE_ID"];
  const siteUrl = process.env["PUBLIC_SITE_URL"] ?? "https://crixin.com";
  if (!secret || !priceId) {
    return res.status(500).json({ error: "Stripe is not configured on the server." });
  }

  const body = (req.body ?? {}) as { email?: string };
  const email = typeof body.email === "string" ? body.email.trim() : undefined;

  // We talk directly to Stripe's REST endpoint to avoid bundling the full SDK
  // into the serverless function (smaller cold start, smaller blast radius).
  const params = new URLSearchParams();
  params.append("mode", "subscription");
  params.append("line_items[0][price]", priceId);
  params.append("line_items[0][quantity]", "1");
  params.append("subscription_data[trial_period_days]", "3");
  params.append("payment_method_collection", "always");
  params.append("allow_promotion_codes", "true");
  params.append("billing_address_collection", "auto");
  params.append("success_url", `${siteUrl}/?checkout=success&session_id={CHECKOUT_SESSION_ID}`);
  params.append("cancel_url", `${siteUrl}/?checkout=cancel`);
  params.append("automatic_tax[enabled]", "true");
  if (email) params.append("customer_email", email);

  try {
    const r = await fetch("https://api.stripe.com/v1/checkout/sessions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${secret}`,
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: params.toString(),
    });
    if (!r.ok) {
      const text = await r.text();
      return res.status(502).json({ error: "stripe error", detail: text.slice(0, 500) });
    }
    const session = (await r.json()) as { id: string; url: string };
    return res.status(200).json({ id: session.id, url: session.url });
  } catch (err) {
    return res.status(500).json({
      error: "internal error",
      detail: err instanceof Error ? err.message : String(err),
    });
  }
}
