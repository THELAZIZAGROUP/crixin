/**
 * POST /api/stripe-webhook — Stripe sends every subscription/checkout event here.
 *
 * What this does:
 *   1. Verify the Stripe signature using STRIPE_WEBHOOK_SECRET.
 *   2. Mirror the event to Firestore (collections: customers, subscriptions, events).
 *   3. Trigger the right transactional email (trial-started, trial-ending, receipt).
 *
 * Required env vars (set on Vercel):
 *   STRIPE_SECRET_KEY        — for billing-portal link generation
 *   STRIPE_WEBHOOK_SECRET    — whsec_… from the Stripe webhook endpoint
 *   FIREBASE_PROJECT_ID
 *   FIREBASE_CLIENT_EMAIL
 *   FIREBASE_PRIVATE_KEY
 *   RESEND_API_KEY
 *   RESEND_FROM
 */

import type { VercelRequest, VercelResponse } from "@vercel/node";
import { createHmac, timingSafeEqual } from "node:crypto";
import { writeDoc, readDoc } from "./_lib/firestore.js";
import { sendEmail, templates } from "./_lib/email.js";
import { mintLicenseJwt } from "./_lib/license-jwt.js";

// Disable Vercel's automatic body-parsing — we need the raw bytes for signature verification.
export const config = {
  api: { bodyParser: false },
};

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== "POST") return res.status(405).json({ error: "method not allowed" });

  const secret = process.env["STRIPE_SECRET_KEY"];
  const whsec = process.env["STRIPE_WEBHOOK_SECRET"];
  if (!secret || !whsec) return res.status(500).json({ error: "stripe webhook not configured" });

  const sigHeader = req.headers["stripe-signature"];
  if (typeof sigHeader !== "string") return res.status(400).json({ error: "missing signature" });

  // Read raw body (Vercel: stream off req).
  const rawBody = await readRaw(req);
  if (!verifySignature(rawBody, sigHeader, whsec)) {
    return res.status(400).json({ error: "invalid signature" });
  }

  let event: StripeEvent;
  try {
    event = JSON.parse(rawBody) as StripeEvent;
  } catch {
    return res.status(400).json({ error: "invalid json" });
  }

  // Idempotency: Stripe retries on any non-2xx and can also re-deliver on
  // network hiccups. Keyed on event.id so a duplicate delivery short-circuits
  // before we send a second trial-started email or mint a fresh license JWT.
  try {
    const prior = await readDoc(`crixin_events/${event.id}`);
    if (prior && prior["processed"] === true) {
      return res.status(200).json({ received: true, idempotent: true });
    }
  } catch (err) {
    // Read failure is rare; prefer risking a duplicate over dropping the event.
    console.error("stripe-webhook idempotency check failed:", event.id, err);
  }

  let handlerError: unknown = null;
  try {
    switch (event.type) {
      case "checkout.session.completed":
        await onCheckoutCompleted(event, secret);
        break;
      case "customer.subscription.created":
        await onSubscriptionCreated(event);
        break;
      case "customer.subscription.trial_will_end":
        await onTrialEnding(event, secret);
        break;
      case "invoice.payment_succeeded":
        await onPaymentSucceeded(event, secret);
        break;
      case "customer.subscription.deleted":
        await onSubscriptionDeleted(event);
        break;
      default:
        // Acknowledge unhandled events so Stripe doesn't retry.
        break;
    }
  } catch (err) {
    handlerError = err;
    console.error("stripe-webhook handler error:", event.type, event.id, err);
  }

  // Mark the event as processed (or failed) for the idempotency check above.
  // Best-effort — if Firestore is down we still ack so Stripe doesn't replay
  // a webhook that may already have side-effected (sent emails, etc.).
  await writeDoc(
    `crixin_events/${event.id}`,
    {
      type: event.type,
      eventId: event.id,
      livemode: event.livemode,
      createdAt: new Date(event.created * 1000),
      processedAt: new Date(),
      processed: handlerError === null,
      ...(handlerError !== null && {
        error: handlerError instanceof Error ? handlerError.message : String(handlerError),
      }),
    },
    { merge: true },
  ).catch((err) => console.error("stripe-webhook event marker write failed:", event.id, err));

  return res.status(200).json({ received: true });
}

