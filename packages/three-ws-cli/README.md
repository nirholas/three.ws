# three-ws

Connect any MCP client to [three.ws](https://three.ws) in one command. `three-ws` signs you in, writes the hosted three.ws MCP servers into every client it finds (Claude Code, Claude Desktop, Cursor, Windsurf, VS Code, IBM Bob, Codex, Gemini CLI, Hermes), prints the connector fields for Grok Bot, and verifies each one with a live `tools/list`.

```bash
npx three-ws setup
```

Requires Node.js 20.12 or newer.

## What you get

The three.ws MCP servers give your assistant 3D generation (text to 3D, image to 3D, rigged avatars), your agents and their wallets, x402 paid services, and Solana token data. The live list is at [three.ws/.well-known/mcp.json](https://three.ws/.well-known/mcp.json) and every tool is in the [catalog](https://three.ws/mcp-tools).

Using one client that supports remote connectors? [three.ws/connect](https://three.ws/connect) adds three.ws to Claude, Cursor or VS Code in one click, with no terminal.

## One command per client

```bash
npx three-ws --claude     # also --cursor --codex --vscode --windsurf --gemini --bob --hermes
```

Signs in, writes the servers, verifies them, and installs the three.ws skill for Claude Code, with no prompts. The config gets a `three-ws proxy` launcher, never a token: credentials stay in `~/.config/three-ws/credentials.json` (mode 600). Running it again changes nothing. Then: `claude "launch my agent"`.

Hosted installers: `curl -fsSL https://three.ws/cli/install | sh` and `curl -fsSL https://three.ws/cli/claude | sh`. Every script ships with a `.sha256` checksum and an ed25519 `.sig`; download, read and verify before running: [three.ws/docs/cli#verify-before-you-run](https://three.ws/docs/cli#verify-before-you-run).

```bash
npx three-ws doctor              # bad config, expired sign-in, unreachable server, with the fix for each
npx three-ws agent status        # agents, wallets and balances
npx three-ws team                # your teams; `team status <id>` for one
```

### Clean-container check

`tests/container/run.sh` packs this package and, for each client, starts a fresh `node:22` container, runs the hosted installer against a local stand-in platform, and asserts the config is written without a key, a second run changes nothing, `doctor` passes and the credential file is mode 600. Needs Docker.

```bash
bash packages/three-ws-cli/tests/container/run.sh
```

## Common commands

```bash
npx three-ws setup --clients cursor,vscode --yes   # specific clients, no prompts
npx three-ws setup --project                       # project-scoped config in this directory
npx three-ws login --device                        # sign in over SSH
npx three-ws mcp list --available                  # every server and its name
npx three-ws tools --server three-ws-main --enable financial
npx three-ws status
npx three-ws create "Nova" --description "A deep-space guide."   # an agent with its own Solana wallet
npx three-ws launch --agent <id> --name Nova --symbol NOVA      # prefilled, you sign on three.ws/launch
```

## Grok Bot

Grok Bot's MCP configuration lives in xAI's cloud, so there is no file to write. `setup` handles the rest: it picks the Grok connector (`https://three.ws/api/mcp-grok`), copies the URL to your clipboard when a clipboard tool exists, prints the exact fields for Grok Bot's custom MCP connector, and runs a real `tools/list` against the public URL to prove it answers from outside.

```bash
npx three-ws setup --client grok-bot                    # free 3D studio, no account, no key
npx three-ws setup --client grok-bot --connector-key    # also mint a key so Grok Bot can use your agents
npx three-ws setup --clients cursor,grok-bot --yes      # local clients and Grok Bot in one run
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
