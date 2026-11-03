# Ship the three-ws-agent command, terminal UI, slash commands, subagents, local cron and gateway on top of the finished agent-cli runtime core

**How to run:** paste this entire file into a fresh Claude Code chat opened in the three.ws repository (`/home/user/three.ws`) and send it. Nothing else is needed: everything this order depends on is in this file, including a verbatim copy of the planning docs it came from. It is safe to run on its own, in any order, and at the same time as any other work order. Its path in the repo is `prompts/finish/272-plan-agent-cli-tui-slash-commands-and-entrypoints.md`.

**Priority:** P1, unshipped fix or half-built user-visible feature (score 66 of 100 inside the tier). **Area:** agent-cli. **Written:** 2026-11-03, from a review of the planning corpus that read the source docs listed at the bottom and checked them against the code. Status claims rot, which is why Step 0 re-measures before you build anything.

## Operating clause (binding)

- Read `CLAUDE.md` at the repo root before anything else. It overrides this file wherever they disagree.
- Finish 100% in this session. Do not end the turn with a question, an option list, a plan, or "let me know". Make reasonable judgment calls, act on them, and note each in one line in the final report.
- The only permitted stops are the CLAUDE.md stop-and-ask gates: signing or sending a transaction, spending or moving funds, paying an x402 endpoint, minting or launching a coin; `git push`, production deploys, publishing or posting externally; committing content that references a crypto project other than $THREE; destroying data that cannot be regenerated. Do every other part of the work around a gate, and batch every such ask into one message at the end.
- Enterprise grade, no shortcuts. No mocks, no fake data, no placeholders, no sample arrays, no fake loading or progress, no unfinished-work markers, no stub functions, no commented-out code. Real APIs, real endpoints, real data. Errors are handled at the boundaries (network, user input) with a real recovery path.
- Bug fixes are test-first: write the test that reproduces the bug, watch it fail for the reported reason, fix the code, watch it pass, and commit the test with the fix.
- UI work meets the bar a senior design review would pass: hover, focus and active states on every interactive element, designed empty, error and loading (skeleton) states, keyboard accessible, works at phone width, and verified in a real browser.
- Solana is the home chain and leads every design. Robinhood means Robinhood Crypto only. $THREE (`FeMbDoX7R1Psc4GEcvJdsbNbZA3bfztcyDCatJVJpump`) is the only promoted coin; tests and fixtures use it or a clearly synthetic placeholder, never a real third-party mint.
- Never write the em-dash or en-dash characters anywhere (code, docs, UI copy, commit messages). Use a period, comma, colon, parentheses, or a plain hyphen.
- Before writing any non-trivial feature or UI, load `.claude/skills/engineering-standards/SKILL.md`. Before claiming done, load `.claude/skills/changelog-and-docs/SKILL.md`.

## Running alongside other sessions

Many sessions may be working in this same worktree at once. Stage explicit paths only (never `git add -A` or `git add .`), re-check `git status` and `git diff --staged` immediately before each commit, re-read a file right before editing it, and commit your own finished work promptly. Never stash, reset, revert or reformat files you did not change. Start dev servers on a free port (`npx vite --port <free port> --strictPort`), not the default 3000, so you do not collide with another session.

## Why this matters

`@three-ws/agent` (packages/agent-cli) is advertised as "run a three.ws agent on your own machine" and its package.json declares a `three-ws-agent` bin, a `main`, a `./cli` export, a `test` script and a homepage of `https://three.ws/docs/agent-cli`. None of that exists: only the runtime core in `src/` (config, credentials, http, loop, mcp, model, paths, store, tools/) is in the tree, so the package cannot be installed, run or published, and `STRUCTURE.md` has to say the entry points "are not yet published". The core is complete and already contains the SQLite tables for subagent runs and cron schedules (local and server mode), so the missing piece is the user-facing layer. Without it the whole local-agent story (self-hosted loop, wallet and MCP tools, approvals) has no door.

