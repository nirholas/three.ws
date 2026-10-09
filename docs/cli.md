# three-ws CLI

`three-ws` connects any MCP client to three.ws in one command. It signs you in, writes the hosted three.ws MCP servers into every client it finds on your machine (Claude Code, Claude Desktop, Cursor, Windsurf, VS Code, Codex, Gemini CLI, Hermes), and then proves each one works with a live `tools/list` call.

If you only use one client and it supports remote connectors, the [connect page](/connect) is faster: one click adds three.ws to Claude, Cursor or VS Code, with no terminal. Use the CLI when you want several clients configured at once, per-project config, an API key instead of a browser sign-in, or control over which tools each client may call.

Requires Node.js 20.12 or newer.

## Quick start

```bash
npx three-ws setup
```

Setup walks through three steps:

1. **Sign in.** A browser opens on three.ws. Approve the permissions and the terminal picks up the token. If you are already signed in, setup asks whether to keep that account.
2. **Pick servers and clients.** The server list is read live from [/.well-known/mcp.json](/.well-known/mcp.json), and the clients are the ones detected on this machine. Keyless servers (3D Studio free, pump.fun) are always offered because they need no account.
3. **Write and verify.** Each client's config file is updated in place (other entries are left alone), then every server is called with `tools/list` so you see a tool count, not a guess.

Restart the client afterwards so it loads the new servers.

## Sign-in options

| Flag | What it does | Use it when |
|---|---|---|
| `--oauth` (default) | Browser sign-in with PKCE. Tokens refresh automatically. | Your own machine. |
| `--device` | Prints a code you approve in any browser, on any device. Yields an API key. | Over SSH, or on a machine with no browser. |
| `--key [sk_live_...]` | Uses an API key from [Dashboard → API](/dashboard/api), or `THREE_WS_API_KEY`. | CI, servers, scripts. |
| `--financial` | Also requests the scopes that let tools spend from your agent wallet, within its caps. | You want the assistant to pay for x402 services or trade. |

Without `--financial`, tools that move funds are not granted, whatever the client asks for. Credentials are stored in `~/.config/three-ws/credentials.json` (or `$XDG_CONFIG_HOME/three-ws/`) with file mode 0600.

## Setup options

```bash
# Only Cursor and VS Code, only the main server and the free 3D studio, no prompts
npx three-ws setup --clients cursor,vscode --servers three-ws-main,three-ws-studio --yes

# Project-scoped config: writes .mcp.json, .cursor/mcp.json, .vscode/mcp.json, .gemini/settings.json here
npx three-ws setup --project

# Print the config instead of writing any file
npx three-ws setup --clients print
```

| Flag | Values |
|---|---|
| `--clients` | `claude-code`, `claude-desktop`, `cursor`, `windsurf`, `vscode`, `codex`, `gemini`, `hermes`, `grok-bot`, `print` |
| `--connector-key` | With `grok-bot`: mint a spend-free API key for Grok Bot's Bot secret |
| `--no-copy` | With `grok-bot`: do not copy the server URL to the clipboard |
| `--servers` | Server names from `npx three-ws mcp list --available` |
| `--packages` | Also add stdio `@three-ws/*-mcp` packages |
| `--project` | Write project-scoped config in the current directory |
| `--proxy` | Route every server through the local proxy, so your tool choices apply in every client |
| `--yes` | Never prompt; take the defaults |

### Grok Bot

Grok Bot is configured in xAI's cloud, so `setup` cannot write a file for it. `--clients grok-bot` runs the part the CLI can do, with no sign-in for the free studio:

```bash
npx three-ws setup --client grok-bot
npx three-ws setup --client grok-bot --connector-key   # key for your agents, never spends
```

It prints the fields Grok Bot's custom MCP connector asks for (name `three-ws`, transport Streamable HTTP, server URL `https://three.ws/api/mcp-grok`, authentication None or API key), the one-line chat prompt that adds the same server, copies the URL to the clipboard where a clipboard tool exists, and verifies the public URL with a live `tools/list`. The command exits 1 if that verification fails. With `--connector-key` it signs in if needed (requesting `agents:write`), mints a `connector` preset key once through `POST /api/api-keys`, stores it in the credential file, and prints it for the Bot secret field. Revoke it any time on [Dashboard → API](/dashboard/api). The full Grok setup is in [three.ws for Grok](./grok.md) and the [Grok Bot guide](./grok-bot.md).

### Where each client's config lives

| Client | User config | `--project` config |
|---|---|---|
| Claude Code | `~/.claude.json` | `.mcp.json` |
| Claude Desktop | `Claude/claude_desktop_config.json` in your app-data folder | |
| Cursor | `~/.cursor/mcp.json` | `.cursor/mcp.json` |
| Windsurf | `~/.codeium/windsurf/mcp_config.json` | |
| VS Code | `Code/User/mcp.json` in your app-data folder | `.vscode/mcp.json` |
| Codex | `$CODEX_HOME/config.toml` (default `~/.codex`) | |
| Gemini CLI | `~/.gemini/settings.json` | `.gemini/settings.json` |
| Hermes | `$HERMES_HOME/config.yaml` (default `~/.hermes`) | |

