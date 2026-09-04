/**
 * One-time Stripe setup. Run this with STRIPE_SECRET_KEY in your env to:
 *   1. Create the "Crixin Pro" Product
 *   2. Create a $5/month recurring USD Price under it
 *   3. Print the resulting price id so you can paste it into your Vercel env
 *
 * Usage:
 *   STRIPE_SECRET_KEY=sk_test_… node --import tsx scripts/setup-stripe.ts
 */

const secret = process.env["STRIPE_SECRET_KEY"];
if (!secret) {
  console.error("Set STRIPE_SECRET_KEY (sk_test_… or sk_live_…) in your env first.");
  process.exit(1);
}

const live = secret.startsWith("sk_live_");
console.log(`Stripe mode: ${live ? "LIVE" : "TEST"}`);
console.log(`(Press Ctrl-C in 3s if you used the wrong key…)`);
await new Promise((r) => setTimeout(r, 3000));

// Step 1: ensure product exists
const productParams = new URLSearchParams();
productParams.append("name", "Crixin Pro");
productParams.append("description", "Local-first AI coding dashboard — pro tier.");
productParams.append("statement_descriptor", "CRIXIN PRO");
productParams.append("url", "https://crixin.com");

let product = await listFirst("products", { name: "Crixin Pro" });
if (product) {
  console.log(`Reusing existing product: ${product.id}`);
} else {
  product = await stripe<StripeProduct>("products", "POST", productParams);
  console.log(`Created product: ${product.id}`);
}

// Step 2: ensure $5/month price exists under the product
const priceParams = new URLSearchParams();
priceParams.append("product", product.id);
priceParams.append("currency", "usd");
priceParams.append("unit_amount", "500"); // cents
priceParams.append("recurring[interval]", "month");
priceParams.append("recurring[trial_period_days]", "3");
priceParams.append("nickname", "Crixin Pro $5/mo (3-day trial)");

let price = await listFirst("prices", { product: product.id, active: "true" });
if (price && price.unit_amount === 500 && price.recurring?.interval === "month") {
  console.log(`Reusing existing price: ${price.id}`);
} else {
  price = await stripe<StripePrice>("prices", "POST", priceParams);
  console.log(`Created price: ${price.id}`);
}

// Step 3: print the env line for your Vercel project
console.log("\n──────────────────────────────────────────────────────────");
console.log("Add this to your Vercel project's environment variables:\n");
console.log(`  STRIPE_SECRET_KEY=${secret.replace(/^(sk_(?:test|live)_)([A-Za-z0-9]{8}).*$/, "$1$2…")}`);
console.log(`  STRIPE_PRICE_ID=${price.id}`);
console.log(`  PUBLIC_SITE_URL=https://crixin.com`);
console.log("──────────────────────────────────────────────────────────\n");

interface StripeProduct { id: string; }
interface StripePrice { id: string; unit_amount: number | null; recurring?: { interval?: string } }

async function stripe<T = unknown>(
  path: string,
  method: "GET" | "POST",
  body?: URLSearchParams,
): Promise<T> {
  const url = `https://api.stripe.com/v1/${path}`;
  const r = await fetch(url, {
    method,
    headers: {
      Authorization: `Bearer ${secret}`,
      ...(body ? { "Content-Type": "application/x-www-form-urlencoded" } : {}),
    },
    body: body?.toString(),
  });
  if (!r.ok) {
    const text = await r.text();
    throw new Error(`stripe ${method} ${path} → ${r.status}: ${text.slice(0, 400)}`);
  }
  return (await r.json()) as T;
}

async function listFirst(
  path: "products" | "prices",
  filter: Record<string, string>,
): Promise<(StripeProduct & StripePrice) | null> {
  // Stripe only accepts a small set of server-side filters. We pass through
  // the ones it supports for /prices (active, product) and filter
  // /products client-side by name.
  const qs = new URLSearchParams({ limit: "100" });
  if (path === "prices") {
    if (filter["active"]) qs.set("active", filter["active"]);
    if (filter["product"]) qs.set("product", filter["product"]);
  }
  const r = await stripe<{ data: (StripeProduct & StripePrice & { name?: string })[] }>(
    `${path}?${qs.toString()}`,
    "GET",
  );
  if (path === "products" && filter["name"]) {
    return r.data.find((p) => p.name === filter["name"]) ?? null;
  }
  return r.data[0] ?? null;
}