// ---------------------------------------------------------------------------

type StripeEvent = {
  id: string;
  type: string;
  created: number;
  livemode: boolean;
  data: { object: Record<string, unknown> };
};

async function readRaw(req: VercelRequest): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on("data", (c: Buffer) => chunks.push(c));
    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    req.on("error", reject);
  });
}

/** Stripe signature scheme (v1) — re-implemented to avoid the SDK's bulk. */
function verifySignature(payload: string, header: string, secret: string): boolean {
  const parts = Object.fromEntries(
    header.split(",").map((p) => p.split("=") as [string, string]),
  );
  const t = parts["t"];
  const v1 = parts["v1"];
  if (!t || !v1) return false;
  const signed = `${t}.${payload}`;
  const expected = createHmac("sha256", secret).update(signed).digest("hex");
  const a = Buffer.from(v1, "hex");
  const b = Buffer.from(expected, "hex");
  return a.length === b.length && timingSafeEqual(a, b);
}

async function getPortalUrl(customerId: string, secret: string): Promise<string | undefined> {
  try {
    const params = new URLSearchParams();
    params.append("customer", customerId);
    params.append("return_url", process.env["PUBLIC_SITE_URL"] ?? "https://crixin.com");
    const r = await fetch("https://api.stripe.com/v1/billing_portal/sessions", {
      method: "POST",
      headers: { Authorization: `Bearer ${secret}`, "Content-Type": "application/x-www-form-urlencoded" },
      body: params.toString(),
    });
    if (!r.ok) return undefined;
    const j = (await r.json()) as { url?: string };
    return j.url;
  } catch {
    return undefined;
  }
}

async function getCustomerEmail(customerId: string, secret: string): Promise<string | undefined> {
  try {
    const r = await fetch(`https://api.stripe.com/v1/customers/${customerId}`, {
      headers: { Authorization: `Bearer ${secret}` },
    });
    if (!r.ok) return undefined;
    const j = (await r.json()) as { email?: string | null };
    return j.email ?? undefined;
  } catch {
    return undefined;
  }
}

function fmtDate(unixSeconds: number | null | undefined): string {
  if (!unixSeconds) return "the trial end date";
  return new Date(unixSeconds * 1000).toLocaleDateString("en-US", {
    weekday: "long",
    month: "long",
    day: "numeric",
    year: "numeric",
  });
}

// ---------------------------------------------------------------------------

interface CheckoutSession {
  id: string;
  customer?: string | null;
  customer_email?: string | null;
  customer_details?: { email?: string | null };
  subscription?: string | null;
  mode?: string;
}

async function onCheckoutCompleted(event: StripeEvent, secret: string) {
  const s = event.data.object as unknown as CheckoutSession;
  if (s.mode !== "subscription" || !s.customer || !s.subscription) return;
  const email =
    s.customer_email ??
    s.customer_details?.email ??
    (await getCustomerEmail(s.customer, secret));
  await writeDoc(
    `crixin_customers/${s.customer}`,
    {
      stripeCustomerId: s.customer,
      email: email ?? null,
      subscriptionId: s.subscription,
      checkoutSessionId: s.id,
      createdAt: new Date(),
      status: "trialing",
    },
    { merge: true },
  );
}

interface Subscription {
  id: string;
  customer: string;
  status: string;
  trial_end?: number | null;
  current_period_end?: number | null;
  items: { data: { price: { id: string } }[] };
}

