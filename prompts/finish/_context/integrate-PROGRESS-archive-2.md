# integrate-PROGRESS, archive 2 (2026-10-14 to 2026-10-15)

Older entries moved verbatim out of [integrate-PROGRESS.md](integrate-PROGRESS.md) on 2026-11-10 so every file stays under the 50,000-character limit. Read-only record: append new entries to [integrate-PROGRESS.md](integrate-PROGRESS.md), never here.

## 2026-10-14: order 513-integrate-14 closed (evolve)

Ported the owner's proprietary `wallet-sleuth` Solana signals into a new
`@three-ws/wallet-linkage` package: six signals (`solana-account-control`,
`solana-fee-payer`, `peer-first-funding`, `common-first-funder`,
`direct-transfer`, `funding-burst`) combined by noisy-OR into a 0-100
pairwise same-controller score with evidence, over an injected RPC client
so it rides the platform's own failover chain rather than a hardcoded
endpoint. Exposed as `GET /api/crypto/linkage?addresses=A,B[,...]`
(2-10 addresses, keyless, cached with a 5-minute fresh window and a
stale-on-outage fallback, rate limited with its own per-IP and global
buckets), wired into the Free Crypto Data API catalog and `/api/crypto/
openapi.json`, and as the `wallet_linkage` tool in the hosted `intel-mcp`
server. Wired the score into the two places that act on money: the Trade
Safety Firewall's new `creator_linkage` check warns when an early buyer
scores "strong" or better against the coin's on-record creator, and
copy-eligibility's new `checkLeaderCreatorLinkage` refuses to size a copy
order when the leader being copied is secretly the creator's own alt.
Both fail closed (clean / not linked) on any RPC or DB error so a data
outage never blocks a trade or a copy.

Live verification surfaced and fixed a real bug before this was reportable
as done: `collect.js` read `accountKeys[].pubkey` from
`getParsedTransaction()` as a plain string, but `@solana/web3.js`'s real
parsed-transaction shape wraps that field in a `PublicKey` object, so the
`solana-fee-payer` signal silently never fired against live mainnet data
even though it passed all 12 original unit tests, whose mocks used plain
strings for `pubkey`. Added a test reproducing the real shape (confirmed
failing pre-fix with the exact symptom: `solana-fee-payer` missing from a
pair that should have had it), fixed `collect.js` to read
`pubkey.toBase58()`, confirmed the test and all 13 in the file pass
post-fix, then confirmed against real mainnet wallets: before the fix the
live endpoint scored a genuine fee-payer-linked pair `0/none`; after the
fix it scored `90/confirmed`, `topSignal: solana-fee-payer`, with real
on-chain evidence.

