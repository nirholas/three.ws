# three-ws CLI

`three-ws` connects any MCP client to three.ws in one command. It signs you in, writes the hosted three.ws MCP servers into every client it finds on your machine (Claude Code, Claude Desktop, Cursor, Windsurf, VS Code, IBM Bob, Codex, Gemini CLI, Hermes), and then proves each one works with a live `tools/list` call.

If you only use one client and it supports remote connectors, the [connect page](/connect) is faster: one click adds three.ws to Claude, Cursor or VS Code, with no terminal. Use the CLI when you want several clients configured at once, per-project config, an API key instead of a browser sign-in, or control over which tools each client may call.

Requires Node.js 20.12 or newer.

## Quick start

```bash
npx @three-ws/cli setup
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
npx @three-ws/cli setup --clients cursor,vscode --servers three-ws-main,three-ws-studio --yes

# Project-scoped config: writes .mcp.json, .cursor/mcp.json, .vscode/mcp.json, .bob/mcp.json, .gemini/settings.json here
npx @three-ws/cli setup --project

# Print the config instead of writing any file
npx @three-ws/cli setup --clients print
```

| Flag | Values |
|---|---|
| `--clients` | `claude-code`, `claude-desktop`, `cursor`, `windsurf`, `vscode`, `bob`, `codex`, `gemini`, `hermes`, `grok-bot`, `print` (`--client` works too) |
| `--connector-key` | With `grok-bot`: mint a spend-free API key for Grok Bot's Bot secret |
| `--no-copy` | With `grok-bot`: do not copy the server URL to the clipboard |
| `--servers` | Server names from `npx @three-ws/cli mcp list --available` |
| `--packages` | Also add stdio `@three-ws/*-mcp` packages |
| `--project` | Write project-scoped config in the current directory |
| `--proxy` | Route every server through the local proxy, so your tool choices apply in every client |
| `--yes` | Never prompt; take the defaults |

### Grok Bot

Grok Bot is configured in xAI's cloud, so `setup` cannot write a file for it. `--clients grok-bot` runs the part the CLI can do, with no sign-in for the free studio:

```bash
npx @three-ws/cli setup --client grok-bot
npx @three-ws/cli setup --client grok-bot --connector-key   # key for your agents, never spends
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
| IBM Bob | `~/.bob/settings/mcp.json` | `.bob/mcp.json` |
| Codex | `$CODEX_HOME/config.toml` (default `~/.codex`) | |
| Gemini CLI | `~/.gemini/settings.json` | `.gemini/settings.json` |
| Hermes | `$HERMES_HOME/config.yaml` (default `~/.hermes`) | |

IBM Bob gets the entry shape its IDE documents, `{ "type": "streamable-http", "url": ... }`, and is detected by a `~/.bob` folder. Bob Shell reads the same files but documents the URL key as `httpURL`; if you only use the shell, rename `url` to `httpURL` in the written entry. Servers that need sign-in use Bob's built-in OAuth discovery on first connect, so the free `three-ws-studio` server is the one that works with no account at all.

### Server names

Every client stores a server under the same name, which is also what `--servers`, `mcp add` and `mcp remove` take. The [connect page](/connect) uses the same names, so adding a server both ways never creates a duplicate.

| Name | Endpoint | Account |
|---|---|---|
| `three-ws-main` | `https://three.ws/api/mcp` | Sign-in |
| `three-ws-3d` | `https://three.ws/api/mcp-3d` | Sign-in or x402 |
| `three-ws-studio` | `https://three.ws/api/mcp-studio` | None |
| `three-ws-grok` | `https://three.ws/api/mcp-grok` | None for the free 3D tools; a connector key or OAuth adds your agents |
| `three-ws-agent` | `https://three.ws/api/mcp-agent` | Sign-in |
| `three-ws-bazaar` | `https://three.ws/api/mcp-bazaar` | Sign-in or x402 |
| `three-ws-pump-fun` | `https://three.ws/api/pump-fun-mcp` | None for reads |
| `three-ws-ibm` | `https://three.ws/api/ibm-mcp` | Sign-in or x402 |

`npx @three-ws/cli mcp list --available` prints the live list, which is the source of truth if this table and the directory ever disagree.

## Grok Bot

Grok Bot, xAI's computer-use agent, runs on xAI's machines and keeps its connectors there, so there is no file on your computer to write. `setup --client grok-bot` does everything else: it picks the server, gets the credential the auth mode needs, prints the exact fields Grok Bot's custom MCP connector form asks for, copies the server URL to your clipboard, and runs a live check against the public URL the way Grok Bot will call it.

```bash
# Free, no account: the 3D studio for Grok
npx three-ws setup --client grok-bot

# Free, with a quota of its own that survives reconnects (for scheduled tasks)
npx three-ws setup --client grok-bot --auth install

# Your agents, memory and skills too: mints a connector key that can never spend
npx three-ws setup --client grok-bot --auth key

# Sign in from Grok Bot instead of holding a key
npx three-ws setup --client grok-bot --auth oauth
```

What it prints, for the free connector:

```text
Grok Bot three-ws-grok · add it in Grok Bot's Connectors (custom MCP server); nothing is written on this machine
  Name            three-ws-grok
  Transport       Streamable HTTP
  Server URL      https://three.ws/api/mcp-grok
  Authentication  None
  Or tell it: "Add a custom MCP server called three-ws-grok at https://three.ws/api/mcp-grok"
  ✔ Server URL copied to the clipboard

  Live check https://three.ws/api/mcp-grok
  ✔ public https URL a cloud agent can reach  three.ws
  ✔ initialize + tools/list                   15 tools from three-ws-3d-studio-free 1.0.0
```

| `--auth` | What Grok Bot gets | What setup does |
|---|---|---|
| `none` (default) | The free studio: text to 3D, image to 3D, rigging, the asset catalog, personas | Prints the URL and runs `initialize` + `tools/list` against it |
| `install` | The same tools, with a generation budget that lasts across every scheduled run | Mints a free [install token](/docs/mcp-studio#connector-url-for-cloud-agents-install-tokens) (no account), puts it in the URL, and reuses it on later runs so the URL stays the same |
| `key` | Also your agents, memory and skills; a connector key reads, generates and edits but can never spend | Mints a connector key for the signed-in account (signing you in first when needed), or checks the one you pass with `--connector-key`, refuses a key that carries a spend scope, then runs `tools/list` with it |
| `oauth` | The same as `key`, signed in once from Grok Bot and revocable any time | Prints the `?auth=oauth` URL and checks that an anonymous call is answered `401` with a protected-resource document that names the authorization server |

Pass `--servers <name>` to connect a server other than `three-ws-grok`, for example `--servers three-ws-main --auth key` for the full core server. A server that needs an account only takes `key` or `oauth`, and setup says so instead of printing fields that would fail. The live check fails on any URL Grok Bot cannot reach from the internet, such as `--origin http://localhost:3000`, because Grok Bot connects from xAI's cloud. The clipboard step is best-effort (`pbcopy`, `clip`, `wl-copy`, `xclip`, `xsel`, or `clip.exe` under WSL); with none available the URL is printed as usual, and `THREE_WS_NO_CLIPBOARD=1` turns it off. `--json` prints the fields, the key's scope and every check as one document. Connector settings, the tool contract and the fix for every probe failure are in the [Grok Bot connector reference](/docs/grok-bot).

## Create an agent and launch its coin

```bash
npx @three-ws/cli create "Nova" --description "A deep-space guide who explains orbital mechanics."
npx @three-ws/cli launch --agent <agent-id> --name "Nova" --symbol NOVA
```

`create` makes the agent on your account and prints its public page and the Solana wallet three.ws minted for it. Pass `--avatar <id>` to use an avatar you already own as its 3D body; otherwise give it a body on its page. A name that imitates an existing public agent is refused with the reason, so pick a distinct one.

`launch` never spends anything from the terminal. It collects the coin's name, ticker, description, optional image (`--image`, the agent's portrait by default) and optional first buy (`--initial-buy <sol>`), then opens [/launch](/launch) with all of it filled in. You review the cost there and sign the launch in your browser. The launching agent needs a 3D body, because that page picks agents by their body. Run either command with no flags to be prompted for each field, or with `--json` to get the agent record or the review URL as JSON.

## Choosing which tools a client may call

Every tool is labelled read, write or financial ([the catalog](/mcp-tools) shows which is which). By default read and write tools are on and financial tools are off.

```bash
# See and change the tool selection interactively
npx @three-ws/cli tools

# Turn financial tools on for the main server only
npx @three-ws/cli tools --server three-ws-main --enable financial

# Back to the default
npx @three-ws/cli tools --server three-ws-main --reset
```

The selection is enforced whichever way you signed in. With a browser sign-in, servers that need an account run through the local proxy (`three-ws proxy`), which also keeps your token fresh: `tools/list` returns only enabled tools, and a call to a disabled one is answered by the proxy with an error explaining how to enable it, without reaching the server. With an API key, the selection travels to the server in the `X-Three-Tools` header, and clients that support a tool allowlist get one written too. `--proxy` routes every server through the proxy regardless.

## All commands