async function onSubscriptionCreated(event: StripeEvent) {
  const sub = event.data.object as unknown as Subscription;
  await writeDoc(
    `crixin_subscriptions/${sub.id}`,
    {
      stripeSubscriptionId: sub.id,
      stripeCustomerId: sub.customer,
      status: sub.status,
      trialEnd: sub.trial_end ? new Date(sub.trial_end * 1000) : null,
      currentPeriodEnd: sub.current_period_end ? new Date(sub.current_period_end * 1000) : null,
      priceId: sub.items.data[0]?.price.id ?? null,
      createdAt: new Date(),
    },
    { merge: true },
  );
  // Welcome / trial-started email — INCLUDES the signed Pro license JWT
  const secret = process.env["STRIPE_SECRET_KEY"]!;
  const email = await getCustomerEmail(sub.customer, secret);
  if (email) {
    // Mint license JWT — exp = period_end + 30-day grace, so renewal events
    // can re-issue without leaving the user offline if a webhook is delayed.
    let licenseToken: string | undefined;
    try {
      const expSec =
        (sub.current_period_end ?? Math.floor(Date.now() / 1000) + 60 * 86400) +
        30 * 86400;
      licenseToken = mintLicenseJwt({
        sub: sub.customer,
        email,
        tier: "pro",
        expSec,
      });
      // Mirror to Firestore for "lost my email" recovery via the customer portal.
      await writeDoc(
        `crixin_customers/${sub.customer}`,
        { latestLicenseToken: licenseToken, latestLicenseIssuedAt: new Date() },
        { merge: true },
      ).catch((err) => console.error("license token mirror failed:", sub.customer, err));
    } catch (err) {
      console.error("license JWT mint failed:", err);
    }

    const portal = await getPortalUrl(sub.customer, secret);
    const t = templates.trialStarted({
      trialEnd: fmtDate(sub.trial_end),
      licenseToken,
      ...(portal ? { manageUrl: portal } : {}),
    });
    await sendEmail({ to: email, ...t });
  }
}

async function onTrialEnding(event: StripeEvent, secret: string) {
  const sub = event.data.object as unknown as Subscription;
  const email = await getCustomerEmail(sub.customer, secret);
  if (!email) return;
  const portal = await getPortalUrl(sub.customer, secret);
  const t = templates.trialEnding({
    trialEnd: fmtDate(sub.trial_end),
    ...(portal ? { manageUrl: portal } : {}),
  });
  await sendEmail({ to: email, ...t });
  await writeDoc(`crixin_subscriptions/${sub.id}`, { status: sub.status, trialEndingNotifiedAt: new Date() }, { merge: true });
}

interface Invoice {
  id: string;
  customer: string;
  subscription?: string | null;
  amount_paid: number;
  status: string;
  period_end: number;
}

async function onPaymentSucceeded(event: StripeEvent, secret: string) {
  const inv = event.data.object as unknown as Invoice;
  // Skip $0 invoices (e.g. trial-start "free" invoice) — receipt for that would confuse users.
  if (!inv.amount_paid || inv.amount_paid === 0) return;
  const email = await getCustomerEmail(inv.customer, secret);
  if (!email) return;
  const portal = await getPortalUrl(inv.customer, secret);
  const t = templates.paymentReceipt({
    amount: inv.amount_paid,
    periodEnd: fmtDate(inv.period_end),
    ...(portal ? { manageUrl: portal } : {}),
  });
  await sendEmail({ to: email, ...t });
  await appendDoc(`crixin_payments`, {
    stripeInvoiceId: inv.id,
    stripeCustomerId: inv.customer,
    stripeSubscriptionId: inv.subscription ?? null,
    amount: inv.amount_paid,
    status: inv.status,
    createdAt: new Date(),
  });
}

async function onSubscriptionDeleted(event: StripeEvent) {
  const sub = event.data.object as unknown as Subscription;
  await writeDoc(
    `crixin_subscriptions/${sub.id}`,
    { status: "canceled", canceledAt: new Date() },
    { merge: true },
  );
  await writeDoc(
    `crixin_customers/${sub.customer}`,
    { status: "canceled", canceledAt: new Date() },
    { merge: true },
  );
}
