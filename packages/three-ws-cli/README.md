# three-ws

Connect any MCP client to [three.ws](https://three.ws) in one command. `three-ws` signs you in, writes the hosted three.ws MCP servers into every client it finds (Claude Code, Claude Desktop, Cursor, Windsurf, VS Code, IBM Bob, Codex, Gemini CLI, Hermes), and verifies each one with a live `tools/list`. For Grok Bot, whose connectors live in xAI's cloud, it prints the connector fields and checks them live instead.

```bash
npx @three-ws/cli setup
```

Requires Node.js 20.12 or newer.

## What you get

The three.ws MCP servers give your assistant 3D generation (text to 3D, image to 3D, rigged avatars), your agents and their wallets, x402 paid services, and Solana token data. The live list is at [three.ws/.well-known/mcp.json](https://three.ws/.well-known/mcp.json) and every tool is in the [catalog](https://three.ws/mcp-tools).

Using one client that supports remote connectors? [three.ws/connect](https://three.ws/connect) adds three.ws to Claude, Cursor or VS Code in one click, with no terminal.

## One command per client

```bash
npx @three-ws/cli --claude     # also --cursor --codex --vscode --windsurf --gemini --bob --hermes
```

Signs in, writes the servers, verifies them, and installs the three.ws skill for Claude Code, with no prompts. The config gets a `three-ws proxy` launcher, never a token: credentials stay in `~/.config/three-ws/credentials.json` (mode 600). Running it again changes nothing. Then: `claude "launch my agent"`.

Hosted installers: `curl -fsSL https://three.ws/cli/install | sh` and `curl -fsSL https://three.ws/cli/claude | sh`. Every script ships with a `.sha256` checksum and an ed25519 `.sig`; download, read and verify before running: [three.ws/docs/cli#verify-before-you-run](https://three.ws/docs/cli#verify-before-you-run).

```bash
npx @three-ws/cli doctor              # bad config, expired sign-in, unreachable server, with the fix for each
npx @three-ws/cli agent status        # agents, wallets and balances
npx @three-ws/cli team                # your teams; `team status <id>` for one
```

### Clean-container check

`tests/container/run.sh` packs this package and, for each client, starts a fresh `node:22` container, runs the hosted installer against a local stand-in platform, and asserts the config is written without a key, a second run changes nothing, `doctor` passes and the credential file is mode 600. Needs Docker.

```bash
bash packages/three-ws-cli/tests/container/run.sh
```

## Common commands

```bash
npx @three-ws/cli setup --clients cursor,vscode --yes   # specific clients, no prompts
npx @three-ws/cli setup --project                       # project-scoped config in this directory
npx @three-ws/cli login --device                        # sign in over SSH
npx @three-ws/cli signup --agent                        # an agent signs itself up: Solana key, account, wallet, API key, no email
npx @three-ws/cli link BCDF-GHJK                        # link this terminal with a code from /dashboard/account
npx @three-ws/cli mcp list --available                  # every server and its name
npx @three-ws/cli tools --server three-ws-main --enable financial
npx @three-ws/cli status
npx @three-ws/cli create "Nova" --description "A deep-space guide."   # an agent with its own Solana wallet
npx @three-ws/cli launch --agent <id> --name Nova --symbol NOVA      # prefilled, you sign on three.ws/launch
```

## Pay for x402 and MPP resources from the terminal

`three-ws pay <url>` fetches a URL, reads its HTTP 402 challenge (x402 v2 `PAYMENT-REQUIRED`, x402 v1 body, or an MPP Solana charge), picks a Solana option, signs with a key that never leaves your machine, retries once and prints the body. Every payment is checked against a permissions file you own before anything is signed.

```bash
three-ws wallet init                      # key goes to the OS keychain, or an encrypted file behind a passphrase
three-ws wallet address                   # the public address to fund with USDC
three-ws pay init                         # writes ~/.config/three-ws/pay-permissions.json (safe defaults)
three-ws pay --dry-run https://three.ws/api/x402/three-intel
three-ws pay https://three.ws/api/x402/three-intel
```

The dry run signs nothing and prints the decision:

```text
Dry run: nothing was signed or sent.
protocol  x402
network   solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp
amount    0.01 (10000 atomic)
asset     EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v
payee     wwwwwDxFWRn7grgr3Esrsg5C6NvDoDHSA4gaCffccrU
decision  allowed by pay-permissions.json
```

| Flag | Meaning |
| --- | --- |
| `--dry-run` | Print protocol, network, exact amount, asset and payee and the permission decision. Signs nothing, spends nothing. |
| `--max <amount>` | Hard ceiling for this call in whole units (`0.05`), on top of the permissions file. |
| `--network <id>` | Only consider offers on this network (`solana`, `devnet`, or a CAIP-2 id). |
| `--method`, `--data`, `-H` | Forward a method, body and headers on both the probe and the paid retry. |
| `--storage keychain\|file` | With `wallet init`: where the key lives. Default tries the keychain, then falls back to the file. |
| `--json` | Machine-readable output, including errors (`{ "error": "<reason>", "exit": <code> }`). |

Solana offers are always tried first. EVM offers are skipped.

### Key custody

`wallet init` generates a 32-byte seed and stores it in the OS keychain through `@napi-rs/keyring`. Where no keychain is reachable (headless Linux, containers) it writes `pay-wallet.sealed.json`, encrypted with AES-256-GCM under a scrypt-derived key, mode 0600, after prompting for a passphrase of at least 12 characters (or reading `THREE_WS_WALLET_PASSPHRASE`). The key is never written in plaintext, no command prints it, and `wallet init` never overwrites an existing wallet. `wallet export-public` prints the address only.

### Permissions file

`~/.config/three-ws/pay-permissions.json` (override with `THREE_WS_PAY_PERMISSIONS`). With no file, every payment is refused.

```json
{
  "version": 1,
  "allowedOrigins": ["https://three.ws"],
  "allowedNetworks": ["solana"],
  "allowedAssets": ["EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v"],
  "allowedPayees": [],
  "maxPerCall": "0.10",
  "maxPerDay": "1.00",
  "confirmAbove": "0.05"
}
```

`maxPerCall` is required. Limits are decimal strings in whole units of the asset, compared exactly. `maxPerDay` counts a UTC-day ledger of settled payments. Above `confirmAbove` the CLI asks on the terminal. `allowedAssets` defaults to mainnet and devnet USDC, and `allowedPayees` is unrestricted when omitted.

### Exit codes

| Code | Reason strings | Meaning |
| --- | --- | --- |
| 0 | | Success, or the resource was free |
| 1 | | Other error |
| 2 | | Usage error |
| 10 | `permissions_missing`, `origin_not_allowed`, `network_not_allowed`, `asset_not_allowed`, `payee_not_allowed`, `per_call_limit`, `max_flag_exceeded`, `daily_limit` | Refused by the permissions file |
| 11 | `confirm_required`, `declined_by_user` | Above `confirmAbove` and not confirmed |
| 12 | `no_payable_option`, `unsupported_intent`, `challenge_expired` | The server offered nothing payable here |
| 13 | `payment_rejected` | The server rejected the signed payment |
| 14 | `wallet_missing`, `wallet_locked` | No usable wallet |

### MCP server

`three-ws pay mcp` is a stdio MCP server with `pay_quote` (read-only) and `pay_fetch`, under the same permissions. It has no confirmation channel, so it refuses any payment above `confirmAbove`.

```json
{ "mcpServers": { "three-ws-pay": { "command": "npx", "args": ["@three-ws/cli", "pay", "mcp"] } } }
```

## Automation mode

Every command takes `--json` and `--non-interactive`. The CLI is built to be driven by scripts and by other agents.

- `--json`: stdout carries exactly one JSON document and nothing else. Progress, warnings and the human sentence for an error go to stderr. A failure prints `{ "error": "<reason>", "message": "...", "exit": <code> }` on stdout.
- `--non-interactive` (or `THREE_WS_NON_INTERACTIVE=1`): never prompts and never opens a browser. Missing input is a usage error (exit 2), a missing credential is an auth error (exit 3), and an external skill install without `--yes` is refused (exit 4). Authenticate with `THREE_WS_API_KEY` or `--key`.

| Exit | Meaning |
| --- | --- |
| 0 | Success |
| 1 | Other error (an unknown run, an unexpected server answer) |
| 2 | Usage: unknown flag or command, missing or malformed input |
| 3 | Auth: no credential, expired or revoked key, or forbidden |
| 4 | Refused by a guard: the spend policy, the trade firewall, or an unconfirmed external skill |
| 5 | Payment required (HTTP 402) |
| 6 | Network: host unreachable, RPC failure, rate limit or a 5xx |

`three-ws pay` keeps its own stable codes 10 to 14 (see above). They are the one exception to this table.

| Command | Output (`--json`) |
| --- | --- |
| `agents list` / `agents get <id\|name>` | Your agents with their Solana address |
| `runs list --agent <id\|name>` / `runs get <run-id>` | Run history, or one run with steps, tool traces and the receipt chain verdict |
| `wallet balance [--agent <id\|name>]` | SOL and USDC of the local pay wallet (read from Solana RPC) or of an agent wallet |
| `skill install <slug> --agent <id>` | Alias of `skills import` |
| `orders list --agent <id\|name> [--network devnet]` | The agent's order-engine orders |
| `report run <run-id> --out run.html` | One self-contained HTML report, see below |

### Run report

`three-ws report run <run-id> --out run.html` writes a single file with inline CSS and JS and no network access: the goal, outcome, decisions, trades, every tool call with input, output and receipt, the receipt chain head and the head hash of the agent's decision trail. It opens offline from disk and can be attached to a ticket or an audit. The same generator backs the "Download report" button on the run page. Run `three-ws report run` against a run you own; the decision trail head is fetched best-effort and the report says so when it could not be reached.

## Grok Bot

Grok Bot's MCP configuration lives in xAI's cloud, so there is no file to write. `setup` handles the rest: it picks the Grok connector (`https://three.ws/api/mcp-grok`), copies the URL to your clipboard when a clipboard tool exists, prints the exact fields for Grok Bot's custom MCP connector, and runs a real `tools/list` against the public URL to prove it answers from outside.

```bash
npx @three-ws/cli setup --client grok-bot                    # free 3D studio, no account, no key
npx @three-ws/cli setup --client grok-bot --connector-key    # also mint a key so Grok Bot can use your agents
npx @three-ws/cli setup --clients cursor,grok-bot --yes      # local clients and Grok Bot in one run
```

```
Grok Bot (cloud connector, nothing to write locally)
  Name            three-ws
  Transport       Streamable HTTP
  Server URL      https://three.ws/api/mcp-grok
  Authentication  None
```

`--connector-key` signs you in, mints one key with the `connector` preset (read, generate and edit agents, never spend), stores it in the credential file, and reuses it on later runs. Paste it as a Bot secret. `--no-copy` skips the clipboard. A `localhost` origin is flagged, because Grok Bot connects from xAI's cloud. Full walkthrough: [three.ws/docs/grok](https://three.ws/docs/grok).

Sign-in is a browser OAuth flow by default. `--device` approves a code from any browser, and `--key sk_live_...` (or `THREE_WS_API_KEY`) uses an API key from [Dashboard → API](https://three.ws/dashboard/api). Tools that move funds are off unless you sign in with `--financial` and enable them.

## Grok Bot

Grok Bot keeps its connectors in xAI's cloud, so `setup` has no file to write for it. It picks the server, gets the credential, prints the fields Grok Bot's custom MCP connector form asks for, copies the server URL to the clipboard, and runs `initialize` + `tools/list` against the public URL the way Grok Bot will.

```bash
npx three-ws setup --client grok-bot                 # free 3D studio, no account
npx three-ws setup --client grok-bot --auth install  # free, a quota that survives reconnects
npx three-ws setup --client grok-bot --auth key      # mints a connector key that can never spend
npx three-ws setup --client grok-bot --auth oauth    # Grok Bot signs in itself
```

```text
Grok Bot three-ws-grok · add it in Grok Bot's Connectors (custom MCP server); nothing is written on this machine
  Name            three-ws-grok
  Transport       Streamable HTTP
  Server URL      https://three.ws/api/mcp-grok
  Authentication  None
  ✔ Server URL copied to the clipboard

  Live check https://three.ws/api/mcp-grok
  ✔ public https URL a cloud agent can reach  three.ws
  ✔ initialize + tools/list                   15 tools from three-ws-3d-studio-free 1.0.0
```

`--connector-key sk_live_...` uses a key you made at [Dashboard → API](https://three.ws/dashboard/api) ("For an AI agent") instead of minting one; a key that can spend is refused. `--servers <name>` connects another server. `mcp add` and `mcp remove` do not apply to Grok Bot, since there is no local file. Details: [three.ws/docs/cli#grok-bot](https://three.ws/docs/cli#grok-bot) and the [Grok Bot connector reference](https://three.ws/docs/grok-bot).

## Programmatic use

The package exports its building blocks (server directory, client detection, config writers, OAuth helpers) for tools that want to reuse them. List every hosted server and the name clients store it under:

```js
import { loadDirectory, hostedServers } from 'three-ws';

const origin = 'https://three.ws';
const directory = await loadDirectory(origin);
for (const server of hostedServers(directory, origin)) console.log(server.slug, server.url);
// three-ws-main https://three.ws/api/mcp
// three-ws-studio https://three.ws/api/mcp-studio
// ...
```

## Docs

Full reference, client config paths and troubleshooting: [three.ws/docs/cli](https://three.ws/docs/cli).

## License

Apache-2.0