| Command | What it does |
|---|---|
| `setup` | Sign in, write servers into clients, verify with `tools/list` |
| `--claude` / `--cursor` / `--codex` / `--vscode` / `--windsurf` | Non-interactive setup for one client; keeps secrets out of its config |
| `doctor` | Diagnose Node, credentials, auth, client configs and server reachability |
| `agent status` | Your agents with wallet address and balances |
| `team` / `team status <id>` | Your teams and one team's detail |
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
| `wallet <init\|address\|export-public>` | A local payer key held in the OS keychain (or an encrypted file behind a passphrase); never printed |
| `pay <url>` / `pay --dry-run <url>` | Settle an x402 or MPP 402 challenge on Solana with that key, inside `pay-permissions.json`; `pay init`, `pay mcp` (stdio MCP server). See the [package README](../packages/three-ws-cli/README.md#pay-for-x402-and-mpp-resources-from-the-terminal) |

## One command per client

Name a client and the CLI does the whole setup without prompts: sign in, write the servers, verify them with a live `tools/list`.

```bash
npx @three-ws/cli --claude      # Claude Code, plus the three.ws skill
npx @three-ws/cli --cursor
npx @three-ws/cli --codex
npx @three-ws/cli --vscode
npx @three-ws/cli --windsurf
npx @three-ws/cli --gemini
```

`--bob` and `--hermes` work the same way. Combine flags to set up several clients at once (`npx @three-ws/cli --cursor --vscode`), and add `--project` for config in the current directory, `--device` over SSH, or `--key sk_live_...` for CI.

These flags write a launcher entry (`three-ws proxy <url>`) instead of a token. The OAuth token or API key stays in `~/.config/three-ws/credentials.json` (mode 600) and never appears in a client config file, so you can commit a project config safely. Running a command twice changes nothing the second time.

With `--claude` the CLI also installs the three.ws skill at `~/.claude/skills/three-ws/SKILL.md`, so you can start Claude Code with:

```bash
claude "launch my agent"
```

### Hosted installers

Two shell scripts do the same from a bare machine. `install` checks your OS and Node version, runs the CLI, and prints next steps. `claude` wires Claude Code and offers to start `claude "launch my agent"`.

```bash
curl -fsSL https://three.ws/cli/install | sh
curl -fsSL https://three.ws/cli/claude | sh
```

Pass options after `--`: `curl -fsSL https://three.ws/cli/install | sh -s -- --cursor`. Both scripts need Linux or macOS (Windows: use WSL) and Node.js 20.12 or newer. They never use `sudo`, never edit your shell profile, never install Node for you, and never write a credential to disk themselves. Environment variables: `THREE_WS_VERSION` pins a CLI version and `THREE_WS_ORIGIN` points at another deployment.

### Verify before you run

Piping a script into a shell trusts whatever the server sends, so every script is published with a SHA-256 checksum and an ed25519 signature. Download, read, verify, then run:

```bash
mkdir three-ws-install && cd three-ws-install
curl -fsSLO https://three.ws/cli/install.sh
curl -fsSLO https://three.ws/cli/install.sh.sha256
curl -fsSLO https://three.ws/cli/install.sh.sig
curl -fsSLO https://three.ws/cli/signing-key.pem

less install.sh                       # read it
sha256sum -c install.sh.sha256        # checksum (macOS: shasum -a 256 -c install.sh.sha256)

# signature (OpenSSL 3)
openssl pkeyutl -verify -pubin -inkey signing-key.pem -rawin -in install.sh -sigfile install.sh.sig

sh install.sh
```

Without OpenSSL 3, Node checks it:

```bash
node -e "const c=require('crypto'),f=require('fs');console.log(c.verify(null,f.readFileSync('install.sh'),c.createPublicKey(f.readFileSync('signing-key.pem')),f.readFileSync('install.sh.sig')))"
```

It prints `true` for an untouched script. The signing key's fingerprint (SHA-256 of its DER public key) is `662f5682e54fec906904b39937f8858a6c269b671fc335bff4b91c6a66a3f27d`, and the same key is committed in the repository at `public/cli/signing-key.pem`. Compare the two sources before trusting a key you downloaded from the same server as the script. The same steps work for `claude.sh`.

Each script defines functions and calls `main` on its last line, so a download cut short runs nothing.

## Check your setup

```bash
npx @three-ws/cli doctor
```

`doctor` finds a bad config before you do. It checks the Node version, the credential file and its permissions, that three.ws is reachable, that your sign-in is still valid (expired or revoked), each client's config (unparseable file, missing three.ws entry, a secret stored in plain text, a launcher missing from `PATH`), and a live `tools/list` for every configured server. Every problem comes with the command that fixes it. It exits 1 when anything fails, and `--json` prints the findings for scripts.

## Agents and teams

```bash
npx @three-ws/cli agent status    # each agent, its wallet address and SOL / USDC balance
npx @three-ws/cli team            # your teams
npx @three-ws/cli team status <id-or-name>
```

Both are read-only.

Global flags: `--json` for machine-readable output, `--origin <url>` (or `THREE_WS_ORIGIN`) to talk to another deployment, `--no-color`.

## Troubleshooting

- **A server returns 401.** The token is missing or expired. Run `npx @three-ws/cli login`, or `npx @three-ws/cli status` to see what the CLI has stored. Every 401 from a three.ws MCP server includes this hint in its body.
- **A client does not show the tools.** Restart it; most clients read their MCP config only at startup. `npx @three-ws/cli mcp list` confirms the entry was written.
- **Signing in over SSH.** Use `npx @three-ws/cli login --device` and approve the code from any browser.
- **Revoking access.** Every signed-in client and CLI session is listed under [Dashboard → Settings → Connected apps](/dashboard/settings).

## Related

- [Connect page](/connect): one-click setup for Claude, ChatGPT, Cursor, VS Code and Claude Code
- [MCP docs](/docs/mcp): the servers, their auth, and how to test locally
- [MCP tool catalog](/mcp-tools): every tool, its price and its safety label
