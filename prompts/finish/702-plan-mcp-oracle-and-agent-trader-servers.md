# Oracle and the autonomous trading agents ship as two focused MCP servers in the official registry

**How to run:** paste this entire file into a fresh Claude Code chat opened in the three.ws repository (`/home/user/three.ws`) and send it. Nothing else is needed: everything this order depends on is in this file, including a verbatim copy of the planning docs it came from. It is safe to run on its own, in any order, and at the same time as any other work order. Its path in the repo is `prompts/finish/702-plan-mcp-oracle-and-agent-trader-servers.md`.

**Priority:** P2, new capability with clear value (score 68 of 100 inside the tier). **Area:** mcp. **Written:** 2026-11-03, from a review of the planning corpus that read the source docs listed at the bottom and checked them against the code. Status claims rot, which is why Step 0 re-measures before you build anything.

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

Oracle is the strongest signal product the platform runs, and an agent client cannot find it. Its four MCP tools (`oracle_top_plays`, `oracle_coin`, `oracle_arm_watch`, `oracle_watch_status`) are buried inside the 149-tool `https://three.ws/api/mcp` server that the registry describes as "3D avatars, embeds, glTF tools". `oracle_arm_watch`, the single most interesting write tool (arms an agent to trade a live conviction stream inside a spend leash), is discoverable only by reading that list. The fix is packaging, not capability: a free read-only Oracle server and a guarded agent-trader control-plane server, each with its own registry entry, docs and announcement-ready claims.

## Current state (measured by the reviewer on 2026-11-03; re-verify)

- Not built: `ls packages | grep -iE 'oracle|trader'` shows only `packages/oracle-model` (the local scorer library). No `api/mcp-oracle.js`, no `server-oracle.json`. `curl -s -o /dev/null -w '%{http_code}' https://three.ws/api/mcp-oracle` returns 404. The registry search `?search=threews-oracle` returns zero servers.
- Exists and reusable: `api/_mcp/tools/oracle.js` (413 lines, 4 tools), `tests/api/mcp-oracle-tools.test.js`, 26 public endpoints in `api/oracle/*.js` (feed, coin, signal, stats, backtest, calibration, leaderboard, wins, movers, categories, search, history, market, social, trades, wallet, watch, agent-stats, action-stream, activity, follow, batch, stream), the hosted-remote template `api/mcp-3d.js` (140 lines) with `server-3d.json`, the stdio templates `packages/intel-mcp` (read-only public) and `packages/autopilot-mcp` (write-heavy real-money posture), `api/_lib/mcp-resources.js` (`OAUTH_MCP_PATHS` has 6 paths), and the publisher `scripts/publish-mcp-servers.mjs` with its `SERVERS` array.
- Live money gates that must be inherited, not re-implemented: `oracle_arm_watch` refuses live mainnet arming with `risk_ack_required` plus a signing link unless the account signed the Terms, Risk Disclosure and Agent Wallet Agreement (`currentSignatureFor` in `api/_lib/real-funds-agreement.js`), and bearer-token live arming needs the `wallet:write` scope (`assertBearerMaySpend` in `api/oracle/watch.js`).

## Step 0: re-derive the current state

Run these first. Skip any task whose outcome already exists, and say so in the report.

```bash
ls packages | grep -iE 'oracle|trader'; ls api/mcp-oracle.js server-oracle.json 2>&1
curl -s -o /dev/null -w '%{http_code}\n' https://three.ws/api/mcp-oracle
curl -s "https://registry.modelcontextprotocol.io/v0/servers?search=threews-oracle" | head -c 300
curl -s "https://registry.modelcontextprotocol.io/v0/servers?search=threews-agent-trader" | head -c 300
grep -n "OAUTH_MCP_PATHS" -A9 api/_lib/mcp-resources.js
grep -n "oracle\|agent-trader" scripts/publish-mcp-servers.mjs public/.well-known/mcp.json
grep -n "name: '" api/_mcp/tools/oracle.js
npm run publish:mcp:dry 2>&1 | tail -30
```
If any of the artifacts already exist, build only what is missing.

Before changing anything, also record the baseline so you can prove you broke nothing:

    git status --short | head -20
    git log --oneline -5
    npx vitest run 2>&1 | tail -8    # note the failing-file count; it is your baseline, not your job unless this order says so

## Tasks

