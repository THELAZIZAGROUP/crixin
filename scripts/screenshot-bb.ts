/**
 * Capture marketing screenshots via Browserbase (cloud headless Chrome).
 *
 * Why Browserbase over local Playwright:
 *   - No local Chromium install / management.
 *   - We use page.setContent(html) so the browser doesn't need to reach
 *     localhost — we ship the HTML to it.
 *   - Reproducible — same engine across machines + CI.
 *
 * Outputs:
 *   web/og-image.png       — 1200×630 social card from launch/og-image.html
 *   web/screenshots/wrapped.png — full-length annual Wrapped report
 *
 * Required env (in shell):
 *   BROWSERBASE_API_KEY
 *   BROWSERBASE_PROJECT_ID
 */

import { chromium } from "playwright";
import { spawn } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync, existsSync, mkdtempSync, rmSync } from "node:fs";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";

const ROOT = resolve(import.meta.dirname, "..");
const SHOTS_DIR = join(ROOT, "web", "screenshots");
mkdirSync(SHOTS_DIR, { recursive: true });

const apiKey = process.env["BROWSERBASE_API_KEY"];
const projectId = process.env["BROWSERBASE_PROJECT_ID"];
if (!apiKey || !projectId) {
  console.error("Set BROWSERBASE_API_KEY and BROWSERBASE_PROJECT_ID first.");
  process.exit(1);
}

console.log("Creating Browserbase session…");
const sessionRes = await fetch("https://api.browserbase.com/v1/sessions", {
  method: "POST",
  headers: { "x-bb-api-key": apiKey, "Content-Type": "application/json" },
  body: JSON.stringify({ projectId, browserSettings: { viewport: { width: 1200, height: 630 } } }),
});
if (!sessionRes.ok) {
  console.error("Browserbase session failed:", await sessionRes.text());
  process.exit(1);
}
const session = (await sessionRes.json()) as { id: string; connectUrl: string };
console.log(`Session ${session.id} ready.`);

const browser = await chromium.connectOverCDP(session.connectUrl);
try {
  // ---- 1. OG image ---------------------------------------------------------
  const ogHtmlPath = join(ROOT, "launch", "og-image.html");
  if (existsSync(ogHtmlPath)) {
    const html = readFileSync(ogHtmlPath, "utf8");
    const ctx = browser.contexts()[0] ?? (await browser.newContext());
    const page = await ctx.newPage();
    await page.setViewportSize({ width: 1200, height: 630 });
    await page.setContent(html, { waitUntil: "networkidle" });
    await page.waitForTimeout(500);
    const buf = await page.screenshot({ fullPage: false });
    writeFileSync(join(ROOT, "web", "og-image.png"), buf);
    console.log("Wrote web/og-image.png");
    await page.close();
  }

  // ---- 2. Wrapped report ---------------------------------------------------
  // Generate the HTML by running `crixin wrapped` against the user's real DB
  // (or a freshly-built temp DB if needed), then send the HTML to Browserbase.
  console.log("Generating Wrapped HTML…");
  const tmpHome = mkdtempSync(join(tmpdir(), "crixin-bb-"));
  const wrappedFile = join(tmpHome, "wrapped.html");
  await new Promise<void>((res, rej) => {
    const w = spawn(
      "node",
      [
        "dist/cli/index.js",
        "wrapped",
        "--year",
        String(new Date().getFullYear()),
        "--anonymize",
        "--reindex",
        "--out",
        wrappedFile,
      ],
      {
        cwd: ROOT,
        env: { ...process.env, CRIXIN_HOME: tmpHome },
        stdio: ["ignore", "inherit", "inherit"],
      },
    );
    w.on("exit", (c) => (c === 0 ? res() : rej(new Error(`wrapped failed (${c})`))));
  });

  if (existsSync(wrappedFile)) {
    const html = readFileSync(wrappedFile, "utf8");
    const ctx2 = await browser.newContext({ viewport: { width: 1080, height: 1500 } });
    const page2 = await ctx2.newPage();
    await page2.setContent(html, { waitUntil: "networkidle" });
    await page2.waitForTimeout(400);
    const buf = await page2.screenshot({ fullPage: true });
    writeFileSync(join(SHOTS_DIR, "wrapped.png"), buf);
    console.log("Wrote web/screenshots/wrapped.png");
    await page2.close();
    await ctx2.close();
  }
  rmSync(tmpHome, { recursive: true, force: true });
} finally {
  await browser.close();
  // Tell Browserbase to terminate the session promptly (saves credits).
  await fetch(`https://api.browserbase.com/v1/sessions/${session.id}`, {
    method: "POST",
    headers: { "x-bb-api-key": apiKey, "Content-Type": "application/json" },
    body: JSON.stringify({ status: "REQUEST_RELEASE", projectId }),
  }).catch(() => {});
}

console.log("Done.");
