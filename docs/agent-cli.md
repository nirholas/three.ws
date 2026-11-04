# three-ws-agent: a three.ws agent in your terminal

`three-ws-agent` runs a three.ws agent on your own machine or VPS. You chat with it in a
terminal UI; it reads and edits files in the folder you point it at, runs shell commands in a
resource-limited sandbox, and uses every tool on the three.ws MCP servers (3D generation, your
agents, their memory and wallets) with your account's key. Anything that writes, runs a command
or moves money stops and asks you first, and a financial call always shows the recipient,
amount, token and chain before you answer.

It also keeps working when you are not looking at it: schedules written in plain language
("every weekday at 9am") run on this machine or as three.ws automations, subagents take a goal
off in parallel and report back, and a gateway mode lets you talk to the same agent from your
own Telegram bot.

The package is [`@three-ws/agent`](../packages/agent-cli) and its source is in
[packages/agent-cli/](../packages/agent-cli). The module-level reference (the loop, the
approval gate, the sandbox, the session store) is in the
[package README](../packages/agent-cli/README.md).

## Install

You need Node.js **22.13 or newer** (the session store uses the built-in `node:sqlite`, so
nothing native is compiled and the same install works on Linux, macOS, Windows, WSL and
Termux).

From a checkout of this repository:

```bash
npm install
node packages/agent-cli/bin/three-ws-agent.js --help
npm link --workspace @three-ws/agent   # optional: puts three-ws-agent on your PATH
```

The package directory also ships:

- a `Dockerfile` and `docker-compose.yml` for running the gateway and schedules on a server;
- a `flake.nix` for Nix (`nix run ./packages/agent-cli -- --help`);
- an `install.ps1` that checks the Node version on Windows and links the command.

Run `three-ws-agent doctor` after installing. It checks Node, the config file, the credential,
the model endpoint (and lists its models), the MCP tools, SQLite with full-text search and the
shell sandbox, and tells you how to fix anything that fails.

## Sign in, or bring your own model

```bash
three-ws-agent login     # prints a URL and a code; confirm it in the browser
three-ws-agent whoami    # account, masked key, scopes
three-ws-agent logout
```

`login` uses the same device-link flow as `npx three-ws setup` and saves a key with the scopes
`profile agents:read agents:write memory:read memory:write wallet:read inference`. Money-moving
scopes are opt-in (`--scope wallet:write`), and even with them every payment still asks you.
`THREE_WS_API_KEY` in the environment wins over a saved key.

Signed in, the model is the metered three.ws endpoint, billed to your account's credits. You
can also point it at any OpenAI-compatible server (llama.cpp, Ollama, vLLM, a hosted lane) with
no account at all:

```bash
THREE_WS_AGENT_BASE_URL=http://localhost:11434/v1 THREE_WS_AGENT_MODEL=llama3.1 three-ws-agent
```

or switch it from inside the UI with `/model`, which saves it to
`~/.config/three-ws/agent.json`.

## The terminal UI

```bash
three-ws-agent                       # new session in the current folder
three-ws-agent --resume ses_3f2a     # continue a saved session (an id prefix is enough)
three-ws-agent --cwd ~/project --model llama3.1 --agent <agent id>
three-ws-agent --avatar              # show the selected agent's 3D body beside the chat
```

Replies stream as they arrive. Each tool call shows as a row with its name, time and a preview
of the result; a call that was refused shows why. The status line at the bottom names the
model, the session, the tokens and credits used, the workspace, and any subagents running.