1. Refactor `api/_mcp/tools/oracle.js` so the tool definitions are a shared module that both the main `/api/mcp` catalog and the new server import. The four existing tools stay in `/api/mcp` unchanged. `tests/api/mcp-oracle-tools.test.js` must stay green throughout.
2. Add the ten read tools as thin wrappers over live public endpoints, each with `readOnlyHint` annotations and a case in `tests/api/mcp-oracle-tools.test.js`: `oracle_getting_started` (static), `oracle_feed`, `oracle_search`, `oracle_movers`, `oracle_wins`, `oracle_backtest`, `oracle_calibration`, `oracle_leaderboard`, `oracle_wallet`, `oracle_stats`. Hard cap: 14 tools total on the Oracle server. Honesty rule enforced by tests: a degraded feed or intel store returns a transient error, never an empty market, and an unknown coin is distinguished from an outage.
3. Build the hosted remote `api/mcp-oracle.js` plus `server-oracle.json` (registry name `io.github.nirholas/threews-oracle`, URL `https://three.ws/api/mcp-oracle`) by copying the structure of `api/mcp-3d.js`: Streamable HTTP, shared plumbing from `api/_mcp/auth.js` and `api/_mcp/payments.js`, per-IP rate limits, SSE on GET, terminate on DELETE. Initialize and `tools/list` work unauthenticated. `oracle_arm_watch` and `oracle_watch_status` are served here only (account scoped).
4. Add `/api/mcp-oracle` to `OAUTH_MCP_PATHS` in `api/_lib/mcp-resources.js` and pass `resourcePath` through the `api/_mcp/auth.js` helpers as `api/mcp-3d.js` does, so the 401 points at `/.well-known/oauth-protected-resource/api/mcp-oracle` with `resource` set to the server's own URL. Add the route to `vercel.json` if the generic `/api/*` filesystem handling does not already serve it (confirm by running the server), and add the entry to `public/.well-known/mcp.json`. `tests/mcp-resources.test.js` must pass (it fails when the list and the well-known file drift).
5. Build the stdio package `packages/oracle-mcp` (`@three-ws/oracle-mcp`), modelled on `packages/intel-mcp`: read-only, no key, no signer, no payment, over the live public API. It advertises the two write tools as "available on the hosted server" in its getting-started text instead of shipping a half-wired local auth path. Include `server.json`, `smithery.yaml`, `LICENSE`, `README.md` (install, full tool table, one runnable example) and a `test/` suite beside the intel-mcp one.
6. Build `packages/agent-trader-mcp` (`@three-ws/agent-trader-mcp`, registry `io.github.nirholas/threews-agent-trader`), modelled on `packages/autopilot-mcp`, authenticated with a three.ws API key, at most 8 tools: `trader_getting_started`, `agent_arm` (POST /api/oracle/watch), `agent_disarm` (the kill switch, works with only an agent id), `agent_status`, `agent_actions` (action-stream and activity), `agent_performance` (agent-stats), `agent_positions` (portfolio API), `agent_guardrails` (spend-envelope API). Safety posture copied from autopilot-mcp: `mode` defaults to `simulate`, live spend is opt-in per call and never sticky, every boundary (scopes, per-trade SOL, daily SOL cap, max open positions) is enforced server-side, the README and `server.json` description say in the first two lines that this server can move real SOL, and `agent_arm` surfaces the `risk_ack_required` refusal and signing link verbatim rather than deciding it. Tests prove simulate is the default, disarm needs one argument, and an unsigned account is never armed.
7. Register both servers in the `SERVERS` array in `scripts/publish-mcp-servers.mjs` (a server missing from that array is invisible to the publisher), then run the four audits and `npm run test:mcp`: `npm run audit:mcp`, `audit:mcp-safety`, `audit:mcp-golden` (add golden transcripts for the new servers), `audit:mcp-catalog`, plus `npm run check:mcp-counts` and `build-mcp-catalog`/`build-mcp-surfaces` outputs for the new servers.
8. Documentation: `docs/mcp.md` (fix the server count against the live registry and add both servers to the hosted and install lists), expand the "MCP path" section of `docs/oracle.md` into a quickstart with a copy-pasteable client config, create `docs/agent-trading-mcp.md` and link it from `docs/start-here.md`, add `STRUCTURE.md` rows for both package directories, add a `data/changelog.json` entry tagged `feature` and `sdk` in holder-readable language, then `npm run build:pages` and `npm run audit:docs`.
9. Verify live behavior locally: run the dev server, call `initialize` and `tools/list` on `/api/mcp-oracle` unauthenticated, call `oracle_top_plays` and `oracle_coin` against real data, and arm then disarm an agent in simulate mode through the agent-trader package against a real dev account. Run `npm run smoke:mcp` and `npm run probe:mcp-clients` once the remote is deployed (note the result in the report if deploy has not happened yet).
10. Update the existing draft `docs/x-posts/oracle-trading-mcp-x-post.md` so every claim matches what is true after the work. Do not post it.

## Definition of done

