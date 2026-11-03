# Make every @three-ws/agents SDK method hit a real mounted /api/v1 route, add the missing test suite, and leave the package one command from npm

**How to run:** paste this entire file into a fresh Claude Code chat opened in the three.ws repository (`/home/user/three.ws`) and send it. Nothing else is needed: everything this order depends on is in this file, including a verbatim copy of the planning docs it came from. It is safe to run on its own, in any order, and at the same time as any other work order. Its path in the repo is `prompts/finish/278-plan-agents-sdk-route-parity-and-release-readiness.md`.

**Priority:** P1, unshipped fix or half-built user-visible feature (score 58 of 100 inside the tier). **Area:** agents-sdk. **Written:** 2026-11-03, from a review of the planning corpus that read the source docs listed at the bottom and checked them against the code. Status claims rot, which is why Step 0 re-measures before you build anything.

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

`@three-ws/agents` (packages/agents-sdk) is the TypeScript client for the v1 Agents API and is meant to be the primary backend path in the docs. Its README still says "most server routes are not mounted yet", which is now wrong for agents, runs, automations, skills, webhooks and strategies (they are served by `api/v1/rest.js`), but is right for a block of methods: intel, usage, budget, integrations, link codes, wallet and swap all call paths that production answers with 404. The package also advertises `npm test` and `npm run examples` against directories and scripts that do not exist, so nothing proves any method's request shape, and `prepublishOnly` (typecheck, test, build) cannot pass. A developer who installs it today gets a client where roughly a quarter of the methods throw `NotFoundError`.

## Current state (measured by the reviewer on 2026-11-03; re-verify)

- Mounted in `api/v1/rest.js` (routes defined with `R(method, path, name, scope, handler)`, wired by the `vercel.json` rewrites at lines ~844-868): agents CRUD, `start`/`stop` (own files under `api/v1/agents/[id]/`), messages, runs (create/list/get/patch/cancel/steps/SSE events), automations (CRUD + trigger), skills (`api/_lib/agents-v1/routes/skills.js`: `/skills`, `/skills/community[/:slug]`, `/agents/:id/skills/custom/*`), strategies, webhooks, `GET /me`, `GET /models` (`api/v1/models.js`), `GET /me/free-tier` (`api/v1/me/free-tier.js`). Production check on 2026-11-03: `/api/v1/models` 200, `/api/v1/me/free-tier` 200, `/api/v1/skills/community` 200, `/api/v1/agents` 401, `/api/v1/runs/<uuid>` 401, `/api/v1/agents/<uuid>/automations` 401.
- NOT mounted (production 404): SDK methods `getPrice`, `getTopMovers`, `getIndicators`, `getSignals`, `getAnomalies`, `getMacro` (`/intel/*`), `getUsage` (`/me/usage`), `getBudget` (`/me/budget`), `getTransactions` (`/me/transactions`), `listIntegrations`/`saveIntegration`/`removeIntegration` (`/me/integrations`), `generateLinkCode`/`redeemLinkCode` (`/me/link-code[/redeem]`), `setExternalWallet` (`PUT /agents/:id/external-wallet`), wallet methods (`GET /agents/:id/wallet`, `.../wallet/transfer/quote`, `.../wallet/transfer`), `swap/quote` and `swap/execute`.
- Server logic that exists but is unmounted: `api/_lib/agents-v1/routes/wallet.js` (balance, history, transfer quote/confirm; forwards to `api/agents/solana-wallet.js` so spend policy, allowlist, CSRF and ledger apply) and `routes/swap.js`. The header of `api/v1/rest.js` records that "Wallet and swap routes move funds and are not mounted here". A swap quote route does exist elsewhere: `POST /api/v1/trading/swap/quote` (docs/api-reference.md around line 3873), and `api/v1/market/intel.js` serves a different (narrative) intel feed.
- `packages/agents-sdk/tests/` and `packages/agents-sdk/scripts/run-examples.mjs` do not exist; `main`/`module` point at an unbuilt `dist/`. The package is not on npm.
- Production state is a measurement of one day; Step 0 re-measures.

## Step 0: re-derive the current state

Run these first. Skip any task whose outcome already exists, and say so in the report.

