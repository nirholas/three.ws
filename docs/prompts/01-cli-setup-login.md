# 01. One-command CLI: `npx three-ws setup`, `login`, `status`, `tools`

Read `docs/prompts/README.md` first.

## The problem

A developer who wants a model to use three.ws today has to read `docs/mcp.md`, pick one of seven hosted MCP servers, mint a key on the site or run the OAuth flow by hand, and paste a JSON block into their client config. There is no `login`, `setup` or `init` command anywhere under `packages/*` (grep `packages/*/src/cli.js`). The only one-command flow is `npm create @three-ws/agent`, which scaffolds a 3D agent and never touches auth or MCP.

The bar: one command that authenticates, wires every relevant MCP server into whatever client the developer uses, verifies with a real tool call, and prints what is now available.

## Build

A new package `packages/three-ws-cli/` published as `three-ws` (bin `three-ws`, so `npx three-ws <cmd>` works with no install) and also exposed as `@three-ws/cli`. Node 20+, ESM, no framework heavier than `commander` and `@clack/prompts` (check `package.json` first; reuse what is installed).

### Subcommands

- `three-ws setup`: interactive. Detects installed clients (Claude Code `.mcp.json` and `~/.claude.json`, Claude Desktop config, Cursor `~/.cursor/mcp.json`, Windsurf, VS Code `mcp.json`, Codex, Gemini CLI, Hermes-style `~/.hermes/config.yaml`, and a generic "print JSON" fallback). Offers two auth modes: **remote OAuth** (opens the browser to the existing OAuth 2.1 authorization endpoint under `api/oauth/[action].js`, uses PKCE, receives the code on a loopback port, stores the token) and **API key** (prompts for a key from `/settings/api-keys`, or mints one through `api/api-keys.js` after a browser login, with the scopes the user picks). Writes the MCP entries for the servers the user selects (default: `/api/mcp`, `/api/mcp-agent`, `/api/mcp-3d`; `/api/mcp-studio` and `/api/pump-fun-mcp` need no auth and are always offered). Offers the stdio path too: `npx -y @three-ws/x402-mcp` and the other `@three-ws/*-mcp` packages under `packages/`, with the key written to the client env block. Ends with a real `tools/list` call against each configured server and prints the count per server.
- `three-ws login`: re-authenticate only (OAuth or key), refresh a stored token, or switch accounts.
- `three-ws logout`: remove stored credentials.
- `three-ws status`: which servers are configured in which clients, auth state, token expiry, account email, wallet address and balance from `api/agents/solana-wallet.js`, current plan from `api/usage/summary.js`.
- `three-ws tools`: interactive picker to enable or disable tool groups per server (read-only groups on by default, financial groups off; the policy and group names come from prompt 03). Writes the selection into the client config as the server's allowed-tools list where the client supports it, otherwise into the three-ws credential store so the server can enforce it via a header.
- `three-ws mcp list | add <server> | remove <server>`: non-interactive equivalents for scripts and CI.
- `three-ws whoami`, `three-ws version`, `three-ws --json` on every command.

### Credential store

`~/.config/three-ws/credentials.json` with mode 0600, plus keychain on macOS through `keytar` if it is already a dependency somewhere in the repo, otherwise the file only. Token refresh is automatic. Never print a key or token after it is stored; print the last four characters.

### Install paths

- `npx three-ws setup` with nothing installed.
- `curl -fsSL https://three.ws/install.sh | bash` and the PowerShell twin, served from `public/install.sh` and `public/install.ps1`, which install Node if missing (via the platform's package manager, never a custom binary) and run the same setup. Add both to `data/pages.json` if they get a page, and to `docs/mcp.md`.
- Every hosted MCP server's 401 body and the `/.well-known/mcp.json` directory must mention `npx three-ws setup` as the fix.

### Server-side work this needs

- The OAuth authorization server must accept the loopback redirect URIs the CLI registers through dynamic client registration. Verify against `api/oauth/[action].js` and `.well-known/`.
- An `api/api-keys.js` action that mints a key from a short-lived browser session started by the CLI (device-style link code: CLI prints a URL plus code, the site page `/cli/authorize` confirms it, the CLI polls). Build the page with every state designed.

## Docs and wiring

- `docs/cli.md` (new): every subcommand, every flag, the credential store location, and a two-minute quick start. Link it from `docs/start-here.md` and from `docs/mcp.md` at the top, replacing the hand-paste instructions as the primary path (keep the JSON as the manual alternative).
- `.agents/skills/connect-three-ws-mcp/SKILL.md`: lead with `npx three-ws setup`.
- README for the package under `packages/three-ws-cli/README.md`.
- `STRUCTURE.md` row, `data/changelog.json` entry tagged `feature, sdk`.

## Acceptance

- On a clean machine: `npx three-ws setup`, choose OAuth, finish in the browser, and the command ends with a live tool count from at least three servers.
- Same with an API key.
- Claude Code, Claude Desktop and Cursor each show three.ws tools after setup with no manual editing.
- `three-ws status` shows the wallet balance that `/agents/wallet` shows in the browser.
- Tests under `packages/three-ws-cli/tests/` cover config detection and writing for every client format, token refresh, and the picker's config output; `npm test` green.