## Current state (measured by the reviewer on 2026-11-03; re-verify)

- Present: `packages/agent-cli/src/{config,credentials,http,loop,mcp,model,paths,store}.js` and `src/tools/{local,netguard,registry,sandbox}.js` (1,189 lines in the top-level modules). `store.js` already has `crons` table with `mode` (local/server), `server_automation_id`, atomic `claimCron`/`finishCron`, session FTS5 search and `exportSession`.
- Absent: `packages/agent-cli/bin/`, `src/index.js`, `src/cli.js`, `tests/` (the package.json `test` script runs `vitest run --root ../.. packages/agent-cli/tests`, which has zero files). No TUI, no slash commands, no subagent runner, no scheduler, no gateway command.
- package.json already declares deps `ink@^8`, `react@^19`, `cron-parser`, `cronstrue`, `turndown`, `@modelcontextprotocol/sdk`, devDep `ink-testing-library`. `@three-ws/agent-runtime` (imported by `src/loop.js` and `src/tools/registry.js`) is NOT in `dependencies`.
- `docs/agent-cli.md` does not exist (package.json homepage points at it); `STRUCTURE.md` line for `@three-ws/agent` says the entry points are missing; there is no `data/pages.json` or `data/changelog.json` entry for it.
- The server side it talks to exists: `/api/mcp-agent`, `/api/mcp`, `/api/v1` (agents, runs, automations in `api/v1/rest.js`), device-link sign-in at `/api/cli/link` and `/api/cli/token` (both answer on production). `packages/three-ws-cli/src/commands/agent.js` is the platform CLI's `create`/`launch` command (not this runtime).
- `workers/agent-gateway` is the server-side Telegram/Discord gateway; its Telegram adapter (`api/_lib/gateway/` + grammY) has an optional `getUpdates` polling mode "for local work". `packages/tty-avatar` is the existing terminal avatar renderer.
- Out of scope here (existing open order `621-beat-21-agent-cli-automation-mode-and-html-reports.md` owns `--json`, `--non-interactive`, the exit-code table and HTML run reports). Do not build those; keep the command layer in a shape that order can extend (every command is a function returning a result object plus a thin printer).

## Step 0: re-derive the current state

Run these first. Skip any task whose outcome already exists, and say so in the report.

```
cd /home/user/three.ws
ls packages/agent-cli packages/agent-cli/src packages/agent-cli/src/tools
ls packages/agent-cli/bin packages/agent-cli/tests 2>&1
git log --oneline -5 -- packages/agent-cli
grep -n "agent-cli" STRUCTURE.md data/pages.json | head
ls docs/agent-cli.md 2>&1
ls node_modules/ink/package.json node_modules/cron-parser/package.json 2>&1
curl -s -o /dev/null -w '%{http_code}\n' https://three.ws/api/cli/link
node -e "import('./packages/agent-cli/src/store.js').then(m=>console.log(Object.keys(m)))"
```

Skip every task whose output already exists and passes its test. If another agent has landed `bin/` or `src/cli.js`, extend it rather than recreating it.

Before changing anything, also record the baseline so you can prove you broke nothing:

    git status --short | head -20
    git log --oneline -5
    npx vitest run 2>&1 | tail -8    # note the failing-file count; it is your baseline, not your job unless this order says so

## Tasks

