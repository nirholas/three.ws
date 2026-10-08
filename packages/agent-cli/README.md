# @three-ws/agent

**Run a three.ws agent on your own machine: the platform's tools and wallet over MCP, your files and shell in a sandbox, every risky call behind an approval gate.**

This package is the local runtime behind `three-ws-agent`. It runs the same
agent loop the server uses ([@three-ws/agent-runtime](../agent-runtime)) on this
machine, with tools from two places:

- **local**: read, list, write and edit files inside the workspace, run shell
  commands in a resource-limited sandbox, fetch public web pages as Markdown;
- **remote**: every tool on the three.ws MCP servers (`/api/mcp-agent` and
  `/api/mcp` by default), mounted over Streamable HTTP with your account's key.

The model is either the metered three.ws endpoint (`<origin>/api/v1`, billed to
your account's credits) or any OpenAI-compatible base URL you point it at: a
local llama.cpp, Ollama or vLLM server, or a hosted lane with its own key.

## Status

The runtime core in `src/` is complete and runs today (see the example below).
The terminal UI and the `three-ws-agent` command that `package.json` declares
(`bin/three-ws-agent.js`, `src/index.js`, `src/cli.js`) and its `tests/`
directory are not in the tree yet, so the package is not publishable and is not
on npm. Until they land, use the modules by path from inside this repository, as
the example does. The design brief for the full CLI (slash commands, subagents,
natural-language cron, Telegram gateway mode) is
[docs/prompts/20-local-agent-runtime-tui.md](../../docs/prompts/20-local-agent-runtime-tui.md).

`src/loop.js` and `src/tools/registry.js` import `@three-ws/agent-runtime`,
which resolves through the monorepo workspace link; it is not yet listed in this
package's `dependencies`.

## Requirements

Node **22.13+**: the session store uses the built-in `node:sqlite`, so there is
no native addon to compile and the same install works on Linux, macOS, Windows,
WSL and Termux. Run `npm install` at the repo root first.

## Example

Save as `agent-check.mjs` at the repo root and run `node agent-check.mjs`. It
needs no account: it loads the config, builds the local toolset, reads the
workspace, proves the approval gate and the sandbox's credential scrubbing, and
indexes a session for full-text search.

```js
import { loadConfig } from './packages/agent-cli/src/config.js';
import { databasePath, systemEnv } from './packages/agent-cli/src/paths.js';
import { openStore } from './packages/agent-cli/src/store.js';
import { localTools } from './packages/agent-cli/src/tools/local.js';
import { createToolset } from './packages/agent-cli/src/tools/registry.js';
import { gateCall } from './packages/agent-cli/src/loop.js';

const env = systemEnv();
const config = loadConfig(env);
console.log('origin', config.origin, 'model', config.model.provider, config.model.model);
console.log('db would live at', databasePath(env));

const toolset = createToolset({ local: localTools({ root: process.cwd(), config }), maxTools: config.mcp.maxTools });
console.log('tools', toolset.all().map((t) => `${t.name}:${t.toolClass}`).join(' '));
// read_file:read list_dir:read write_file:write edit_file:write shell:shell web_fetch:network

console.log(await toolset.get('list_dir').run({ path: 'packages/agent-cli', depth: 2 }));

// Shell is an `ask` class by default, and with nobody at the keyboard the gate refuses it.
const shell = toolset.get('shell');
console.log(await gateCall({ tool: shell, args: { command: 'ls' }, approvals: config.approvals, approve: null }));

// Run directly, the sandbox strips credentials from the child's environment.
const out = await shell.run({ command: 'echo "token=$THREE_WS_API_KEY sandbox=$THREE_WS_SANDBOX"' });
console.log(out.exitCode, out.stdout.trim()); // 0 token= sandbox=1

const store = openStore(':memory:');
const session = store.createSession({ title: 'readme check' });
store.appendMessages(session.id, [
	{ role: 'user', content: 'check the wallet balance' },
	{ role: 'assistant', content: 'The agent wallet balance covers this run.' },
]);
console.log(store.search('wallet balance').map((r) => r.snippet)); // [ 'check the [wallet] [balance]' ]
```

### One full turn with a model and the three.ws MCP tools

This needs either a three.ws key with the `inference` scope (`THREE_WS_API_KEY`,
or a signed-in credential store), or your own OpenAI-compatible model via
`THREE_WS_AGENT_BASE_URL` and `THREE_WS_AGENT_MODEL`.

```js
import { loadConfig } from './packages/agent-cli/src/config.js';
import { resolveCredential } from './packages/agent-cli/src/credentials.js';
import { createModel } from './packages/agent-cli/src/model.js';
import { connectMcp } from './packages/agent-cli/src/mcp.js';
import { localTools } from './packages/agent-cli/src/tools/local.js';
import { createToolset } from './packages/agent-cli/src/tools/registry.js';
import { runTurn } from './packages/agent-cli/src/loop.js';

const config = loadConfig();
const credential = resolveCredential();
const model = createModel(config, credential);
const remote = await connectMcp({ origin: config.origin, servers: config.mcp.servers, token: credential?.token });
for (const s of remote.servers) console.log(s.server, s.error || `${s.toolCount} tools`);

const toolset = createToolset({ local: localTools({ root: process.cwd(), config }), remote, maxTools: config.mcp.maxTools });
const messages = [
	{ role: 'system', content: 'You are a three.ws agent running on the owner\'s machine.' },
	{ role: 'user', content: 'How many lines are in packages/agent-cli/src/paths.js?' },
];
const turn = await runTurn({
	model,
	toolset,
	messages,
	query: messages.at(-1).content,
	approvals: config.approvals,
	budget: config.budget,
	onContent: (delta) => process.stdout.write(delta),
	onEvent: (e) => e.kind === 'tool_end' && console.error(`\n[${e.name} ${e.ms}ms]`),
});
console.log('\n', turn.usage, turn.toolsUsed, `$${turn.billedUsd}`);
await remote.close();
```

With no `approve` callback, any `ask`-class call (writes, shell, financial) is
refused with a message the model reads and routes around. A UI passes
`approve: async ({ tool, args }) => ({ ok: true })` after asking the person.

## How it works

### The loop ([src/loop.js](src/loop.js))

`runTurn` drives `AgentRuntime` from `@three-ws/agent-runtime`:

1. Call the model with this turn's tool list, streaming text through `onContent`.
2. Every planned tool call passes the runtime's `GuardChain` (with `TradeGuard`),
   then the approval gate for its class.
3. Allowed calls run concurrently; refused ones return an error result the
   model can read.
4. Repeat until the model answers, the turn's tool rounds (`budget.maxToolRounds`)
   are spent (the model is then asked to answer with no tools), the step budget
   (`budget.maxSteps`) ends it, or the `signal` aborts it (`InterruptedError`).

Tool output is capped at 24,000 characters per result. State is plain JSON: a
session's transcript is exactly `messages`.

### Approvals

Each tool belongs to one class, and `agent.json` sets a mode per class:

| Class | Default | Tools |
|---|---|---|
| `read` | `allow` | `read_file`, `list_dir`, MCP tools with policy tier `read` or `readOnlyHint` |
| `write` | `ask` | `write_file`, `edit_file`, MCP tools with tier `write` or no hint |
| `shell` | `ask` | `shell` |
| `network` | `allow` | `web_fetch` |
| `financial` | `ask` | MCP tools with tier `financial` or `destructiveHint` |

Modes are `ask`, `allow` and `deny`. **`financial` can never be `allow`**: a
config that says so is read as `ask`, so no tool that moves funds runs without a
person saying yes. Remote tools are classified from the
`_meta['three.ws/policy'].tier` block every three.ws MCP server stamps
([@three-ws/mcp-policy](../mcp-policy)).

### Tool selection ([src/tools/registry.js](src/tools/registry.js))

Local tools are always offered. The MCP servers expose far more tools than a
model should see at once, so each turn offers the top `mcp.maxTools` remote
tools by relevance to the request (the runtime's `ToolRelevanceScorer`), plus
every remote tool already used in the session. A name defined by two servers is
mounted once (first server in config order wins) and reported in
`remote.duplicates`. The platform's remote `web_fetch` supersedes the local one
when it is mounted.

### The sandbox ([src/tools/sandbox.js](src/tools/sandbox.js))

| Limit | How |
|---|---|
| Wall time | `sandbox.timeoutMs` (default 120 s, per-call up to 30 min); the whole process group is killed. |
| CPU time | `ulimit -t` (`sandbox.cpuSeconds`, default 60) on POSIX. |
| File size | `ulimit -f` (`sandbox.maxFileMb`, default 256) so a runaway write cannot fill the disk. |
| Output | stdout and stderr each capped at `sandbox.maxOutputBytes` (default 200,000). |
| Environment | Any variable whose name contains KEY, TOKEN, SECRET, PASSWORD, CREDENTIAL, PRIVATE, MNEMONIC, SEED, COOKIE or SESSION is removed unless listed in `sandbox.passEnv`. `THREE_WS_SANDBOX=1` is set. |
| Paths | Every file tool resolves against the workspace root and refuses `..`, absolute paths elsewhere, and symlinks that point out. |

`web_fetch` refuses URLs that resolve to loopback, private, link-local or CGNAT
addresses unless `webFetch.allowPrivate` is `true`, and rechecks every redirect hop.

### Sessions ([src/store.js](src/store.js))

One SQLite file (WAL mode, so a UI, a scheduler and a gateway can share it)
holds sessions, their full transcripts exactly as the model saw them (tool calls
included, so a resumed session continues with full fidelity), an FTS5 index over
user and assistant text, subagent and cron runs with token usage and billed USD,
cron schedules (`local` or `server` mode, with an atomic claim so two processes
never run the same job), and a small key-value table. `exportSession(id)`
returns a portable `three-ws-agent-session` v1 JSON document.

## Configuration

### Files

| What | Path | Override |
|---|---|---|
| Settings | `~/.config/three-ws/agent.json` | `THREE_WS_AGENT_CONFIG`, or `XDG_CONFIG_HOME` |
| Credentials | `~/.config/three-ws/credentials.json` (shared with the `three-ws` CLI) | `THREE_WS_CREDENTIALS` |
| Data (sessions DB) | `~/.local/share/three-ws/agent/agent.db`, `%LOCALAPPDATA%\three-ws\agent` on Windows | `THREE_WS_AGENT_HOME`, or `XDG_DATA_HOME` |

`agent.json` holds only what you changed; `loadConfig` deep-merges it over the
defaults. A minimal file that points the agent at a local Ollama server and
turns shell approvals off:

```json
{
  "model": { "provider": "openai", "baseUrl": "http://localhost:11434/v1", "model": "llama3.1" },
  "approvals": { "shell": "allow" }
}
```

Defaults: origin `https://three.ws`; model provider `three-ws`, model
`three-ws/agent`, `maxTokens` 4096, `temperature` 0.3; MCP servers
`/api/mcp-agent` and `/api/mcp` with `maxTools` 24; budget 12 tool rounds and
40 steps per turn; subagents 8 rounds, 24 steps, 4 concurrent.

### Environment overrides

| Variable | Effect |
|---|---|
| `THREE_WS_ORIGIN` | API origin (staging, a local `npm run dev`). |
| `THREE_WS_AGENT_ID` | Agent id, sent as `x-three-agent` on model calls. |
| `THREE_WS_AGENT_BASE_URL` | Switches to provider `openai` at this base URL. |
| `THREE_WS_AGENT_MODEL` | Model id. |
| `THREE_WS_AGENT_API_KEY`, `OPENAI_API_KEY` | Key for provider `openai` (or name your own with `model.apiKeyEnv`). |
| `THREE_WS_API_KEY` | three.ws key; wins over the credential store. |

### Credentials ([src/credentials.js](src/credentials.js))

Resolution order: `THREE_WS_API_KEY`, then the store's `agent_key` slot, then
the `three-ws` CLI's `stdio_key`, then its `auth` (an API key, or an OAuth token
that has not expired). The agent keeps its own key in `agent_key`, so signing in
here never replaces the credential your MCP clients use, and one
`npx three-ws setup` is enough to start. Sign-in uses the device-link flow at
`<origin>/api/cli/link` and `/api/cli/token` (RFC 8628 polling) and asks for
`profile agents:read agents:write memory:read memory:write wallet:read inference`;
money-moving scopes are opt-in. Files are written atomically with mode `0600`.

## Module reference

| Module | Exports |
|---|---|
| `src/config.js` | `loadConfig`, `saveConfig(patch)`, `readConfigFile`, `deepMerge`, `enforceApprovalFloor`, `DEFAULTS`, `DEFAULT_ORIGIN`, `THREE_WS_MODEL`, `APPROVAL_MODES`, `TOOL_CLASSES` |
| `src/paths.js` | `systemEnv`, `configDir`, `configPath`, `credentialsPath`, `dataDir`, `databasePath` |
| `src/credentials.js` | `resolveCredential`, `hasScope`, `startDeviceLink`, `pollDeviceLink`, `saveAgentKey`, `clearAgentKey`, `readStoreFile`, `writeStoreFile`, `mask`, `DEFAULT_SCOPES` |
| `src/http.js` | `request`, `requestJson`, `errorOf`, `ApiError`, `VERSION`, `USER_AGENT` |
| `src/model.js` | `createModel(config, credential)` returning `{ target, label, round, listModels }`, `resolveModelTarget`, `readSse` |
| `src/mcp.js` | `connectMcp({ origin, servers, token })` returning `{ servers, tools, duplicates, call, close }`, `classifyMcpTool`, `flattenToolResult` |
| `src/loop.js` | `runTurn`, `gateCall`, `roundsThisTurn`, `serializeToolResult`, `InterruptedError`, `MAX_TOOL_OUTPUT_CHARS` |
| `src/store.js` | `openStore(file)` (sessions, messages, search, export, runs, crons, kv), `ftsQuery`, `newId` |
| `src/tools/local.js` | `localTools({ root, config, fetchImpl? })`, `resolveInWorkspace`, `htmlToText`, `WorkspaceError` |
| `src/tools/registry.js` | `createToolset({ local, remote, extra, maxTools })` returning `{ get, all, schemasFor, size }` |
| `src/tools/sandbox.js` | `runCommand(command, opts)`, `scrubEnv` |
| `src/tools/netguard.js` | `assertPublicUrl`, `isPrivateAddress` |

## Related

- [packages/agent-runtime](../agent-runtime): the loop, guards and tool scorer this runtime is built on.
- [packages/mcp-policy](../mcp-policy): the tool tiers the approval gate reads.
- [packages/three-ws-cli](../three-ws-cli) and [docs/cli.md](../../docs/cli.md): `npx three-ws setup` writes the shared credential store.
- [docs/mcp.md](../../docs/mcp.md): the MCP servers the agent mounts.

## License

Apache-2.0. See [LICENSE](LICENSE).