| Key | What it does |
|---|---|
| Enter | send (a line ending in `\` continues on the next line) |
| Tab | complete a slash command |
| Up / Down | history |
| Enter / `y` on an approval | approve the call |
| Esc / `n` on an approval | deny it |
| Ctrl+C during a turn | stop the turn; the partial reply stays in the session |
| Ctrl+C at an empty prompt | quit (the session is saved) |

Typing while the agent is still working **redirects** it: the running turn stops and your new
message starts the next one, with everything so far kept in context.

`--avatar` renders the agent's rigged 3D avatar in the terminal beside the chat (110 columns or
wider). The source is a `.glb` path or URL, or a three.ws avatar or agent id; with no value it
uses the selected agent's body. It reacts to what the agent is doing: thinking, working a tool,
or idle.

### Slash commands

| Command | What it does |
|---|---|
| `/model [id]` | list the models the endpoint offers, or switch to one |
| `/agent [id]` | list your three.ws agents, or pick the one whose persona, wallet and skills this session uses |
| `/wallet [all \| call <tool> <json>]` | the selected agent's wallet; `call` runs a wallet tool through the approval gate |
| `/skills` | skills installed on the selected agent, and the tools this session can use |
| `/runs` | recent subagent and schedule runs here, and the agent's runs on three.ws |
| `/new` | start a fresh session (the current one stays saved) |
| `/sessions` | recent sessions on this machine |
| `/search <words>` | full-text search across every saved session |
| `/resume <id>` | switch to a saved session |
| `/export [id]` | write a session to a JSON file in the workspace |
| `/cron ...` | schedules, see below |
| `/subagent "<goal>"` | run a goal in a parallel child session; `/subagent list`, `/subagent cancel <id>` |
| `/clear` | clear the screen (the session is kept) |
| `/help` | every command |
| `/exit` | quit |

## Approvals

Every tool belongs to a class, and each class has a mode in `agent.json`:

| Class | Default | Examples |
|---|---|---|
| read | allow | `read_file`, `list_dir`, read-only MCP tools |
| network | allow | `web_fetch` (public addresses only) |
| write | ask | `write_file`, `edit_file`, MCP tools that change data |
| shell | ask | `shell` |
| financial | ask, always | sends, swaps, payments, launches |

Financial calls ask even if the config says `allow`. When nobody is there to answer (a
schedule firing, a subagent, a headless run), anything that would ask is refused instead, and
the refusal is recorded in the run.

## Sessions

Every session is saved in a SQLite file on this machine
(`~/.local/share/three-ws/agent/agent.db`, `%LOCALAPPDATA%\three-ws\agent` on Windows) with a
full-text index over every message.

```bash
three-ws-agent sessions                       # most recent first
three-ws-agent sessions search lighthouse budget
three-ws-agent sessions export ses_3f2a --out lighthouse.json
three-ws-agent sessions export ses_3f2a --out -   # to stdout
```

The export is JSON with `format: "three-ws-agent-session"` and `version: 1`, the session row
and every message, tool calls included.

## Subagents

`/subagent "summarize every README under packages/"` starts a child session with its own
budget (8 tool rounds and 24 steps by default) and returns you to the prompt. Up to four run at
once; more wait in a queue. When one finishes, its report is added to your session so the next
message can use it, and its tokens and cost are recorded as a run (`/runs`). Subagents cannot
answer approvals, so they stick to tools that do not ask. Change the limits under `subagent` in
`agent.json`.

## Schedules

```bash
three-ws-agent cron add "every weekday at 9am" "summarize yesterday's agent runs"
three-ws-agent cron add "every 30 minutes" "check the wallet balance" --server
three-ws-agent cron                     # list
three-ws-agent cron off <id>            # pause; `on` resumes
three-ws-agent cron mode <id> server    # move a schedule to three.ws (or back to local)
three-ws-agent cron rm <id>
three-ws-agent cron run                 # run local schedules without the UI
three-ws-agent cron run --once          # fire whatever is due, then exit (for system cron)
```

The schedule is plain language or a cron expression:

```
every minute
every 15 minutes
every hour  |  hourly  |  every 2 hours
every day at 9am  |  daily at 18:30  |  every day at noon
every weekday 9am  |  every weekend at 10:00
every monday at 8am  |  every mon, wed and fri at 7:30pm
every month on the 1st at 9am  |  monthly
at 9am and 5pm every weekday
append "utc" to read the time in UTC, e.g. "every day at 13:00 utc"
or a raw 5-field cron expression, e.g. "0 9 * * 1-5"
```

Anything else is refused with that list, rather than guessed at.

**Local** schedules use your machine's time zone and fire while the UI, the gateway or
`cron run` is running. Several of them can run against the same database and a schedule still
fires exactly once: each process claims the due row in one SQLite transaction before running
it. Missed runs fire once on the next start (set `cron.catchUp` to `false` to skip them).

**Server** schedules (`--server`) become three.ws automations for the selected agent and run
whether this machine is on or not. They need sign-in and an agent (`/agent`), run in UTC (the
time is converted for you; a schedule whose day would shift is refused with an explanation),
and fire at most every 5 minutes.

## Telegram gateway

The gateway answers your own Telegram bot from this machine, using long polling, so nothing is
exposed to the internet.

1. Create a bot with [@BotFather](https://t.me/BotFather) and copy its token.
2. Save it once (read from stdin, never printed or logged), or set `TELEGRAM_BOT_TOKEN`:

   ```bash
   three-ws-agent gateway --save-telegram-token < token.txt
   ```

3. Find your chat id (message the bot, then open
   `https://api.telegram.org/bot<token>/getUpdates`), and start the gateway with it:

   ```bash
   three-ws-agent gateway --allow 123456789
   ```

Only allowlisted chats get answers; everything else is ignored and logged. The allowlist can
also come from `gateway.telegram.allowChats` in `agent.json` or `TELEGRAM_ALLOWED_CHATS`, and
the gateway refuses to start without one. It also refuses to start while the bot has a webhook
set, rather than deleting it: a webhook means something else is answering that bot.

Each chat gets its own saved session. Approvals arrive as **Approve** / **Deny** buttons with the
same facts the terminal shows. Local schedules run alongside the gateway unless you pass
`--no-cron`.

## Running on a server

`packages/agent-cli/docker-compose.yml` runs the gateway with its schedules in a container, with
the database and config on a named volume:

```bash
cd packages/agent-cli
TELEGRAM_BOT_TOKEN=... TELEGRAM_ALLOWED_CHATS=123456789 THREE_WS_API_KEY=... docker compose up -d
```

## Configuration

| What | Path | Override |
|---|---|---|
| Settings | `~/.config/three-ws/agent.json` | `THREE_WS_AGENT_CONFIG`, or `XDG_CONFIG_HOME` |
| Credentials | `~/.config/three-ws/credentials.json` (shared with the `three-ws` CLI) | `THREE_WS_CREDENTIALS` |
| Sessions database | `~/.local/share/three-ws/agent/agent.db` | `THREE_WS_AGENT_HOME`, or `XDG_DATA_HOME` |

| Variable | Effect |
|---|---|
| `THREE_WS_API_KEY` | three.ws key; wins over the saved one |
| `THREE_WS_ORIGIN` | API origin (staging, or a local `npm run dev`) |
| `THREE_WS_AGENT_ID` | the agent this machine acts as |
| `THREE_WS_AGENT_BASE_URL`, `THREE_WS_AGENT_MODEL` | use your own OpenAI-compatible model |
| `THREE_WS_AGENT_API_KEY`, `OPENAI_API_KEY` | that model's key |
| `TELEGRAM_BOT_TOKEN`, `TELEGRAM_ALLOWED_CHATS` | gateway token and allowlist |

## Use it as a library

```js
import { createAgentContext, createSession } from '@three-ws/agent';

const ctx = createAgentContext();
const session = createSession(ctx, { title: 'scripted' });
const result = await session.send('List the files in this folder.', {
	approve: null, // nobody to ask: tools that would ask are refused
	onContent: (delta) => process.stdout.write(delta),
});
console.log('\n', result.usage);
await ctx.close();
```

## Related

- [packages/agent-cli/README.md](../packages/agent-cli/README.md): module reference and internals.
- [docs/cli.md](./cli.md): `npx three-ws setup`, which connects MCP clients and writes the shared credential.
- [docs/mcp.md](./mcp.md): the MCP servers and tools the agent mounts.
- [docs/agent-runtime.md](./agent-runtime.md): the loop and guards this runtime shares with the server.