Every line must be verified with the actual command output or browser observation in front of you. Never claim a line you did not verify.

- [ ] `node -e` or curl: POST `initialize` and `tools/list` to the local `/api/mcp-oracle` returns the tool list with no auth, at most 14 tools, each annotated.
- [ ] `npx` equivalent from the package dir (`node packages/oracle-mcp/src/index.js` or the declared bin) answers `tools/list` and returns a live score for a real mint with no key.
- [ ] `packages/agent-trader-mcp` test suite proves simulate default, one-argument disarm, and `risk_ack_required` pass-through; it passes.
- [ ] `npm run audit:mcp && npm run audit:mcp-safety && npm run audit:mcp-golden && npm run audit:mcp-catalog && npm run check:mcp-counts` all exit 0.
- [ ] `npx vitest run tests/api/mcp-oracle-tools.test.js tests/mcp-resources.test.js` passes.
- [ ] `npm run publish:mcp:dry` lists both new servers as ready to publish.
- [ ] After deploy and publish (owner approved): `curl -s "https://registry.modelcontextprotocol.io/v0/servers?search=threews-oracle"` and `...threews-agent-trader` each return one server, and `npm run smoke:mcp` passes.
- [ ] Every test you wrote or touched passes (`npx vitest run <those files>`; Playwright specs with `npx playwright test <spec>`). Bug fixes landed test-first: the new test failed before the fix for the reason the bug describes, and passes after.
- [ ] `npx vitest run` shows no new failing files compared with the Step 0 baseline.
- [ ] Any UI you changed was exercised in a real browser on a dev server (`npx vite --port <free port> --strictPort`): no console errors or warnings from your code, real network calls returning real data, and hover, focus, active, empty, error and loading (skeleton) states all designed and observed.
- [ ] `npm run check:rules -- --paths <every file you touched>` exits 0.
- [ ] Documentation is true: the feature doc or README describes what now exists, `STRUCTURE.md` has a row for any new surface or directory, a new page is in `data/pages.json`, and any user-visible change has a `data/changelog.json` entry followed by `npm run build:pages`. `npm run audit:docs` reports nothing new.
- [ ] You reviewed `git diff --staged` line by line before committing, and every changed line is justified.

## Never blocked

| Blocker | Resolution (act, do not ask) |
|---|---|
| Registry publish returns 403 | Known trap in `scripts/publish-mcp-servers.mjs`: the git PAT outranks `GITHUB_TOKEN`. Check `npm whoami` and the PAT source first. |
| No live mainnet account to test arming | Test arming with `mode: simulate` and devnet; the live path is covered by the server-side refusal tests. |
| Main `/api/mcp` loses Oracle tools in the refactor | `tests/api/mcp-oracle-tools.test.js` is the guard; keep definitions in `api/_mcp/tools/oracle.js` and import from both catalogs. |
| Missing credential or env var | Read it from the live Cloud Run service: `node scripts/read-service-env.mjs` (or `gcloud run services describe three-ws-api --region us-central1`). Never trust `vercel env pull`; it returns empty secrets. To set one key, use `gcloud run services update --update-env-vars`, never `--set-env-vars` (that replaces the whole set). Load `.claude/skills/self-unblock-playbook/SKILL.md` for the full table. |
| Database schema needed | Write the migration beside the existing ones, read `npm run db:status` first, and remember `npm run db:migrate` applies immediately with no dry run. |
| GCP resource, GPU, or quota | GCP spend for quality and reliability is pre-approved (project `aerial-vehicle-466722-p5`). Create what you need; never downgrade quality to save credits. Do not onboard a new paid third-party API without the owner. |
| Tests failing that you did not touch | Compare with your Step 0 baseline. Pre-existing failures are not yours to fix unless this order says so; report them in one line. Never delete or skip a test to get green. |
| A file changed under you | Another session edited it. Re-read it, keep their change, and apply yours on top. Never `git stash`, `git reset`, `git checkout -- <path>`, or revert work you did not write. |
| Upstream API down or rate-limited | Find the root cause, add a real fallback or retry with backoff, and keep going. Never ship fake data in its place. |

## Gates in this order

`npm publish`, the MCP registry publish, and the X post are external publishing (CLAUDE.md gate 2). Build, test and dry-run everything; stop before `npm run publish:mcp` and before posting, and batch both asks into one message at the end. Arming a LIVE mainnet watch is a spend action and is never exercised by this order; only simulate and devnet.

## Close out (required)

