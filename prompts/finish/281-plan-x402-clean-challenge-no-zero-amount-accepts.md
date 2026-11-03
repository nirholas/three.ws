# Paid endpoint 402 challenges stop advertising amount-0 accepts that external x402 validators reject

**How to run:** paste this entire file into a fresh Claude Code chat opened in the three.ws repository (`/home/user/three.ws`) and send it. Nothing else is needed: everything this order depends on is in this file, including a verbatim copy of the planning docs it came from. It is safe to run on its own, in any order, and at the same time as any other work order. Its path in the repo is `prompts/finish/281-plan-x402-clean-challenge-no-zero-amount-accepts.md`.

**Priority:** P1, unshipped fix or half-built user-visible feature (score 58 of 100 inside the tier). **Area:** x402. **Written:** 2026-11-03, from a review of the planning corpus that read the source docs listed at the bottom and checked them against the code. Status claims rot, which is why Step 0 re-measures before you build anything.

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

Every major x402 directory ranks and admits providers by whether the endpoint's 402 challenge validates. Endpoints that declare `authHints` (today `agent-reputation` and `agent-bouncer`) append USE-21 placeholder entries with `amount: "0"` to `accepts[]`. The repo's own distribution playbook records that 402index's validator rejects the whole challenge ("no valid x402 challenge detected") because of them, and other crawlers likely apply the same amount-must-be-positive rule. The default is still `X402_AUTH_HINT_ACCEPTS=true`, so production serves the bad challenge today. The reviewer confirmed it live on 2026-11-03: `curl -s https://three.ws/api/x402/agent-reputation` returns six accepts, two of them on `eip155:8453` with amount `0`, plus an `auth-hints` extension. The fix is to make the default challenge validator-clean while keeping the auth bypass and its discoverability.

## Current state (measured by the reviewer on 2026-11-03; re-verify)

- `api/_lib/env.js` getter `X402_AUTH_HINT_ACCEPTS` defaults to `'true'` (about line 1119).
- `api/_lib/x402-paid-endpoint.js` (about lines 700-780) builds the zero-amount `freeEvmAcceptForAuth` entries and the `auth-hints` extension only when `authHints && env.X402_AUTH_HINT_ACCEPTS`. The code comment says the extension schema requires each declared method to map to a free accepts entry, so the two ship together.
- Auth bypass itself (Bearer / SIWX before the payment dance) works regardless of the flag, per the code comment and the doc.
- Only `api/x402/agent-bouncer.js` and `api/x402/agent-reputation.js` use `authHints`.
- Live 402 for agent-reputation: accepts = 2 Solana (10000, 10000000), 2 Base (10000), 2 Base amount `0`; extensions include `auth-hints`.
- 402index registration is automated (`api/cron/x402-directory-registrar.js`, `scripts/x402-register-directories.mjs`); the validator rejection is documented in `docs/x402-distribution.md`.
- Config-only `gcloud run services update --update-env-vars` is pre-approved by CLAUDE.md; code deploys are owner-gated.

## Step 0: re-derive the current state

Run these first. Skip any task whose outcome already exists, and say so in the report.

```bash
cd /home/user/three.ws
for p in agent-reputation agent-bouncer; do
  curl -s https://three.ws/api/x402/$p | python3 -c "
import sys,json
d=json.load(sys.stdin)
print('$p', [(a.get('network'),a.get('amount') or a.get('maxAmountRequired')) for a in d.get('accepts',[])], list(d.get('extensions',{}).keys()))"
done
grep -n "X402_AUTH_HINT_ACCEPTS" -r api docs scripts tests | head -20
grep -rn "authHints" api --include=*.js | head
ls tests | grep -i -E "x402-paid|auth-hint|offer"
npx -y @agentcash/discovery@latest check https://three.ws/api/x402/agent-reputation 2>&1 | tail -20
```

If no live challenge contains an `amount: "0"` accept, the env half is already done: only do the code-default, test, and docs tasks that are still missing.

