# Getting the Voice MCP into the marketplaces

Status as of 2026-09-04. Four surfaces, in order of how far along each is. Every requirement below was read from the live docs on that date; items marked UNVERIFIED come from third parties.

| Surface | What it is | Status | Blocker |
|---|---|---|---|
| Official MCP registry (`registry.modelcontextprotocol.io`) | The shared index VS Code, GitHub and other clients read | **Published**: `com.crixin/voice` lists the npm package and the remote | None |
| Claude Desktop extension (MCPB) | One-click local install in Claude Desktop, listed via Anthropic's extension form | Bundle builds from `scripts/build-mcpb.sh`; repo public | Form submission (human) |
| Claude Connectors Directory (remote) | Listing in claude.ai "Browse connectors" | Remote endpoint live, tools annotated | Team/Enterprise org + OAuth 2.0 |
| ChatGPT plugins (OpenAI) | Plugins Directory shared by ChatGPT and Codex; MCP-only plugins accepted | Remote endpoint live, tools annotated | Verified developer identity + OAuth 2.1 |

The remote endpoint is `https://crixin-platform.vercel.app/api/mcp` (Streamable HTTP, stateless, `Authorization: Bearer crx_live_…`). Both curated directories reject API-key auth for listed connectors, so the same OAuth 2.1 server unblocks both.

## 1. Official MCP registry — done

Sources: `modelcontextprotocol/registry` repo docs (`docs/modelcontextprotocol-io/quickstart.mdx`, `authentication.mdx`, `docs/reference/server-json/generic-server-json.md`, `docs/reference/cli/commands.md`).

- `server.json` at the repo root (schema `2025-12-11`) describes the npm package, run as `npx crixin voice mcp`, and the remote endpoint. Description is capped at 100 characters; remote URLs must be unique registry-wide; versions are immutable, so every metadata change needs a new version.
- `package.json` carries `"mcpName": "com.crixin/voice"`. The registry fetches that exact version from npm at publish time, so npm publish always comes first.
- Namespace `com.crixin/*` is proven over HTTP: crixin.com serves `/.well-known/mcp-registry-auth` with `v=MCPv1; k=ed25519; p=<public key>`. DNS proof at the apex would also grant `com.crixin.*` subnamespaces, but crixin.com's DNS lives at Google/Squarespace, not in any project we control from the CLI. The signing key is kept outside the repository by the maintainer.

Re-publish after any change (all from this repo):

```bash
npm publish                                   # bump the version first; registry versions are immutable
mcp-publisher login http --domain crixin.com --private-key "$MCP_REGISTRY_KEY_HEX"   # Ed25519 seed as 64 hex chars; token cached by the CLI
mcp-publisher validate server.json && mcp-publisher publish
curl 'https://registry.modelcontextprotocol.io/v0/servers?search=crixin'
```

## 2. Claude Desktop extension (MCPB)

Sources: `modelcontextprotocol/mcpb` (`MANIFEST.md`, `CLI.md`, the repo moved from `anthropics/mcpb`), `claude.com/docs/connectors/building/submission`, and the submission form itself.

- `manifest.json` at the repo root (manifest_version `0.3`): Node server, entry `bin/crixin.js voice mcp`, `user_config` for the Crixin key or BYO-Twilio creds, `privacy_policies` pointing at `https://crixin.com/legal/privacy`. Missing or incomplete privacy policies mean immediate rejection; the README also carries a Privacy Policy section. Sensitive `user_config` values go to the OS keychain.
- Build: `scripts/build-mcpb.sh` → `build/crixin-voice-<version>.mcpb` (stages `bin/`, `dist/`, production `node_modules/`, `icon.png`, validates, packs). Optional: `npx @anthropic-ai/mcpb sign <file> --self-signed`.
- Submit: the desktop-extension form at `https://clau.de/desktop-extention-submission` (a Google Form, any Google account, no Team plan). It asks for contact name and email, a description of at most 50 words, the GitHub link, whether you work for the company that owns the connected service, the `.mcpb` upload, and agreement to the directory terms. Stated requirements: **extension publicly available on GitHub, MIT licensed, built with Node.js, `author` pointing at your GitHub profile**. The code is public at `https://github.com/THELAZIZAGROUP/crixin` (MIT, Node). No response or inclusion is guaranteed; Anthropic contacts selected developers.
- Users can install any `.mcpb` today via Claude Desktop → Settings → Extensions → Advanced → Install Extension.

## 3. Claude Connectors Directory (remote server)

Sources: `claude.com/docs/connectors/building/submission`, `/building/authentication`, `/building/review-criteria`, and the Anthropic Software Directory Policy (support article 13145358).