1. **Dependencies and entry files.** Add `@three-ws/agent-runtime` to `packages/agent-cli/package.json` `dependencies` (workspace-compatible version range matching `packages/agent-runtime/package.json`). Create `bin/three-ws-agent.js` (shebang, Node >=22.13 check with a one-line actionable error, imports `src/cli.js`), `src/index.js` (public API re-exporting `loadConfig`, `resolveCredential`, `createModel`, `connectMcp`, `localTools`, `createToolset`, `runTurn`, `openStore`, plus the new `createSession`, `runSubagent`, `startScheduler`), `src/cli.js` (argv parsing with `node:util` `parseArgs`, no new CLI framework).
2. **Commands.** Implement in `src/cli.js` + `src/commands/*.js`: `three-ws-agent` (opens the TUI, `--resume <id>`, `--agent <id>`, `--model`, `--cwd`), `login` / `logout` (device-link flow already in `src/credentials.js`: `startDeviceLink`, `pollDeviceLink`, `saveAgentKey`, `clearAgentKey`), `whoami`, `sessions` (list, `search <q>`, `export <id>`), `cron` (see task 6), `gateway` (task 7), `doctor` (config, credential, model reachability via `listModels`, MCP server tool counts via `connectMcp`, node:sqlite availability, sandbox ulimit support), `--version`, `--help`.
3. **Terminal UI with Ink** (`src/tui/`): multiline input with history, streaming assistant text through `runTurn({onContent})`, tool-call rows from `onEvent` (`tool_start`/`tool_end` with name, ms and a truncated result), an approval prompt driven by `runTurn`'s `approve` callback (shows tool class, args, and for `financial` class the recipient/amount/token/chain facts; Enter = yes, Esc = no; `financial` never auto-allows), interrupt with Ctrl+C aborting the turn via the `signal` (`InterruptedError`) without exiting, redirect (typing while a turn runs queues a follow-up that aborts and restarts with the new message), status line (model label, session id, tokens, billed USD, workspace root), optional avatar pane that spawns `packages/tty-avatar` when `--avatar` is passed and the terminal is wide enough. Do not hand-roll a renderer.
4. **Slash commands** (`src/tui/slash.js`, with autocomplete and a registry that `/help` renders): `/model` (list via `model.listModels`, switch and persist with `saveConfig`), `/agent` (list/select the platform agent via `GET /api/v1/agents`, sets `x-three-agent`), `/wallet` (calls the three.ws MCP wallet tools through `connectMcp`; any transfer stays `financial` class and asks), `/skills`, `/runs` (agent runs via `GET /api/v1/agents/:id/runs`), `/new`, `/sessions`, `/search <q>` (store FTS), `/resume <id>`, `/export <id>`, `/cron`, `/subagent`, `/clear`, `/help`, `/exit`.
5. **Subagents** (`src/subagent.js`): `/subagent <goal>` and the CLI equivalent spawn an isolated `runTurn` loop with a fresh message list, its own budget from `config.subagent` (8 rounds, 24 steps), at most `config.subagent.maxConcurrent` (4) at once, recorded as a run row in the store with usage and billed USD, and a result summary posted back into the parent session as a message. Parallel with the main session; cancelable.
6. **Cron** (`src/scheduler.js`): `/cron "every weekday 9am" "post the portfolio summary"` converts natural language to a cron expression (small deterministic phrase grammar for the common forms; validate and describe with the already-declared `cron-parser` and `cronstrue`; reject what it cannot parse with a message showing accepted forms), stores it with `store.insertCron` in `local` or `server` mode. Local mode: a scheduler loop (`three-ws-agent cron run` foreground, and inside the TUI) that uses `claimCron`/`finishCron` so two processes never double-fire, runs the prompt as a headless turn, records the run. Server mode: create the schedule as a server automation with `POST /api/v1/automations` (trigger `{type:'schedule', cron}`, action `{type:'agent_prompt', prompt}` as in `api/v1/rest.js` `createAutomationRoute`) and store `server_automation_id`; `cron mode <id> local|server` switches and deletes/creates the remote automation. A cron's tool approvals default to `deny` for `ask` classes when nobody is attached (headless), never auto-allow.
7. **Gateway mode** (`src/gateway.js`): `three-ws-agent gateway --telegram` runs a long-polling Telegram bot using the owner's OWN bot token (`TELEGRAM_BOT_TOKEN`, from env or the credential store, never printed), restricted to an allowlist of chat ids that must be set (refuse to start with an empty allowlist), each chat mapped to a store session. Approvals are inline-button Approve/Deny messages with the same recipient/amount/token/chain table for financial tools. It must refuse to start while a webhook is set on that bot (`getWebhookInfo`), the same guard the hosted `workers/agent-gateway` Telegram adapter uses. Document that the hosted gateway (`workers/agent-gateway`) is the managed alternative.
8. **Tests** in `packages/agent-cli/tests/` (all run under the existing `vitest run --root ../.. packages/agent-cli/tests`): argv parsing and help for every command; slash registry/autocomplete; TUI component tests with `ink-testing-library` (streaming render, approval prompt accept/deny, interrupt, queued redirect); session search and export; subagent concurrency cap and budget enforcement against a local fake OpenAI-compatible HTTP server started in the test (a real `node:http` server speaking the SSE chat-completions format, which is a test harness for the model endpoint, not a mock of three.ws); scheduler claim/finish with two scheduler instances on one DB file never double-firing; NL cron grammar table tests including rejection cases; server-mode cron against a local HTTP server asserting the exact `/api/v1/automations` request body; gateway allowlist and webhook-set refusal. Also one live smoke test file guarded by `THREE_WS_API_KEY` that lists the MCP tools from production and is skipped with a visible reason when the key is absent.
9. **Docs and wiring.** Write `docs/agent-cli.md` (install via `npx @three-ws/agent`, requirements Node 22.13+, login, slash command table, approvals, sandbox, cron modes, gateway, config files and env vars, troubleshooting by `doctor` output). Update `packages/agent-cli/README.md` Status section (remove the "not in tree" paragraph), `STRUCTURE.md` row, add a `data/pages.json` entry if a docs page route is used, run `npm run build:pages`, append a `data/changelog.json` entry tagged `feature, sdk`. Add install breadth that does not need an account: a `Dockerfile` and `docker-compose.yml` in `packages/agent-cli/`, a `flake.nix`, and a PowerShell `install.ps1`, each verified by actually building/running it where the tool exists on the machine (note in the report which could not be run).
10. Verify `npm pack --dry-run` in `packages/agent-cli` lists `bin/`, `src/`, README, LICENSE and that `node packages/agent-cli/bin/three-ws-agent.js --help` and `doctor` run from a clean checkout.