Before changing anything, also record the baseline so you can prove you broke nothing:

    git status --short | head -20
    git log --oneline -5
    npx vitest run 2>&1 | tail -8    # note the failing-file count; it is your baseline, not your job unless this order says so

## Tasks

1. Test first. Add `tests/x402-challenge-validator-clean.test.js` that drives `paidEndpoint()` (see how `tests/x402-upto.test.js` builds one) for a route with `authHints: { oauth2: true, siwx: true }`-style config and asserts that, with default env, no `accepts[]` entry has `amount` of `"0"` or an `extra.authRequired` marker. Run it and confirm it fails on today's default for the reason above.
2. Make the validator-clean challenge the default. Flip the `X402_AUTH_HINT_ACCEPTS` default in `api/_lib/env.js` to `'false'` and update the comment. Keep the opt-in path working (`X402_AUTH_HINT_ACCEPTS=true`) and keep its existing tests green.
3. Keep the free auth path discoverable without touching `accepts[]`: publish the supported auth methods per route in `GET /openapi.json` (`api/openapi-json.js`, as an `x-auth-methods` or `security` entry) and in the `/.well-known/x402.json` discovery doc (`api/wk.js`). Add a test beside the existing discovery tests (`tests/x402-discovery-resources.test.js`) asserting both surfaces list the auth methods for `agent-reputation` and `agent-bouncer`.
4. Prove the bypass is unaffected: add a test that a request carrying a valid Bearer or SIWX credential still reaches the handler without a payment on `agent-reputation`, with the flag both on and off.
5. Apply the config now so production is clean before the next code deploy: `gcloud run services update three-ws-api --region us-central1 --project aerial-vehicle-466722-p5 --update-env-vars X402_AUTH_HINT_ACCEPTS=false` (use `--update-env-vars`, never `--set-env-vars`). Record the previous value in the report.
6. Re-run the validators against production: the `curl` in Step 0 shows no `amount` 0 entries, `npx -y @agentcash/discovery@latest discover https://three.ws` still passes, `node scripts/verify-x402-discovery.mjs` passes, and a manual `POST https://402index.io/api/v1/register` probe (or the registrar script with `--dry-run` first) for both URLs no longer reports "no valid x402 challenge detected".
7. Update `docs/x402-distribution.md` "Known listing blockers": replace the zero-amount bullet with the new default, the opt-in flag, and where auth methods are now advertised. Add a `data/changelog.json` entry and run `npm run build:pages`.

## Definition of done

Every line must be verified with the actual command output or browser observation in front of you. Never claim a line you did not verify.

- [ ] `curl -s https://three.ws/api/x402/agent-reputation` and `.../agent-bouncer` show no accept with amount `0` (production, after the config update).
- [ ] `npx vitest run tests/x402-challenge-validator-clean.test.js` fails before the change and passes after; the bypass test passes with the flag on and off.
- [ ] `/openapi.json` and `/.well-known/x402.json` list auth methods for both routes.
- [ ] `npx -y @agentcash/discovery@latest discover https://three.ws` exits 0 and `node scripts/verify-x402-discovery.mjs` passes.
- [ ] `docs/x402-distribution.md` no longer says the default stays `true`.
- [ ] Every test you wrote or touched passes (`npx vitest run <those files>`; Playwright specs with `npx playwright test <spec>`). Bug fixes landed test-first: the new test failed before the fix for the reason the bug describes, and passes after.
- [ ] `npx vitest run` shows no new failing files compared with the Step 0 baseline.
- [ ] Any UI you changed was exercised in a real browser on a dev server (`npx vite --port <free port> --strictPort`): no console errors or warnings from your code, real network calls returning real data, and hover, focus, active, empty, error and loading (skeleton) states all designed and observed.
- [ ] `npm run check:rules -- --paths <every file you touched>` exits 0.
- [ ] Documentation is true: the feature doc or README describes what now exists, `STRUCTURE.md` has a row for any new surface or directory, a new page is in `data/pages.json`, and any user-visible change has a `data/changelog.json` entry followed by `npm run build:pages`. `npm run audit:docs` reports nothing new.
- [ ] You reviewed `git diff --staged` line by line before committing, and every changed line is justified.

