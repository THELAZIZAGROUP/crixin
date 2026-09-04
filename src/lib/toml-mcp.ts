/**
 * Minimal TOML section mutator for MCP server registration in Codex CLI's
 * `~/.codex/config.toml`. Scope is intentionally narrow: add / find / remove
 * `[mcp_servers.<name>]` sections without disturbing the rest of the file.
 *
 * Why not a full TOML parser:
 *   - Codex's config is hand-edited by users and contains comments + custom
 *     formatting we must preserve byte-for-byte where we don't write.
 *   - A full parser would re-serialize the file on every write, mangling
 *     user comments and quirky-but-valid formatting.
 *   - We only ever touch one shape: a top-level table named
 *     `[mcp_servers.<server_id>]` containing `command = "..."` and
 *     `args = ["...", ...]`. Section-level surgery is enough.
 *
 * Section boundary rule: a section starts at a line whose first non-whitespace
 * character is `[` (the table header) and ends at the next such line or EOF.
 * Anything before the first `[` is the "preamble" and is preserved unchanged.
 */

export interface McpEntry {
  command: string;
  args: string[];
}

interface ParsedSection {
  header: string;     // e.g. "[mcp_servers.crixin-voice]"
  name: string;       // e.g. "mcp_servers.crixin-voice"
  rawBlock: string;   // header + everything until next header or EOF (no trailing trim)
}

interface ParsedToml {
  preamble: string;   // raw text before the first section header (may be empty)
  sections: ParsedSection[];
}

const HEADER_RE = /^\s*\[([^\]]+)\]\s*$/;

export function parseToml(src: string): ParsedToml {
  const lines = src.split(/\r?\n/);
  let firstHeaderIdx = -1;
  for (let i = 0; i < lines.length; i++) {
    if (HEADER_RE.test(lines[i]!)) {
      firstHeaderIdx = i;
      break;
    }
  }
  if (firstHeaderIdx === -1) {
    return { preamble: src, sections: [] };
  }
  const preambleLines = lines.slice(0, firstHeaderIdx);
  const preamble = preambleLines.length ? preambleLines.join("\n") + (preambleLines.some(Boolean) ? "\n" : "") : "";

  const sections: ParsedSection[] = [];
  let currentStart = firstHeaderIdx;
  let currentName = lines[firstHeaderIdx]!.match(HEADER_RE)![1]!.trim();

  for (let i = firstHeaderIdx + 1; i < lines.length; i++) {
    const m = lines[i]!.match(HEADER_RE);
    if (m) {
      // Close the previous section
      const block = lines.slice(currentStart, i).join("\n") + "\n";
      sections.push({
        header: `[${currentName}]`,
        name: currentName,
        rawBlock: block,
      });
      currentStart = i;
      currentName = m[1]!.trim();
    }
  }
  // Close the final section
  const tail = lines.slice(currentStart).join("\n");
  sections.push({
    header: `[${currentName}]`,
    name: currentName,
    rawBlock: tail.endsWith("\n") ? tail : tail + "\n",
  });

  return { preamble, sections };
}

export function serialize(parsed: ParsedToml): string {
  const body = parsed.sections.map((s) => s.rawBlock).join("");
  return parsed.preamble + body;
}

/**
 * Emit the canonical block for an MCP server section. Always uses double-quoted
 * strings to keep the output unambiguous. Always ends with a trailing blank line
 * so subsequent sections start cleanly.
 */
export function serializeMcpSection(name: string, entry: McpEntry): string {
  const argsLine =
    "args = [" +
    entry.args.map((a) => JSON.stringify(a)).join(", ") +
    "]";
  return (
    `[mcp_servers.${name}]\n` +
    `command = ${JSON.stringify(entry.command)}\n` +
    `${argsLine}\n` +
    `\n`
  );
}

/**
 * Compare an existing parsed section block against a desired entry. Returns
 * true if the section already encodes the same command + args (whitespace and
 * key order insensitive). Used for idempotency checks.
 */
