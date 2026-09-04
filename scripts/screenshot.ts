/**
 * Capture screenshots of the in-product dashboard for the README + marketing site.
 *
 * Usage:
 *   npm run build && CRIXIN_HOME=/tmp/crixin-shot \\
 *     node --import tsx scripts/screenshot.ts
 *
 * Output:
 *   web/screenshots/dashboard.png  (1440x900, light)
 *   web/screenshots/wrapped.png    (1080x1500, the Wrapped report at a glance)
 */

import { chromium } from "playwright";
import { spawn } from "node:child_process";
import { mkdirSync, existsSync, writeFileSync, rmSync, mkdtempSync } from "node:fs";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";

const ROOT = resolve(import.meta.dirname, "..");
const SHOTS_DIR = join(ROOT, "web", "screenshots");
mkdirSync(SHOTS_DIR, { recursive: true });

const TMP_HOME = mkdtempSync(join(tmpdir(), "crixin-shot-"));
process.env["CRIXIN_HOME"] = TMP_HOME;

console.log("Spinning up the dashboard server (port 7790)…");
const server = spawn(
  "node",
  ["dist/cli/index.js", "--no-open", "--port", "7790"],
  {
    cwd: ROOT,
    env: { ...process.env, CRIXIN_HOME: TMP_HOME },
    stdio: ["ignore", "ignore", "inherit"],
  },
);

await waitForUrl("http://127.0.0.1:7790/health", 60_000);
console.log("Server ready.");

const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
const page = await ctx.newPage();

// Dashboard.
await page.goto("http://127.0.0.1:7790/", { waitUntil: "networkidle" });
await page.waitForTimeout(800);
await page.screenshot({ path: join(SHOTS_DIR, "dashboard.png"), fullPage: false });
console.log("Wrote dashboard.png");

// Wrapped — render to a separate file so we can shoot the HTML directly.
console.log("Generating Wrapped HTML…");
await new Promise<void>((res, rej) => {
  const w = spawn(
    "node",
    [
      "dist/cli/index.js",
      "wrapped",
      "--year",
      String(new Date().getFullYear()),
      "--anonymize",
      "--out",
      "/tmp/crixin-shot-wrapped.html",
    ],
    {
      cwd: ROOT,
      env: { ...process.env, CRIXIN_HOME: TMP_HOME },
      stdio: ["ignore", "inherit", "inherit"],
    },
  );
  w.on("exit", (c) => (c === 0 ? res() : rej(new Error(`wrapped failed (${c})`))));
});

if (existsSync("/tmp/crixin-shot-wrapped.html")) {
  await ctx.close();
  const ctx2 = await browser.newContext({ viewport: { width: 1080, height: 1500 } });
  const page2 = await ctx2.newPage();
  await page2.goto("file:///tmp/crixin-shot-wrapped.html", { waitUntil: "networkidle" });
  await page2.waitForTimeout(400);
  await page2.screenshot({ path: join(SHOTS_DIR, "wrapped.png"), fullPage: true });
  console.log("Wrote wrapped.png");
  await ctx2.close();
}

// OG image — 1200x630 for social cards.
const ogPath = resolve(ROOT, "launch", "og-image.html");
if (existsSync(ogPath)) {
  const ctx3 = await browser.newContext({ viewport: { width: 1200, height: 630 } });
  const page3 = await ctx3.newPage();
  await page3.goto("file://" + ogPath, { waitUntil: "networkidle" });
  await page3.waitForTimeout(200);
  await page3.screenshot({ path: join(ROOT, "web", "og-image.png"), fullPage: false });
  console.log("Wrote web/og-image.png");
  await ctx3.close();
}

await browser.close();
server.kill();
rmSync(TMP_HOME, { recursive: true, force: true });
console.log("Done.");

async function waitForUrl(url: string, timeoutMs: number): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  let lastErr: unknown;
  while (Date.now() < deadline) {
    try {
      const r = await fetch(url);
      if (r.ok) return;
    } catch (e) {
      lastErr = e;
    }
    await new Promise((r) => setTimeout(r, 1000));
  }
  throw new Error(`timeout waiting for ${url}: ${String(lastErr)}`);
}

void writeFileSync; // keep import alive for future telemetry stubs