Verified: `npx vitest run tests/wallet-linkage.test.js
tests/smart-money.test.js` passes 28/28 (the exact command the order's
Definition of Done names). `npx vitest run tests/copy-eligibility.test.js
tests/copy-engine.test.js tests/trade-firewall-creator-linkage.test.js`
passes 73/73 together with the wallet-linkage file. The Trade-firewall and
copy-trade guards each have tests proven to fail on the pre-fix code via
the stash-dance protocol (temporarily set aside, confirmed red for the
stated reason, restored byte-identical, confirmed green). A full
unscoped `npx vitest run` showed 64 failures across 39 files, none in any
file this order touched and none topically related to wallet
linkage, copy-trading, or the trade firewall (oauth, api-keys, branding,
grok-bot docs, pages-routes, sitemap, tutorials-manifest, etc.); consistent
with CLAUDE.md's "concurrent agents share this worktree" warning, so taken
as pre-existing/concurrent and not a regression from this diff.
`curl localhost:3107/api/crypto/linkage?addresses=<two real fee-payer-linked
mainnet wallets>` returned the real score above (addresses not committed,
per the order's own instruction). `/api/crypto/openapi.json` lists
`/api/crypto/linkage` (re-verified live this session: `has /api/crypto/
linkage: true`). The hosted `intel-mcp` server's `tools/list` over stdio
lists `wallet_linkage` among its 7 tools (re-verified live this session).
`docs/crypto-api.md` got the endpoint's full reference section plus its
index row, `STRUCTURE.md` got the package row, `packages/intel-mcp/
README.md` documents the new tool, `data/changelog.json` got a new entry,
and `npm run build:pages` ran clean. `npm run check:rules --paths <all 24
touched/added files>` exits 0 clean. One fix beyond the order's own scope:
the two new `rate-limit.js` entries were committed with the surrounding
table's indentation one tab shallow; caught and fixed before committing.

Commits: `112749dfe` (wallet-linkage package, endpoint, MCP tool, rate
limits, catalog wiring, the collect.js bug fix), `0044f262f` (trade-firewall
creator-linkage check), `af1226c74` (copy-trade creator-linkage guard),
`14453d052` (docs, changelog, STRUCTURE.md, build:pages artifacts), this
closing commit (order-file deletion, PROGRESS log).

## 2026-10-14: order 512-integrate-13 stopped on a gate (evolve)

Switched the native $THREE launch lane's curve from a flat 1% trading fee to
a decaying anti-snipe schedule in `api/_lib/native-launch/config.js`:
`fee.baseFeeParams` now sets `BaseFeeMode.FeeSchedulerExponential` with a
50% starting fee (`antiSnipeStartFeeBps`) decaying to the steady-state 1%
(`antiSnipeEndFeeBps`, equal to the existing `tradeFeeBps`) over 25 periods
across 100 slots (`antiSnipeDecayPeriods` / `antiSnipeDecaySlots`, about 40
seconds). `RateLimiter` was ruled out, not just compared: the SDK's own
`getBaseFeeParams()` throws "BaseFeeMode.RateLimiter is deprecated" for any
new config in this SDK version, which settles the measurement the task
asked for before reaching devnet. `enableFirstSwapWithMinFee` stays on so
only the creator's pool-creation-bundled first buy is exempt. `laneInfo()`
now serves the schedule under a new `anti_snipe` key (additive, checked
against every existing consumer of the spread object before adding it).

Verified: `npx vitest run tests/native-launch-curve.test.js` passes 20/20,
including four new cases asserting the fee starts at 5000 bps, decays
monotonically slot by slot, reaches exactly 100 bps at slot 100 and stays
there past it, and taxes slot 2 at more than 10x the steady-state fee.
`scripts/native-launchpad-e2e-devnet.mjs` now quotes an identical 1,000
$THREE buy at pool activation and again 21 slots later; because the public
devnet faucet is rate-limited (confirmed: `-32603` then an explicit `429`
"airdrop faucet has run dry", and no funded devnet key exists anywhere in
this worktree's env or GCP Secret Manager), the run used a local
`solana-test-validator` cloning the real DBC, Token-2022, ATA, and Metaplex
Token Metadata programs directly off devnet (the documented fallback in
`docs/draft-agent-mint.md`), which executes byte-identical on-chain program
logic with unlimited local airdrops. Real output: the fee for the same
buy dropped from 400.040459 $THREE to 156.523092 $THREE over those 21
slots, a real signed devnet-program transaction decaying the way the
schedule says it should. The new schedule was also confirmed directly
against the live mainnet DBC program via the script's existing zero-cost,
keyless `--simulate` flag: `simulation OK: config + a $THREE-quoted pool
created by the live DBC program (144429 compute units)`.
`scripts/native-launchpad-create-config.mjs` needed no code change: both
its `--simulate` and real `--network` paths already share the one
`curveBuildParams()` call that config.js's edit updated. `docs/native-
launchpad.md` gained an "Anti-snipe: a decaying fee instead of a flat one"
section (the schedule, why exponential over linear/RateLimiter, and the
one honest EVM difference: the anti-snipe premium flows through the same
creator/platform split every trade uses, never to LPs, since DBC pools
have no third-party LPs pre-graduation) and its curve table row. `data/
changelog.json` got a new entry and `npm run build:pages` ran clean.
`npm run check:rules --paths <all 5 touched source/docs files>` exits 0.

What cannot finish from this session: creating the mainnet curve config is
the on-chain write this order named up front as the one gated step (about
0.006 SOL). Confirmed before naming the owner action that this is a
first-time activation, not a change to a live config: `gcloud run services
describe three-ws-api --region us-central1` lists zero `NATIVE_LAUNCH_*`
env vars in production today. See [row 64 of
production-100-OWNER-ACTIONS.md](production-100-OWNER-ACTIONS.md) for the
exact `node scripts/native-launchpad-create-config.mjs --network mainnet`
command, its funding requirement, and the env-pin command that follows it.
Leaving `512-integrate-13-anti-snipe-native-lane.md` in place with a dated
Evolve status paragraph rather than deleting it.

Commits: this closing commit (curve config, tests, e2e script, docs,
changelog, owner-actions row, order-file annotation, PROGRESS log).

## 2026-10-14: order 514-integrate-15 closed (evolve)

`scripts/check-secrets.mjs` (from a prior commit this session, `d2824d4f3`) gained a base58
Solana secret-key rule: any 86-90 character base58 run is decoded and flagged only when the
first 32 bytes derive the embedded public key in the last 32 bytes via Ed25519, so the repo's
thousands of real 64-byte transaction signatures never false-positive. `tests/check-secrets-
solana.test.js` proves both sides with a runtime-generated keypair.

This closing commit adds the second half: `api/_lib/burned-destination.js`, a read-only
sweeper-bot heuristic over a destination's recent on-chain history (near-zero balance plus
repeated quick in-then-out transfers within 60s), ported from the owner's sol-sweeper-bots
`burned-check` CLI with a deliberate fix over its upstream bug (unsorted newest-first timestamp
comparison misclassifies "quick out"; this module sorts chronologically first). A pure
`classifySweepPattern` carries the heuristic so `tests/burned-destination.test.js` (7 cases)
runs with no network access; `collectDestinationDeltas` is the async collector, taking an
injected connection the same way `packages/wallet-linkage/src/collect.js` already does, never a
hardcoded RPC endpoint. Wired into `api/_lib/agent-trade-guards.js` (`checkDestinationSweepRisk`,
called from `enforceDestinationAllowlist` for `category === 'withdraw'`) and
`api/agents/solana-wallet.js` (`handleWithdraw`, both the simulate-preview and real-submit
paths), with a `sweepRiskAck` flag mirroring the existing `stepUpApproved` ack-and-retry pattern
so a flagged destination blocks once and only proceeds on explicit confirm. `src/agent-wallet-
hub/tabs/withdraw.js` previews the risk on reaching the confirm screen, shows a blocking banner,
and falls back to a native `confirm()` + retry if the server flags it instead (stale preview).
Two existing suites needed mock updates for the new export/dependency:
`tests/agent-wallet-withdraw.test.js` (missing mock function) and
`tests/agent-custody-guards.test.js` (new real network dependency, now stubbed to keep that
suite's documented "deterministic and fast" guarantee).

`docs/ops/hosting-and-credentials.md` documents the base58 rule and the incident response for a
caught Solana secret. `docs/agent-abilities/wallet/18-withdraw.md` documents the sweeper-bot
confirm-screen warning and the server-side check. `data/changelog.json` got a new entry and
`npm run build:pages` ran clean (`public/features.json`, `CHANGELOG.md`,
`public/changelog{.json,.xml,-recent.json}`, `public/sitemap/index.html` regenerated).

DoD verified: `npx vitest run tests/burned-destination.test.js tests/check-secrets-
solana.test.js tests/agent-wallet-withdraw.test.js tests/agent-custody-guards.test.js` is 49/49
passing; `node scripts/check-secrets.mjs` over the full tree reports zero findings;
`npm run check:rules --paths <every touched file>` exits 0 on both commits.

No owner-gated action in this order: every step is code, tests, docs, and a local build.

Commits: `5fa6b0109` (feature: burned-destination.js, trade-guards and solana-wallet wiring,
withdraw.js UI, tests, changelog, build:pages output), `9d3234104` (docs), this closing commit
(PROGRESS log, order-file removal).

## 2026-10-14: order 515-integrate-16 closed (evolve)

Built the owner-signed, epoch-bounded spend delegation: `{ agent, owner, cap_lamports_per_epoch,
epoch_seconds, not_after, nonce }`, canonically serialized and Ed25519-signed by the owner's own
Solana wallet via a sign-message flow (never a transaction). `packages/agent-guards/src/delegation.js`
is the zero-dependency spec module: `DELEGATION_DOMAIN` plus six ordered fields joined with `\n`
for the signed bytes, `verifyDelegationSignature` using only `node:crypto` (a fixed SPKI DER
envelope around the raw 32-byte Solana pubkey) and a from-scratch base58 decoder, and
`checkDelegationCap` for the pure epoch-cap arithmetic. Full spec section added to that package's
README.

`api/_lib/agent-spend-delegation.js` is the platform's store and enforcement: `registerDelegation`
verifies the signature, verifies `owner` really is the agent's linked owner wallet (via
`agent_identities.user_id` to `user_wallets`), and rejects a replayed nonce with a permanent
`UNIQUE(agent_id, nonce)` Postgres constraint (new migration
`api/_lib/migrations/20261014140000_agent_spend_delegations.sql`, written and tested locally,
not yet applied to production). `checkDelegationSpend` measures epoch spend from the REALIZED
ledger (`agent_custody_events`, via the existing `getDailySpendLamports`) rather than the agent's
own claim, so an exact-output trade that settles for more than quoted still can't slip past the
cap. Wired into `POST /api/agent/guard` (registers and enforces in the same preflight call, layered
on top of `GuardChain.evaluate()`) and into `GET`/`POST /api/agents/:id/solana/delegation` on
`api/agents/solana-wallet.js`.

Owner-facing UI: a new "Delegation" tab (`src/agent-wallet-hub/tabs/delegation.js`, order 59,
between Policy and Withdraw) shows the active delegation and lets the owner sign a new one via
`connectLaunchWallet()` + the Wallet Standard `solana:signMessage` feature. That tab carries its
own local copy of the message-builder (not an import of `delegation.js`, which pulls in
`node:crypto` at module scope and has no browser build) with `tests/delegation-message-parity.test.js`
as the tripwire keeping the two formats byte-identical.

DoD verified: `packages/agent-guards/test/delegation.test.js` (8/8, `node --test`) covers a
replayed nonce, an expired delegation, a wrong signer, and the realized-balance cap check in
isolation; `tests/agent-guard-endpoint.test.js` (new `describe` block, lines 297+) covers the same
four rejections end to end through the guard endpoint, including the overspend case built from a
mocked realized-spend ledger (`dbState.custodySpentLamports`); both plus the new parity test are
19/19 under `npx vitest run tests/delegation-message-parity.test.js tests/agent-guard-endpoint.test.js`.
UI flow browser-verified with Playwright against a real owner session (the repo's own QA audit
account via `scripts/page-audit.mjs --login`): active-delegation card, empty state, and the
sign-and-activate flow correctly surfacing "No Solana wallet extension found" in a headless
browser (actual live signing is the owner's own action, out of scope for this order). Docs
(`docs/agent-wallet-api.md`, `docs/agent-wallets.md`) and `data/changelog.json` updated;
`npm run build:pages` ran clean. `npm run check:rules --paths <every touched file>` exits 0.

No owner-gated action in this order: live wallet signing is explicitly the owner's own action,
not something this order performs.

Commit: `92bb445c2` (feature: delegation.js spec, agent-spend-delegation.js store/enforcement,
migration, guard.js and solana-wallet.js wiring, Delegation tab, tests, docs, changelog), this
closing commit (PROGRESS log, order-file removal).

## 2026-10-14: order 516-integrate-17 closed (evolve)

Ported all 8 keyless x402-suite services (no API key anywhere in the chain, not an upstream
key, not a three.ws key) as native `api/x402/<slug>.js` routes settling on three.ws's own
Solana facilitator, rather than through the aggregator lane (`api/v1/_providers.js`), because
that lane hardcodes Base-first networks and only does single-fetch-shape failover: Weather
Guard (Open-Meteo, NWS fallback), Carbon (UK Carbon Intensity), Domains (RDAP), Research
(arXiv/Crossref/Semantic Scholar), Books (OpenLibrary/Gutenberg), News Wire (GDELT DOC 2.0,
~5.1s per-IP throttle serialized in a request queue), Transit (MBTA GTFS + GTFS-Realtime),
Places (OSM Overpass). Each service follows the same two-tier shape: one primary GET route
runs a free daily per-IP quota (`api/_lib/rate-limit.js`, fails closed to the paid rail on a
Redis outage) before falling through to the x402 pay-per-call lane, and one or more secondary
routes are always paid. 17 routes total, each with a catalog descriptor in
`api/_lib/service-catalog/services/` so they surface in bazaar/economy/openapi/x402.json.

Mid-session discovery: `catalogPaidPaths()` in `api/openapi-json.js` silently skipped every
catalog descriptor marked `free: true`, so all 8 free-lane primary routes were completely
missing from `/openapi.json` (only the 9 paid-only secondary routes appeared) even though the
live 402 challenge was spec-valid on every route. Fixed by including `free: true` services in
the document with `security: []` and no `x-payment-info` (mirroring the aggregator's own
documented treatment of free-tier endpoints just above in the same file, for the same reason:
a bare probe can legitimately return 200 while quota remains, so advertising `x-payment-info`
there would repeat the exact x402scan registration failure that section already documents),
with the free-then-paid billing lanes already spelled out in each service's `description`.

Judgment call: upstream x402-places's detail route enriches with Yelp reviews, falling back to
a deterministic seeded-random fixture when no Yelp key is set. three.ws has no Yelp key and
CLAUDE.md bans fake data, so that whole enrichment path was dropped: `places-detail` returns
only the real, live OSM record, documented in both the catalog descriptor and the route file.

DoD verified: `npx vitest run tests/openapi-aggregator.test.js tests/service-catalog.test.js
tests/aggregator-upstream-failover.test.js` is 40/40 passing (these schema-driven tests
exercise every `PAID_SERVICES` entry automatically, no new hardcoded cases needed per service).
All 17 routes confirmed present in `/openapi.json` and `/.well-known/x402.json` with Solana
listed first in every `accepts[]`/challenge. Live, real (non-fabricated) free-lane responses
captured from every one of the 8 services' actual upstream: Open-Meteo (weather-guard-forecast),
UK Carbon Intensity (carbon-now), RDAP (domains-check), arXiv/Crossref/Semantic Scholar
(research-search), OpenLibrary/Gutenberg (books-search), MBTA GTFS (transit-plan: a real
South-Station-to-Harvard Red Line itinerary), OSM Overpass (places-search: a real Starbucks
near Boston), and GDELT (news-wire-query: a genuine 200 and a genuine 429, the latter
confirming GDELT's documented ~1-req/5s throttle on this shared sandbox IP is real upstream
behavior, not an app bug). `npm run check:rules --paths <every touched file>` exits 0 on all
three commits; em-dash/en-dash grep clean on every new/changed line.

No owner-gated action in this order: every step is code, tests, docs, and a local build; no
other-crypto-project reference landed in the diff, so no batched owner ask was needed either.

Commits: `b239cb926` (weather-guard), `228dafe28` (carbon), `92cd17eb6` (domains), `506cf74c7`
(research), `0ecc3007c` (books), `48d05d9a7` (news-wire, transit, places), `ad01ea88a`
(openapi.json free-tier-discoverability fix), `e18987975` (docs + changelog), this closing
commit (PROGRESS log, order-file removal).

## 2026-10-14: order 517-integrate-18 closed (evolve)

Every buyer path (`api/_lib/x402-user-payer.js`'s hosted a2a-hire/pay_and_call flow,
`packages/x402-mcp`'s stdio server, `mcp-bridge`'s stdio client) registered only x402's
CAIP-2 wire format (`client.register('solana:*', new ExactSvmScheme(signer))`). Most of the
open x402 bazaar, and every service in the owner's own x402-suite, still speaks v1 (flat
network strings like `solana`, price field `maxAmountRequired`), so none of our buyers could
pay those sellers at all.

The installed `@x402/svm` package already ships `registerExactSvmScheme(client, { signer })`,
a one-call helper that registers v1's three flat network strings AND v2's `solana:*` wildcard
on the same client. All three buyer files were switched to it. Requirement-selection
preference for v2 over v1 needed no new code: `@x402/core`'s `x402HTTPClient
.getPaymentRequiredResponse()` already prefers the v2 `PAYMENT-REQUIRED` header over a
v1-shaped JSON body whenever a seller sends both; a test now locks that behavior in.
Settlement receipts were confirmed (by reading both the real `@x402/svm` v1 facilitator's
`settle()` and the owner's x402-domains seller's hand-rolled receipt shape) to already share
field names (`success`, `transaction`, `network`, `payer`) across both versions, so the
"normalize v1 receipts" task needed a test proving no normalization is required, not new code.

Judgment call: implementing task 2 surfaced two real spend-cap bugs that only trigger on a v1
payment, neither named in the order's 4 tasks but both block safe v1 support if left alone.
`api/_lib/x402-spending-cap.js`'s `enforceCap` only ever checked `requirement.amount`, so every
v1 payment (which carries `maxAmountRequired` instead) threw `spending-cap: requirement.amount
required` and was refused outright. `mcp-bridge/src/x402-axios-client.js`'s spend-cap hook also
only read `selectedRequirements?.amount`, defaulting to `'0'` for a v1 payment of any size,
silently bypassing both the per-call and session ceilings instead of refusing them. Both were
reproduced with a failing test first (`tests/x402-spending-cap-v1-amount.test.js`,
`mcp-bridge/tests/spending-cap-v1.test.mjs`), then fixed with a one-line fallback to
`maxAmountRequired`, then reverified green alongside every pre-existing test in both suites.

DoD verified: `packages/x402-mcp/test/x402-v1-buyer.test.mjs` feeds a captured v1 402 body
(fields mirrored from the owner's x402-domains `payments.ts`, `payTo`/`asset` replaced with the
$THREE mint and clearly-synthetic placeholders) into `x402Client.selectPaymentRequirements()`
and gets back a valid v1 requirement with no `payload`/`signature` present (no signing). A
second test proves v2 wins when a seller's response carries both the v2 header and a v1 body.
`node --test "test/**/*.test.mjs"` in `packages/x402-mcp` is 13/13 green (10 pre-existing + 3
new); `node --test "tests/**/*.test.mjs"` in `mcp-bridge` is 14/14 green. Docs updated in
`packages/x402-mcp/README.md`, `mcp-bridge/README.md`, and `docs/mcp-agent.md`.

A broader regression pass (`tests/a2a-hire-handler.test.js`, `tests/api/mcp-wallet-provision
.test.js`, `tests/api/mcp-agent.test.js`, `tests/x402-spending-cap-v1-amount.test.js`,
`tests/x402-circuit-breaker.test.js`) surfaced 4 failures in 2 files unrelated to this diff
(scope-enforcement tests in `mcp-wallet-provision.test.js` and a `tool_disabled` test in
`mcp-agent.test.js`). Confirmed pre-existing by stashing this diff's 3 production-file edits
out, rerunning: same 4 failures reproduced against the unmodified baseline. Restored the stash
and left those pre-existing failures for a separate order; not in scope here.

No owner-gated action in this order: `THREEWS_AGENT_PAY_ENABLED` was never touched, no live
payment was made, and no other-crypto-project reference landed in the diff (test fixtures use
the $THREE mint and clearly-synthetic `THREEsynthetic...` placeholders throughout), so no
batched owner ask was needed.

Commit: `0a7085020` (buyer wiring, spend-cap fixes, tests, docs, changelog), this closing
commit (PROGRESS log, order-file removal).

## 2026-10-15: order 518-integrate-19 closed (evolve)

Ported the owner's `x402-agent-wallet` ideas (approval threshold, merchant denylist, per-rail
daily caps, HMAC-signed verdicts) onto our own storage: `payment_sessions` gains
`approval_threshold_usdc`, `blocked_hosts text[]`, `per_rail_daily_usdc jsonb` (migration
`20261015100000_payment_session_policy_upgrades.sql`), and a new
`payment_session_rail_reservations` table backs the rolling 24h rail cap with the same eager
reserve-then-roll-back-on-failure pattern `spent_usdc` already uses, closing the race a naive
sum-of-past-executions check would leave open. `api/_lib/pay/policy.js` gained
`approvalVerdict`, `canonicalizePerRailDaily`/`NETWORK_TO_CAIP2`/`resolveRailDailyCapAtomics`,
`signVerdict`/`verifyVerdictSignature`/`computePolicyDigest`/`computeRequestHash`, and both
`spend-governor.js`'s `reserveSessionSpend` and `simulate.js`'s `replay` call through the one
`evaluateCall()` these live in, which is what makes the two structurally unable to disagree
rather than merely unlikely to. Every verdict (allow or reject) now carries a `policy_digest`
and an HMAC signature over `{verdict, digest, request hash, timestamp}`, stored on the
execution via `execute.js`'s four `recordExecution` call sites.

DoD verified:
- Governor/guard/parity tests: `npx vitest run tests/payment-session-governor.test.js
  tests/solana-trade-guards.test.js tests/payment-policy-simulator.test.js
  tests/advisory-lock-snapshot.test.js` is 162/162 green, including a new parity describe
  block that runs 6 scenarios (plain allow, blocked host, per-tx ceiling, approval threshold,
  rail daily cap, insufficient budget) through both `reserveSessionSpend` and `replay()` and
  asserts identical verdict codes.
- Signed verdicts: a new `'signed verdicts'` describe block in
  `tests/payment-session-governor.test.js` verifies an allowed verdict's signature against its
  stored digest with `verifyVerdictSignature`, and proves altering any signed field (verdict
  code, digest, request hash, or timestamp) breaks verification.
- UI: `pages/payments.html`'s create and edit modals gained Blocked hosts, Requires-approval
  threshold, and Per-rail daily cap fields (the create modal's behind a collapsed "Advanced
  spend policy" `<details>` so the common case stays uncluttered), with inline validation on
  both. Browser-verified headlessly with Playwright against `npx vite --port 3107`: the create
  payload, the edit modal's pre-fill from a session row, the edit PATCH payload, and both
  modals' positive-number validation on the new fields all came back correct with zero console
  errors.
- Docs (`docs/payment-sessions.md`: new body fields, new error codes `host_blocked` /
  `requires_approval` / `rail_daily_exceeded`, the signed-verdict note) and
  `data/changelog.json` updated, `npm run build:pages` run.

Never-blocked row: no `PAY_VERDICT_HMAC_KEY` existed in env before this order.
`api/_lib/env.js`'s `env.PAY_VERDICT_HMAC_KEY` getter falls back through
`PAYMENT_SESSION_SECRET` (and so through `WALLET_CAPABILITY_SECRET` /
`WALLET_ENCRYPTION_KEY` / `JWT_SECRET`), kept as its own env var rather than reusing
`PAYMENT_SESSION_SECRET` directly so rotating the token secret (which revokes every live
session) does not also invalidate the historical verdict record. A dev value is in
`.env.local` (gitignored). Owner action still needed: set `PAY_VERDICT_HMAC_KEY` on the live
Cloud Run service (`gcloud run services update three-ws-api --region us-central1
--update-env-vars PAY_VERDICT_HMAC_KEY=<value>`); until then production runs on the
`PAYMENT_SESSION_SECRET` fallback, which works but means a secret rotation there also rotates
the verdict-signing key. Not a stop-and-ask gate (the fallback keeps the feature fully
functional), so it is not batched into an owner message; noted here for whoever runs the next
Cloud Run env update.

No other owner-gated action: no push, no deploy, no on-chain write, and no reference to a
crypto project other than $THREE landed in the diff.

Commit: `655b5a491` (schema, policy, governor, execute.js wiring, simulate.js parity, UI,
tests, docs, changelog), this closing commit (PROGRESS log, order-file removal).

## 2026-10-15: order 519-integrate-20 closed (evolve)

Both venues that could already produce a `requires_approval` verdict (order 518's governor
rule on `payment_sessions.approval_threshold_usdc`, and `a2a-hire.js`'s own check against an
agent's `approval_threshold_usd`) just rejected the call outright; neither was wired to a
human. `api/pay/execute.js` and `api/agents/a2a-hire.js` now park the call on the existing
generic Approval Inbox (`api/_lib/approvals.js`) the moment it crosses the threshold, answer
202 with a poll link to `/approvals/<id>` instead of failing it, and resume the exact
reserve-then-settle or hire path the call would have taken inline the moment the owner
approves, with the same idempotency key re-polling instead of parking a second request. A
denied request answers 403 on the next poll, an expired one 410. No new UI: the approval page
already renders any venue generically from the request's `summary`/`amount`/`risk_notes`, so
the two new venues (`payment_session_execute`, `a2a_hire`) get the right card for free.

DoD verified:
- Handler tests: `npx vitest run tests/a2a-hire-handler.test.js tests/pay-execute-approval.test.js
  tests/agent-custody-guards.test.js` is 57/57 green, covering create, approve (both
  executed-with-result and approved-but-not-yet-executed), decline, expire, and double-use
  (idempotent re-poll of an already-completed or already-parked hire) for both venues.
- Browser verification: live-ran the full flow against the real local server
  (`server/index.mjs` on a spare port, real production DB) and a real Chromium session via
  Playwright, for the `a2a_hire` venue specifically (the `payment_session_execute` venue shares
  order 518's still-pending `20261015100000_payment_session_policy_upgrades.sql` migration,
  already tracked as owner row 65; applying it is out of scope for this session). The run
  registered a throwaway account, minted two real agent wallets, set an approval threshold,
  signed the real-funds agreements, hired above the threshold (real 202 + `pending_approval`),
  loaded `/approvals/<id>` in a real browser and confirmed the rendered card (summary, $0.05
  amount, Solana chain, threshold reason, working Approve/Deny buttons), denied it, confirmed
  the same idempotency key now re-polls to 403 `approval_denied`, and cleaned up every row it
  created. Screenshot and script were scratch (not committed, per repo-hygiene: no throwaway
  scripts land in `scripts/`).
- Docs (`docs/approvals.md`'s executor-registry sentence names both new sources) and
  `data/changelog.json` updated, `npm run build:pages` run.

Judgment calls: reused the existing generic `/approvals/<id>` page instead of building a new
page, since it already renders any venue from generic fields; verified the `a2a_hire` venue
live in a browser rather than `payment_session_execute`, for the migration-dependency reason
above (both venues' request/response/retry logic and generic-card rendering are otherwise
identical, and `payment_session_execute` is covered by its own 24 handler tests); inserted one
synthetic `agent_paid_services` row directly via SQL for the throwaway hire fixture, since
registering a real offer needs a publicly reachable `target_url` out of scope for a local
smoke run, and the row is never fetched before the approval gate.

No new owner-gated action: no push, no deploy, no on-chain write, and no reference to a crypto
project other than $THREE landed in the diff. The one owner action this order's code now also
depends on (applying `20261015100000_payment_session_policy_upgrades.sql` before
`payment_session_execute`'s approval path works in production) was already logged as owner row
65 by order 518's close-out; not duplicated here.

Commit: `9f40b6acc` (approvals wiring for both venues, handler tests, docs, changelog), this
closing commit (PROGRESS log, order-file removal).

## 2026-10-15: order 520-integrate-21 closed (evolve)

Built the SKILL-MD 1.0 generator the order asked for: `api/_lib/skill-md.js` reads the live
`/openapi.json` catalog (`buildOpenApiDoc()`) and the real `buildExactRequirements()` rail
logic and emits an agent-readable markdown catalog of every paid HTTP route (method, path,
price, parameters), the Solana and Base payment rails, and a sample 402 challenge, per the
upstream `x402-skill-md` format. Served at `/.well-known/skill.md` (`api/skill-md.js`, routed
in `vercel.json`), linked from the `/.well-known/x402.json` discovery doc (`service.skill_md`
field in `api/wk.js`) and from `llms.txt` (via a new `data/pages.json` machine-section entry).

Definition of Done, verified with real command output:
- `npx vitest run tests/skill-md.test.js`: 5 passed. The suite imports the real published
  `x402-skill-md@0.1.0` npm validator (added as a devDependency, installed for real, not
  `--package-lock-only`) and asserts zero validator errors other than SM005 (no EVM rail)
  while Base stays unconfigured in the test env, matching the order's exact tolerance.
- `curl -s http://localhost:3107/.well-known/skill.md -D -` (via `PORT=3107 node
  server/index.mjs`, since vite's dev proxy does not execute serverless handlers locally and
  port 3000 belongs to the owner's dev server): `HTTP/1.1 200 OK`, `content-type:
  text/markdown; charset=utf-8`, real generated body. `npm run check:pages`: 966/966 pages
  resolve.
- Docs updated both directions (`docs/x402-endpoints.md` new "Agent-readable catalog:
  skill.md" section, `docs/agent-skills.md` cross-reference note), `STRUCTURE.md` row added,
  `data/changelog.json` entry added and `npm run build:pages` run (propagated into
  `CHANGELOG.md`, `public/changelog*.json/.xml`, `public/llms*.txt`, `public/features.json`,
  `public/sitemap/index.html`).
- `npm run check:rules` clean on every touched file; `npm run check:skills-pack` clean.

Judgment call: the order's literal ask was to serve this at `/skill.md`, but that path is
already live and linked as the unrelated Agent Skills (agentskills.io) connector file
(`public/skill.md`, generated from `data/skill-md.template.md` by
`scripts/build-skills-pack.mjs`). Serving the new document at `/.well-known/skill.md` instead
avoids overwriting a different, actively-used file; both documents now link to each other so
neither is an orphan. Discovered mid-session that `public/skill.md` is itself a generated
artifact, not hand-authored; the one new line it needed went into the source template
(`data/skill-md.template.md`), then regenerated via `node scripts/build-skills-pack.mjs`
rather than hand-editing the generated file.

Noted, not fixed (pre-existing, unrelated, out of scope): `tests/api/x402-discovery-green.test.js`
fails on `/api/x402/transit-delays` (a bazaar.info schema mismatch on `route`). Confirmed via a
`git stash push -u` / `apply` A/B comparison that this failure exists on the tree with none of
this order's changes applied, so it predates and is independent of this work.

No owner-gated action: no push, no deploy, no on-chain write, and no reference to a crypto
project other than $THREE landed in the diff.

Commit: `b3e416177` (generator, handler, routing, test, docs, changelog), this closing commit
(PROGRESS log, order-file removal).

## 2026-10-15: order 521-integrate-22 closed (evolve)

Built the `tools.json`-driven registry the order asked for: 17 named tools, one per order
516's keyless x402 service (weather, carbon, domain RDAP check, research, books, news wire,
transit, places), each a fixed-endpoint, fixed-price wrapper so a model calls the right
endpoint with the right schema instead of composing a raw `pay_and_call(url)`. Added
`spending_report`, totaling every settled payment by merchant and day from a new local JSONL
ledger (`X402_MCP_LEDGER_PATH`). Mirrored all 17 on the hosted agent-wallet server
(`api/_mcpagent/named-services-tools.js`, wired into `api/_mcpagent/catalog.js`), reading the
same `tools.json` so hosted and stdio agree on names, prices and schemas; each hosted tool
gets a `<name>_quote` read tool plus the shared `mcp-policy` table gating payment on that
exact quote (one service's preview can never unlock a different service's payment).

Definition of Done, verified with real command output:
- `node --test` (packages/x402-mcp): 28 passed, 0 failed. Includes 6 new tests in
  `test/named-services.test.mjs` asserting a 1:1 registry-to-tool mapping, complete
  annotations and schemas, and `test/ledger.test.mjs` (8 tests) covering the ledger's
  env-path override, append/read round-trip, and merchant/day/since aggregation.
- Dry run: `named-services.test.mjs`'s "dry run: calling a named tool without confirm:true
  prices it and pays nothing" test asserts exactly one fetch call (the price probe, no
  payment) and the correct price for every one of the 17 tools.
- `packages/x402-mcp/README.md` (tools table, env var), `docs/mcp.md` (new "Named commerce
  tools" section listing all 17, hosted and stdio) and `data/changelog.json` updated;
  `npm run build:pages` run (propagated into `CHANGELOG.md`, `public/changelog*.json/.xml`,
  `public/features.json`).
- `npm run check:rules` clean on every touched file.

Judgment call: the registry's `domain_check` entry collided by name with a pre-existing,
unrelated, free, read-only `domain_check` tool already served on the main `/api/mcp` server
(Google Cloud Domains registration lookup, `api/_mcp/tools/domains.js`). Renamed this order's
paid RDAP-based service to `domain_rdap_check` / `domain_rdap_check_bulk` everywhere (registry,
hosted mirror, policy table, tests, docs) rather than touching the pre-existing tool; the two
capabilities are genuinely different (RDAP protocol lookup vs. Google Cloud Domains pricing)
and now coexist under distinct names.

While wiring the hosted mirror into the cross-cutting `tests/mcp-remote-annotations.test.js`
and `tests/api/mcp-agent-catalog.test.js`, found both the hosted server's `RESOURCE_DESCRIPTION`
(`api/_mcpagent/discovery.js`) and its system instructions (`api/_mcpagent/dispatch.js`) were
already missing papertrade, portfolio, sniper/alert, duel and agent-commerce tools from an
earlier, unrelated feature drop (`7461c3ed0`), which broke `mcp-agent-challenge.test.js` before
this change touched anything. Fixed alongside this order's own additions since both files
needed the same kind of edit either way; `mcp-agent-catalog.test.js`'s hardcoded tool list had
the same pre-existing gap (missing the event-market tools) and is fixed too.

Noted, not fixed (pre-existing, unrelated, out of scope):
- `npm run build:mcp-catalog` fails with `TypeError: studio.resourcesForSurface is not a
  function` (`api/_lib/mcp-census.js:118`), from the same unrelated commit `7461c3ed0`. This
  means `public/mcp-catalog.json` and the `<!-- mcp-count -->` markers for the hosted servers
  cannot be regenerated by the normal pipeline right now; the one marker this order's own diff
  touched (`packages/x402-mcp/examples/README.md`, stdio-only, unaffected by the census) was
  updated by hand with the real count (22, confirmed by running `node examples/list-tools.mjs`).
- `tests/mcp-spend-gate.test.js` fails at import time (`presetScopes is not a function` from
  `api/_lib/api-keys.js`), and `tests/mcp-use-cases-doc.test.js` fails on unrelated `launch-token`,
  `perps` and `predictions` use-case mismatches. Neither file is touched by this diff and neither
  failure mentions any of this order's tool names; both predate this session (same unrelated
  commit history).

No owner-gated action: no push, no deploy, no on-chain write, and no reference to a crypto
project other than $THREE landed in the diff.

Commits: `06650c721` (stdio package: registry, named tools, spending_report, ledger),
`9d88c7f9d` (hosted mirror, policy table, discovery/instructions fixes), `16b544a33` (docs,
changelog), this closing commit (PROGRESS log, order-file removal).

## 2026-10-15: order 523-integrate-24 closed (evolve)

Every settled a2a-hire (`api/agents/a2a-hire.js`) now writes one signed fulfillment
attestation row via the new `api/_lib/trust/hire-attestations.js` (`{hire_id,
payment_signature, outcome: delivered|failed|disputed, evidence_hash, signed_by}`), signed
off-chain with the platform attestation key `api/_lib/attest-event.js` already uses for
on-chain provenance memos; a `node:crypto`/`tweetnacl` import stayed out of
`api/_lib/a2a-hire-phases.js` (shared with client code `src/agent-screen-hire.js`,
`src/shared/forge-frames.js`), so only its pure outcome-classification and canonical-JSON
helpers (`isAmbiguousPaymentError`, `classifyHireOutcome`, `sortedStringify`,
`buildHireAttestationPayload`) live there; the real hashing and signing is server-only.
A client-side payment timeout is recorded `disputed`, never inferred `delivered`, since
x402 verify-then-settle means the provider may already have been paid server-side.
New migration `20261015120000_hire_fulfillment_attestations.sql` (table
`hire_attestations`, unique on `hire_id`; `agent_paid_services.reputation_discount_enabled`
column) applied with `node scripts/apply-migrations.mjs --apply --file <name>` so it did not
sweep the 11 other already-pending migrations from concurrent work in this worktree.

The recency-weighted fulfillment rate (`weightedFulfillmentRate`/`computeFulfillmentRate`,
30-day half-life, minimum 5 attestations before it counts) is now an additive input to the
free Financial reputation score's Settlement reliability pillar
(`src/shared/agent-financial-reputation.js`, `REPUTATION_VERSION` bumped 3 to 4 so cached
scores recompute), read in `api/_lib/trust/wallet-reputation.js`. Verified end to end: the
pillar's `detail` string (e.g. `"90% hire fulfillment over 12 hires."`) and `facts.hire_
fulfillment_rate`/`facts.hire_fulfillment_sample_size` flow unmodified from `computeReputation`
through `GET /api/agents/:id/reputation` to the generic `pillarRow()` renderer in
`src/shared/agent-reputation.js` (mounted on the agent page's Trust tab via
`src/agent-wallet-hub/tabs/reputation.js`), confirmed by a direct `computeReputation()` call
producing that exact detail string, no UI code changed.

Task 3: `api/_lib/trust/hire-discount.js` adds an off-by-default
`agent_paid_services.reputation_discount_enabled` flag; when set, `a2a-hire.js` mints a
5-minute, slug-scoped, ed25519-signed discount voucher from the hirer's live reputation tier
(`getEffectiveReputation`), and the public paywall (`api/x402/service.js`) only ever trusts
that platform signature, never a caller-supplied claim, failing closed to full price on
anything missing, expired, mis-scoped, or forged.

Definition of done, verified:
- `tests/a2a-hire-phases.test.js` gained an 11-case `describe('fulfillment attestation (pure
  core)', ...)` block (32/32 tests pass in the file).
- New `tests/hire-attestations.test.js`: `describe('verifyHireAttestation', ...)` (5 tests)
  signs with a locally-generated ed25519 keypair injected via `ATTEST_AGENT_SECRET_KEY` and
  verifies `verifyHireAttestation` accepts a correctly-signed payload and rejects a tampered
  payload, a forged signature, a signer mismatch, and malformed input; `describe
  ('weightedFulfillmentRate', ...)` (4 tests) covers the empty case, an all-delivered sample,
  `disputed` never counting as delivered, and recency decay (9/9 tests pass in the file).
- `tests/wallet-reputation.test.js` gained a `describe('hire fulfillment rate', ...)` block
  (4 tests: below-minimum contributes 0 points with `facts.hire_fulfillment_rate: null`,
  at-minimum scores it, a poor rate scores lower than a strong one at the same sample size,
  combined with the `ESTABLISHED` fixture it never exceeds the pillar max) plus the
  `REPUTATION_VERSION` pin updated 3 to 4 (27/27 tests pass in the file).
- Agent page: traced above, confirmed with a direct `computeReputation()` call.
- Docs and changelog: new "Signed fulfillment attestations" section in
  `docs/agent-abilities/chapters/06-identity-reputation.md`, a `data/changelog.json` entry,
  `docs/ALL.md` regenerated via `node scripts/combine-docs.mjs`, `npm run build:pages` run.

Pre-existing, unrelated, out of scope (confirmed by reverting this diff's one line in
`api/_lib/x402-user-payer.js` and re-running): `tests/api/mcp-agent.test.js` and
`tests/api/mcp-wallet-provision.test.js` each fail 2 tests (`pay_and_call` tool listing/
scope-enforcement) identically with or without this diff; both failures trace to commit
`9d88c7f9d`, already logged above in the 2026-10-14 entry for order 500-integrate-01's
neighbor work. `npm run check:docs-freshness` was already over budget by 130 across 15
unrelated docs (none the one this order edited) before this diff; not touched.

No owner-gated action: no push, no deploy, no on-chain write (the attestation and discount
voucher are both off-chain ed25519 signatures over a platform-controlled key, never a Solana
transaction), and no reference to a crypto project other than $THREE landed in the diff.

Commits: `2f8110a92` (attestation infra, reputation blending, discount pricing, tests),
`613dcd785` (docs, changelog), this closing commit (PROGRESS log, order-file removal).