export function sectionMatches(rawBlock: string, entry: McpEntry): boolean {
  const lines = rawBlock.split(/\r?\n/);
  let foundCommand: string | null = null;
  let foundArgs: string | null = null;
  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed.startsWith("command")) {
      const m = trimmed.match(/^command\s*=\s*(.+)$/);
      if (m) foundCommand = m[1]!.trim();
    } else if (trimmed.startsWith("args")) {
      const m = trimmed.match(/^args\s*=\s*(\[.+\])\s*$/);
      if (m) foundArgs = m[1]!.trim();
    }
  }
  if (!foundCommand || !foundArgs) return false;
  // Compare command string (handle both "x" and 'x' quoting)
  const desiredCommand = JSON.stringify(entry.command);
  const desiredArgs = "[" + entry.args.map((a) => JSON.stringify(a)).join(", ") + "]";
  // Normalize single quotes to double quotes for comparison
  const norm = (s: string) => s.replace(/'/g, '"').replace(/\s+/g, " ").trim();
  return norm(foundCommand) === norm(desiredCommand) && norm(foundArgs) === norm(desiredArgs);
}

/**
 * Mutation result returned by mutateMcpServer/removeMcpServer so callers can
 * report idempotency cleanly to the user.
 */
export interface MutationResult {
  toml: string;
  changed: boolean;
  replaced: boolean;   // true if an existing matching section was overwritten with different content
}

/**
 * Add or update `[mcp_servers.<name>]` in the given TOML source. Idempotent:
 * if the section is already present AND matches the desired entry exactly,
 * returns { changed: false }. Otherwise appends or replaces in place.
 */
export function mutateMcpServer(
  src: string,
  serverName: string,
  entry: McpEntry,
): MutationResult {
  const parsed = parseToml(src);
  const targetName = `mcp_servers.${serverName}`;
  const idx = parsed.sections.findIndex((s) => s.name === targetName);
  const newBlock = serializeMcpSection(serverName, entry);

  if (idx === -1) {
    // Append. Ensure preamble or last section has a trailing newline.
    let preamble = parsed.preamble;
    if (preamble.length > 0 && !preamble.endsWith("\n")) preamble += "\n";
    if (parsed.sections.length === 0) {
      // Pure-preamble file. Add a separating blank line if preamble isn't empty.
      const sep = preamble.length > 0 && !preamble.endsWith("\n\n") ? "\n" : "";
      return {
        toml: preamble + sep + newBlock,
        changed: true,
        replaced: false,
      };
    }
    const newSections = [
      ...parsed.sections,
      { header: `[${targetName}]`, name: targetName, rawBlock: newBlock },
    ];
    return {
      toml: serialize({ preamble, sections: newSections }),
      changed: true,
      replaced: false,
    };
  }

  // Already exists — check if it matches
  const existing = parsed.sections[idx]!;
  if (sectionMatches(existing.rawBlock, entry)) {
    return { toml: src, changed: false, replaced: false };
  }
  // Replace in place
  const newSections = [...parsed.sections];
  newSections[idx] = { header: `[${targetName}]`, name: targetName, rawBlock: newBlock };
  return {
    toml: serialize({ preamble: parsed.preamble, sections: newSections }),
    changed: true,
    replaced: true,
  };
}

/**
 * Remove `[mcp_servers.<name>]` from the given TOML source. Returns
 * { changed: false } if the section wasn't present.
 */
export function removeMcpServer(src: string, serverName: string): MutationResult {
  const parsed = parseToml(src);
  const targetName = `mcp_servers.${serverName}`;
  const idx = parsed.sections.findIndex((s) => s.name === targetName);
  if (idx === -1) return { toml: src, changed: false, replaced: false };
  const newSections = parsed.sections.filter((_, i) => i !== idx);
  return {
    toml: serialize({ preamble: parsed.preamble, sections: newSections }),
    changed: true,
    replaced: false,
  };
}