### Server names

Every client stores a server under the same name, which is also what `--servers`, `mcp add` and `mcp remove` take. The [connect page](/connect) uses the same names, so adding a server both ways never creates a duplicate.

| Name | Endpoint | Account |
|---|---|---|
| `three-ws-main` | `https://three.ws/api/mcp` | Sign-in |
| `three-ws-3d` | `https://three.ws/api/mcp-3d` | Sign-in or x402 |
| `three-ws-studio` | `https://three.ws/api/mcp-studio` | None |
| `three-ws-agent` | `https://three.ws/api/mcp-agent` | Sign-in |
| `three-ws-bazaar` | `https://three.ws/api/mcp-bazaar` | Sign-in or x402 |
| `three-ws-pump-fun` | `https://three.ws/api/pump-fun-mcp` | None for reads |
| `three-ws-ibm` | `https://three.ws/api/ibm-mcp` | Sign-in or x402 |

`npx three-ws mcp list --available` prints the live list, which is the source of truth if this table and the directory ever disagree.

## Create an agent and launch its coin

```bash
npx three-ws create "Nova" --description "A deep-space guide who explains orbital mechanics."
npx three-ws launch --agent <agent-id> --name "Nova" --symbol NOVA
```

`create` makes the agent on your account and prints its public page and the Solana wallet three.ws minted for it. Pass `--avatar <id>` to use an avatar you already own as its 3D body; otherwise give it a body on its page. A name that imitates an existing public agent is refused with the reason, so pick a distinct one.

`launch` never spends anything from the terminal. It collects the coin's name, ticker, description, optional image (`--image`, the agent's portrait by default) and optional first buy (`--initial-buy <sol>`), then opens [/launch](/launch) with all of it filled in. You review the cost there and sign the launch in your browser. The launching agent needs a 3D body, because that page picks agents by their body. Run either command with no flags to be prompted for each field, or with `--json` to get the agent record or the review URL as JSON.

## Choosing which tools a client may call

Every tool is labelled read, write or financial ([the catalog](/mcp-tools) shows which is which). By default read and write tools are on and financial tools are off.

```bash
# See and change the tool selection interactively
npx three-ws tools

# Turn financial tools on for the main server only
npx three-ws tools --server three-ws-main --enable financial

# Back to the default
npx three-ws tools --server three-ws-main --reset
```

The selection is enforced whichever way you signed in. With a browser sign-in, servers that need an account run through the local proxy (`three-ws proxy`), which also keeps your token fresh: `tools/list` returns only enabled tools, and a call to a disabled one is answered by the proxy with an error explaining how to enable it, without reaching the server. With an API key, the selection travels to the server in the `X-Three-Tools` header, and clients that support a tool allowlist get one written too. `--proxy` routes every server through the proxy regardless.

## All commands

| Command | What it does |
|---|---|
| `setup` | Sign in, write servers into clients, verify with `tools/list` |
| `login` / `logout` | Sign in or switch accounts; `logout` also revokes the OAuth refresh token |
| `status` / `whoami` | Account, plan, wallet balance, token expiry and every configured client |
| `create [name]` | Create an agent with its own Solana wallet and public page |
| `launch` | Fill in a coin for one of your agents and open three.ws/launch to review and sign it |
| `mcp list` | Servers configured in each client (`--available` lists every server) |
| `mcp add <server>` / `mcp remove <server>` | Add or remove one server without prompts |
| `tools` | Choose which tool tiers or tools each server exposes |
| `skills <list\|search\|show\|import\|installed>` | Browse and import community agent skills |
| `proxy <url>` | A stdio bridge to a hosted server; setup writes it into client configs when `--proxy` is used |
| `fund --amount <usdc> --agent <id>` | Move USDC from an agent wallet into credits. Prints the transfer and asks before sending |
| `provider use three-ws` / `provider show` | Point this machine's model clients at three.ws inference, billed to your credits |
| `usage` | Credits, burn rate, days left and recent top-ups |
| `ask "<prompt>"` | One completion through the active provider |

Global flags: `--json` for machine-readable output, `--origin <url>` (or `THREE_WS_ORIGIN`) to talk to another deployment, `--no-color`.

## Troubleshooting

- **A server returns 401.** The token is missing or expired. Run `npx three-ws login`, or `npx three-ws status` to see what the CLI has stored. Every 401 from a three.ws MCP server includes this hint in its body.
- **A client does not show the tools.** Restart it; most clients read their MCP config only at startup. `npx three-ws mcp list` confirms the entry was written.
- **Signing in over SSH.** Use `npx three-ws login --device` and approve the code from any browser.
- **Revoking access.** Every signed-in client and CLI session is listed under [Dashboard → Settings → Connected apps](/dashboard/settings).

## Related

- [Connect page](/connect): one-click setup for Claude, ChatGPT, Cursor, VS Code and Claude Code
- [MCP docs](/docs/mcp): the servers, their auth, and how to test locally
- [MCP tool catalog](/mcp-tools): every tool, its price and its safety label
