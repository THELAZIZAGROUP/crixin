/**
 * `crixin sync <subcommand>` — sub-router for cross-machine metadata sync (Pro).
 *
 * Subcommands:
 *   status   show device + link state. Works on Free (shows "off").
 *   link     open browser to /sync/link OR finalize with --token <…>
 *   enable   turn sync on. Pro-gated.
 *   disable  turn sync off (does NOT forget the link by default).
 *   push     extract metadata + send to server.
 *   pull     fetch peer metadata into the local inbox.
 *   devices  list devices linked to the account.
 *
 * What this NEVER sends: message bodies, transcripts, credentials, env vars,
 * phone numbers, free-text tags. See src/sync/metadata.ts.
 */
import kleur from "kleur";
import { log } from "../lib/log.js";
import { openInBrowser } from "../lib/browser.js";
import { isPro, PRO_UPGRADE_HINT } from "../license/features.js";
import { readSyncState, patchSyncState, redactedState } from "./state.js";
import { ensureThisDevice, listLocalDevices, upsertRemoteDevice, forgetThisDevice } from "./device.js";
import { runSyncPush } from "./push.js";
import { runSyncPull } from "./pull.js";
import { syncRequest, SyncAuthError } from "./client.js";
import { outboxStats, inboxStats, listInbox } from "./queries.js";

const SYNC_HELP = `${kleur.bold("crixin sync")} — metadata sync across your machines (Pro).

${kleur.gray("Subcommands:")}
  ${kleur.cyan("crixin sync status")}                show device + link state + queue counts
  ${kleur.cyan("crixin sync link")}                  approve this device via browser
  ${kleur.cyan("crixin sync link")} ${kleur.gray("--token <jwt>")}   finalize after browser approval
  ${kleur.cyan("crixin sync enable")}                turn sync on (Pro)
  ${kleur.cyan("crixin sync disable")} ${kleur.gray("[--forget]")}   turn sync off (--forget also clears the token)
  ${kleur.cyan("crixin sync push")}                  send metadata to the server (Pro)
  ${kleur.cyan("crixin sync pull")} ${kleur.gray("[--since 0]")}     fetch peer metadata (Pro)
  ${kleur.cyan("crixin sync devices")}               list devices on this account (Pro)
  ${kleur.cyan("crixin sync inbox")} ${kleur.gray("[--limit N] [--json]")}  list latest pulled metadata records (Pro)

${kleur.gray("What this never sends:")}
  message bodies, transcripts, credentials, env vars, phone numbers, free-text tags.
  See ${kleur.cyan("src/sync/metadata.ts")} — the typed extractor is the privacy floor.

${kleur.gray("Docs:")} https://crixin.com/sync
`;

interface SyncArgs {
  positionals: string[];
  flags: Record<string, string | boolean>;
}

export async function runSync(args: SyncArgs): Promise<number> {
  const sub = args.positionals[0];

  if (!sub || sub === "help" || args.flags["help"] || args.flags["h"]) {
    process.stdout.write(SYNC_HELP);
    return 0;
  }

  if (sub === "status")  return runStatus();
  if (sub === "link")    return await runLink(args);
  if (sub === "enable")  return runEnable();
  if (sub === "disable") return runDisable(args);
  if (sub === "push")    return await runPushCmd(args);
  if (sub === "pull")    return await runPullCmd(args);
  if (sub === "devices") return await runDevices();
  if (sub === "inbox")   return runInbox(args);

  log.error(`Unknown sync subcommand: ${sub}`);
  process.stdout.write(SYNC_HELP);
  return 1;
}

function runStatus(): number {
  const state = readSyncState();
  const device = ensureThisDevice();
  const redacted = redactedState(state);
  const outbox = outboxStats();
  const inbox = inboxStats();

  process.stdout.write(kleur.bold("crixin sync — status\n\n"));
  log.stat("device id",     device.device_id);
  log.stat("device name",   device.device_name);
  log.stat("hostname",      device.hostname);
  log.stat("os",            device.os);
  log.stat("linked",        state.account_uid ? kleur.green(state.account_email ?? state.account_uid) : kleur.gray("no"));
  log.stat("enabled",       state.enabled ? kleur.green("yes") : kleur.gray("no"));
  log.stat("server",        state.server);
  log.stat("license",       isPro() ? kleur.green("Pro") : kleur.gray("Free"));
  log.stat("token",         redacted.device_token_present ? kleur.green("present") : kleur.gray("missing"));
  log.stat("last push",     state.last_pushed_at ? new Date(state.last_pushed_at).toISOString() : kleur.gray("never"));
  log.stat("last pull",     state.last_pulled_at ? new Date(state.last_pulled_at).toISOString() : kleur.gray("never"));

  process.stdout.write("\n");
  log.stat("outbox pending",  outbox.pending);
  log.stat("outbox pushed",   outbox.pushed);
  if (outbox.errored > 0) log.stat("outbox errored", kleur.yellow(String(outbox.errored)));
  log.stat("inbox records",   inbox.total);
  log.stat("peer devices",    inbox.distinct_devices);
  log.stat(
    "latest peer record",
    inbox.latest_updated_at ? new Date(inbox.latest_updated_at).toISOString() : kleur.gray("none"),
  );

  if (!state.account_uid) {
    process.stdout.write("\n");
    log.hint(`Not linked yet. Run ${kleur.cyan("crixin sync link")} to approve this device.`);
  } else if (!isPro()) {
    process.stdout.write("\n");
    log.hint(PRO_UPGRADE_HINT);
  } else if (!state.enabled) {
    process.stdout.write("\n");
    log.hint(`Sync is off. Run ${kleur.cyan("crixin sync enable")} to turn it on.`);
  } else if (inbox.total > 0) {
    process.stdout.write("\n");
    log.hint(`Run ${kleur.cyan("crixin sync inbox")} to see the latest pulled records.`);
  }
  return 0;
}

