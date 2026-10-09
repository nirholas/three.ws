# three-ws

Connect any MCP client to [three.ws](https://three.ws) in one command. `three-ws` signs you in, writes the hosted three.ws MCP servers into every client it finds (Claude Code, Claude Desktop, Cursor, Windsurf, VS Code, Codex, Gemini CLI, Hermes), and verifies each one with a live `tools/list`. For Grok Bot, whose connectors live in xAI's cloud, it prints the connector fields and checks them live instead.

```bash
npx three-ws setup
```

Requires Node.js 20.12 or newer.

## What you get

The three.ws MCP servers give your assistant 3D generation (text to 3D, image to 3D, rigged avatars), your agents and their wallets, x402 paid services, and Solana token data. The live list is at [three.ws/.well-known/mcp.json](https://three.ws/.well-known/mcp.json) and every tool is in the [catalog](https://three.ws/mcp-tools).

Using one client that supports remote connectors? [three.ws/connect](https://three.ws/connect) adds three.ws to Claude, Cursor or VS Code in one click, with no terminal.

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
