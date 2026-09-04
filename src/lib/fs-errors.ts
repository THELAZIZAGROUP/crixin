/**
 * Friendly translation of common Node fs errors into messages a user can act
 * on without reading a stack trace.
 *
 * Every install / uninstall / config-write path should funnel its caught
 * errors through `friendlyFsError()`. Raw Node ErrnoException messages leak
 * implementation detail and turn a recoverable mistake (wrong file ownership,
 * read-only mount, no disk space) into a moment of fragility.
 *
 * Principle: every failure should feel anticipated.
 */

interface ErrnoLike {
  code?: string;
  message: string;
}

function isErrno(err: unknown): err is ErrnoLike {
  return typeof err === "object" && err !== null && "message" in err;
}

/**
 * Translate a Node fs error into a multi-line operator-friendly message.
 * Always includes the raw error at the bottom so support requests can paste
 * the friendly + raw form together.
 */
export function friendlyFsError(err: unknown, path: string, label: string): string {
  const e = isErrno(err) ? err : { message: String(err) };
  const code = e.code;

  if (code === "EACCES" || code === "EPERM") {
    return [
      `${label} (${path}) — couldn't write the config: permission denied.`,
      ``,
      `  Try:`,
      `    • Check permissions:  ls -la "${path}"`,
      `    • Fix ownership:      sudo chown $(whoami) "${path}"`,
      `    • If you ran an earlier Crixin command with sudo, ownership may have flipped.`,
      `    • Or edit ${path} by hand to add the MCP entry.`,
      ``,
      `  Raw error: ${e.message}`,
    ].join("\n");
  }

  if (code === "EISDIR") {
    return [
      `${label} (${path}) — expected a file but found a directory.`,
      ``,
      `  Inspect with:  ls -la "${path}"`,
      `  Move or remove the directory, then re-run crixin install.`,
      ``,
      `  Raw error: ${e.message}`,
    ].join("\n");
  }

  if (code === "ENOTDIR") {
    return [
      `${label} (${path}) — a parent path is a file, not a directory.`,
      ``,
      `  Crixin needs to create the parent directory but something in the path is in the way.`,
      `  Inspect each parent: ls -la "${path}"`,
      ``,
      `  Raw error: ${e.message}`,
    ].join("\n");
  }

  if (code === "EROFS") {
    return [
      `${label} (${path}) — the filesystem is read-only.`,
      ``,
      `  ${path} is on a mounted volume that doesn't accept writes.`,
      `  Move the file to a writable location, or skip this host with --only.`,
      ``,
      `  Raw error: ${e.message}`,
    ].join("\n");
  }

  if (code === "ENOSPC") {
    return [
      `${label} (${path}) — couldn't write: no space left on device.`,
      ``,
      `  Free up some disk space and re-run crixin install.`,
      ``,
      `  Raw error: ${e.message}`,
    ].join("\n");
  }

  if (code === "EMFILE" || code === "ENFILE") {
    return [
      `${label} (${path}) — too many open files on this system.`,
      ``,
      `  Close some applications, or raise the open-file limit (ulimit -n on macOS/Linux).`,
      `  Then re-run crixin install.`,
      ``,
      `  Raw error: ${e.message}`,
    ].join("\n");
  }

  if (code === "ENOENT") {
    return [
      `${label} (${path}) — couldn't write: the path doesn't exist and couldn't be created.`,
      ``,
      `  Check the parent directory exists and is writable by your user.`,
      ``,
      `  Raw error: ${e.message}`,
    ].join("\n");
  }

  // Default — no recognized error code; surface the raw message but in a
  // structured form so the user knows it's the underlying OS error.
  return `${label} (${path}) — write failed.\n\n  Raw error: ${e.message}`;
}