async function runLink(args: SyncArgs): Promise<number> {
  const tokenFlag = typeof args.flags["token"] === "string" ? (args.flags["token"] as string).trim() : "";
  const state = readSyncState();
  const device = ensureThisDevice();

  // Path A: `crixin sync link --token <…>` finalizes the flow.
  if (tokenFlag) {
    try {
      // Verify the token works by listing devices.
      const r = await syncRequest<{ ok: true; devices: Array<{ device_id: string }> }>({
        method: "GET",
        path: "/api/sync/device",
        token: tokenFlag,
      });
      patchSyncState({
        device_token: tokenFlag,
        account_uid: extractUidFromToken(tokenFlag),
      });
      // Try to read the linked account email from /api/auth/me-style fields.
      // The pull endpoint will fill in account_email later; for now hint user.
      log.success("Device linked.");
      log.hint(`${r.data.devices.length} device(s) registered.`);
      log.hint(`Next: ${kleur.cyan("crixin sync enable")} then ${kleur.cyan("crixin sync push")}.`);
      return 0;
    } catch (err) {
      if (err instanceof SyncAuthError) {
        log.error("Token rejected by server.");
        log.hint(err.message);
      } else {
        log.error(`Could not verify token: ${(err as Error).message}`);
      }
      return 1;
    }
  }

  // Path B: open the browser to approve. The user pastes the token back.
  const base = state.server;
  const url = new URL("/sync/link", base);
  url.searchParams.set("device_id", device.device_id);
  url.searchParams.set("device_name", device.device_name);
  url.searchParams.set("hostname", device.hostname);
  url.searchParams.set("os", device.os);

  log.info("Opening browser to approve this device…");
  log.stat("device id",   device.device_id);
  log.stat("device name", device.device_name);
  process.stdout.write("\n");
  log.hint(`If the browser doesn't open, visit:\n      ${kleur.cyan(url.toString())}`);
  process.stdout.write("\n");
  log.hint(`After approval, run: ${kleur.cyan("crixin sync link --token <token-from-browser>")}`);
  await openInBrowser(url.toString());
  return 0;
}

function runEnable(): number {
  if (!isPro()) {
    log.error("Sync is a Pro feature.");
    log.hint(PRO_UPGRADE_HINT);
    return 1;
  }
  const state = readSyncState();
  if (!state.account_uid || !state.device_token) {
    log.error("Not linked yet.");
    log.hint(`Run ${kleur.cyan("crixin sync link")} first.`);
    return 1;
  }
  patchSyncState({ enabled: true });
  log.success("Sync enabled.");
  log.hint(`Now run ${kleur.cyan("crixin sync push")} to send metadata, or ${kleur.cyan("crixin sync pull")} to fetch from peers.`);
  return 0;
}

function runDisable(args: SyncArgs): number {
  const forget = Boolean(args.flags["forget"]);
  if (forget) {
    forgetThisDevice();
    log.success("Sync disabled and device forgotten. Re-run `crixin sync link` to relink.");
    return 0;
  }
  patchSyncState({ enabled: false });
  log.success("Sync disabled. Device token kept — run `crixin sync enable` to resume.");
  return 0;
}

async function runPushCmd(args: SyncArgs): Promise<number> {
  if (!isPro()) {
    log.error("Sync push is a Pro feature.");
    log.hint(PRO_UPGRADE_HINT);
    return 1;
  }
  const limit = args.flags["limit"] ? Number(args.flags["limit"]) : undefined;
  const dryRun = Boolean(args.flags["dry-run"]);
  try {
    const s = await runSyncPush({ limit, dryRun });
    process.stdout.write(kleur.bold("\ncrixin sync push\n\n"));
    log.stat("extracted",  s.extracted);
    log.stat("queued",     s.queued);
    log.stat("unchanged",  s.unchanged);
    log.stat("pushed",     s.pushed);
    log.stat("rejected",   s.rejected);
    if (dryRun) log.hint("dry run — no network calls made.");
    return s.rejected > 0 && s.pushed === 0 ? 1 : 0;
  } catch (err) {
    log.error((err as Error).message);
    return 1;
  }
}