## Definition of done

Every line must be verified with the actual command output or browser observation in front of you. Never claim a line you did not verify.

- [ ] `node packages/agent-cli/bin/three-ws-agent.js --help` exits 0 and lists every command from task 2; `... doctor` runs and reports each check.
- [ ] `ls packages/agent-cli/bin/three-ws-agent.js packages/agent-cli/src/index.js packages/agent-cli/src/cli.js` all exist and the three package.json fields (`bin`, `main`, `exports["./cli"]`) resolve.
- [ ] `npx vitest run --root . packages/agent-cli/tests` passes with the test files from task 8 present (non-zero test count in each area).
- [ ] In a real terminal (script/pty capture is fine): start the TUI against a local OpenAI-compatible endpoint, ask it to write a file, see the approval prompt, approve, and the file exists; a `shell` call with no approver is refused.
- [ ] `/subagent` runs concurrently with a main-session turn and posts its summary back (shown in the TUI test and a captured pty transcript).
- [ ] A local cron created with `/cron "every minute" "..."` fires, records a run, and a second scheduler process does not double-fire; switching it to server mode creates an automation visible in `GET /api/v1/automations` (verify with a QA login per the self-unblock playbook, then delete it).
- [ ] `docs/agent-cli.md` exists, `npm run audit:docs` passes, `STRUCTURE.md` and `data/changelog.json` updated.
- [ ] `npm pack --dry-run` in `packages/agent-cli` shows the bin and src files.
- [ ] Every test you wrote or touched passes (`npx vitest run <those files>`; Playwright specs with `npx playwright test <spec>`). Bug fixes landed test-first: the new test failed before the fix for the reason the bug describes, and passes after.
- [ ] `npx vitest run` shows no new failing files compared with the Step 0 baseline.
- [ ] Any UI you changed was exercised in a real browser on a dev server (`npx vite --port <free port> --strictPort`): no console errors or warnings from your code, real network calls returning real data, and hover, focus, active, empty, error and loading (skeleton) states all designed and observed.
- [ ] `npm run check:rules -- --paths <every file you touched>` exits 0.
- [ ] Documentation is true: the feature doc or README describes what now exists, `STRUCTURE.md` has a row for any new surface or directory, a new page is in `data/pages.json`, and any user-visible change has a `data/changelog.json` entry followed by `npm run build:pages`. `npm run audit:docs` reports nothing new.
- [ ] You reviewed `git diff --staged` line by line before committing, and every changed line is justified.