## Never blocked

| Blocker | Resolution (act, do not ask) |
|---|---|
| 402index domain claim or verify state unknown | Not needed for this order. Validate with the local test and the public probe only; leave `.x402-directory-credentials.json` untouched. |
| The `auth-hints` extension schema refuses to ship without the free accepts | Keep the extension off by default (that is the point), publish auth methods via OpenAPI and the discovery doc instead, and note the schema constraint in the doc. |
| `npx @agentcash/discovery` cannot reach the network from the sandbox | Run `scripts/verify-x402-discovery.mjs` and the unit tests; state which external check could not run. |
| Missing credential or env var | Read it from the live Cloud Run service: `node scripts/read-service-env.mjs` (or `gcloud run services describe three-ws-api --region us-central1`). Never trust `vercel env pull`; it returns empty secrets. To set one key, use `gcloud run services update --update-env-vars`, never `--set-env-vars` (that replaces the whole set). Load `.claude/skills/self-unblock-playbook/SKILL.md` for the full table. |
| Database schema needed | Write the migration beside the existing ones, read `npm run db:status` first, and remember `npm run db:migrate` applies immediately with no dry run. |
| GCP resource, GPU, or quota | GCP spend for quality and reliability is pre-approved (project `aerial-vehicle-466722-p5`). Create what you need; never downgrade quality to save credits. Do not onboard a new paid third-party API without the owner. |
| Tests failing that you did not touch | Compare with your Step 0 baseline. Pre-existing failures are not yours to fix unless this order says so; report them in one line. Never delete or skip a test to get green. |
| A file changed under you | Another session edited it. Re-read it, keep their change, and apply yours on top. Never `git stash`, `git reset`, `git checkout -- <path>`, or revert work you did not write. |
| Upstream API down or rate-limited | Find the root cause, add a real fallback or retry with backoff, and keep going. Never ship fake data in its place. |

## Close out (required)

1. Verify every Definition of done line with real output in front of you.
2. Commit with explicit paths and a message that describes the diff: `type(scope): what changed and why a reader would care`. Split unrelated changes into separate commits. If the diff references a crypto project other than $THREE, stop and ask the owner before that commit (CLAUDE.md commit gate).
3. If every Definition of done line passes, delete this work order in your final commit (`git rm prompts/finish/281-plan-x402-clean-challenge-no-zero-amount-accepts.md`) and append one dated line to `prompts/finish/_context/plan-PROGRESS.md` (create it if missing): the date, `281-plan-x402-clean-challenge-no-zero-amount-accepts.md`, the commit SHAs, and one sentence on what shipped.
4. If the last step belongs to the owner or an outside party, finish everything else, keep this file, add a dated "Status" paragraph directly under its title saying exactly what remains and who owns it, and append the same to `prompts/finish/_context/plan-PROGRESS.md`.
5. Never push or deploy unless the owner's message that started this session explicitly told you to. Leave the ship as one command (`git push threews main`, then `npm run deploy:gcp:full` per `.claude/skills/deploy-runbook/SKILL.md`) and name it in the report.

## Final report

Reply with, in this order and nothing else: what Step 0 measured; what you changed (files and commit SHAs); evidence for each Definition of done line; the one batched owner message, if any gate was hit; one line per judgment call. No trailing questions.

## Source material (verbatim)

The planning docs this order was derived from, copied on 2026-11-03 so this order stands alone even if they move or are deleted. Typography was normalized to the house style (dashes become hyphens, uppercase unfinished-work markers are lowercased, and a code comment that reads like a statement gets a trailing period so the repo lint does not mistake it for commented-out code); nothing else was changed. Where a source still exists, the live file may be newer: re-read it, and trust the code over both.

### `docs/x402-distribution.md` (section "Known listing blockers")

~~~~markdown
## Known listing blockers