async function runPullCmd(args: SyncArgs): Promise<number> {
  if (!isPro()) {
    log.error("Sync pull is a Pro feature.");
    log.hint(PRO_UPGRADE_HINT);
    return 1;
  }
  const limit = args.flags["limit"] ? Number(args.flags["limit"]) : undefined;
  const since = args.flags["since"] !== undefined ? Number(args.flags["since"]) : undefined;
  try {
    const s = await runSyncPull({ limit, since });
    process.stdout.write(kleur.bold("\ncrixin sync pull\n\n"));
    log.stat("fetched",    s.fetched);
    log.stat("new",        s.inserted);
    log.stat("unchanged",  s.unchanged);
    log.stat("cursor",     new Date(s.new_cursor).toISOString());
    if (s.truncated) log.hint("server reported more records — rerun to continue.");
    return 0;
  } catch (err) {
    log.error((err as Error).message);
    return 1;
  }
}

async function runDevices(): Promise<number> {
  if (!isPro()) {
    log.error("Device listing is a Pro feature.");
    log.hint(PRO_UPGRADE_HINT);
    return 1;
  }
  try {
    const r = await syncRequest<{ ok: true; devices: Array<{
      device_id: string;
      device_name: string | null;
      hostname: string | null;
      os: string | null;
      created_at: number | null;
      last_seen_at: number | null;
    }> }>({ method: "GET", path: "/api/sync/device" });

    for (const d of r.data.devices) {
      upsertRemoteDevice({
        device_id: d.device_id,
        device_name: d.device_name,
        hostname: d.hostname,
        os: d.os,
        created_at: d.created_at,
        last_seen_at: d.last_seen_at,
      });
    }

    const rows = listLocalDevices();
    process.stdout.write(kleur.bold("\ncrixin sync devices\n\n"));
    for (const d of rows) {
      const marker = d.is_this_device ? kleur.green("● this") : kleur.gray("○");
      const last = d.last_seen_at ? new Date(d.last_seen_at).toISOString() : kleur.gray("never");
      process.stdout.write(`  ${marker} ${(d.device_name ?? d.hostname ?? d.device_id).padEnd(24)} ${kleur.gray(d.device_id.slice(0, 12))}  ${kleur.gray(last)}\n`);
    }
    return 0;
  } catch (err) {
    log.error((err as Error).message);
    return 1;
  }
}

function runInbox(args: SyncArgs): number {
  if (!isPro()) {
    log.error("Sync inbox is a Pro feature.");
    log.hint(PRO_UPGRADE_HINT);
    return 1;
  }
  const limit = args.flags["limit"] ? Math.max(1, Math.min(Number(args.flags["limit"]), 200)) : 10;
  const json = Boolean(args.flags["json"]);
  const rows = listInbox(limit);

  if (json) {
    process.stdout.write(JSON.stringify(rows, null, 2) + "\n");
    return 0;
  }

  process.stdout.write(kleur.bold("\ncrixin sync inbox\n\n"));
  if (rows.length === 0) {
    log.hint(`No pulled records yet. Run ${kleur.cyan("crixin sync pull")} to fetch metadata from peers.`);
    return 0;
  }

  const devices = listLocalDevices();
  const deviceLabel = new Map<string, string>();
  for (const d of devices) {
    deviceLabel.set(d.device_id, d.device_name ?? d.hostname ?? d.device_id.slice(0, 8));
  }

  for (const r of rows) {
    const label = r.source_device_id
      ? (deviceLabel.get(r.source_device_id) ?? r.source_device_id.slice(0, 12))
      : kleur.gray("unknown");
    const when = r.ended_at ?? r.started_at;
    const whenStr = when ? new Date(when).toISOString().slice(0, 16).replace("T", " ") : kleur.gray("—");
    const sourceCol = kleur.cyan(r.source.padEnd(11));
    const labelCol = label.padEnd(16).slice(0, 16);
    const projectCol = (r.project ?? kleur.gray("—")).padEnd(28).slice(0, 28);
    const detail =
      r.source === "voice"
        ? kleur.gray(`${r.duration_seconds ?? 0}s`)
        : kleur.gray(`${r.message_count ?? 0} msgs`);
    process.stdout.write(`  ${sourceCol} ${labelCol} ${projectCol} ${whenStr}  ${detail}\n`);
  }

  if (rows.length === limit) {
    process.stdout.write("\n");
    log.hint(`Showing latest ${limit}. Pass ${kleur.cyan("--limit N")} for more, or ${kleur.cyan("--json")} for raw output.`);
  }
  return 0;
}

/** Best-effort uid extraction — purely for state-file display. Token is still verified server-side. */
function extractUidFromToken(token: string): string | null {
  const parts = token.split(".");
  if (parts.length !== 3) return null;
  try {
    const payload = JSON.parse(Buffer.from(parts[1]!, "base64url").toString("utf8")) as { uid?: string };
    return typeof payload.uid === "string" ? payload.uid : null;
  } catch { return null; }
}