```
cd /home/user/three.ws
for p in models me/free-tier me skills/community strategies webhooks/events intel/price intel/indicators me/usage me/budget me/integrations me/link-code swap/quote trading/swap/quote agents/00000000-0000-4000-8000-000000000000/wallet; do echo "$p $(curl -s -m 15 -o /dev/null -w '%{http_code}' https://three.ws/api/v1/$p)"; done
grep -noE '"(GET|POST|PUT|PATCH|DELETE)", [`"][^,)]*' packages/agents-sdk/src/client.ts | sed 's/seg([^)]*)/:x/g'
grep -n "R('" api/v1/rest.js api/_lib/agents-v1/routes/*.js | sed "s/async.*//" | cut -c1-140
ls packages/agents-sdk/tests packages/agents-sdk/scripts 2>&1
cd packages/agents-sdk && npx tsc --noEmit && npx tsup
```

A 401/403 means the route is mounted and wants a key; 404 means it is not. A 404 on an unauthenticated GET of a route that is mounted but dynamic (UUID routes) is checked with a valid-shape UUID as above.

Before changing anything, also record the baseline so you can prove you broke nothing:

    git status --short | head -20
    git log --oneline -5
    npx vitest run 2>&1 | tail -8    # note the failing-file count; it is your baseline, not your job unless this order says so

## Tasks

1. **Contract test first.** Write `packages/agents-sdk/tests/route-parity.test.ts` (or `.js`) that parses every `this.call(METHOD, PATH)` in `src/client.ts` and asserts each (method, normalized path) matches a route in `api/v1/rest.js` `ROUTES`, `api/_lib/agents-v1/routes/skills.js`, or another mounted v1 handler. Run it, confirm it fails for exactly the unmounted methods listed above, then drive the rest of the work from it.
2. **Mount the non-money-moving routes** in `api/v1/rest.js` (add a `routes/me.js`, `routes/intel.js` under `api/_lib/agents-v1/routes/` in the same `R(...)` style with scopes and the `{data, meta}` envelope) and extend the `vercel.json` rewrite for `/api/v1/(intel)` and the `me/*` sub-paths (`/api/v1/me/?` today matches only `/me`): `GET /me/usage` (from `api/usage/summary.js`), `GET /me/budget` and `GET /me/transactions` (from `api/credits/`, `api/billing/`), `GET/PUT/DELETE /me/integrations[/:provider]` (the linked accounts that exist today, one object), `POST /me/link-code` and `POST /me/link-code/redeem` (backed by `api/auth/link-codes/*`), `GET /agents/:id/wallet` and `GET /agents/:id/wallet/history` (read only, scope `wallet:read`, mount `routes/wallet.js` read routes), and `GET /intel/{price,top-movers,indicators,signals,anomalies,macro}` backed by the data the radar, coin-intel and fade surfaces already fetch (see docs/trading-surfaces.md); compute indicators server-side from OHLCV with a maintained npm indicators library, not hand-rolled math.
3. **Money-moving routes stay unmounted unless proven safe in Step 0.** Judgment call to keep (state it in the report): the code comment in `api/v1/rest.js` records that wallet transfer and swap are deliberately not mounted. Keep `transfer`, `transfer/quote`, `external-wallet` and swap execute off the public v1 router. Repoint the SDK's `swapQuote` at the existing `POST /api/v1/trading/swap/quote` if its request/response shape matches (read `api/v1/trading/[...path].js`), and remove from the SDK (and from the README) the methods whose routes are intentionally absent, with a note that they are available through the MCP wallet tools and the dashboard. Do not execute any transfer or swap on mainnet to test.
4. **Fix SDK methods** to match each real route (paths, query names, response unwrapping of `{data, meta}`), keeping typed errors. Add a typed `streamRun` async iterator test against the real `GET /runs/:id/events` SSE endpoint shape (`src/sse.ts`).
5. **Tests.** Create `packages/agents-sdk/tests/`: transport (retry on 5xx/network/timeouts with exponential backoff, idempotency key on every mutating POST, rate-limit headers surfaced on `RateLimitError`, `Retry-After`), error mapping for every status in `src/errors.ts`, `seg()` encoding and path-injection refusal, SSE parsing including split chunks and reconnect, and a request-shape test per method run against a local `node:http` server (a harness for the transport, not a mock of the three.ws API). Add `tests/live.test.ts` that, with `THREE_WS_API_KEY` set (use the QA login from the self-unblock playbook to mint a key), runs create agent, start, send message, create run, read steps, create/delete automation, list models, free tier, and cleans up; skipped with a visible reason when no key is present. New routes from task 2 get route tests under `tests/` at the repo root beside the existing v1 tests (for example `tests/agents-v1-me-routes.test.js`, `tests/agents-v1-intel-routes.test.js`) including an RSI-within-0..100 check against a reference calculation.
6. **Examples.** Create `packages/agents-sdk/scripts/run-examples.mjs` and an `examples/` directory (quick start, run with streaming, automation, strategy preset) that the script executes against the built `dist/` with a real key, or delete the `examples` npm script if you ship none. Make `npm test` in the package resolve (it runs `cd ../.. && vitest run packages/agents-sdk/tests`).
7. **Docs.** Rewrite the README "Status" section to the measured truth (remove "most server routes are not mounted" and the missing-tests bullet), update the API-reference table to the final method list, add the new routes to the `v1 Agents API` section of `docs/api-reference.md`, `STRUCTURE.md` row for `api/v1/`, `data/changelog.json` entry tagged `feature, sdk`, `npm run build:pages`.
8. **Release readiness (publish itself is an owner step).** Run `npm run prepublishOnly` and `npm pack --dry-run` in `packages/agents-sdk`; confirm `dist/` contains ESM, CJS and `.d.ts`; confirm the tarball has zero runtime dependencies. Do not run `npm publish`.

## Definition of done

Every line must be verified with the actual command output or browser observation in front of you. Never claim a line you did not verify.

- [ ] The route-parity test exists, failed before the changes for the unmounted methods, and passes after.
- [ ] `cd packages/agents-sdk && npm run prepublishOnly` exits 0 (typecheck, tests, build).
- [ ] For every remaining SDK method the production route answers non-404 after deploy-equivalent local run (`npm run dev` and the same probe loop as Step 0 against `http://localhost:3000/api/v1/...` shows 401/403/200, never 404).
- [ ] `tests/live.test.ts` passes locally against the dev server with a real key and cleans up the agent it created.
- [ ] `npm pack --dry-run` shows `dist/`, README, LICENSE and `"dependencies"` absent from package.json.
- [ ] README Status no longer claims unmounted routes, and every method in the README table maps to a route listed in `docs/api-reference.md`.
- [ ] `npm run audit:docs` passes.
- [ ] Every test you wrote or touched passes (`npx vitest run <those files>`; Playwright specs with `npx playwright test <spec>`). Bug fixes landed test-first: the new test failed before the fix for the reason the bug describes, and passes after.
- [ ] `npx vitest run` shows no new failing files compared with the Step 0 baseline.
- [ ] Any UI you changed was exercised in a real browser on a dev server (`npx vite --port <free port> --strictPort`): no console errors or warnings from your code, real network calls returning real data, and hover, focus, active, empty, error and loading (skeleton) states all designed and observed.
- [ ] `npm run check:rules -- --paths <every file you touched>` exits 0.
- [ ] Documentation is true: the feature doc or README describes what now exists, `STRUCTURE.md` has a row for any new surface or directory, a new page is in `data/pages.json`, and any user-visible change has a `data/changelog.json` entry followed by `npm run build:pages`. `npm run audit:docs` reports nothing new.
- [ ] You reviewed `git diff --staged` line by line before committing, and every changed line is justified.

## Never blocked

| Blocker | Resolution (act, do not ask) |
|---|---|
| No API key for the live suite | Use the QA login from the self-unblock playbook to mint an `sk_live_` key with `agents:read agents:write inference` against the local dev server; the live file is skipped (visibly) only if nothing can be minted. |
| A route needs data the platform does not have (an indicator needs OHLCV for a mint) | Return the platform's typed `not_found`/`upstream_unavailable` error with the reason; never fabricate values. |
| Production still lacks the new routes during verification | Verify against the local dev server (port 3000) and state that production gets them on the owner's next deploy. |
| `tsup`/`tsc` not found in the package | They resolve from the repo-root `node_modules`; run `npm install` at the root. |
| Missing credential or env var | Read it from the live Cloud Run service: `node scripts/read-service-env.mjs` (or `gcloud run services describe three-ws-api --region us-central1`). Never trust `vercel env pull`; it returns empty secrets. To set one key, use `gcloud run services update --update-env-vars`, never `--set-env-vars` (that replaces the whole set). Load `.claude/skills/self-unblock-playbook/SKILL.md` for the full table. |
| Database schema needed | Write the migration beside the existing ones, read `npm run db:status` first, and remember `npm run db:migrate` applies immediately with no dry run. |
| GCP resource, GPU, or quota | GCP spend for quality and reliability is pre-approved (project `aerial-vehicle-466722-p5`). Create what you need; never downgrade quality to save credits. Do not onboard a new paid third-party API without the owner. |
| Tests failing that you did not touch | Compare with your Step 0 baseline. Pre-existing failures are not yours to fix unless this order says so; report them in one line. Never delete or skip a test to get green. |
| A file changed under you | Another session edited it. Re-read it, keep their change, and apply yours on top. Never `git stash`, `git reset`, `git checkout -- <path>`, or revert work you did not write. |
| Upstream API down or rate-limited | Find the root cause, add a real fallback or retry with backoff, and keep going. Never ship fake data in its place. |

## Close out (required)

1. Verify every Definition of done line with real output in front of you.
2. Commit with explicit paths and a message that describes the diff: `type(scope): what changed and why a reader would care`. Split unrelated changes into separate commits. If the diff references a crypto project other than $THREE, stop and ask the owner before that commit (CLAUDE.md commit gate).
3. If every Definition of done line passes, delete this work order in your final commit (`git rm prompts/finish/278-plan-agents-sdk-route-parity-and-release-readiness.md`) and append one dated line to `prompts/finish/_context/plan-PROGRESS.md` (create it if missing): the date, `278-plan-agents-sdk-route-parity-and-release-readiness.md`, the commit SHAs, and one sentence on what shipped.
4. If the last step belongs to the owner or an outside party, finish everything else, keep this file, add a dated "Status" paragraph directly under its title saying exactly what remains and who owns it, and append the same to `prompts/finish/_context/plan-PROGRESS.md`.
5. Never push or deploy unless the owner's message that started this session explicitly told you to. Leave the ship as one command (`git push threews main`, then `npm run deploy:gcp:full` per `.claude/skills/deploy-runbook/SKILL.md`) and name it in the report.

## Final report

Reply with, in this order and nothing else: what Step 0 measured; what you changed (files and commit SHAs); evidence for each Definition of done line; the one batched owner message, if any gate was hit; one line per judgment call. No trailing questions.

## Source material (verbatim)

The planning docs this order was derived from, copied on 2026-11-03 so this order stands alone even if they move or are deleted. Typography was normalized to the house style (dashes become hyphens, uppercase unfinished-work markers are lowercased, and a code comment that reads like a statement gets a trailing period so the repo lint does not mistake it for commented-out code); nothing else was changed. Where a source still exists, the live file may be newer: re-read it, and trust the code over both.

Code and config the reviewer cited alongside these docs (read them in the repo; they are not copied here): `api/v1/rest.js`.

### `packages/agents-sdk/README.md` (whole file)

~~~~markdown
# @three-ws/agents

**The typed TypeScript client for the three.ws v1 Agents API.**

Construct a client with an API key, then create, start and chat with agents,
run goals, schedule automations, and move funds from Solana agent wallets, with
retries, timeouts, idempotency keys, typed errors and a client-side confirm gate
on every call that moves money.

```ts
import { ThreeAgents } from "@three-ws/agents";

const client = new ThreeAgents({ apiKey: process.env.THREE_WS_API_KEY! });
const agent = await client.createAgent({ name: "Momentum Alpha", strategy: "momentum" });
await client.startAgent(agent.id);
const reply = await client.sendMessage(agent.id, { message: "What is trending right now?" });
console.log(reply.content);
```

## Contents

- [Status](#status)
- [Install and build](#install-and-build)
- [Getting a key](#getting-a-key)
- [Runnable example](#runnable-example)
- [Configuration](#configuration)
- [Core concepts](#core-concepts)
- [API reference](#api-reference)
- [Errors](#errors)
- [Requirements](#requirements)

## Status

Read this before building on the package.

- **Not on npm yet.** `@three-ws/agents` returns 404 from the registry. Build it
  from this directory (below) and depend on the built `dist/`. Publishing is an
  owner-approved step: `npm run release` from this directory runs `npm publish
  --access public`, and `prepublishOnly` gates it on `typecheck`, `test` and `build`.
- **The client is complete; most server routes are not mounted yet.** On
  2026-10-08 production answered these methods: `getModels()` (`GET /models`),
  `getFreeTierStatus()` (`GET /me/free-tier`), `startAgent()` and `stopAgent()`
  (`POST /agents/:id/start|stop`). Every other method calls a `/api/v1` path that
  production answers with `404 not_found` (or, under `/agents/:id/...`, with the
  on-chain card resolver's `400 invalid_caip`). The server-side logic for those
  routes exists in [api/_lib/agents-v1/](../../api/_lib/agents-v1) but has no
  route entry under `api/v1/` yet. The errors are typed, so a caller sees a
  `NotFoundError` or `ValidationError`, never a crash.
- `npm test` (`vitest run packages/agents-sdk/tests`) and `npm run examples`
  (`scripts/run-examples.mjs`) name directories that are not in the tree; use
  `npm run typecheck` and `npm run build` to verify a change.

## Install and build

From the repo root (`tsup` and `typescript` resolve from the root `node_modules`):

```bash
cd packages/agents-sdk
npx tsup          # writes dist/index.js (ESM), dist/index.cjs (CJS) and .d.ts types
npx tsc --noEmit  # type check
```

One entry, ESM and CJS, with declarations and source maps. The on-chain error
classes are imported from [solana-agent-sdk/src/errors.ts](../../solana-agent-sdk/src/errors.ts)
by relative path and inlined by tsup, so the built package has **zero runtime
dependencies**. It runs on Node 20+, Deno, Bun and browsers (anything with `fetch`).

## Getting a key

`apiKey` is a three.ws API key (`sk_live_...`). Create one with
`npx three-ws setup` ([docs/cli.md](../../docs/cli.md)) or on
[/dashboard/api](https://three.ws/dashboard/api). Model calls need a key with the
`inference` scope; agent writes need `agents:write`.

## Runnable example

This runs today against production. Save it as `example.mjs` in this directory
after building:

```js
import { ThreeAgents, ConfirmationRequiredError, VERSION } from "./dist/index.js";

const client = new ThreeAgents({ apiKey: process.env.THREE_WS_API_KEY ?? "sk_live_example" });
console.log(VERSION, client.baseUrl); // 0.1.0 https://three.ws/api/v1

// Free-tier allowance and the models it covers.
console.log(await client.getFreeTierStatus());
// { limit: 20, used: 0, remaining: 20, reset_at: '...', anonymous: true, signed_in_limit: 100, models: [...] }

// The model catalog.
console.log(await client.getModels());

// Fund-moving calls are refused before any request unless confirm is literally true.
try {
  await client.transfer("agent-id", { quoteId: "q" });
} catch (err) {
  console.log(err instanceof ConfirmationRequiredError, err.confirmFlag, err.previewMethod); // true confirm transferQuote
}
```

```bash
node example.mjs
```

## Configuration

```ts
const client = new ThreeAgents({
  apiKey: process.env.THREE_WS_API_KEY!, // required
  baseUrl: "https://three.ws/api/v1",    // default
  timeout: 30_000,                        // per attempt, ms
  retries: 2,                             // after the first attempt, on 5xx, network errors and timeouts
  retryDelay: 1_000,                      // retry n waits retryDelay * 2^n plus up to 20% jitter
  fetch: globalThis.fetch,                // any fetch implementation
  headers: { "x-team": "research" },      // sent on every request
});
```

Every method takes `RequestOptions` as its last argument to override `timeout`
or `retries`, pass an `AbortSignal`, or supply your own `idempotencyKey`.

## Core concepts

**Agent lifecycle.** `createAgent` (optionally from a `strategy` preset:
`momentum`, `sniper`, `defi-yield`, `macro-hedge`, `monitor-exit`,
`conservative`) creates an agent; a preset fills the skills, persona and default
automations you leave out. An agent's status is `running` (its automations,
intents and runs may execute) or `stopped`. `startAgent` and `stopAgent` switch
between them without deleting anything; `deleteAgent` stops automations and
cancels open runs.

**Chat versus runs.** `sendMessage` is one turn and returns the reply with
usage, cost, tool calls and any transaction signatures. `createRun` hands the
agent a goal and lets the server-side tool loop work toward it inside a credit
budget, an on-chain budget and a step limit; follow it with `streamRun` (Server-Sent
Events, resumed from the last event id when the connection drops) or `getRunSteps`.

**Custodial versus non-custodial.** `swapQuote` with an `agentId` trades from the
agent's custodial wallet, and `swapExecute` then needs `confirm: true` and signs
server-side. Without `agentId` the quote is built for your own wallet and
`swapExecute` returns an unsigned base64 transaction for you to sign.

**Money needs a preview and a yes.** `transfer` and `setExternalWallet` throw
`ConfirmationRequiredError` before any request unless their `confirm` flag is
literally `true`. Call the preview method the error names (`transferQuote`,
`getWallet`) and show the result first.

**Idempotency.** Every non-GET request carries an `Idempotency-Key` that is
reused across retries, so a retried create, transfer or swap acts at most once.

**Pagination.** List methods return `Page<T>` (`data`, `hasMore`, `nextCursor`,
`requestId`). `client.paginate(fetchPage)` walks every page:

```ts
for await (const agent of client.paginate((cursor) => client.listAgents({ cursor }))) console.log(agent.name);
```

## API reference

Paths are relative to `baseUrl`. Live means production answered it on 2026-10-08.

### Agents

| Method | Route | Live |
|---|---|---|
| `createAgent(params)` | `POST /agents` | no |
| `getAgent(agentId)` | `GET /agents/:id` | no |
| `listAgents({ limit, cursor })` | `GET /agents` | no |
| `updateAgent(agentId, patch)` | `PATCH /agents/:id` | no |
| `startAgent(agentId)` | `POST /agents/:id/start` | yes |
| `stopAgent(agentId)` | `POST /agents/:id/stop` | yes |
| `deleteAgent(agentId)` | `DELETE /agents/:id` | no |

### Chat and runs

| Method | Route | Live |
|---|---|---|
| `sendMessage(agentId, { message, model?, temperature? })` | `POST /agents/:id/messages` | no |
| `getMessages(agentId, { limit, before })` | `GET /agents/:id/messages` | no |
| `createRun(agentId, { goal, budgetCreditsUsd?, budgetUsd?, maxSteps?, toolsAllowed?, schedule? })` | `POST /agents/:id/runs` | no |
| `listRuns(agentId, page)` | `GET /agents/:id/runs` | no |
| `getRun(runId)` | `GET /runs/:id` | no |
| `updateRun(runId, params)` | `PATCH /runs/:id` | no |
| `cancelRun(runId)` | `POST /runs/:id/cancel` | no |
| `getRunSteps(runId, page)` | `GET /runs/:id/steps` | no |
| `streamRun(runId)` | `GET /runs/:id/events` (SSE) | no |

### Skills

| Method | Route | Live |
|---|---|---|
| `listSkills()` | `GET /skills` | no |
| `listCommunitySkills({ q, tag, author, limit })` | `GET /skills/community` | no |
| `getCommunitySkill(slug)` | `GET /skills/community/:slug` | no |
| `listCustomSkills(agentId)`, `getCustomSkill(agentId, skillId)` | `GET /agents/:id/skills/custom[/:skillId]` | no |
| `createCustomSkill`, `updateCustomSkill`, `deleteCustomSkill` | `POST`, `PATCH`, `DELETE /agents/:id/skills/custom[/:skillId]` | no |
| `importCommunitySkill(agentId, slug, { enabled })` | `POST /agents/:id/skills/custom/import` | no |

### Automations

| Method | Route | Live |
|---|---|---|
| `createAutomation(params)` | `POST /automations` | no |
| `listAutomations(agentId, page)` | `GET /agents/:id/automations` | no |
| `deleteAutomation(automationId)` | `DELETE /automations/:id` | no |

### Intelligence

| Method | Route | Live |
|---|---|---|
| `getPrice(mint)` | `GET /intel/price` | no |
| `getTopMovers(params)` | `GET /intel/top-movers` | no |
| `getIndicators({ mint, indicators, interval })` | `GET /intel/indicators` | no |
| `getSignals(mint)` | `GET /intel/signals` | no |
| `getAnomalies()`, `getMacro()` | `GET /intel/anomalies`, `GET /intel/macro` | no |

### Catalog and account

| Method | Route | Live |
|---|---|---|
| `getModels()` | `GET /models` | yes |
| `getFreeTierStatus()` | `GET /me/free-tier` | yes |
| `getUsage()`, `getBudget()` | `GET /me/usage`, `GET /me/budget` | no |
| `getTransactions(page)` | `GET /me/transactions` | no |
| `listIntegrations()`, `saveIntegration(provider, params)`, `removeIntegration(provider)` | `/me/integrations[/:provider]` | no |
| `generateLinkCode(params)`, `redeemLinkCode({ code })` | `POST /me/link-code[/redeem]` | no |
| `setExternalWallet(agentId, { ..., confirm: true })` | `PUT /agents/:id/external-wallet` | no |

### Wallet and swap

| Method | Route | Live |
|---|---|---|
| `getWallet(agentId, { network })` | `GET /agents/:id/wallet` | no |
| `getWalletHistory(agentId, { limit, cursor, network, category })` | `GET /agents/:id/wallet/history` | no |
| `transferQuote(agentId, params)` | `POST /agents/:id/wallet/transfer/quote` | no |
| `transfer(agentId, { quoteId, confirm: true })` | `POST /agents/:id/wallet/transfer` | no |
| `swapQuote(params)` | `POST /swap/quote` | no |
| `swapExecute(params)` | `POST /swap/execute` | no |

Request and response types for every method are exported from the package
(`CreateAgentParams`, `MessageReply`, `Run`, `RunEvent`, `SwapQuote`, `Wallet`,
`Page<T>` and the rest, from [src/types.ts](src/types.ts)).

## Errors

Every HTTP failure is a subclass of `ThreeAgentsError` carrying `status`, the
stable `code`, the `requestId` (quote it to support), the envelope's `details`,
the `rateLimit` headers, `method` and `path`.

| Class | When |
|---|---|
| `AuthenticationError` | 401: key missing, malformed, revoked or expired. |
| `PermissionError` | 403: key lacks a scope (`scope` names it) or the resource is someone else's. |
| `NotFoundError` | 404. |
| `ValidationError` | 400/422, with per-field `fields`. Also thrown client-side for an empty id. |
| `RateLimitError` | 429, with `retryAfter` in seconds. |
| `InsufficientFundsError` | The wallet or credit balance cannot cover the call. |
| `ConfirmationRequiredError` | A fund-moving call without its confirm flag; names `confirmFlag` and `previewMethod`. |
| `ServerError` | 5xx after the retries are spent. |
| `TimeoutError` | An attempt exceeded `timeout` (`timeoutMs`). |
| `ConnectionError` | The request never got a response. |

On-chain failures reuse the classes from `@three-ws/solana-agent`:
`SolanaAgentError`, `SwapError`, `SimulationError`, `ConfirmationTimeoutError`,
`TransactionRejectedError`, `WalletNotConnectedError`, `WalletCapabilityError`,
`MissingTokenAccountError`.

```ts
import { RateLimitError, ThreeAgentsError } from "@three-ws/agents";

try {
  await client.getFreeTierStatus();
} catch (err) {
  if (err instanceof RateLimitError) console.log(`retry in ${err.retryAfter}s`);
  else if (err instanceof ThreeAgentsError) console.log(err.status, err.code, err.requestId);
  else throw err;
}
```

Also exported: `parseSse(stream)` (the SSE parser `streamRun` uses), `VERSION`,
`DEFAULT_BASE_URL`, and the `FetchLike` and `ResponseMeta` types.

## Requirements

Node 20+ (or any runtime with `fetch`, `AbortSignal` and `ReadableStream`).

## Related

- [docs/api-reference.md](../../docs/api-reference.md): the HTTP API.
- [solana-agent-sdk/](../../solana-agent-sdk): wallet and swap primitives, and the on-chain error classes.
- [packages/three-ws-cli](../three-ws-cli): `npx three-ws setup` mints the key.

## License

Apache-2.0. See [LICENSE](LICENSE).
~~~~

### `docs/prompts/05-agents-rest-parity.md` (whole file)

~~~~markdown
# 05. Agents REST parity: runs, lifecycle, model catalog, intelligence, integrations and link codes

Read `docs/prompts/README.md` first.

## The problem

The agent runtime exists (`api/agent/run.js` runs a server-side tool loop; `api/agent/activity.js` and `api/audit-log.js` log it) but runs are not first-class objects a developer can create, list, inspect step by step, update or cancel. Several capabilities a developer expects from an agents API are either scattered or missing: start and stop as explicit lifecycle states, a model catalog endpoint with prices, a free-tier status endpoint, technical indicators and top movers as JSON, integrations as a listable object, and a short link code for connecting a browser session to an agent from another device. Prompt 06 wraps this API in an SDK; prompt 02 exposes it as resources; prompt 13 delivers it to chat gateways.

## Build

All routes under `api/v1/agents/...` (add a `/api/v1` route family in `vercel.json` served by `server/index.mjs`), keyed by API key or OAuth token with the existing scopes. Every response carries `meta: { requestId, timestamp }`. Errors use one envelope `{ error: { code, message, details } }` with stable codes.

### Lifecycle

- `POST /agents` (name, persona, systemPrompt, model, temperature, skills, strategy preset), `GET /agents`, `GET /agents/:id`, `PATCH /agents/:id`, `DELETE /agents/:id`.
- `POST /agents/:id/start` and `/stop`: status `running` means scheduled automations, intents and runs may execute; `stopped` pauses all of them without deleting anything. Persist `status` and surface it everywhere the agent is listed.
- Strategy presets: `momentum`, `sniper`, `defi-yield`, `macro-hedge`, `monitor-exit`, `conservative`, each a documented bundle of skills, persona text and default automations, stored in `data/agent-strategies.json` and validated at build.

### Chat

- `POST /agents/:id/messages` (message, model override, temperature override) returns content, usage, cost in credits, tool calls made, and transaction signatures if any. `GET /agents/:id/messages` with `limit` and `before` cursor and `hasMore`.

### Runs

- `POST /agents/:id/runs` (goal, budget in credits and USD, max steps, tools allowed, schedule or immediate), `GET /agents/:id/runs`, `GET /runs/:runId`, `PATCH /runs/:runId` (pause, resume, raise budget), `POST /runs/:runId/cancel`, `GET /runs/:runId/steps` (every model call, tool call, result, cost and timestamp), and an SSE stream `GET /runs/:runId/events`. Migration for `agent_runs` and `agent_run_steps`. Runs execute through the existing runtime loop in `api/agent/run.js` with GuardChain preflight and never exceed `enforceSpendLimit`.

### Automations

Expose the existing wallet intents and alert rules (`api/_lib/wallet-intents.js`, `api/alerts/_rules.js`) as one automation object: `POST /automations` with `trigger` (`price_threshold` with mint, operator, priceUsd; `schedule` with cron; `balance_below`; `tip_received`; `launch_matching`; `graduation`; `whale_buy`) and `action` (`agent_prompt`, `swap`, `transfer`, `notify`), `triggerOnce`, `GET /agents/:id/automations`, `DELETE /automations/:id`. Same guards as intents.

### Catalog and account

- `GET /models`: every model in `api/_lib/chat-models.js` with input and output price, context window, and which are free-tier.
- `GET /me/free-tier`: remaining free messages and reset time.
- `GET /me/usage`, `GET /me/budget`, `GET /me/transactions`: from `api/usage/summary.js`, `api/credits/`, `api/billing/`.
- `GET /me/integrations`, `PUT /me/integrations/:provider`, `DELETE /me/integrations/:provider`: X posting config and the other linked accounts that exist today, as one object.
- `POST /me/link-code` and `POST /me/link-code/redeem`: an eight-character code that pairs a device or chat gateway to the account for ten minutes; prompt 13 consumes it.
- `PUT /agents/:id/external-wallet` (`financial` tier, `confirm_transfer`): set a withdrawal destination, subject to the allowlist.

### Intelligence

- `GET /intel/price?mint=`, `GET /intel/top-movers?timeframe=&sortBy=&minLiquidity=`, `GET /intel/indicators?mint=&indicators=rsi,ema,sma,macd&interval=`, `GET /intel/signals?mint=`, `GET /intel/anomalies`, `GET /intel/macro`. Back them with the data the radar, coin-intel and fade surfaces already fetch (`docs/trading-surfaces.md`); compute indicators server-side from the OHLCV we already pull, with a well-adopted npm indicators library rather than hand-rolled math.

### MCP

Every route above gets a tool on `/api/mcp-agent` under the policy from prompt 03 (`list_agent_runs`, `create_agent_run`, `update_agent_run`, `cancel_agent_run`, `get_agent_run_steps`, `get_model_catalog`, `get_free_tier_status`, `get_indicators`, `get_top_movers`, `list_integrations`, `save_integration`, `remove_integration`, `generate_link_code`, `set_external_wallet`, and so on).

## Docs and wiring

- `docs/api-reference.md`: a full `v1 Agents API` section in the format of the neighboring sections, every route with request, response and error codes.
- `docs/agent-runtime.md`: runs and steps.
- `data/changelog.json` entry tagged `feature, sdk`. `STRUCTURE.md` row for `api/v1/`.

## Acceptance

- A run created with a goal and a budget executes, its steps stream over SSE, and cancelling it stops the loop within one step.
- `stop` on an agent prevents an automation from firing; `start` resumes it.
- `GET /intel/indicators` for the wrapped SOL mint returns RSI within 0 to 100 and matches a reference calculation in the test.
- `npm test` green with route tests for every family.
~~~~

### `docs/prompts/06-agents-sdk.md` (whole file)

~~~~markdown
# 06. `@three-ws/agents`: the TypeScript SDK with the agent-lifecycle idiom

Read `docs/prompts/README.md` first.

## The problem

Our published SDKs are `@three-ws/sdk` (embed and `AgentKit(...).mount()`), `@three-ws/solana-agent` (wallet and swap primitives with a good error hierarchy in `solana-agent-sdk/src/errors.ts`) and `@three-ws/agent-payments`. None gives a backend developer the five-line experience the best platforms document: construct a client with a key, `createAgent`, `startAgent`, `sendMessage`, read the reply. There is no retry or timeout configuration, no typed error classes for HTTP failures, and `sdk/README.md` has a nav bar but not a full reference.

## Build

A new package `packages/agents-sdk/` published as `@three-ws/agents`. TypeScript, ESM and CJS builds, zero runtime dependencies beyond `fetch` (Node 20+), generated types from the `v1` routes in prompt 05 (use an OpenAPI document generated from those routes and checked into `docs/api/openapi.json`; `openapi-typescript` is fine).

### Client

```ts
import { ThreeAgents } from "@three-ws/agents";
const client = new ThreeAgents({
  apiKey: process.env.THREE_WS_API_KEY!,
  baseUrl: "https://three.ws/api/v1",
  timeout: 30_000,
  retries: 2,
  retryDelay: 1_000,
});
const agent = await client.createAgent({ name: "Momentum Alpha", strategy: "momentum" });
await client.startAgent(agent.id);
const reply = await client.sendMessage(agent.id, { message: "What is trending right now?" });
```

Methods, one per route in prompt 05: `createAgent`, `getAgent`, `listAgents`, `updateAgent`, `startAgent`, `stopAgent`, `deleteAgent`, `sendMessage`, `getMessages`, `createRun`, `listRuns`, `getRun`, `updateRun`, `cancelRun`, `getRunSteps`, `streamRun` (async iterator over SSE), `listSkills`, `listCustomSkills`, `createCustomSkill`, `updateCustomSkill`, `deleteCustomSkill`, `importCommunitySkill`, `createAutomation`, `listAutomations`, `deleteAutomation`, `getPrice`, `getTopMovers`, `getIndicators`, `getSignals`, `getAnomalies`, `getModels`, `getFreeTierStatus`, `getUsage`, `getBudget`, `getTransactions`, `getWallet`, `getWalletHistory`, `transfer` (requires `confirm: true` and refuses without it), `swapQuote`, `swapExecute` (non-custodial: returns an unsigned base64 transaction for the caller to sign, plus the custodial agent-wallet path when `agentId` is passed and `confirm: true`), `launchToken` (prompt 15), `listIntegrations`, `saveIntegration`, `removeIntegration`, `generateLinkCode`, `setExternalWallet`, and typed methods for perps, lending, predictions, marketplace bids, mail and cards as those briefs land (add them in the same change as each brief).

Retries on 5xx, network errors and timeouts with exponential backoff and an idempotency key on every POST that creates or moves value. Rate-limit headers are surfaced on the error.

### Errors

`ThreeAgentsError` base, then `AuthenticationError`, `PermissionError` (scope missing, names the scope), `NotFoundError`, `ValidationError` (with field details), `RateLimitError` (with `retryAfter`), `InsufficientFundsError`, `ConfirmationRequiredError` (names the confirm flag and the preview method), `ServerError`, `TimeoutError`. Reuse the on-chain errors from `@three-ws/solana-agent` rather than duplicating them.

### README

`packages/agents-sdk/README.md` with a real table of contents and these sections: quick start, installation, getting a key (`npx three-ws setup` from prompt 01 or the settings page), configuration, core concepts (agent lifecycle diagram, custodial versus non-custodial paths, runs, automations), full API reference with request and response for every method, strategy presets, skills catalog, models, automation system, swap guide, error handling, types, best practices, pricing and rate limits, examples, requirements, contributing. Every snippet runs against production as a test fixture (`examples/` directory, executed in CI-free local test with a QA key from `AUDIT_EMAIL` provisioning).

## Docs and wiring

- `docs/api-reference.md` and `docs/start-here.md` link the SDK as the primary backend path.
- `sdk/README.md` gains a section pointing backend developers to `@three-ws/agents`.
- `STRUCTURE.md` row, `data/changelog.json` entry tagged `sdk, feature`.
- Publish to npm is push-gated; prepare the release so it is one command and say so in the report.

## Acceptance

- The quick start above runs end to end with a real key and prints a reply.
- `transfer` without `confirm: true` throws `ConfirmationRequiredError` naming `confirm`.
- A 503 from the server is retried twice and then surfaces as `ServerError` with the request id.
- Type check passes; `npm test` green with unit tests for retry, errors and every method's request shape.
~~~~