- Submissions happen in `https://claude.ai/admin-settings/directory/submissions/new`, which exists only for **Team or Enterprise** organizations (Owner or Primary owner). Individual plans cannot submit. Escalations: `mcp-review@anthropic.com`.
- Policy text: "Remote MCP servers that connect to a remote service and require authentication must use secure OAuth 2.0 with certificates from recognized authorities." Supported modes: OAuth with dynamic client registration, OAuth with a client ID metadata document, or a client id and secret held by Anthropic. `client_credentials` is not supported. PKCE S256 is mandatory. The 401 must carry `WWW-Authenticate: Bearer resource_metadata="…/.well-known/oauth-protected-resource"`. Hosted callback: `https://claude.ai/api/mcp/auth_callback`; Claude Code uses loopback callbacks. API keys as request headers exist only as a beta for custom connectors in a limited set of orgs, not as a directory auth mode.
- Transport: Streamable HTTP (SSE still accepted, being deprecated). Tool results capped around 150,000 characters; 300-second timeout.
- Tool rules: every tool has a `title` plus `readOnlyHint: true` for reads or `destructiveHint: true` for writes (done on both servers); names of 64 characters or fewer; no catch-all tool mixing reads and writes; narrow descriptions without prompt-injection patterns; specific error messages; no conversation-data collection.
- Listing needs: documentation URL, HTTPS privacy policy URL, support contact, icon, at least three working example prompts, a populated test account, and seven policy acknowledgments. Listing fields: name ≤100 characters, tagline ≤55, description ≤2,000, one to five categories, permanent slug.
- Review: "Review times vary with queue volume." New submissions are auto-scanned and listed as Community; Anthropic may escalate to Verified after manual per-tool testing. A two-week figure circulates in blog posts: UNVERIFIED.
- Prohibited: money or crypto transfers, AI image/video/audio generation, ad serving.

What is missing on our side: an OAuth 2.1 authorization server in front of `/api/mcp` (authorization-code + refresh grants, PKCE S256, dynamic client registration or a client ID metadata document), `/.well-known/oauth-protected-resource` on the platform, and the Team-plan org.

## 4. ChatGPT (OpenAI plugins, formerly Apps SDK)

Sources: `developers.openai.com/plugins/*` (the Apps SDK docs redirect there; the app directory became the Plugins Directory on 2026-07-09), `openai.com/policies/usage-policies`.

- Submit at `https://platform.openai.com/plugins` → Create plugin → "With MCP". Needs a **verified individual or business identity**, the "Apps Management = Write" role, and a project **without EU data residency**. Egypt-specific developer eligibility: UNVERIFIED.
- MCP-only plugins are accepted; no UI required; screenshots only for plugins with UI.
- Auth: "For an authenticated MCP server, you are expected to implement an OAuth 2.1 flow that conforms to the MCP authorization spec." PKCE S256 mandatory; `/.well-known/oauth-protected-resource` required; client ID metadata document preferred, dynamic client registration optional, static client credentials accepted. API keys and bearer tokens are explicitly unsupported. A `noauth` security scheme is allowed for anonymous read tools. Advertise `offline_access` so refresh tokens keep the connection alive.
- Server checks: public production HTTPS URL, a domain-verification token served at `/.well-known/openai-apps-challenge`, a passing "Scan Tools" run, and demo credentials that work "without MFA, SMS, email confirmation, or private-network access".
- Every tool needs `readOnlyHint`, `openWorldHint` and `destructiveHint` **plus a written justification for each** in the portal. Also required: at least five positive and three negative test cases, starter prompts, a country list, release notes, policy attestations. Display name ≤30 characters; website, support, privacy-policy and terms URLs all required over HTTPS.
- Rules that shape the listing: "Side effects should never be hidden or implicit." ChatGPT's default "Important actions" permission asks before actions with effects outside ChatGPT, so make_call and send_sms are marked write, open-world and destructive. Usage policies forbid deception, impersonation, and use of a real person's voice without consent; plugins must not facilitate "negative-option billing, telemarketing, or consent-bypass schemes". Position Crixin as a personal assistant calling businesses for the user, keep the geo-gate and consent attestation, and disclose AI on the call (the disclosure point is our inference from the impersonation rule, not a quoted requirement).
- Monetization: plugins may sell physical goods only, via external checkout; they "must not display subscription plans, initiate new subscriptions, or promote upgrades", but "users may sign in to an existing paid account and access features already included in their subscription". So the plugin never mentions the $9.99 plan; checkout stays on the platform site.

## Interim distribution that needs no listing

- Claude Code: `claude mcp add --transport http crixin-voice https://crixin-platform.vercel.app/api/mcp --header "Authorization: Bearer crx_live_…"` (also `--scope user`, or a `.mcp.json` entry with `${CRIXIN_API_KEY}` expansion).
- Cursor / VS Code: HTTP MCP server with the same URL and header.
- claude.ai custom connector: the Request-headers field for API keys is beta and only visible to some orgs; otherwise OAuth or no-auth only.
- ChatGPT developer mode: Settings → Security and login → Developer mode → Apps → Create → URL. Auth options there are OAuth, none, or mixed; no API-key option. Write actions need Business, Enterprise or Edu; Pro is read-only. Web only.
- npm: `npx -y crixin voice mcp` (stdio), which is what the registry entry points at.