- **Zero-amount auth-hint accepts break external validators.** Endpoints that
  declare `authHints` (currently `agent-reputation`, `agent-bouncer`) append
  USE-21 zero-amount placeholder entries to `accepts[]`. 402index's validator
  rejects the whole challenge ("no valid x402 challenge detected"), and other
  crawlers likely apply the same amount-must-be-positive rule. **Resolution:**
  set `X402_AUTH_HINT_ACCEPTS=false` on the deployment to suppress the
  advertisement (both the zero-amount entries and the auth-hints extension -   the extension schema requires them together). Auth bypass itself keeps
  working either way; the access-control hook honors Bearer/SIWX headers
  before the payment dance. Default stays `true` until the owner flips it.
- **Bazaar indexing needs the CDP facilitator.** Solana-only settles through
  the self-hosted facilitator never reach the Bazaar catalog. The Base rail
  must settle via CDP at least once per endpoint; that is exactly what
  `scripts/x402-bazaar-settle-sweep.mjs` does once CDP credentials and a funded
  Base buyer wallet are in place.
~~~~

### `docs/x402-distribution.md` (section "Surface-by-surface")

~~~~markdown
## Surface-by-surface

### `pay` registry (Solana Foundation)

[`pay`](https://github.com/solana-foundation/pay) is the Solana Foundation's
agentic-payments CLI and MCP server: `pay curl <url>` answers a 402 by signing a
USDC transfer on Solana and retrying, and `pay skills search` / `pay mcp` let
agents browse a public registry of paid APIs,
[`pay-skills`](https://github.com/solana-foundation/pay-skills). It is
Solana-only by design, so it is the most direct agent-discovery surface for our
home-chain rail.

- **What gets listed:** a `PAY.md` plus a committed OpenAPI document per
  provider. We publish three providers, `three-ws/3d`, `three-ws/market-data`,
  and `three-ws/agent-trust`, generated from the service catalog into
  [`distributions/pay-skills/`](../distributions/pay-skills/README.md) by
  `npm run build:pay-skills`.
- **Admission:** the registry's CI probes every paid endpoint and merges only
  ones whose 402 is payable in USDC or USDT on Solana mainnet. Our self-hosted
  Solana facilitator passes as-is; `npm run verify:pay-skills` runs the same
  validator locally against production.
- **Ranking:** the catalog is searched by description and use case, so the
  listing copy is written to the registry's rules rather than reused from other
  storefronts.

### CDP Bazaar (feeds agentic.market)

- **Mechanism:** settlement-triggered. The CDP facilitator catalogs an endpoint
  the first time it **settles** (not just verifies) a payment for it. There is
  no registration form.
- **Metadata:** the Bazaar discovery extension in the 402 challenge -   `description` (< 500 chars, embedded for semantic search), `input` +
  `inputSchema` (the example **must** validate against the schema or indexing
  is rejected), and an output example. Our shared handler emits all of this
  from each service-catalog descriptor.
- **Ranking:** relevance × quality = distinct buyers (30 d), settled volume
  (30 d), recency, metadata completeness. Recomputed every 6 hours.
- **Ops required (secondary priority - see Chain priority above):**
  `CDP_API_KEY_ID`/`CDP_API_KEY_SECRET` on the Cloud Run
  service so Base settles through the CDP facilitator, then ≥1 settled payment
  per endpoint. The ring payer (`api/_lib/x402/pay.js`) is still Solana-only,
  but the Base settle leg exists as a one-shot buyer sweep:
  [`scripts/x402-bazaar-settle-sweep.mjs`](../scripts/x402-bazaar-settle-sweep.mjs)
  pays one real Base USDC settle against every live endpoint that advertises a
  Base accept, cheapest-first under a spend cap (default $3), sending each
  endpoint's own runnable `bazaar.input` example so the settle indexes a 200.
  It needs a funded Base buyer wallet (`X402_BUYER_PRIVATE_KEY`); all Base
  accepts pay to the owner's wallet, so the sweep is an internal transfer.
  Do not let any of this block Solana work. Verify presence via
  `GET https://api.cdp.coinbase.com/platform/v2/x402/discovery/resources` -   do **not** trust the `EXTENSION-RESPONSES` header alone (known upstream bug:
  x402-foundation/x402#2112 - it is sometimes never emitted).
- **agentic.market** (Coinbase's public directory, ~1,700 services) has no
  submission form - it auto-indexes from Bazaar + payment activity. Getting
  Bazaar-listed IS getting agentic.market-listed. Its ~70-service "curated"
  tier is editorial: the lever is volume + clean metadata + BD outreach.

### x402scan (x402scan.com)

- **Mechanism:** three ingestion paths - (1) crawls known facilitators'
  resource lists (incl. the CDP Bazaar), (2) attributes on-chain USDC
  settlements on Base + Solana to sellers, (3) manual registration at
  `https://www.x402scan.com/resources/register` (probes the URL; a valid x402
  challenge auto-lists it; one-time SIWX wallet signature, no funds move).
- **Ranking:** activity - tx count, volume, recency per origin/seller. No
  pay-to-rank.
- **Ops required:** a human with a wallet registers each top resource once
  (start with the flagship services, not health canaries). Our origin metadata
  (og-tags, favicon) renders on the resource page - already good.

### AgentCash (agentcash.dev)

- **Mechanism:** AgentCash is an aggregating discovery interface for
  agent-payable APIs. It does not have its own registration form - it discovers
  us three ways: (1) crawling x402scan / the CDP Bazaar (register there and
  AgentCash picks us up), (2) reading `GET /openapi.json` for the AgentCash
  discovery fields (`info.x-guidance`, `info.contact.email`, per-operation
  `x-payment-info` + `responses.402` + request/response schemas - all emitted by
  [`api/openapi-json.js`](../api/openapi-json.js)), and (3) probing each paid
  route's live 402 challenge. Validate any time with
  `npx -y @agentcash/discovery@latest discover https://three.ws`, and a single
  route with
  `npx -y @agentcash/discovery@latest check https://three.ws/api/x402/crypto-intel`.
  `check` reads the OpenAPI spec, so pass a route the spec actually carries.
  Since 2026-09-02 that is every live, non-free service in the catalog: the spec
  projects each one into a paid operation (`catalogPaidPaths()`), so a new paid
  endpoint is listable the moment its descriptor lands, and hand-authored
  operations still win where they are richer. Routes outside the spec (anything
  not in the catalog, the `/api/v1/x/*` proxy lane and `/api/mcp` aside) still
  answer `L3_NOT_FOUND` even though their live 402 challenge is perfectly valid.
- **Critical invariant - the `PAYMENT-REQUIRED` header carries the bazaar
  block.** AgentCash's probe reads the 402 challenge from the `PAYMENT-REQUIRED`
  **response header** in preference to the JSON body, and checks
  `extensions.bazaar.schema.properties.input` / `.output` for each endpoint's
  input/output schema. Our header mirror is size-capped (8 KB; oversized headers
  were dropped by the LB / flagged HEADERS_OVERFLOW), so
  `paymentRequiredHeaderValue()` in
  [`api/_lib/x402-spec.js`](../api/_lib/x402-spec.js) keeps the `bazaar`
  extension while shedding the heavy payment-execution extensions, degrading it
  in tiers (full bazaar → drop `info` examples → compact `{type:'object'}` field
  schemas) so input/output presence survives. **Do not** reintroduce an
  extension-less header mirror for paid routes - it makes every endpoint look
  schema-less to AgentCash and x402scan's Bazaar probe. Covered by
  `tests/api/x402-spec.test.js` (`paymentRequiredHeaderValue cap`).
- **Ops required:** none beyond keeping x402scan current and `/openapi.json`
  valid. We advertise x402 only (no MPP / Tempo rail), so **mppscan** does not
  apply - AgentCash lists us under x402.

### 402index.io - automated ✅

- **Mechanism:** open API, `POST https://402index.io/api/v1/register` with
  `{ url, name, protocol: 'x402', description }`. No auth. The service probes
  the URL for a valid 402 challenge; some listings go live instantly, others
  are "pending review - verify your domain for instant approval". Rate limit:
  10 registrations/hour/IP.
- **Automation:** `node scripts/x402-register-directories.mjs` submits a batch
  of 8 per run, pre-probes production for a real 402 first (registering a
  not-yet-deployed route burns a slot), and records results in
  [`data/x402-directory-registrations.json`](../data/x402-directory-registrations.json).
  Re-run hourly until it reports 0 remaining, and after every deploy that adds
  endpoints. `--dry-run` previews. The hourly cron
  [`api/cron/x402-directory-registrar.js`](../api/cron/x402-directory-registrar.js)
  supersedes manual runs: it re-upserts a rotating window of 8 catalog entries
  per tick (registration is an upsert by URL), so new endpoints auto-register
  and description drift self-heals.
- **Domain verification (ranks ALL our listings first):** three.ws is claimed -   the challenge hash is served at `/.well-known/402index-verify.txt` (in
  `public/.well-known/`). After a deploy makes it live, complete with
  `curl -X POST https://402index.io/api/v1/claim/verify -H 'Content-Type: application/json' -d '{"domain": "three.ws"}'`.
  The claim's `verification_token` (the ongoing credential for editing
  listings) is in the gitignored `.x402-directory-credentials.json` at the
  repo root - never commit it. Claims expire 72 h after issuance if unverified
  (re-claim with `POST /api/v1/claim {"domain":"three.ws"}` and update the
  hash file).

### x402-list.com

- **Mechanism:** web form at `https://x402-list.com/submit` - first submission
  free, endpoint auto-probed for a live 402 handshake, human-reviewed, then
  monitored (5-15 min uptime checks, "verified" badges). Updates via one-time
  domain proof.
- **Submitted 2026-09-30** as "three.ws 3D Studio" (category AI, origin
  `https://three.ws`, website `/docs/x402-endpoints`, contact `support@three.ws`).
  The form is a plain `POST https://x402-list.com/api/v1/submit` with no sign-in,
  and it answered `303 /submit?success=1&found=14`: every one of the 14 endpoints
  sent was probed and returned a live 402. They are `embody`, the five
  `pipeline-*` stages, `model-check`, `asset-download`, `animation-download`,
  `remix-asset`, `print-order`, `knock`, `fact-check` and `llm-proxy`. `forge` and
  `pipeline` were left out because a bare GET answers 200 with usage, not 402.
  The listing is human-reviewed. Before submission the full catalog
  (`GET /api/v1/services`, 857 services) had no three.ws entry. Updates to the
  listing need the one-time domain proof.

### PR-based directories

- **x402.org ecosystem page** - partner metadata PR to the x402 repo
  (`typescript/site/app/ecosystem/`): logo + description JSON.
- **awesome-x402** - PRs to `xpaysh/awesome-x402` and
  `Merit-Systems/awesome-x402`.

### A2A / AP2 (Google agentic commerce)

- No central registry. Discovery is our A2A agent card at
  `/.well-known/agent-card.json` declaring the a2a-x402 extension URI under
  `capabilities.extensions` - already present, and the card now carries the
  generated `x402-service-catalog` skill. Featuring in Google's AI Agent
  Marketplace is BD, not crawl.

### B402 (Binance BNB-chain Bazaar)

- Same extension-declaration + settle-through-their-facilitator model as CDP,
  on BSC. We already have a BSC direct-settlement rail
  (`api/_lib/x402-bsc-direct.js`); listing there means routing BSC settles
  through Binance's facilitator. Evaluate after the CDP lane is proven.
~~~~

### `docs/x402-distribution.md` (section "The one rule of ranking")

~~~~markdown
## The one rule of ranking

Every major surface ranks the same way: **settled transaction count and
distinct buyers in the trailing 30 days**. Metadata quality gets us *found*
(semantic search embeds our `description` fields); paid traffic gets us
*ranked*. The [autonomous x402 loop](autonomous-x402.md) already drives real
settled canary purchases against every `autobuy: true` entry in
[`api/_lib/x402/ring-catalog.js`](../api/_lib/x402/ring-catalog.js) - that loop
is also our 30-day-activity keeper: the CDP Bazaar **drops resources from
search results after 30 days without a settle**.
~~~~