1. Verify every Definition of done line with real output in front of you.
2. Commit with explicit paths and a message that describes the diff: `type(scope): what changed and why a reader would care`. Split unrelated changes into separate commits. If the diff references a crypto project other than $THREE, stop and ask the owner before that commit (CLAUDE.md commit gate).
3. If every Definition of done line passes, delete this work order in your final commit (`git rm prompts/finish/702-plan-mcp-oracle-and-agent-trader-servers.md`) and append one dated line to `prompts/finish/_context/plan-PROGRESS.md` (create it if missing): the date, `702-plan-mcp-oracle-and-agent-trader-servers.md`, the commit SHAs, and one sentence on what shipped.
4. If the last step belongs to the owner or an outside party, finish everything else, keep this file, add a dated "Status" paragraph directly under its title saying exactly what remains and who owns it, and append the same to `prompts/finish/_context/plan-PROGRESS.md`.
5. Never push or deploy unless the owner's message that started this session explicitly told you to. Leave the ship as one command (`git push threews main`, then `npm run deploy:gcp:full` per `.claude/skills/deploy-runbook/SKILL.md`) and name it in the report.

## Final report

Reply with, in this order and nothing else: what Step 0 measured; what you changed (files and commit SHAs); evidence for each Definition of done line; the one batched owner message, if any gate was hit; one line per judgment call. No trailing questions.

## Source material (verbatim)

The planning docs this order was derived from, copied on 2026-11-03 so this order stands alone even if they move or are deleted. Typography was normalized to the house style (dashes become hyphens, uppercase unfinished-work markers are lowercased, and a code comment that reads like a statement gets a trailing period so the repo lint does not mistake it for commented-out code); nothing else was changed. Where a source still exists, the live file may be newer: re-read it, and trust the code over both.

### `docs/oracle-trading-mcp-plan.md` (whole file)

~~~~markdown
# Plan: ship Oracle and the autonomous trading agents as MCP servers