## Never blocked

| Blocker | Resolution (act, do not ask) |
|---|---|
| No model key for the end-to-end run | Use the local fake OpenAI-compatible server for tests, and for the manual pty run point `THREE_WS_AGENT_BASE_URL` at it; use the QA login from the self-unblock playbook for the live three.ws smoke checks. |
| Telegram bot token for the gateway | Tests use a local HTTP server standing in for `api.telegram.org` via an injectable base URL; document the live bot setup. The live bot run is the only part that needs the owner's token. |
| `@three-ws/agent-runtime` not resolvable | It is a workspace package at `packages/agent-runtime`; run `npm install` at the repo root and use the workspace range. |
| `node:sqlite` missing | Node must be >=22.13; use `nvm`/`fnm` to select it, do not add a native dependency. |
| Ink peer/ESM problems | Pin to the versions already in package.json; if `ink-testing-library@4` rejects `ink@8`, use Ink's own `render` with a fake stdout stream in tests. |
| Missing credential or env var | Read it from the live Cloud Run service: `node scripts/read-service-env.mjs` (or `gcloud run services describe three-ws-api --region us-central1`). Never trust `vercel env pull`; it returns empty secrets. To set one key, use `gcloud run services update --update-env-vars`, never `--set-env-vars` (that replaces the whole set). Load `.claude/skills/self-unblock-playbook/SKILL.md` for the full table. |
| Database schema needed | Write the migration beside the existing ones, read `npm run db:status` first, and remember `npm run db:migrate` applies immediately with no dry run. |
| GCP resource, GPU, or quota | GCP spend for quality and reliability is pre-approved (project `aerial-vehicle-466722-p5`). Create what you need; never downgrade quality to save credits. Do not onboard a new paid third-party API without the owner. |
| Tests failing that you did not touch | Compare with your Step 0 baseline. Pre-existing failures are not yours to fix unless this order says so; report them in one line. Never delete or skip a test to get green. |
| A file changed under you | Another session edited it. Re-read it, keep their change, and apply yours on top. Never `git stash`, `git reset`, `git checkout -- <path>`, or revert work you did not write. |
| Upstream API down or rate-limited | Find the root cause, add a real fallback or retry with backoff, and keep going. Never ship fake data in its place. |

## Close out (required)

1. Verify every Definition of done line with real output in front of you.
2. Commit with explicit paths and a message that describes the diff: `type(scope): what changed and why a reader would care`. Split unrelated changes into separate commits. If the diff references a crypto project other than $THREE, stop and ask the owner before that commit (CLAUDE.md commit gate).
3. If every Definition of done line passes, delete this work order in your final commit (`git rm prompts/finish/272-plan-agent-cli-tui-slash-commands-and-entrypoints.md`) and append one dated line to `prompts/finish/_context/plan-PROGRESS.md` (create it if missing): the date, `272-plan-agent-cli-tui-slash-commands-and-entrypoints.md`, the commit SHAs, and one sentence on what shipped.
4. If the last step belongs to the owner or an outside party, finish everything else, keep this file, add a dated "Status" paragraph directly under its title saying exactly what remains and who owns it, and append the same to `prompts/finish/_context/plan-PROGRESS.md`.
5. Never push or deploy unless the owner's message that started this session explicitly told you to. Leave the ship as one command (`git push threews main`, then `npm run deploy:gcp:full` per `.claude/skills/deploy-runbook/SKILL.md`) and name it in the report.