**Status:** planned, not started. Written 2026-08-19; still unstarted at 2026-10-23 (no `packages/oracle-mcp`, no `packages/agent-trader-mcp`, no `api/mcp-oracle.js` in the tree; `packages/oracle-model` is the local scorer library, not an MCP server). Facts below re-verified 2026-10-23.
**Goal:** make [Oracle](https://three.ws/oracle) and the autonomous trading agents first-class,
discoverable MCP servers, publish them to the official MCP registry
(`registry.modelcontextprotocol.io`), document them, and announce them in one plain-language X post.

This document is the build order. Everything in "What already exists" was verified against the
tree and the live registry on 2026-08-19, so the plan starts from facts, not assumptions.

---

## Why this is worth doing

Oracle is the best thing we run and almost nobody can find it from an agent client.

Its four MCP tools (`oracle_top_plays`, `oracle_coin`, `oracle_arm_watch`, `oracle_watch_status`)
live inside the main `https://three.ws/api/mcp` server, buried among 140+ avatar, model, animation,
sign-language, memory, and market tools (149 for the `mcp` server in `public/mcp-catalog.json` today). In the registry that server is listed as
"3D avatars, embeds, glTF tools, agent memory, and on-chain agent identity". An agent looking for
a conviction signal on a new launch has no way to find it, and a human browsing the registry has
no reason to click.

The same is true of the autonomous side. `oracle_arm_watch` is the single most interesting write
tool on the platform (it arms an agent to trade a live conviction stream inside a spend leash), and
it is discoverable only by reading a 149-tool list on an avatar server.

The fix is not new capability. It is **packaging**: two focused servers, named for what they do,
listed under their own registry entries.

---

## What already exists (verified 2026-08-19, re-checked 2026-10-23)

### Oracle

| Layer | Location | State |
|---|---|---|
| Conviction engine | `api/_lib/oracle/` + `conviction-model.json` | Live, fitted model with three heads; holdout AUC 0.840 win, 0.918 rug, 0.892 moon |
| Public API | `api/oracle/*.js` (26 endpoints) | Live: `feed`, `coin`, `signal`, `stats`, `backtest`, `calibration`, `leaderboard`, `wins`, `movers`, `categories`, `search`, `history`, `market`, `social`, `trades`, `wallet`, `watch`, `agent-stats`, `action-stream`, `activity`, `follow`, `batch`, `stream`, and more |
| Pages | `/oracle`, `/oracle/docs`, `/oracle/arm` (in `data/pages.json`) | Live |
| Reference doc | `docs/oracle.md` | Complete, long-form |
| MCP tools | `api/_mcp/tools/oracle.js`, 4 tools | Live, but only inside the main server |
| Dedicated MCP server | none | **This is the gap** |

### Autonomous trading agents

| Surface | Location | Registry state |
|---|---|---|
| Sniper engine (library + CLI + MCP + x402 API) | `packages/agent-sniper`, `workers/agent-sniper` | `io.github.nirholas/agent-sniper` @ 0.1.7 in the registry, matching the tree |
| Autopilot control plane | `packages/autopilot-mcp` | `io.github.nirholas/autopilot-mcp` @ 0.2.2 in the registry, matching the tree |
| Copy-trade follows | `packages/copy-mcp` | registry @ 0.1.4, matching the tree |
| Signal marketplace | `packages/signals-mcp` | registry @ 0.1.3, matching the tree |
| Portfolio + PnL | `packages/portfolio-mcp` | registry @ 0.1.2, matching the tree |
| Market intel | `packages/intel-mcp`, `packages/kol-mcp` | published |
| Oracle-armed agent loop | `api/oracle/watch.js`, `api/oracle/action-stream.js`, `api/oracle/agent-stats.js` | **No dedicated server. Only the two tools inside `/api/mcp`.** |

80 servers are already published under the `io.github.nirholas` namespace (counted against
the live registry on 2026-10-23), so the publishing path is proven and boring. `scripts/publish-mcp-servers.mjs` (`npm run publish:mcp`)
handles npm plus registry, idempotently, and skips anything already at the target version.

### The publishing machinery (already built, do not rebuild)

- `scripts/publish-mcp-servers.mjs`: npm publish, then registry publish, per server. Auth resolves
  `MCP_REGISTRY_TOKEN`, then the owner's GitHub PAT from git config or `~/.git-credentials`, then
  `GITHUB_TOKEN`.
- `npm run audit:mcp` / `audit:mcp-golden` / `audit:mcp-safety` / `audit:mcp-catalog`: manifest,
  golden-transcript, safety-annotation, and catalog checks. All four are in `npm run gate`.
- `npm run smoke:mcp`: hits the hosted remotes for real. `npm run probe:mcp-clients`
  (`scripts/mcp-client-probe.mjs`) drives every hosted server the way a cloud connector does,
  OAuth discovery included.
- `public/.well-known/mcp.json`: the hand-maintained hosted-server directory (8 entries today).
- `public/mcp-catalog.json` + `/mcp-tools` page: the human-facing catalog, built by
  `scripts/build-mcp-catalog.mjs`.

---

## The plan

Five phases. Phases 1 and 2 are independent and can run in parallel; 3 depends on both; 4 and 5
close it out.

### Phase 1: `@three-ws/oracle-mcp` and the hosted Oracle remote

Two faces of one server, mirroring the pattern already used for 3D Studio
(`packages/*` stdio package plus `api/mcp-3d.js` remote plus `server-3d.json`).

**1a. Hosted remote: `api/mcp-oracle.js` + `server-oracle.json`**

Copy the structure of `api/mcp-3d.js` exactly: Streamable HTTP, shared OAuth/x402 plumbing from
`api/_mcp/auth.js` and `api/_mcp/payments.js`, per-IP rate limits, SSE on GET, terminate on DELETE.
Registry name `io.github.nirholas/threews-oracle`, URL `https://three.ws/api/mcp-oracle`.

Route the handler in `vercel.json` and add the entry to `public/.well-known/mcp.json`. Since
2026-10-08 every hosted MCP server is its own OAuth resource (RFC 8707): add `/api/mcp-oracle` to
`OAUTH_MCP_PATHS` (six paths today: `/api/mcp`, `/api/mcp-3d`, `/api/mcp-agent`, `/api/mcp-bazaar`, `/api/ibm-mcp`, `/api/mcp-grok`) in `api/_lib/mcp-resources.js`, and pass `resourcePath` through the `api/_mcp/auth.js`
helpers as `api/mcp-3d.js` does. That alone makes its 401 point at
`/.well-known/oauth-protected-resource/api/mcp-oracle` (already routed generically to `api/wk.js`, so
no new `vercel.json` metadata route) with `resource` set to the server's own URL, which is what stock
MCP SDK connectors check before they will sign in. `tests/mcp-resources.test.js` fails when that list
and `public/.well-known/mcp.json` drift.

**1b. stdio package: `packages/oracle-mcp`**

Read-only, public, no key, no signer, no payment, over the live public API. This is the one people
will actually install, so it has to be free and instant. Model it on `packages/intel-mcp`, which is
already exactly this shape.

**Tool surface (both faces).** The four existing tools stay, and the rest are thin wrappers over
endpoints that are already live and public:

| Tool | Backing endpoint | Auth |
|---|---|---|
| `oracle_getting_started` | local, static | free |
| `oracle_top_plays` | `/api/oracle/signal` | free |
| `oracle_coin` | `/api/oracle/coin`, `/api/oracle/signal?mint=` | free |
| `oracle_feed` | `/api/oracle/feed` | free |
| `oracle_search` | `/api/oracle/search` | free |
| `oracle_movers` | `/api/oracle/movers` | free |
| `oracle_wins` | `/api/oracle/wins` | free |
| `oracle_backtest` | `/api/oracle/backtest` | free |
| `oracle_calibration` | `/api/oracle/calibration` | free |
| `oracle_leaderboard` | `/api/oracle/leaderboard` | free |
| `oracle_wallet` | `/api/oracle/wallet` | free |
| `oracle_stats` | `/api/oracle/stats` | free |
| `oracle_arm_watch` | `POST /api/oracle/watch` | account-scoped (hosted remote only) |
| `oracle_watch_status` | `GET /api/oracle/watch` | account-scoped (hosted remote only) |

The two write tools ship on the hosted remote only. The stdio package advertises them as
"available on the hosted server" in its getting-started text rather than shipping a half-wired
auth path locally.

`oracle_arm_watch` has carried a second gate since 2026-09-17, and live arming over a bearer token also needs the `wallet:write` scope (`assertBearerMaySpend` in `api/oracle/watch.js`, since 2026-10-08), otherwise the caller is sent to a browser session on three.ws: arming a live mainnet watch refuses
with `risk_ack_required` and a signing link unless the account has signed the Terms, the Risk
Disclosure, and the Agent Wallet Agreement (`currentSignatureFor` in
`api/_lib/real-funds-agreement.js`). Devnet and an already-live watch are exempt, and a lookup
failure fails closed. The new server inherits that refusal verbatim; it is not something to
re-implement or soften.

**Honesty requirements, non-negotiable, already enforced by the existing tests in
`tests/api/mcp-oracle-tools.test.js`:** a degraded feed or intel store reports as transient, never
as an empty market, and an unknown coin is distinguished from an outage. Any new tool inherits
that rule and gets a case in that test file.

**Backwards compatibility:** the four tools stay in the main `/api/mcp` catalog. Nothing that works
today stops working. `api/_mcp/tools/oracle.js` becomes the shared definition both catalogs import.

### Phase 2: `@three-ws/agent-trader-mcp`, the autonomous trading control plane

One server that answers "arm my agent on Oracle, then show me what it did and let me stop it."
Today that story is split across `oracle_arm_watch`, the sniper package, autopilot, and the
portfolio server, so no single entry in the registry tells it.

Registry name `io.github.nirholas/threews-agent-trader`, npm `@three-ws/agent-trader-mcp`, stdio,
authenticated with a three.ws API key. Model it on `packages/autopilot-mcp`, which already has the
right posture for a write-heavy, real-money server.

| Tool | Backing surface | Kind |
|---|---|---|
| `trader_getting_started` | local, static | free |
| `agent_arm` | `POST /api/oracle/watch` | write, guarded |
| `agent_disarm` | `POST /api/oracle/watch` (`armed:false`) | write, the kill switch |
| `agent_status` | `GET /api/oracle/watch` | read |
| `agent_actions` | `/api/oracle/action-stream`, `/api/oracle/activity` | read |
| `agent_performance` | `/api/oracle/agent-stats` | read |
| `agent_positions` | portfolio API | read |
| `agent_guardrails` | agent guards / spend-envelope API | write, guarded |

**Safety posture, copied from `packages/autopilot-mcp` because it is correct:**

- `mode` defaults to `simulate`. Live spend is opt-in, per call, never sticky by accident.
- Every boundary (scopes, per-trade SOL, daily SOL cap, max open positions) is enforced
  server-side. The MCP server cannot widen a leash the backend refuses.
- `agent_disarm` is documented as the kill switch and must work with only an agent id, no other
  arguments, because that is what someone types when something is going wrong.
- The `README` and `server.json` description both say, in the first two lines, that this server can
  move real SOL.
- Arming live still routes through the platform's existing owner-confirmation path. This server
  does not become a way around the spend gate in `CLAUDE.md`.
- `agent_arm` inherits the signed real-funds agreement gate described in Phase 1: an unsigned
  account gets `risk_ack_required` and the signing link, never an armed agent. Every custodial
  money endpoint behind these tools enforces it server-side, so the tool surfaces the refusal
  rather than deciding it.

### Phase 3: publish to the registry

Nothing new to build here. In order:

```bash
npm run audit:mcp            # manifest validation
npm run audit:mcp-safety     # tool annotation / safety audit
npm run audit:mcp-golden     # golden transcripts
npm run audit:mcp-catalog    # catalog is in sync
npm run test:mcp             # every MCP server's own tests
npm run publish:mcp:dry      # report exactly what would publish, publish nothing
npm run publish:mcp          # npm, then registry, idempotent
npm run smoke:mcp            # hit the hosted remotes for real
```

Also in this phase, because they are one-line fixes that are currently drifted:

- Keep the registry in step with the tree: `autopilot-mcp` 0.2.2, `copy-mcp` 0.1.4, `signals-mcp` 0.1.3
  and `portfolio-mcp` 0.1.2 are all published and match as of 2026-10-23. `npm run publish:mcp:dry`
  reports any drift, and `scripts/publish-mcp-servers.mjs --stale` flags a published npm package
  that lags its source.
- Add both new remotes to `public/.well-known/mcp.json` (8 entries today, 9 after Phase 1).
- Add both new server keys to the `SERVERS` array in `scripts/publish-mcp-servers.mjs`. A server
  that is not in that array is invisible to the publisher, which is the single easiest way for
  this whole plan to silently ship nothing.

Verify after publishing:

```bash
curl -s "https://registry.modelcontextprotocol.io/v0/servers?search=threews-oracle" | jq '.servers[].server.name'
```

### Phase 4: documentation

Per the documentation rules in `CLAUDE.md`, all of these apply and none are optional:

- `packages/oracle-mcp/README.md` and `packages/agent-trader-mcp/README.md`: what it does, install,
  full tool table, one runnable example each. Package README coverage is currently 100% and this
  plan must not be what breaks it.
- `docs/mcp.md`: update the server count (it currently says 73, which has already drifted; the registry lists 80) and add both servers to the hosted
  and install-and-run lists.
- `docs/oracle.md`: expand the existing "the MCP path" section into a real quickstart with the new
  server name and a copy-pasteable client config.
- `docs/agent-trading-mcp.md`: new. The autonomous trading story end to end, linked from
  `docs/start-here.md`.
- `STRUCTURE.md`: rows for both new package directories.
- `data/pages.json`: only if a new public page lands. No new page is planned.
- `data/changelog.json`: one entry, tags `feature` and `sdk`. Holder-readable, no commit jargon.
  Something like "Oracle is now its own MCP server: any AI agent can pull live conviction scores,
  and arm a trading agent, without touching the website."

### Phase 5: the X post

Draft lives at [`docs/x-posts/oracle-trading-mcp-x-post.md`](x-posts/oracle-trading-mcp-x-post.md). Written before
the work ships so the announcement shapes the scope rather than the reverse: if a claim in that
post is not true when the phases are done, the phases are not done.

Post it only after `npm run smoke:mcp` passes against the live remotes and both registry entries
resolve. Announcing an MCP server nobody can connect to is the one failure mode that costs more
than shipping late.

---

## Definition of done

- [ ] `https://three.ws/api/mcp-oracle` responds to `initialize` and `tools/list` unauthenticated.
- [ ] `npx @three-ws/oracle-mcp` connects from a clean machine with no key and returns a live score.
- [ ] `npx @three-ws/agent-trader-mcp` arms an agent in simulate mode and disarms it.
- [ ] Both servers resolve in `registry.modelcontextprotocol.io`.
- [ ] `npm run gate` passes (all four MCP audits are inside it).
- [ ] `npm run smoke:mcp` passes.
- [ ] Every doc in Phase 4 is written, and `npm run audit:docs` is clean.
- [ ] The changelog entry is in and `npm run build:pages` accepts it.
- [ ] The X post claims nothing that is not live.

## Risks and how they get handled

| Risk | Handling |
|---|---|
| Registry publish 403s on the wrong account | Known trap, documented in the publish script: the git PAT outranks `GITHUB_TOKEN` because a Codespace token can belong to a different account. If it 403s, check `npm whoami` and the PAT source before touching anything else. |
| Tool sprawl makes the new servers as unfindable as the old one | Hard cap: Oracle ships at most 14 tools, agent-trader at most 8. A tool that does not earn its place in the getting-started text does not ship. |
| Someone arms live spend from an MCP client by accident | `simulate` default, server-side leash, per-call opt-in, kill switch that takes one argument. Same posture as `packages/autopilot-mcp`. |
| The X post outruns the deploy | Post gated on `smoke:mcp` plus both registry lookups resolving. |
| The main `/api/mcp` server loses the Oracle tools in the refactor | The four tool definitions stay in `api/_mcp/tools/oracle.js` and both catalogs import them. `tests/api/mcp-oracle-tools.test.js` already covers them and must stay green. |
~~~~

### `docs/x-posts/oracle-trading-mcp-x-post.md` (whole file)

~~~~markdown
# X post: Oracle and our trading agents become MCP servers

Draft copy for announcing that [Oracle](https://three.ws/oracle) and the three.ws autonomous
trading agents are published as Model Context Protocol servers in
[Anthropic's official MCP registry](https://registry.modelcontextprotocol.io/?q=io.github.nirholas),
so any AI assistant can use them directly.

Build plan this announces: [`docs/oracle-trading-mcp-plan.md`](../oracle-trading-mcp-plan.md).

**Do not post until:** `npm run smoke:mcp` passes against the live remotes, and both
`io.github.nirholas/threews-oracle` and `io.github.nirholas/threews-agent-trader` resolve in the
registry. Every claim below has to be true at post time.

## Rules for this one

1. **Explain it to someone who has never heard of MCP.** The audience is not protocol people. It
   is traders who use Claude and builders who have heard the acronym and never installed one.
   One sentence of plain English up top, jargon only after the reader is already interested.
2. **Lead with the thing, not the plumbing.** Nobody wakes up wanting an MCP server. They want the
   score before the candle. Open on that.
3. **One outbound link in the main post.** Threads can carry more.
4. **Claim only what is live.** We publish to the registry, we do not "partner with Anthropic".
   Do not imply endorsement.
5. **No price talk, no predictions, no moon language.** This is a capability post.
6. **$THREE is the only coin named**, and only if it is naturally relevant. Do not force it in.

---

## 1. Main post (recommended)

> Your AI can now trade with our eyes.
>
> Oracle scores every new pump.fun coin 0 to 100 in the first seconds, from the creator's history,
> who is buying, and how clean the supply is.
>
> It is now an MCP server. One line of setup and Claude reads it live.
>
> https://three.ws/oracle

Why this one: the first line is the whole product in six words, the second line explains it with
zero jargon, and MCP shows up only after the reader already wants it.

## 2. Alternate main post (builder-facing)

> We turned our conviction engine into an MCP server.
>
> `npx @three-ws/oracle-mcp`
>
> Free, no key, no signup. Your agent gets a live 0-100 score on every new launch, the reasoning
> behind it, and the track record so it can decide how much to trust it.
>
> Now in Anthropic's MCP registry.

## 3. Thread (use if the main post lands)

**1/**
> Your AI can now trade with our eyes.
>
> Oracle scores every new pump.fun coin 0 to 100 in its first seconds. It is now an MCP server, so
> Claude can read it live.
>
> Here is what that actually means. 🧵

**2/**
> MCP is a plug for AI assistants. Instead of copy-pasting data into a chat, you connect a tool
> once and the AI can use it whenever it needs to.
>
> Anthropic built it. There is an official registry of them. We just published two.

**3/**
> Server one is Oracle.
>
> Ask your AI "what is worth looking at right now" and it pulls the live board: score, tier, the
> plain-language reasoning, and the honest track record.
>
> Free. No key. No account.

**4/**
> Server two is the trading agent.
>
> Same conversation, next step: "arm my agent on anything scoring 80+, half a SOL a day, simulate
> first."
>
> It runs. You can check what it did and stop it in one sentence.

**5/**
> Simulate is the default. Real spend is opt-in every time, and the per-trade and daily limits are
> enforced on our side, not in the client.
>
> An AI cannot talk its way past them. That is the point.

**6/**
> Why it matters: the first minutes of a new coin are the most lopsided market there is. The people
> with an edge have context you do not.
>
> Oracle is that context, as a number, delivered fast enough to act on.

**7/**
> Both servers are in the official MCP registry now, alongside the rest of ours.
>
> registry.modelcontextprotocol.io/?q=io.github.nirholas
>
> Docs: https://three.ws/oracle/docs

## 4. Reply to attach to whichever post lands

> The scoring model is fitted on our own labeled outcomes, not hand-tuned vibes, and the holdout
> numbers are published on the docs page including the ones that make us look worse.
>
> If you are going to let an agent act on a number, you should get to audit the number.

## 5. If someone asks "what is MCP" in the replies

> It is a standard way to plug a tool into an AI assistant. Connect it once and Claude can use it
> whenever it is relevant, instead of you pasting data in by hand. Anthropic made it and it is
> open. Ours takes one line to add.

---

## Facts a reply might need

Pull the live numbers from https://three.ws/oracle/docs before posting. As of 2026-08-19 the
docs report holdout AUC 0.879, top-decile good-rate 62.5 percent against an 11.7 percent base rate,
and Prime tier at 72.7 percent. **Re-read those from the page at post time.** The model is refit as
labels accumulate, and quoting a stale number in a post about being auditable is the worst possible
place to be wrong.

## What not to say

- Anything implying Anthropic endorses, reviewed, or partnered with us. We published to a public
  registry. That is all.
- "Guaranteed", "alpha", "printer", "financial advice" in any direction.
- A win-rate number without the base rate next to it.
- Anything about the agent being unsupervised. Simulate is the default and the limits are real.
~~~~