## Final report

Reply with, in this order and nothing else: what Step 0 measured; what you changed (files and commit SHAs); evidence for each Definition of done line; the one batched owner message, if any gate was hit; one line per judgment call. No trailing questions.

## Source material (verbatim)

The planning docs this order was derived from, copied on 2026-11-03 so this order stands alone even if they move or are deleted. Typography was normalized to the house style (dashes become hyphens, uppercase unfinished-work markers are lowercased, and a code comment that reads like a statement gets a trailing period so the repo lint does not mistake it for commented-out code); nothing else was changed. Where a source still exists, the live file may be newer: re-read it, and trust the code over both.

Code and config the reviewer cited alongside these docs (read them in the repo; they are not copied here): `packages/agent-cli/package.json`.

### `packages/agent-cli/README.md` (whole file)

~~~~markdown
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
~~~~

### `docs/prompts/20-local-agent-runtime-tui.md` (whole file)

~~~~markdown
# 20. Local agent runtime and terminal UI: `three-ws agent`

Read `docs/prompts/README.md` first.

## The problem

Everything an agent does today runs on our servers. There is no way to run a three.ws agent on your own machine or VPS with a real terminal interface, talk to it, let it work on local files and long tasks, and still use the platform's wallet, tools and marketplace through the API. The `three-ws-tty` and `tty-avatar` bins under `packages/` render an avatar in a terminal; `@three-ws/agent-runtime` is the loop the server uses. The strongest open agents ship exactly this: a TUI, sessions, slash commands, subagents, cron, and a gateway process, installable anywhere.

## Build

A new package `packages/agent-cli/` published as `@three-ws/agent`, reachable as `three-ws agent` from the CLI in prompt 01 and as `npx @three-ws/agent`.

- **Runtime:** wraps `@three-ws/agent-runtime` for local execution with the unified MCP endpoint from prompt 17 as its tool source (plus local tools: file read and write, shell in the sandbox from prompt 25, web fetch from the tool gateway in prompt 26). Model access through the account's credits (prompt 16) or any OpenAI-compatible base URL the user sets.
- **TUI:** multiline editor, slash-command autocomplete (`/model`, `/agent`, `/wallet`, `/skills`, `/runs`, `/new`, `/sessions`, `/cron`, `/subagent`, `/help`), streaming tool output, interrupt and redirect, the terminal avatar from `tty-avatar` optional in a pane. Use `ink` or the terminal library already in `packages/`; do not hand-roll a renderer.
- **Sessions:** local SQLite with full-text search over past conversations (`/search`), resume by id, export to JSON.
- **Subagents:** `/subagent <goal>` spawns an isolated child run with its own context and budget, reporting back into the parent.
- **Cron:** `/cron "every weekday 9am" "post the portfolio summary to Telegram"` stores natural-language schedules parsed with a maintained cron-parsing package, executed by a local scheduler or, when the machine is off, by prompt 05 automations on the server (the user picks).
- **Gateway mode:** `three-ws agent gateway` runs the local agent as the backend for the chat gateways in prompts 13 and 24, so messages from Telegram reach the machine the user chose.
- **Install breadth:** Linux, macOS, Windows native (PowerShell installer), WSL, Termux, and a Nix flake; Docker image with a `docker-compose.yml`; a $5 VPS guide.
- **Docs:** `docs/agent-cli.md`, `packages/agent-cli/README.md`, `STRUCTURE.md` row, changelog entry tagged `feature, sdk`.

## Acceptance

- On a clean VPS: install, `three-ws agent`, ask the agent to check its wallet balance and to write a file; both happen.
- `/subagent` runs in parallel with the main session and reports back.
- A cron fires on schedule with the machine on, and hands off to the server when the user picks server mode.
- `npm test` green with TUI component tests and session search tests.
~~~~

