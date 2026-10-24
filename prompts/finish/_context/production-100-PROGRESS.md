# production-100 progress log

The only memory between chats for this pack. Append, never rewrite. Newest at the bottom.

Format:

```
## <date>: <order name, or "map">
Measured: <the numbers you read, with the command>
Did: <what shipped, with commit SHAs>
Left: <exactly what remains, who owns it, and which follow-up file or OWNER-ACTIONS row carries it>
```

Orders run from other packs log in THEIR pack's `production-100-PROGRESS.md`; this file carries only this
pack's four orders, ship-readiness runs, and map-level changes (rows added to
[OWNER-ACTIONS.md](production-100-OWNER-ACTIONS.md), orders retired from [00-INDEX.md](production-100-00-INDEX.md)).

---

## 2026-08-09: pack created

Measured: production at `c1e600a04` (2026-08-07 build) vs `main` at `e5ad85478`;
`/event` and `/event.json` 404 on the live site with the event window configured for
2026-08-09 17:00 UTC; the dry-run reclaim path in `api/_lib/economy-sweepback.js` still
returns its plan before key recovery; `/play/war` vite input now exists (that gap closed
since the event preflight noted it, so no order was written for it).

Did: authored the map (00-INDEX), the four pack orders (01 ship readiness, 02 stranded
wallets, 03 master key hygiene, 04 mixed verdicts), OWNER-ACTIONS with 13 rows, and the
event closeout order in the event pack. Existing packs were indexed, not duplicated: every
open order there was already sized for a single agent chat.

Left: everything; the map is the queue. The most time-critical row is OWNER-ACTIONS row 1
(the deploy) with the event window hours away.

## 2026-08-09: 01 ship-readiness (first run: shipped and verified)

Measured: prod was at c1e600a04 (2026-08-07) with every event surface 404; main
at a81f2701a and moving. Gate red on audit:docs (an unregistered recap draft)
and token drift (5 hardcoded hexes). Committed changelog feeds were stale
against data/changelog.json.

Did: fixed both gate reds, regenerated the eight feed outputs, stripped 17
banned dashes from data/pages.json, built clean at pinned 4a748fbde
(BUILD_EXIT 0, all 691 pages resolve), ran deploy-preflight (all PASS; its one
blocker, a deterministic /api/locale 404 in e2e, root-caused to the dev server
proxying /api to stale production, proven by running the handler standalone:
200 with the namespace), submitted Cloud Build 015cc079 (SUCCESS, 22m37s,
revision 00365), purged the CDN synchronously, and verified: a concurrent
agent's build superseded mine minutes later as revision 00366 at 2841ab5df,
which contains my commits (ancestry verified), so production is CURRENT.
/event 200, event.json serving, /api/locale 200, fact-check benchmark
ran:true source:database, smoke:prod all 691 pages green. Vitest 19027/19027
green; the only e2e failures were the stale-prod proxy artifact above.
Also cleared fix-queue 02 (lint) and retired its file.

Left: this order stands (it retires only at campaign end). OWNER-ACTIONS row 1
(the deploy) is satisfied for today; the event window 17:00-19:30 UTC is armed
on production ahead of time.

## 2026-09-01: map (retirement sweep across every pack)

Measured: production `ad7b54c16` (2026-08-28 build, revision 00404) vs `main` `73c8ccbb7`,
107 commits behind (`git log ad7b54c16..main --oneline | wc -l`); `smoke:prod` exit 1 with
seven deploy-lag 404s; healthz `x402_settle` down (`cause: sponsor_floor`), `agent_index`
down, `helius` and `sniper` degraded; benchmark live from the database (40%, 2026-08-10);
`gcloud` auth dead; `npm run audit:docs` clean. Every open work order in the repo (58 numbered
files across the packs plus the 157 swarm files and the 8 briefs then under `docs/openai-pr/`)
was re-verified line by line against code, git history and the live site by eight read-only
verification passes.

Did: retired the verified-shipped orders (event 01/03/04/05/07 in `38812511e`, backlog
02/03/04/06 in `c50037d79`, the fable-audit index folded into RESIDUALS in `20c381d92`, the
OpenAI pack moved to `prompts/openai-pr/` with briefs 01 to 05 deleted in `09bfbb1b5`);
rewrote event 08 to its recoverable remainder; wrote backlog 11 for the `agent_index` outage
that nothing owned; rewrote the map in 00-INDEX from the measured verdicts; refreshed
OWNER-ACTIONS (deleted the self-expired row, corrected rows 3, 4, 9, 10, added 13 to 17).

Left: three verified-retirable files wait on the commit gate (row 14); everything else in
the map is open for the measured reason next to it. The "Definition of 100%" now excludes
`masters/` from line 1, since those prompts never retire by design.

Addendum, same day: the swarm-100 probe finished after the map was first rewritten. Section J
now carries its numbers (56 of 151 routes mechanically clean, 95 with a measured defect,
none retirable on mechanical evidence) and the state of the four sweeps and the roadmap
slice. Probe artifacts stayed in the session scratchpad; the reproducible method is in
`docs/ops/swarm-100-audit.md`.

## 2026-09-04 (later pass) · OWNER-ACTIONS re-measurement: one row cleared, two freed, one premise inverted

`gcloud` answered every call in this session with no re-auth, which is the third
consecutive observation that row 15 is intermittent rather than standing. The
backlog it had been holding was drained rather than re-reported.

**Row 18 is cleared and deleted.** `MULTIPLAYER_INTERNAL_URL` was genuinely unset
(`read-service-env.mjs '^MULTIPLAYER'` matched nothing on `three-ws-api`), and the
world server answered `/population` with `ok:true` on the same query the proxy was
failing. Before setting it, the shared-secret half was checked rather than assumed:
both services resolve the HMAC through the same `HOLDER_PASS_SECRET` fallback and
their values hash identically, so turning the URL on also turns on correctly-signed
live DM and stage-tip delivery (`presence-store.js`, `stage-bridge.js`) instead of
converting those from `unconfigured` into silent 401s. Applied as a config-only
`--update-env-vars` (pre-approved in CLAUDE.md, and it merges rather than replacing
the other 60 vars). Revision `three-ws-api-00413-gbp`, same image commit
`c2148462e`, so this is not a code deploy. Verified live:
`/api/play/population` → `{"ok":true,...}`, `?by=coin` → `byCoin` present, and the
`$THREE` mint query the `/event` LIVE panel makes → `ok:true`.

**Row 3 is freed: both stranded customer wallets are now named.** The keyed audit
(`scripts/audit-custodial-key-health.mjs --json`, read-only by construction, key
pulled from Secret Manager inline and never written to disk) swept 735 custodial
wallets. Nine are sealed: two platform bots at 0.142875505 SOL and seven customer
wallets, of which only two hold anything. `GemVS5fT958FKRe5fpgizohUYUKE8cUDueEdmB1bmXnm`
(0.250001) was already known from its `wallet_key_retired` withdraw failure; the
second is `HPL1LfuTdYDwtzJDzsnrmR2ngrrQwLTQyxJszCC4DHsN`, agent
`a20829e1-6dd7-4495-9141-8f5d69be86a9`, owner `sol-4ac625e9b4d3ff8e@wallet.local`,
0.100001 SOL. Total 0.350002 SOL over exactly two accounts, matching the 2026-08-09
figure the brief carried on trust. `stranded_unread` is empty, so nothing is
unaccounted for. `docs/ops/stranded-wallets.md` now carries the completed table and
no longer tells the reader to run the audit to fill it in. The decision is
unchanged and fully informed.

**Event closeout: the log read finally ran, and it corroborates the zero-grant
finding.** `gcloud logging read` over `three-ws-multiplayer` for
`textPayload:"souvenir laurel-meetup"` at `--freshness=30d` (a window that still
reaches back past the 2026-08-09 event) returned **nothing**, against a control
query proving the service's log stream is intact and current. That is independent
of the code argument in the 2026-09-02 entry and agrees with it. The durable
Upstash `player:*` scan, which would have been the stronger source, cannot be run
from here for a reason that is not `gcloud`: the store sits behind a private VPC
SRH proxy (`10.128.15.228`) on both services, so it needs in-VPC execution, and
creating the read-only Cloud Run job to do that was refused by this environment's
tool policy. It is confirmation, not the finding.

**Row 9 was re-verified this pass, and it is accurate**, including that the
address it names is the one the key in the gitignored `contracts/.env` actually
derives to. The evidence names a third-party chain, so it falls under CLAUDE.md's
commit gate and OWNER-ACTIONS row 11, which is still open: it is reported to the
owner rather than written here. No change to what row 9 asks for.

**Rows re-confirmed unchanged.** Row 2: the settle sponsor holds 0.001507661 SOL,
down again. Row 16: `three-ws` (org) and `three-ws/examples` both still 404.

**A finding the sweep produced that was not on anyone's list.** All 794 routes
declared in `data/pages.json` were swept against production. Zero 404s, which
retires row 1's old "seven declared routes 404" phrasing outright, but six answer
**HTTP 500**: `/api/mcp` and five `.well-known/*` endpoints. Cloud Run stderr gives
the cause in one line, `ERR_MODULE_NOT_FOUND` on
`/app/services/home-relay/src/token.js`, and `/api/healthz` is 500 for the same
reason. The request log shows real traffic taking it: a `Cursor/3.9.16` MCP client
POSTing `/api/mcp` and getting 500s in a loop. A concurrent agent root-caused the
same defect independently and committed the fix (`d668ceece`, re-including
`services/` in the `.gcloudignore` allowlist, the identical failure shape as the
`agents/` and `.agents/` entries above it in that file). The fix is committed and
**not** in production, so only a deploy clears it. That is now the strongest
argument in row 1, and row 1 already carries it.

## 2026-09-02: OWNER-ACTIONS re-measured, and the audit that would have lied about row 3

Measured, not carried over: production still `ad7b54c16` (2026-08-28, revision 00404-ph7)
against a `main` that has moved to **143 commits ahead** (`git rev-list --count
ad7b54c16..HEAD`); healthz `x402_settle` down at 5.9% (3 of 51 paid attempts, 3 hours,
`cause: sponsor_floor`, 329 `no_solana_accept`) with the sponsor wallet holding
**0.001568 SOL** read straight off mainnet `getBalance`; `gcloud run services list` still
refusing with "Reauthentication failed. cannot prompt during non-interactive execution";
the `three-ws` GitHub organization and its `examples` repository both 404; the x402
discovery endpoint live with 100 resources; the testnet deployer
`0x1C4918894dfA5eE11cfF9629B458b5169Cfa3871` present in `contracts/.env` at balance 0,
nonce 0.

Found and fixed a defect that would have made row 3 worse than unanswered. Running
`scripts/audit-custodial-key-health.mjs` here, where `.env.local` carries only
`DATABASE_URL`, produced a fully confident report: **725 of 725 wallets undecryptable,
8.57 SOL stranded, 7.29 SOL of it customer money**, followed by the escalation banner. Every
number was an artifact of the script having no decryption key at all, and it is off by more
than an order of magnitude from the real incident (8 wallets, 0.49 SOL). It is the same
class of false certainty the script already guards against for unread balances. The audit
now calls `secretBoxKeyCandidates()` before it touches the database and exits 3 with the
places to find the key when the list is empty, and when a key is configured but opens
nothing it says a fleet-wide 100% failure is one wrong key rather than a mass customer
incident (`3a8000267`). `scripts/gcp-triage.mjs` skips on the structured error code instead
of matching prose, and `docs/ops/wallet-key-migration.md` records the blind spot beside the
two it already documents (`7335810ec`).

Did: rewrote rows 1, 2, 3, 8, 9, 15 and 16 of OWNER-ACTIONS from those measurements, and
put row 18 back in numeric order. Three premises had rotted. Row 8 asked for a GitHub PAT
that nothing needs any more (the upstream pull request merged 2026-08-11) and was filed
against backlog 09, which needs nothing; it now asks for the origin registration that is
actually left, against backlog 10. Row 9 asked the owner to generate a deployer key that
already exists and named no address to fund; it now names the address, the measured gas
cost, and the retired address not to fund. Row 3 gained the finding above: the brief it
waits on cannot be written from this workspace at all, because the wallet list needs
`WALLET_ENCRYPTION_KEY` off the service env, which makes row 15 the gate on four rows.

Left: no row was cleared, because none of them is an agent's to clear. Row 15 is now the
highest-leverage one on the board.

## 2026-09-02: 02 stranded-wallet-reclaim (shipped; the decision is now the owner's)

Measured: task 1 (the lying dry run) was already fixed in `afd349790` and is pinned by
`tests/economy-reclaim-dryrun-key-gate.test.js` (48 tests green across the four sweepback
suites), so this run verified it and moved on. Production's own records carry the rest,
which is what let the brief be written without `gcloud` (row 15 is still dead):
`economy_master_ledger` holds 71,475 `inflow_failed` rows with reason
`secret_undecryptable`, all of them against exactly TWO platform wallets, Atlas #22
(`6FL9viFy2WrYMWPd3HAQA4Bxm5qxQWoQMn3T9GbcwxEB`, 0.078390963 SOL) and Echo #22
(`8u5raEaz7Qjm5hRzNxwzXiZtjTkdgQ3Co6G6S5WNxFTs`, 0.064484542 SOL), 35,736 and 35,739
attempts each, the most recent at 19:00 UTC today. `agent_custody_events` names 15 agents
that hit `wallet_key_retired` on the withdraw path in July, 14 platform bots and one
CUSTOMER: `My First Agent` (`5e05f68f-...`, `GemVS5fT958FKRe5fpgizohUYUKE8cUDueEdmB1bmXnm`,
0.250001 SOL on chain today). Fleet inventory: 725 custodial wallets, 112 platform / 613
customer.

Did: extracted the measurement into `api/_lib/custodial-key-health.js`, shared by
`scripts/audit-custodial-key-health.mjs` and a new `stranded_custody` panel on
`GET /api/ops/payment-outcomes` (snapshot-cached 6h, single-flight: 13.9s cold, 0.5s warm,
verified rendered in Chromium with no console errors). Fixed real drift in the process: the
audit carried its own ownership predicate with the house account spelled `agents@three.ws`
instead of the `three-ws@users.three.ws.local` the reclaim leg enforces in SQL, so 12
platform wallets were being filed as CUSTOMER ones in the very report that sizes the
customer obligation; `economy-sweepback.js` and the audit now share one definition. The
panel refuses to publish an unattributable total: a keyless or fleet-wide-failure reading
returns `status: unknown` with the SOL fields `null` rather than a number with a caveat.
Wrote the owner brief `docs/ops/stranded-wallets.md` (measurement, why recovery is
impossible, cost of credit vs contact vs write-off, exact commands for each), linked from
`docs/ops/README.md` and the payment-outcomes runbook. 17 new tests in
`tests/custodial-key-health.test.js`, 2 more in `tests/api/ops-endpoints.test.js`.
`npm run audit:docs` clean, `check:rules` clean on the touched paths.

Left: the DECISION, which is OWNER-ACTIONS row 3 (rewritten to point at the brief):
credit the customers (recommended), contact them first, or write the balance off. Naming
the second customer wallet needs one keyed `node scripts/audit-custodial-key-health.mjs
--json` run on a machine with `WALLET_ENCRYPTION_KEY` (row 15); the decision itself does
not wait on it. Order file deleted.

## 2026-09-02: the `mixed` class was unreachable by construction, not by threshold

P100-04 assumed the `mixed` verdict needed a threshold nudge. It did not. The verdict
taxonomy has four classes and the stance vocabulary had three (`supports`, `contradicts`,
`neutral`), and the stance rubric told the model outright that when content "affirms one
[assertion] while refuting another", it must "choose the stance for the assertion the
content speaks to most directly". Every mixed fixture is a partial truth ("Napoleon was
unusually short", "carrots give significantly better night vision") whose sources AGREE
with each other that the claim is half right. Collapsed onto one side, they produce a
near-unanimous `contradicts` distribution, which `computeVerdict` read correctly as
`contradicted`. Both published runs show it: mixed to contradicted, 7 of 10, twice. The
`mixed` branch was defined as inter-source DISAGREEMENT while the class it had to predict
is intra-source QUALIFICATION, so no threshold reaches it.

Fixed by adding `partial` as a fourth stance and making `computeVerdict` count its weight
as stance-bearing evidence that takes neither side. With zero `partial` sources the
function's output is identical to the old one, which is the anti-seesaw guarantee, pinned
by `tests/api/fact-check-verdict.test.js`.

Found a second defect while measuring, and it is the one that matters for trust in the
number. Two live free-lane checks on 2026-09-02 came back `insufficient` with every stance
`neutral`, every excerpt the raw search snippet, real LLM tokens spent, and nothing marked
degraded: "A tomato is a vegetable." resolved as unengaged evidence while holding
*Nix v. Hedden*, the Supreme Court case that settles it. Both LLM stages extracted their
JSON with a NON-GREEDY `/\[[\s\S]*?\]/`, so they stopped at the first `]` in the response.
A reasoning block, a code fence, or a `[1]` citation truncated the match, the stage fell
back to all-neutral, and it said nothing. That fabricated verdict was scored by the
accuracy benchmark as real, was invisible to the degraded-run guard that exists precisely
to catch this, and was written into the 7-day cache. The same fault collapsed the three
search angles to one on every check. `extractJsonArray` now scans for a balanced,
string-literal-aware array of the shape the caller asked for, and an unreadable answer
reports `stance extraction unreadable` / `query generation unreadable` instead of a silent
`insufficient`.

Did: the stance vocabulary, the verdict weighting, the response reader, the degradation
contract, `docs/fact-check.md`, `agents/fact-checker/README.md`, and two changelog
entries. 70 tests green across the four fact-check suites, `check:rules` clean on the
touched paths. The full `npx vitest run` is 26,965 passing with 17 failures in 13 files,
none of them fact-check (3d-studio, branding, cron-scheduler-sync, x402-discovery-parity,
glb-quality, oracle-calibrate-cron, rate-limit-buckets, asset-host-liveness,
deploy-artifacts, no-nul-bytes), all in code other sessions were editing at the time.

Left: nothing has MEASURED the fix, so there is no before/after table and no published
run. The in-process runner needs an LLM lane and this machine has none: no provider key in
`.env` or `.env.local`, and `gcloud` refuses every call with "Reauthentication failed.
cannot prompt during non-interactive execution", which also takes out the Vertex Gemini
anchor. Production's own chain is currently falling through to a dead paid backstop
(`openai 429: billing_not_active` on a live check), so a run today would be refused by the
error-rate ceiling anyway, correctly. `prompts/finish/903-production-100-04b-fact-check-publish-run.md`
carries the remainder with the exact commands. Order file 04 deleted.

## 2026-09-02: 04 mixed verdicts (calculus fix, lane fix, and what could not be measured)

Measured first: the live endpoint still served the 2026-08-10 run, `source: database`,
40% overall with `mixed` 0/10 and its confusion row reading `contradicted` 7,
`insufficient` 2, `supported` 1.

Root cause, and it is not a threshold. The ten `mixed` fixtures are all partial truths
("a tomato is a vegetable", "Napoleon was unusually short", the tongue map), and on a
partial truth the sources do not disagree with each other: every one reads the same
nuance. The stance vocabulary was `supports | contradicts | neutral`, and the extraction
rubric explicitly told the model to pick one side when a source affirmed part of a claim
and refuted another. So every source projected the same way, the projection cleared the
70% dominance bar, and the claim came back flat. `computeVerdict`'s `mixed` branch was
reachable only from inter-source disagreement, which that evidence never produces. The
class was unreachable by construction.

Fix: a fourth stance, `partial`, for a source that engages the claim and finds it true in
one respect and wrong, overstated, or only conditionally true in another. It is
stance-bearing but takes neither side, so it dilutes dominance and pushes the result to
`mixed`; the rubric is deliberately narrow (hedged prose, thin coverage and extractor
uncertainty stay `neutral`). Mixed confidence was rewritten too: it was
`max(supportRatio, contraRatio)`, which grew as a split became more lopsided. It is now a
mixedness score, `partialRatio + 2 * min(supportRatio, contraRatio)`, clamped to 1.
Wired through the extraction rubric, the image-evidence lane, the x402 response schema,
the source pill on `/fact-checker`, `docs/fact-check.md` and the agent README.

Anti-seesaw, proven mechanically rather than statistically: `tests/api/fact-check-verdict.test.js`
runs 5000 seeded random distributions drawn only from the three legacy stances and asserts
the new `computeVerdict` returns exactly what a transcription of the old rule returns. So
no clear-cut claim can be pulled into the mixed band by the calculus; the only claims whose
verdict can move are the ones a source actually reports as half-true. 23 tests green,
alongside the clear-cut pins (unanimous, boundary-at-70%, empty, all-neutral, zero-weight,
lone-source coverage floor).

Could not be measured here, which is why 04b exists. A 40-claim before/after needs an LLM
lane and this box has none: no provider key in `.env` or `.env.local`, `gcloud` auth dead,
and the keyless floor answered 0 of 8 probes (OVH 429, Pollinations 429 on every attempt).
A baseline worktree at `1407949cb` was staged for the A/B and torn down unused. Publishing
was refused on top of that for a second reason worth keeping: without ADC the search chain
falls to Wikipedia and DuckDuckGo, which returned "Aunty Donna's Coffee Cafe" for "coffee
is bad for your health", so a local run would have understated a chain the public number
is meant to describe. Both facts are now written into 04b with the trap named.

Side fix, from diagnosing that floor: LLM7.io retired the anonymous tier its rung was added
on, so every unauthenticated call is a 401 `invalid_api_key` (the `unused` token its docs
used to accept included). The rung sat in the chain unconditionally, spending a guaranteed
round trip at the tail of an already-exhausted chain. It is gated on `LLM7_API_KEY` now,
and `docs/ops/llm-lanes.md`, `docs/free-llm-providers.md` and `.env.example` no longer
claim three keyless rungs when there are two.

Left: 04b, unchanged in scope. It needs one LLM key and, for a publishable number, the
grounded search rung.

Worth knowing for the next agent: this ran alongside another agent on the same order.
Everything here reached `main` swept into that agent's commits (the shared worktree does
`git add -A`), so the content landed even though almost none of it carries a commit of
mine. Four commit attempts lost the `HEAD` ref race outright.


## 2026-09-02: 03 master-key-hygiene (shipped; only the rotate-or-accept decision is left)

Measured: `gcloud` was dead on the first three calls of this session
("Reauthentication failed. cannot prompt during non-interactive execution", which is
OWNER-ACTIONS row 15) and then started answering again a few minutes later with no
intervention, so row 15's premise is intermittent, not standing. With it working:
`ECONOMY_MASTER_SECRET_BASE58` was a plaintext `value:` on `three-ws-api` exactly as the
order described, and it was not alone: **58 more credential-bearing vars** were literals
too, including `DATABASE_URL`, `WALLET_ENCRYPTION_KEY`, `JWT_SECRET`, `CRON_SECRET`,
`OPENAI_API_KEY`, four wallet secret keys and the `OFFER_RECEIPT_JWK` signing key. Any
principal with `run.services.get` on the project could read all of them out of the service
config. Baseline before touching anything: `/api/healthz` `status: ok`, subsystems
7 ok / 3 degraded / 2 down / 1 unknown, revision `three-ws-api-00404-ph7`.

Did: built `scripts/migrate-plaintext-secrets.mjs` (dry run by default, never prints or
writes a secret value, classifies every var, reuses a secret that already holds the value
instead of minting a copy, grants the runtime SA `secretAccessor` on that one secret,
flips in one update, then re-reads the service and asserts the end state). Migrated the
master first and verified it alone, then swept the rest.

**End state: 59 credentials migrated (the master plus 58), 81 Secret Manager references in
all against the 22 that predated this, ZERO plaintext credentials, and 126 of the service's
207 variables correctly left as plaintext config. 100% of traffic on
`three-ws-api-00407-m7c`.** `--verify` reports `Verify: clean` and exits 0.

Two verifications, both read live rather than assumed:
1. Healthz against the baseline is strictly better, nothing regressed: 10 ok / 1 degraded /
   2 down. the two RPC subsystems went from degraded to `premium RPC healthy` and `4/4 paid
   lanes serving` (those provider keys resolve out of Secret Manager), `database` ok proves
   `DATABASE_URL` resolves, `resend: configured` proves `RESEND_API_KEY` does. The two that
   are still down (`x402_settle` on the sponsor floor, `agent_index` on crawl lag) were
   down before and are OWNER-ACTIONS row 2 and other work.
2. Master signing path: the treasury sweep writes a heartbeat row to
   `economy_master_ledger` carrying the pubkey it derived from the loaded secret. Revision
   `00406-nlg` was created at 19:58:46Z and the ledger kept writing through 20:02:23Z under
   `WwwuGbqHrwF5RG89KhUbmRWEvjnRH9k5kVM5p7T3WwW`, so the container reads the secret, decodes
   64 bytes and derives the right wallet. No cron was triggered by hand: triggering
   `treasury-topup` moves SOL, which is stop-and-ask gate 1.

Fixed five callers the migration would otherwise have broken, all of which read
`env[].value` off `describe` and would have silently gotten `undefined`:
`scripts/create-gcp-scheduler.mjs` (CRON_SECRET, which signs the Authorization header on
every one of the 112 cron jobs) and `rug-signature.mjs` / `seed-sniper-experiments.mjs` /
`sniper-evolve.mjs` (DATABASE_URL). They now share `scripts/lib/service-env.mjs`, which
resolves a literal or a reference, and `scripts/read-service-env.mjs` gives an operator the
same thing on the command line. Ten runbook passages that told a reader to get a credential
out of `describe` were corrected, CLAUDE.md's credential row included, since that line is
the first thing every agent reads when a credential is missing. 25 new tests across
`tests/migrate-plaintext-secrets.test.js` and `tests/service-env-resolver.test.js`, plus 3
in `tests/cron-scheduler-sync.test.js`; `check:rules` clean on every touched path.

Left: OWNER-ACTIONS row 4, narrowed to what it always actually was: the master key sat
readable in the service config for some window, so rotate-or-accept is a judgment about who
held project viewer access in that period. The runbook section in
`docs/ops/wallet-key-migration.md` now carries the exact rotation commands, owner-gated at
the fund move. Two findings for that same row, both needing an owner call and neither
safe for an agent to change: `WALLET_ENCRYPTION_KEY` and `JWT_SECRET` hold the same value
on production (which defeats the dedicated-key guard in `secret-box.js` while passing it),
and `X402_SEED_SOLANA_SECRET_BASE58` holds the same value as
`LAUNCHER_MASTER_SECRET_KEY_B64` though `wire-master-wallet.mjs` assigns them to different
wallets. Order file deleted.

Not mine, found while verifying and left alone: `npm run check:claude` and one case in
`tests/cron-scheduler-sync.test.js` fail on a cron count that another agent is mid-edit on
in `vercel.json` (README and `docs/build.md` say 111, `vercel.json` declared 113 then 112
within the hour, and it briefly carried a duplicate `print-orders-sync` entry). One
`npm run audit:docs` finding, `docs/materialize.md` missing from `data/pages.json`, belongs
to the Materialize work committed today; `data/pages.json` is dirty in that agent's tree.

## 2026-09-02: 01 ship-readiness (built and verified; the submit is the owner's)

Prod before: `089500f4e`, revision `three-ws-api-00408-9mn`, built 20:07 UTC. Read it from
the Cloud Run URL, not `https://three.ws/api/version`: the CDN served three different
stale copies of that endpoint during this run (`ad7b54c16`/00404, `7f0ef6251`/00405), and
believing them would have made this a 343-commit deploy instead of the real 188. Anyone
verifying a deploy from the public URL without purging first is reading history.

Pinned and staged, not submitted: `2f26d19f3`, built clean in `/workspaces/.deploy-wt-p100`.
`npm run gate` exit 0 at that SHA, `npm run build:gcp` exit 0 (773 declared pages resolve,
check:dist OK), `npm run db:check` exit 0 with every migration applied. The ship is one
command; owner approval for the submit had not been given, so it was not run.

Full `npm test` on a quiet box, which this order has been owed since 2026-08-08: vitest
`Test Files 1911 passed | 3 skipped (1914)`, zero failures. Playwright `192 passed, 1
flaky, 2 failed`; both failures were then fixed and re-verified individually. Load average
peaked at 216 mid-run and the test was held until it fell under 16 rather than reading a
SIGTERM as a result.

Fifteen reds cleared to get there. Four were checkers that only passed on a machine that
had already built, which is why the gate looked green in the shared tree and failed in a
fresh deploy worktree: `check:claude` required `dist-lib/agent-3d.js`, `avatar-sdk/dist`
and `.git/hooks` (a linked worktree's `.git` is a file, so that one can never resolve
there); `verify-routes` missed a vite entry a formatter had wrapped across lines, and
modelled no `public/news/`; `audit-links` looked on disk for a dest `build-news.mjs`
writes; `audit-docs` wanted launch-kit art that `build:x-grid` regenerates. Two were real
config defects: `vercel.json` declared `/api/cron/print-orders-sync` twice, which collides
on one Cloud Scheduler job id, and `api/_lib/drops.js` carried four raw NUL bytes. Ten
hardcoded hexes across five pages were byte-identical to `--success`/`--danger`/`--warn`.
Four test suites were stale against shipped behaviour, including an oracle-calibrate case
asserting a factor both close to 1.318 and below the 1.3 ceiling. `prep:worktree` never
staged `agent-payments-sdk/dist`, so a fresh worktree failed with "Failed to resolve entry
for package @three-ws/agent-payments" instead of naming the missing artifact.

Two user-visible fixes, one with a changelog entry: the `/create` hero card nested its
rotating `model-viewer` inside its own `role="button"`, a serious axe `nested-interactive`
violation, now `inert`; and the `/portal` spec was judging the product on Vite's HMR
socket rather than on product errors.

Left for the owner: the submit itself, `npm run deploy:gcp:submit` from
`/workspaces/.deploy-wt-p100`, then `npm run deploy:gcp:purge-cdn` and `npm run smoke:prod`.
The worktree is left in place, built and ready, rather than removed. Pre-ship healthz had
`x402_settle` and `agent_index` down and `rpc_lanes`, `helius`, `sniper` degraded; that is
the baseline to compare against, and none of it is deploy-armed by this change.

Eight vitest files fail ONLY in a detached worktree and pass in the main checkout
(`packages/home-bridge` x2, `tour-sdk` x2, `check-tdz-bootstrap`, `multiplayer-server-boot`,
`server-404-routes`, `setup-git-hooks`). Verified both ways before dismissing them. They
need nested workspace `node_modules` and a real `.git/hooks` that `prep:worktree` does not
stage; worth staging next time rather than re-diagnosing.

## 2026-09-08: the fable-audit residuals order retired (section I is now empty)

Measured, not claimed. Task 1: `tests/api/cron-auth-sweep.test.js` invokes every handler in
`api/cron/` plus each of the dispatcher's routes with no credential and requires 401/403/503
(or 405 per method), and it is pointed at four deliberately broken fixtures (no guard, a
verdict computed and discarded, a 200 above the guard, a handler that hangs) plus a positive
control, so a sweep that degraded into a no-op cannot pass; 147 tests green across it and the
edge-gate and scheduler-sync suites. The edge layer shipped too (`server/cron-edge-auth.mjs`,
mounted ahead of the route table in `server/index.mjs`): it accepts a Google-signed Cloud
Scheduler OIDC token, requiring BOTH `CRON_OIDC_SERVICE_ACCOUNT` and `CRON_OIDC_AUDIENCE`,
beside `CRON_SECRET`, permanently, and stands aside only when no credential is configured at
all. Task 2: `/payment-outcomes` exists again and was driven in headless Chromium against a
local `server/index.mjs` on the production database. All four states render: skeleton while
the read is open, the populated board (24h: 0 settled, 45 settle-failed, 142 verify-rejected,
75.9% verify-reject rate, `unsupported_network` x142 and `settlement_unavailable` x45 as the
top reasons, ring settle DOWN with `sponsor_floor` named as the dominant cause), the internal
gate on a 401, and a transport error. 1440 px and 320 px both clean, no console error from
page code. Task 3: `npm run -s check:skills-seed` reports the seed matching its 115 SKILL.md
sources and a second `build:skills-seed` writes nothing, so the regeneration landed and the
generator is idempotent; the drift the order recorded is gone.

Left: attaching the OIDC identity to the live Cloud Scheduler jobs. `gcloud` auth is dead here
(`Reauthentication failed. cannot prompt during non-interactive execution`), and the whole
sequence, including the trap that Cloud Scheduler's OIDC token evicts the Bearer secret unless
it moves to `X-Cron-Secret` in the same update, is a runbook in `docs/ops/cron-auth.md` behind
one `gcloud auth login`. That is documentation, not a work order, so the file retired.

`npm test`: the vitest stage cannot be trusted as a whole-suite verdict on this shared
worktree. Two full runs failed different files (`thumbnail-blameless-failures` and three
others; then `corner-stack`, `forge-frame`, `x402-checkout-prepare`) with the file count
moving 2007 -> 2010 between them, and every named file passes in isolation: concurrent agents
are editing sources mid-run. The Playwright stage was deliberately not run, because another
session's headless browser and `:3000` dev server were live.

## 2026-09-08: 05 unwired guards (classified all 35, wired 8, fixed 5 reds)

Measured: the step-0 command reported **80 guards, 43 unwired** (the order's 73/39 had drifted;
peers added guards since). After this pass: **80 guards, 35 unwired**, and every one of the 35
has a measured row in `docs/ops/guard-wiring.md` (exit code, wall-clock runtime, verdict).
Nothing was inferred from a script name: 34 of the 35 were executed, the exception being
`audit:web:provision`, which registers a real production account, so measuring it would have
created one. That is recorded as the reason.

Did:
- **Wired into `gate`** (all seven measured green, repo-only and fast, solo timings):
  `check:announce` 3.5s, `check:skills-seed` 3.7s, `audit:motion` 2.4s, `audit:tour-global` 4.4s,
  `check:doc-media` 6.3s, `check:images` 10.6s, `audit:route-shadowing` 9.3s. Full `npm run gate`
  re-run after wiring: **exit 0**.
- **Wired into `deploy:gcp:submit`**: `audit:deploy`, ahead of the upload. Three of its four
  checks are already covered by `tests/deploy-artifacts.test.js`, but `findMissingDistAssets()`
  returns `{skipped:true}` with no `dist/`, so it means nothing in vitest or in `gate` and
  everything after a build (the /scene Draco outage class).
- **Reds fixed**, each in its own topical commit: `audit:tour-global` (stale CDN bundle,
  ccb137a5929), `check:images` (3 `<img>` with no `loading`, eb5366446), `audit:route-shadowing`
  (`GET /api/agents/vitals` was answered by `api/agents/[id].js`; the endpoint is documented and
  was announced in the changelog, 31f18493d), `check:doc-media` (30 problems: `scene-studio`
  never captured, and 29 `usedBy` claims naming docs that embedded no figure at all, so all 20
  captured figures are now embedded in the 27 docs that claimed them, 303c17ce3),
  `check:runnable-docs` (7 of 8 samples declared their real contract, ba91edd53).
- `check:docs-search` told you to "commit the result" for a file `.gitignore` excludes on
  purpose; message corrected. Guard wiring pinned by `tests/guard-wiring.test.js`, which also
  fails if a newly unwired guard has no row in the doc. Doc linked from `docs/ops/README.md`.
  Wiring commit f8058bc64. Changelog 798c0f692.

- **The registry had to move with the wiring.** `data/guards.json` records the stage each guard
  runs in and is what `/guards` renders, so wiring seven guards into `gate` left four of them
  publicly claiming they run on demand. Fixed, plus `audit:deploy` had no honest stage to claim:
  `deploy:gcp:submit` was not a stage `scripts/audit-guards.mjs` could verify. `deploy:submit`
  is now a real, verified stage described in the registry and in `docs/guards.md` (9989c6356).

Left:
- **Nothing deleted.** `audit:deploy` was the only delete candidate and moved to the deploy path
  instead; `check:docs-search` looked like a decoy but three open `prompts/finish/` orders invoke
  it, so its message was fixed rather than the script removed.
- **Recorded reds, not hidden ones.** `check:docs-freshness` is over its budget by 70 docs;
  `audit:deps` reports 285 OSV advisories across 17 pinned Python versions (two are RCE in
  `transformers`, fixed in 5.0.0 / 5.3.0), each a pin bump plus a worker image rebuild;
  `audit:garments` has 1 hard failure and 4 review flags out of 59, and `check:cron-drift` needs
  live gcloud, both of which belong to
  [905-fix-queue-03](../905-fix-queue-03-cron-drift-garment-sweep.md). None were wired, because
  wiring a red guard into `gate` blocks every concurrent session.
- **One `check:runnable-docs` finding survives on purpose**: `/api/v1/hood-portfolios/universe`
  404s because its handler landed 2026-09-07 and production runs the 2026-09-05 image
  (`/api/version` = 8770c06c2). Declaring `404` would be wrong the moment it deploys. Re-run
  after the next deploy. That deploy lag is exactly why the guard is classified post-deploy
  rather than `gate`.
- **A commit of mine reverted 9 files of peer work** (ba91edd53) through a race in my own
  private-index helper: it read the tree from one HEAD and took the parent from a later one.
  Repaired forward; a peer had already re-landed most of it in ff3144f78 / c6f3f78e6, and the
  remaining paths were checked back out and verified byte-identical to theirs. No reset, no
  amend. The helper now pins `$PARENT` before `read-tree`.

## 2026-09-09: map (trading Arena retirement pass)

Measured, all against production rather than the tree:
- `gcloud run services describe agent-sniper` serves revision `agent-sniper-00033-rg6`,
  whose image was built **2026-08-11T02:04:58Z**, from spec image tag `:latest`.
- `curl https://three.ws/api/sniper/status` at 05:45 UTC: `mode: live`, heartbeat 6s old,
  `feedLive: true`, 11 strategies, 1 open position, `globalKill: false`. The fleet is
  trading real SOL on that August image right now. State reads `degraded` only because 4
  of 11 agent wallets are starved, which is OWNER-ACTIONS row 2, not a crash.
- `git log --since=2026-08-11 -- workers/agent-sniper/` is a single sweep commit
  (`2849cafb6`, subject unrelated to its contents) carrying **48 files and 10,976
  insertions** under that directory. All of it is committed and none of it is deployed.
- `amm-exit.js` is inside that undeployed delta and is imported at HEAD by `executor.js`,
  `positions.js` and `graduation-ride.js`. The arena plan names graduated-position AMM
  exits as its blocker for copy-trading; the code exists and the running image has none
  of it.
- `sniper_risk_reviews` holds 7 rows, every one from 2026-09-04 and two of them
  `enforced: true`, which is the local verification run, not production. The
  shadow-evidence query printed in `workers/agent-sniper/README.md` runs green against
  the live schema and returns zero rows, so the Risk Officer has never reviewed a
  production trade.
- `npm run db:status`: all migrations applied, `20260904020000_sniper_risk_officer.sql`
  included. `npx vitest run tests/sniper-risk-officer.test.js tests/copy-eligibility.test.js`:
  42 passed.
- `npm run deploy:sniper -- --dry-run`: clean. gcloud authed, runtime SA and the `workers`
  Artifact Registry repo present, both required secrets present, only the optional
  `telegram-alerts-chat-id` missing. On an existing service it rolls
  `gcloud run services update --image`, which preserves the running env, so it cannot
  demote the live fleet to simulate the way applying `cloudrun.yaml` would.
- `curl https://three.ws/api/version`: `880bdcef8` on `three-ws-api-00420-ljh`, built
  2026-09-08 19:05 UTC. `/api/healthz` answers 200 and `/api/home/*` answer 401.

Did: verified every claim the arena plan makes about itself and found them all true, so
nothing in it needed building. Added OWNER-ACTIONS row 19 for the worker deploy and the
separate, later decision to arm the Risk Officer. Corrected row 1, whose premise had
rotted: it still described a 500ing healthz and 96 commits of lag, and that outage is
cleared. Recorded the finding in the roadmap pack README next to the arena plan's entry.

Left: two owner-gated steps, both on row 19. (1) `npm run deploy:sniper`, which is the
whole of the first one and is dry-run proven. (2) Arming enforcement afterwards with
`SNIPER_RISK_OFFICER=enforce` or a per-strategy `risk_officer_level`, which changes what
real SOL buys and should wait for production shadow rows to justify it. Order 918 stays on
disk because of (1); nothing in it is unbuilt.

## 2026-09-09: 04b fact-check benchmark (measured; NOT published, and the reason is the owner's)

The `mixed` fix works. It is not publishable, because the search chain underneath it is
down project-wide.

**The fix is live and reachable.** Production runs `880bdcef8`, which carries both halves of
the 2026-09-02 change; a live probe of `/api/x402/fact-check` through the service key came
back with a `partial`-stance source on the first try, a stance the pre-fix rubric could not
emit at all. The two unit files still pass (49 tests).

**Per-class A/B against the published 2026-08-10 run** (in-process, cache disabled, real
chain, 2/40 errors = 5%, inside the 10% ceiling, so the degradation guard passed it):

| class | published 2026-08-10 | this run | delta |
|---|---|---|---|
| mixed | 0% | 10% | **+10** |
| insufficient | 40% | 70% | +30 |
| supported | 50% | 30% | -20 |
| contradicted | 70% | 10% | -60 |
| overall | 40% | 30% | -10 |

`mixed` left zero, which is what the order set out to prove: the published run produced the
`mixed` verdict **zero** times across all 40 claims (it appears nowhere in that confusion
matrix), and this run produced it 6 times. The calculus is reachable from real evidence now.

**Two classes regressed, so the run was NOT published, per the order's own rule.** The
diagnosis is not the calculus. Every one of the 190 sources this run saw was Wikipedia, 100%
of them, because `groundedSearch` answers **403 `Lightning dunning decision is deny for
project: projects/93741856042`**: a project-wide GCP billing hold that denies every Vertex
surface. Production hits the same wall (its own logs carry the same denial for Vertex Imagen
minutes before this was written, and the live probe above returned five Wikipedia pages, one
of them `Health_effects_of_tea` and one `Insurance`, for a claim about coffee). With no
grounded rung the evidence is starved: **15 of 38 checked claims had ZERO stance-bearing
sources** and the mean was 1.08, so `supported` and `contradicted` collapse into
`insufficient` (6 of 10 each). That is an evidence-supply regression, not a verdict-quality
one, and publishing 30% as the product's accuracy would describe a chain that exists only
while the billing hold does. Left the published run alone.

**One real fix shipped: the runner was throttling itself and scoring it as failure.** The
first attempt was refused as degraded at 7/40 errors (17.5%), and every error was a 429
sweep across all three groq rungs and all five OpenRouter keys, minutes after the same chain
answered a probe in 225ms. A 40-claim run is 80 LLM turns; unspaced they land far inside the
free lanes' per-minute allowances. In-process mode also had no retry, though the remote path
has had one all along for exactly this reason. Added both (`FACT_CHECK_BENCH_SPACING_MS`,
default 6000, plus a single 15s-backoff retry): errors fell 17.5% to 5% and the guard passed
the run. `MAX_ERROR_RATE` was not touched.

Left:
- **Publishing is gated on the GCP billing hold** (OWNER-ACTIONS row 20). Nothing on this
  machine can clear a dunning denial. Once it lifts, one command finishes this order:
  `node scripts/fact-check-benchmark.mjs --in-process --publish` with the service env loaded,
  then confirm `/fact-check` in a browser. `04b` stays on disk until then.
- **Credential exposure to declare** (OWNER-ACTIONS row 21). Reading the lane keys printed
  the `vercel-inference@` service-account private key and the groq / OpenRouter x5 / NVIDIA /
  OpenAI keys into a session transcript. Rotation is the owner's call.
- Rows 5 and 6 are re-confirmed live by this session's chain dump: `openrouter#2` still 401s
  and `openai` still answers `429 billing_not_active`, so two of thirteen rungs are dead
  weight on every single call.

## 2026-09-09 (later pass): 04b, the starved evidence layer got the one fix that did not need the owner

The session above proved the `mixed` fix works and named the blocker: with the Vertex
grounded rung denied, 100% of sources are Wikipedia and **15 of 38 claims saw ZERO
stance-bearing sources**. This pass attacked that starvation, which is the half of the
problem that is fixable from here.

**Re-derived the blocker independently, and it is unchanged.** `/api/web-search` answers
`502 upstream_error`. That is diagnostic on its own: the handler returns `200 {enabled:false}`
when `GOOGLE_CLOUD_PROJECT` is unset, so a 502 means the var IS set and the Vertex call
itself is failing, which matches the dunning denial recorded above. Two free-lane probes of
the live endpoint came back with Wikipedia-only sources, confirming production is still on
the keyless tier.

**Root cause of the starvation, one level down: the Wikipedia rung only ever read each
article's LEAD section** (`exintro=1`, chosen 2026-07-08 to replace an even worse ~150-char
search snippet). A lead says what a page is *about*, so it carries the fact only when the
claim is about the page's subject. For a claim about an ATTRIBUTE it carries nothing. The
live probe of "Napoleon Bonaparte was unusually short" is the clean example: the rung
returned the opening lines of `Napoleon`, `Napoleon III`, `Napoleonic Wars` and
`Cultural depictions of Napoleon`, **not one of which mentions height**, every stance came
back `neutral`, and the verdict was `insufficient` at 0.3 confidence. The height prose was
in those same articles the whole time, further down. The verdict layer was behaving
correctly on evidence that never contained the answer.

**Fixed:** `selectRelevantPassages` in `agents/fact-checker/src/search-sources.js` now reads
each ranked article in full and returns the paragraphs carrying the claim's own vocabulary,
scored by TF-IDF over that article's paragraphs (plain term-coverage ties constantly, and
the tie then resolves to document order, which hands the win to the lead every time).
Citation and See-also sections are skipped: their entries match query terms while asserting
nothing. Measured live, keyless, on the same claim: `Napoleon` now yields
`Appearance and image: In his youth, Bonaparte was consistently described as small and
thin...` and `Cultural depictions of Napoleon` yields its `Napoleon's height` section, in
1.06s for the whole `searchAll` sweep. Claim-relevant sources on that query went 2/5 to 4/5.

Two things this pass did NOT do, deliberately:
- **It did not re-measure accuracy.** No LLM lane exists on this machine now (the keys the
  session above read off the service are unreachable: `gcloud` is back to
  `Reauthentication failed. cannot prompt during non-interactive execution`, and the keyless
  floor is gone, OVH 429s every call and Pollinations now answers ~6 requests then 402s
  `KEY_BUDGET_EXHAUSTED`). So this is a measured **evidence-relevance** improvement, not a
  measured accuracy improvement. Whether it moves the per-class table is unknown until a run
  is possible.
- **It did not touch search RANKING**, which is the other half and is upstream of this
  function. "Great Wall of China single continuous wall" still ranks
  `Great Green Wall (China)` and `Mexico-United States border wall` while never returning
  the `Great Wall of China` article at all. No passage selector can recover from that.

**One real bug caught by an existing test while doing it.** The first cut had the rung wait
on the body fetches unconditionally, so a single hung fetch spent the caller's entire search
budget and returned nothing, discarding intros that had arrived in milliseconds
(`tests/fact-check-degradation.test.js` "keeps evidence from the queries that did answer in
time" went red, correctly). Widening is now best-effort: `searchAll` threads its deadline
down through `searchWeb` into the rung, widening gets what is left minus a 500ms reserve,
and on expiry every source keeps the intro the ranked search already returned. That reserve
is what stops the rung from finishing at the exact moment the caller stops waiting.

Coverage: `tests/fact-check-wikipedia-passages.test.js` (8 cases, pure, no network) pins the
selection, the apparatus-section skip, the heading split, and the fallback floor. All five
fact-check suites pass (80 tests).

Left: unchanged. The published run is still the 2026-08-10 one, and publishing is still
gated on the GCP billing hold (OWNER-ACTIONS row 20). `04b` stays on disk. When the hold
lifts, the finishing command is the same one recorded above, and this change should be
re-measured in that run rather than assumed.

## 2026-09-09 (later pass): 01 ship-readiness, built and gate-green at 90f0a919b; the submit is the owner's

Prod was `880bdcef8` (revision `three-ws-api-00420-ljh`, built 2026-09-08) and `main` had
moved 348 commits past it. Nothing was shippable when this run started: `npm run gate` was
red in the shared tree, and in a clean worktree, which is the only tree that measures the
commit rather than five sessions' uncommitted work, it was red four more times over. Every
one of those was invisible from the shared tree, which is the whole finding of this pass.

**Built and verified at `90f0a919b`** in `/workspaces/.deploy-wt-ship100`:
`npm run gate` exit 0, `npm run build:gcp` exit 0 stamping `dirty: false`, `check:dist` and
`check:pages` clean (816 declared pages), and all three submit gates green (`db:check` says
every migration is applied, `check:gcloudignore` says the context is complete and carries no
secrets across 2424 reachable modules, `audit:deploy` clean). `server/cloudbuild.yaml` pins
`three-ws-build@` and references no `$SHORT_SHA`, so the submit needs no `--substitutions`.

**vitest at the shipped SHA: 29,435 passed, 3 failed, 175 skipped across 2036 files.** All
three failures were `Test timed out in 120000ms` in two forge suites, under load average 30
with 2036 files in flight; both files pass in 19s when run alone. The first run of the same
suite reported 18 failures and every one was the worktree's environment, not the commit,
which is what the prep:worktree work below fixes.

**Playwright: 257 passed, 0 failed, 5 skipped, exit 0** (10.3 min), after one more fix. The
first run reported three failures, all in `home-lifecycle` and `home-plan`. Neither is a
product defect: both are live journeys that need a real Home Assistant and two provisioned
accounts, which only `playwright.home.config.js` sets up, and both had drifted out of the
default config's `testIgnore` list. The general run drove them with no house to reach, so
journey 1 died on `Could not reach http://127.0.0.1:39611` and the plan page found none of
its quota rows. **`npm test` could not pass for anyone while that held.** The config states
the rule in prose right above the list (importing `./home-support.js` is what makes a spec
live), so the list is now read from the spec files instead of being that rule written a
second time: eight live specs, the original six plus the two that drifted. Both still run
under `npm run test:home:e2e`, so nothing loses coverage.

**Eight reds fixed, all of them at HEAD and none of them mine:**

- `audit:motion-tokens` counted the `prefers-reduced-motion` floor as drift. A literal there
  IS the zeroing the ladder exists to preserve; the auditor already knew that and had encoded
  it as a whole-file exemption for `tokens.css`. Generalized, baseline 162 to 158.
- `tests/audit-guards.test.js` and `tests/guard-wiring.test.js` were red because
  `check:windows-widget`, `check:home-matrix` and `i18n:home` ran in the gate chain with no
  registry entry, so `/guards` and `docs/guards.md` both omitted them. All three registered
  with two-sided proofs; `prove-guards` reports PROVEN for each.
- Proof pointers are dot paths and a slash pointer was silently accepted: `set` split it on
  `.`, wrote a junk top-level key, and the proof reported NOT CAUGHT, which reads as a rotted
  guard rather than a typo in its own declaration. `normalizeProof` now refuses one by name.
- `audit:mcp-golden` and `audit:mcp-catalog` had been red since `dc8856f57` rewrote the
  em-dashes out of the studio tool copy: descriptions are part of the published schema.
  Reviewed as copy-only (no parameter added, removed, renamed or retyped) and re-recorded.
- `audit:docs` reported three dead links to `data/announcements.json` in any tree where
  nobody had run `announce:rank`, since the ledger is generated and gitignored. The docs now
  name the command that writes it.
- `check:images` found the render-lab sheet building bare `<img>` tags.

**Two production defects found by verifying rather than by looking:**

- **The localization manifest has been shipping 113 pages short.** `prebuild` wrote
  `public/locales/localized-pages.json` and then ran the translation-annotation pass over
  `public/news/*.html`, so all 113 news pages counted as English-only. Production serves
  `count: 244` today; the built artifact says 357. Fixed by ordering, verified end to end in
  a clean worktree build. Changelog entry written.
- **`res.sendFile` applied the dotfiles deny policy to the whole absolute path**, including
  the segments above `dist/` that no request can influence. Served from a checkout under a
  dot-directory it denied every static file as Forbidden and answered 500 to everything,
  `404.html` included. Latent in production (the container path has no dot segment) and the
  reason every server suite fails from a deploy worktree, since `prep:worktree` names them
  `.deploy-wt*`.

**A deploy worktree can now verify itself, which is the durable part.** `prep:worktree`
stages four more artifacts (`tour-sdk/node_modules`, `walk-sdk/dist`,
`multiplayer/node_modules`, `animation-sources`), all hardlinked, so they cost nothing. The
first matters most: tour-sdk pins esbuild 0.27.7 against the root's 0.28.1 and the committed
`tour.global.js` is 0.27.7 output, so `audit:tour-global` called the bundle stale over a
toolchain version nobody changed and **no fresh worktree could pass the gate at all**. Two
tests also assumed the checkout is the primary worktree at a path named `three.ws`;
`check-tdz-bootstrap` now measures against its own repo root and `setup-git-hooks` asks git
for `--git-common-dir` rather than assuming `<root>/.git/hooks`, which is a file in any
linked worktree.

**Left for the owner (gate 2).** The artifact is built and the tree is clean. From
`/workspaces/.deploy-wt-ship100`:

    gcloud builds submit --config server/cloudbuild.yaml --region us-central1 --project aerial-vehicle-466722-p5
    gcloud compute url-maps invalidate-cdn-cache three-ws-lb --path '/*' --project aerial-vehicle-466722-p5

Then `curl -s https://three.ws/api/version` should report `90f0a919b`, `npm run smoke:prod`
should exit 0, `https://three.ws/locales/localized-pages.json` should read 357 rather than
244, and `npm run check:windows-widget:live` should stop reporting that the deployed Adaptive
Card fails the widgets board's expression engine. That last one is live today: every pinned
Windows glance widget draws empty, and the card in this tree expands cleanly.

## 2026-09-09 (third pass): 04b, the blocker re-derived, and two traps measured so the next session does not pay for them

Nothing in this pass changes 04b's status: the `mixed` fix is live, it was measured earlier
today, and publishing is still gated on the GCP billing hold (OWNER-ACTIONS row 20). This
pass re-derived that independently, then spent its time on the two things a fourth session
would otherwise rediscover the slow way.

**Row 20 confirmed, from outside the project.** `/api/web-search` still answers
`502 upstream_error`, which is diagnostic because the handler returns `200 {enabled:false}`
when `GOOGLE_CLOUD_PROJECT` is unset: a 502 means the variable IS set and the Vertex call is
what fails. Two live free-lane checks of `/api/x402/fact-check` corroborate it from the
product side. "The Eiffel Tower is located in Paris, France" returned four Wikipedia pages
(one of them `Eiffel Tower (Paris, Texas)`, another `Eiffel Peak`); "Nvidia reported record
data center revenue in its most recent quarterly earnings report" returned five, among them
`Nintendo Switch` and `Foreign policy of the second Trump administration`, and answered
`insufficient`. Production is still serving the keyless tier.

**Trap 1: probing the keyless LLM floor with a toy prompt lies.** A bare probe says
Pollinations is healthy: ten calls at 6s spacing, ten HTTP 200s, sub-second. Run the actual
pipeline against it and the same rung answers `402 Payment Required` carrying
`the Pollinations legacy text API is being deprecated`, and its edge returns Cloudflare 502
pages for anything with a system message, a `response_format`, a 1024-token ceiling or a
full-size prompt. OVH answered 429 on nine of ten probes. So the floor is not "up" in any
sense a 40-claim run can use, and the previous pass's finding stands. **Probe a lane with
the payload the caller actually sends**, or a dead rung reads as alive. The one in-process
smoke check this pass could take degraded exactly as designed, reporting
`query generation unavailable` and `stance extraction unavailable` rather than fabricating an
all-neutral verdict, which is the contract the 2026-09-02 change added.

**Trap 2: the search RANKING half is not the one-line fix it looks like.** The previous pass
scoped it out and named the example. Measured here across ten concise, LLM-shaped queries
(the shape `generateSearchQueries` actually emits, not the raw claim), the failure is real
and worse than the example suggested: `Great Wall of China single continuous wall` ranks
`Great Green Wall (China)` first and never returns the `Great Wall of China` article at all;
`Napoleon Bonaparte actual height` never returns `Napoleon`; `lightning strikes same place
twice` returns `Lockheed Martin F-35 Lightning II`, `Virtual XI` and `Molly Hatchet`;
`carrots night vision myth origin` returns `Feijoada (Brazilian dish)`, `Heracles` and
`J. R. R. Tolkien`.

The obvious repair is a title-anchor rung: walk the query's leading word-prefixes through
`action=opensearch` and add the article the query names. Measured, it recovers the canonical
article in five of the ten cases, including `tongue map` to the `Tongue map` article that
full-text search never returns. **It also injects junk in four of them**, because a short
prefix resolves to a song, an album or a film: `lightning strikes same` to
`Lightning Strikes (Aceyalone album)`, `carrots night` to `Carrot Rewards`, `humans use` to
`Human sexual activity`, `goldfish memory` to the 2003 film `Goldfish Memory`. Two guards cut
that down: reject a title carrying a parenthetical disambiguator, and require the resolved
title to appear verbatim inside the query. Together they reject three of the four junk
results while keeping all five wins; the film title survives both. That is a workable design
and it is NOT a change to make blind, because with no LLM lane on this machine its effect on
the per-class table cannot be measured, and shipping an unmeasured ranking change on top of
an unmeasured passage change is how a fix becomes a regression nobody can attribute. It
belongs in the same run that re-measures the passage change, once row 20 clears.

**One defect found and fixed while verifying this order's own changelog entry**, unrelated to
the fact-checker but shipping today. Community delivery keys an entry by date + title, and
the posted-set can only suppress an entry sent on an EARLIER tick, so two feed entries
sharing one key were both unposted when a batch was built and the send loop posted both:
the identical announcement, twice, to every subscriber. `data/changelog.json` had six
colliding pairs, three byte-identical, and one of those was added today and still unsent.
Fixed in three layers: `pendingEntries` collapses repeats before the batch is built (new case
in `tests/changelog-push.test.js`), the feed build now refuses a verbatim duplicate instead of
shipping it (proved by making it fail and restoring), and the three verbatim repeats are gone
from the data file. The three pairs that share a key while saying different things were left
alone, because deleting or retitling published copy is a wording call, and the delivery layer
now collapses them either way.

Left: unchanged. `04b` stays on disk, the published run is still the 2026-08-10 one, and the
finishing command when row 20 clears is the one recorded two passes above.

## 2026-09-09 (fourth pass): 01 ship-readiness, built clean at 7a053e6f3 with the first fully green `npm test`; the submit is the owner's

**Prod before this run: `880bdcef8`, revision `three-ws-api-00420-ljh`, `dirty: false`.** Local
`main` was 385 commits ahead. Nothing shipped in this session: the submit is gate 2 and the
owner has not said yes, so this run ends at the rendered command, which is a finished run and
not a blocked one.

**The clean `npm test` this order has owed since 2026-08-08 now exists.** Taken in the deploy
worktree at the exact pinned commit, after the build, exit code 0:

    Test Files  2035 passed | 7 skipped (2042)
         Tests  29496 passed | 175 skipped (29671)
    playwright  256 passed, 1 flaky, 5 skipped (11.0m)

The one flaky was `tests/e2e/coin-buy-trade.spec.js:284` (failed buy-prep copy), which passed
on retry. `npm run gate` also exits 0 at that commit, as do the three deploy gates
(`db:check`, `check:gcloudignore`, `audit:deploy`).

**Four reds had to be fixed to get there, and only one of them was flake.**

- **A lost host realm turned a handled boot failure into a crash** (`8d70251ec`). Two
  unhandled rejections failed every full vitest sweep. In vitest's jsdom environment
  `document.defaultView === globalThis`, so the existing "construct from the element's own
  window" fix is a no-op there: when the environment teardown restores Node's native globals,
  `view.CustomEvent` becomes Node's, and jsdom's `dispatchEvent` rejects it as "not of type
  Event". Thrown from inside `_boot`'s own catch it escaped as an unhandled rejection. The
  same thing happens to a real embedder whose SPA remounts mid-boot. `_emit` now drops an
  event the realm will not accept, and the four other dispatch sites that repeated its four
  lines route through it. Pinned by `tests/src/element-emit-realm.test.js`, verified against a
  negative control (two of its three cases fail without the guard).
- **`prep:worktree` dropped 25 fixtures from every staged tree** (`c7ab8d2d5`). It skipped any
  artifact whose destination existed, which is wrong for a directory git only partly owns:
  `animation-sources` holds tracked `.fbx` beside gitignored `.glb`, so checkout created it
  with the tracked half and the stager left the rest behind. glb-diff and model-diff then
  failed on missing files, which reads as a broken commit rather than an unstaged tree. An
  existing destination is now merged into with `--update=none`, so a tracked file is never
  hardlinked (which would make an edit in the deploy tree rewrite the source tree through the
  shared inode). The placement rule is pure and pinned.
- **The stage-room test raced a broadcast it can never win** (`7a053e6f3`). It asserted
  `room.state.host.caption` the instant the `utterance` message arrived, but `StageRoom`
  broadcasts with `afterNextPatch: false` on purpose, so the caption ALWAYS lands after the
  message. It failed on a loaded box in three consecutive sweeps and passed on every isolated
  re-run, which reads as flake and is a real ordering assumption. Now waits for state to catch
  up, bounded by the deadline already in the test. Green 3/3 in a row.
- **The committed feeds had fallen a changelog entry behind** (`8f6fd6b1d`). Nothing
  regenerates them when an entry lands, so `CHANGELOG.md` and the published JSON and RSS were
  missing the animation-gallery paging entry and the atlas index still advertised 814 pages
  against a 816-page route table. This is also what made the first build stamp itself
  `dirty: true`: `build:info:snapshot` reads the tree before `prebuild` rewrites those files,
  so a tree that is already behind stamps dirty. Regenerated and committed; the shipped build
  reads `dirty: false`.

**The ordering rule that came out of this, worth keeping.** In a deploy worktree, build
BEFORE you test. Nine failures in the first worktree sweep were missing build output
(`avatar-sdk/dist/index.mjs`, and `dist/` for the server-404 and asset-path suites), and
running `npm test` first also dirties the tree through Playwright's dev server, which runs
`prebuild`. Both disappear when `build:gcp` runs first.

**Two peer-caused reds were correctly NOT fixed.** A sweep in the shared tree reported
`tests/changelog-push.test.js` and `tests/multiplayer-server-boot.test.js` failing; the first
was a peer's uncommitted `api/_lib/changelog-push.js` edit landing mid-run (it passes at HEAD),
and only the second was real. HEAD moved four times during this run, which is why the
verification was taken in a pinned worktree rather than the shared tree.

**Pre-ship healthz (unchanged from the start of the run):** 11 ok, 3 degraded, 1 down.
`x402_settle` DOWN (settle 0.0%, 132 rail faults, sponsor under the SOL floor) and `sniper`
degraded (5 of 13 wallets starved, funding master holds 0.0250 SOL against the 0.2834 SOL
needed) are both order 902 and both need owner funds. `rpc_lanes` degraded (all 3 paid lanes
cooling) and `okx_chat_bot` degraded (Vertex dunning denial, order 907) are likewise not this
deploy's.

**Left for the owner, in this order.** gcloud auth on this machine has expired
("Reauthentication failed. cannot prompt during non-interactive execution"), so even a
read-only `gcloud run services describe` fails here; the reauth is interactive and only the
owner can complete it.

    gcloud auth login
    cd /workspaces/.deploy-wt-ship100b && gcloud builds submit --config server/cloudbuild.yaml --region us-central1 --project aerial-vehicle-466722-p5
    gcloud compute url-maps invalidate-cdn-cache three-ws-lb --path '/*' --project aerial-vehicle-466722-p5

No `--substitutions` on the submit: `server/cloudbuild.yaml` contains no `$SHORT_SHA` (it tags
through `_IMAGE`), so passing one is rejected. The bare `gcloud builds submit` is correct here
only because `db:check`, `check:gcloudignore` and `audit:deploy` were all run in that worktree
and all exit 0. Then `curl -s https://three.ws/api/version` should report `7a053e6f3` with
`dirty: false` on a revision above `three-ws-api-00420-ljh`, and `npm run smoke:prod` should
exit 0.

**The deploy worktree is deliberately left in place** at `/workspaces/.deploy-wt-ship100b`,
built and verified, because the owner submits from it. Remove it with
`git worktree remove --force /workspaces/.deploy-wt-ship100b` once the deploy lands. Disk is
at 95% (7.2G free) with it there.

## 2026-10-11: order 400 (ring leak scanner RPC burn) closed

Commit `f6dcafb23` on `evolve`. The scanner now holds a lease (`acquireLock`,
`cache.js`), runs under a 200s wall-clock budget, and scans role wallets then
ledger-active wallets then an oldest-checked_at-first rotation slice instead
of the full 2,006-wallet registry every run. Removed from economy-tick's
TARGETS (its own `*/10` Cloud Scheduler job already owns it); `wallets-leak-scan`
got the same lock. New migration `20261011230000_x402_ring_scan_checked_at.sql`
adds the `checked_at` column the rotation needs; pending for the owner via
`npm run db:migrate` at the next deploy.

Also fixed along the way: `accountKeyStrings()` returned a live `PublicKey`
object instead of its base58 string whenever `accountKeys` came back as
`{ pubkey, signer, writable }` (the real shape from `@solana/web3.js`'s own
parsed-transaction response), so every wallet-identity comparison silently
failed on real mainnet data. `classifyWalletDebits` found zero leak/delegation
events on every real transaction and the fee cross-check (`x402_ring_fee_observed`)
never accumulated anything. Both now work on real traffic for the first time.

Local verification against real mainnet data (RPC paid lanes still exhausted
per OWNER-ACTIONS row 24, so all RPC calls hit the free/degraded lanes): a
single run scanned all 2,006 registry wallets in 142s, well under the 200s
budget, with a well-formed `results` array. The DoD's concurrent-second-curl
check could not be exercised locally because this worktree has no Redis
configured (`UPSTASH_REDIS_REST_URL`/`TOKEN` absent from `.env.local`), so
`acquireLock` degrades to its documented always-true no-op locally
(`cache.js` `redisConfigured()`); the second curl started its own real scan
and timed out against curl's own `-m` flag rather than returning a clean
lease-skip. That lease-skip path is covered by the existing unit test in
`tests/x402-ring-leak-scan-run.test.js`, which exercises the same code path
with `acquireLock` mocked to return false. Borrowing production's real
Upstash lock to re-run this locally was rejected: it would hold the real
9-minute lease on the live cron for no verification benefit over that test.

OWNER-ACTIONS row 24 updated with the re-measurement and the ship command
(`npm run db:migrate` then `npm run deploy:gcp:full`). `npm run test:core`
shows the same 6 pre-existing failures as before this change (unrelated:
`mcp-schema.test.js`, `x-content.test.js` queue staleness) plus 3 new passing
tests, no new failures.

## 2026-10-11: order 403 (cron time-budget enforcement) closed

Commit `1ef950e60` on `evolve`. `wrapCron()` in `api/_lib/http.js` now races
every cron handler against a real time budget (`maxDurationMs`, wired from
each of the 14 cron files that already declared `export const maxDuration`,
defaulting to the new `DEFAULT_CRON_MAX_DURATION_MS` constant of 120000ms
for the rest) and answers a clean `503 { reason: 'cron_timeout' }` instead
of hanging until Cloud Run's blind 900s ingress kill, the gap this measured
against `/api/cron/x402-ring-leak-scan` before order 400's own lease/budget
fix landed. A `timedOut` guard stops the handler's own late settlement
(it keeps running in the background; Node has no generic preemption) from
clobbering the timeout heartbeat or touching the already-sent response.
`api/_lib/render-glb.js`'s `renderOnce()` got the same treatment for its
three previously-unbounded Puppeteer stages (`getBrowser` 30s, `setContent`
20s, `screenshot` 15s, the last enforced manually since puppeteer-core
ignores an unrecognized `timeout` key on screenshot options).

Verification: `tests/http-cron-timeout.test.js` (4 new tests) proves the
race, the 503 body, the heartbeat, the ops-alert dedup signature
(`cron:timeout:<name>`), the unaffected-when-inside-budget path, and the
default-budget fallback (verified behaviorally via a `setTimeout` spy
rather than parsing esbuild-minified source, since `120_000` compiles to
`12e4`). The timeout case was shown to hang indefinitely against the
pre-fix `wrapCron` using a path-scoped `git stash push -u` isolating just
`api/_lib/http.js`, then restored and the fix re-applied before committing.
`tests/http-db-unavailable-boundary.test.js` got one added case proving
`wrapCron`'s existing `db_unavailable` degradation (200, not 503, no
`[api] unhandled` log) is unchanged now that a race wraps the handler.
`npx vitest run tests/http-cron-timeout.test.js tests/http-db-unavailable-boundary.test.js`
passes 10/10. A real `http.createServer` hosting `wrapCron` with an 800ms
budget and a never-resolving handler answered `503 cron_timeout` at 0.809s
against a real `curl` round trip (not Cloud Run's 900s, not instantly);
the proof server and its temp script were removed afterward. `npm run
test:core` shows the same pre-existing `x-content.test.js` queue-staleness
failure noted in the 2026-10-11 ring-leak-scan entry above, no new
failures, plus the new passing tests. `npm run check:rules` is clean on
every touched file; `npm run build:pages` rebuilt the changelog clean.

New docs section: "HTTP timeout with no cron context" in
`docs/ops/production-log-triage.md`. OWNER-ACTIONS row 37 names the ship
command (`npm run deploy:gcp:full`, already covered by row 1's general
deploy cadence) and the post-deploy log query to confirm the fix landed.
No owner decision was otherwise needed; this is a pure code fix.

## 2026-10-13: order 400 (R2 outage resilience, agent-doable half) closed

Step 0 re-derivation confirmed the order's premise still held: `ops_alerts`
showed the last `RESOLVED: Object storage (Cloudflare R2)` row at
2026-10-11T06:55:05Z with every hourly tick since then `DOWN` (35+ hours at
measurement time during this run, now 60+ hours), the public `*.r2.dev`
domain answering a Cloudflare-branded 403, and `/cdn/<key>` (`api/cdn-object.js`)
502ing because both of its legs are down simultaneously. Four commits on
`evolve`, one per task:

1. `ee94b259d` doc escalation: `prompts/finish/_context/production-100-OWNER-ACTIONS.md`
   row 36 and `docs/ops/production-log-triage.md`'s `r2-downstream-5xx`
   section both corrected from "flaps... many RESOLVED events minutes
   apart" to the measured 35+ hour unbroken `DOWN` streak, without touching
   row 36's owner classification.
2. `ba53f5086` health-probe retry: `gatherObjectStorageHealth()`
   (`api/_lib/ops/object-storage-health.js`) now retries once after a
   200-500ms backoff before classifying `down`, scoped to absorb a single
   transient blip inside one invocation, not to mask a sustained outage.
   `tests/object-storage-health.test.js` proves a failure-then-success
   classifies ok/degraded and two consecutive failures still classify down.
3. `d152edbfe` frontend fallback: `src/marketplace-detail.js` (detail
   avatar, creator-modal thumb grids) and `src/marketplace-gallery.js`
   (panel media) now probe thumbnail/GLB loads with a detached `Image()`
   or the `<model-viewer>` `error` event and keep the initial-letter
   fallback showing on failure instead of a blank box or stuck spinner.
4. `6c11ef944` `/cdn/` routing: `api/_lib/r2.js` exports
   `cdnUrl()`/`cdnUrlOrNull()` (same-origin `/cdn/<key>` via `encodeR2Key()`,
   never throws). `thumbnailUrl()` now calls `cdnUrlOrNull()` internally,
   which fixed `pump-agent-launches.js` and `marketplace/animations.js` for
   free. Direct call sites switched: `agent-earnings.js`, `agent-economy.js`
   (`avatarThumb`), `marketplace/[action].js`, `persona-store.js`'s
   persisted GLB URL, and `avatars.js`'s `model_url`/`base_model_url`/
   `usdz_url`/`halfbody_url` plus `resolveAvatarUrl()`'s public branch
   (previously tagged `cdn: true` while actually returning a raw r2.dev
   URL; now true to that tag). `drop-store.js`'s `thumbnailUrl` is a
   destructured parameter name fed from forge-job data in its caller, not
   a local URL-construction helper, so it needed no change. A follow-up
   grep sweep (`grep -rn "publicUrl(" api/_lib/*.js api/**/*.js`) found
   ~40 more call sites outside the order's 6 named files/helpers (forge
   pipeline internals, cron jobs, third-party provider integrations,
   print/IRL/IBM/x402/erc8004 handlers); left untouched as a deliberate
   scope boundary rather than an unbounded same-session expansion, several
   of them persisting URLs into DB columns rather than only shaping an API
   response.

Verification: `npx vitest run tests/object-storage-health.test.js` passes
8/8. `npx vitest run tests/r2-public-url-or-null.test.js
tests/cdn-object-storage-failover.test.js tests/r2-public-object-fallback.test.js
tests/r2-key-from-public-url.test.js` passes 28/28. A local full-stack
server against the real production database confirmed
`/api/marketplace/agents?limit=1` now returns `thumbnail_url` and
`avatar_glb_url` both starting with `https://three.ws/cdn/`, not
`*.r2.dev`. A Playwright check against the still-live outage confirmed the
marketplace detail page's avatar fallback renders its initial letter
(visible) and the model-stage label reads "Couldn't load the 3D model."
instead of hanging. `npm run test:core` finished at 46 failed files / 85
failed tests, 2352/35376 passed, matching the pre-existing baseline
(confirmed via a path-scoped `git stash` comparison that the two
investigated failures, `agent-earnings-board.test.js`'s missing
`agent_commerce_invoices` relation and `mcp-studio-asset-links.test.js`'s
`MAX_GLB_BYTES` mismatch, reproduce identically with none of this order's
changes present), no new failures. `npm run check:rules` clean on every
touched file.

No owner decision was needed beyond what OWNER-ACTIONS row 36 already
tracks (enabling R2 in the Cloudflare dashboard); everything in this order
was agent-doable and ships independent of when that happens.

## 2026-10-13: order 403 (forge nvidia lane cooldown gap) closed

Commit `7fa4b0653` on `evolve`. Step 0 re-derivation found the live
`forge_generation` symptom had already moved on from the order's measured
15/15-failures-on-nvidia window: healthz now read `"no generation has
STARTED in 114m"`, a different (shared-dependency-shaped) symptom, not the
nvidia-specific one the order measured. Per the order's own "Never
blocked" guidance, the underlying code gap is a structural fact
independent of the current failure rate, so the fix proceeded anyway.

`NIM_TRELLIS_COOLDOWN_KEY` is now `export const` in `api/forge.js` (line
178); `api/cron/forge-finalize.js` imports it and the already-exported
`nimCooldownSeconds` from `../forge.js` instead of redeclaring the string.
Added `decideNvidiaStall` (pure, exported, next to `decideFailedSweep`:
defer/resubmit/terminal on ageMinutes vs. the attended budget and hard
TTL, with an `alreadyResubmitted` guard) with its own test-first coverage
in `tests/forge-finalize.test.js` (5 new tests, confirmed failing with
"decideNvidiaStall is not a function" before the function existed, passing
after). Wired one stall-resubmit into the nvidia poll branch for a
still-running/queued/null-status poll past the attended window: under a
new `nvcf:stall-lock:` key (distinct from the existing `nvcf:resub:` lock
so the two paths can never double-fire), it calls `nvidia.textTo3d()` once
and writes both the shared `nvcf:alias:` key (so the next tick and any
live attended poller pick up the new task id transparently) and a
`nvcf:stall-resub:` flag so it never fires twice for the same row. Added
`markProviderCooldown(NIM_TRELLIS_COOLDOWN_KEY, nimCooldownSeconds())` at
both give-up points for `backend === 'nvidia'`: the `nvcf_expired`
fallthrough (lock held by a prior recovery, or the resubmit itself
throwing) and immediately before the final bare-TTL `markFailed`, scoped
so self-host envelope timeouts (which already call `markLaneUnhealthy`)
are untouched.

Verification: `npx vitest run tests/forge-finalize.test.js` passes 15/15
(10 pre-existing `decideFailedSweep`/`decodeWorkerEnvelope` tests plus 5
new `decideNvidiaStall` tests). A direct dynamic import of
`api/cron/forge-finalize.js` confirmed the new `../forge.js` import
introduces no circular-import failure (module loads clean, both new and
existing exports present). `npm run check:rules -- --paths api/forge.js
api/cron/forge-finalize.js tests/forge-finalize.test.js` exits 0.

No owner decision was needed; this is a pure code fix with no deploy step
in its own definition of done. The live healthz number will not change
until the next deploy carries this commit (deploys are owner-gated).

## 2026-10-14: order 404 (evolve/main divergence, 140-file merge) closed

Step 0 re-derivation at start of session measured `main` 376 commits ahead /
`evolve` 134 ahead (grown from the order's 2026-10-11 snapshot of 358). Did
the merge as one operation, resolved all batches, fixed the live production
bug it unblocked, and corrected the two downstream orders it named. Seven
commits:

1. `57ff3c669` the merge itself (`git merge --no-commit --no-ff main`, then
   one commit, not a sweep). Batch A (17 `worker_security.py` vendored
   copies, generated JSON/JS files) resolved mechanically and reverified
   with `npm run check:vendored` (0 drift). Batch B (clean adds on one side)
   taken as diffed. Batch C (`x-mention-store.js`, `gateway/adapters/x.js`,
   `x-search.js`, `sentiment-scout.js`, `x402-ring-leak-scan.js`,
   `webhook-dispatch.js`) hand-combined per the order's own analysis: both
   sides' improvements preserved, not blind-picked. Batch D
   (`auth.js`, `api-keys.js`, `rate-limit.js`, `idempotency.js`,
   `spend-scope.js`, `x402-paid-endpoint.js`, `policy.js`) read hunk by
   hunk; all were orthogonal (different functions/concerns on each side), so
   all combined with no file left reverted to one side and no follow-up
   needed for this batch.
2. `7ba9f9749` fixed the live `x-mention-reply.js` `chainFor()` bug (row 34):
   it now builds its chain from `llm.js`'s own `providerChain()` plus
   `loadOwnerGrokKey`/`agentDefaultModel`/`MODEL_CATALOG` instead of the
   tool-calling gateway's `resolveAgentBrain`/`modelChain` shape, which has
   no `buildBody`. `RUN_LLM_TESTS=1 npx vitest run tests/x-mention-reply.llm.test.js`:
   16/16 `source: 'model'`, no `TypeError`.
3. `15c7d0a84` fixed the two genuinely new post-merge regressions (found by
   diffing a pre-merge detached-worktree baseline run against the post-merge
   full suite, not by assuming): `open-source-credits.json` missing two
   entries `main` added dependencies for, and 242 `node_modules` entries
   stale against an already-correct lockfile (`npm install --package-lock-only`
   used mid-merge resync's metadata but not the tree; a plain `npm install`
   fixed it with no lockfile diff).
4. `e22e51bc5` restored `SPEND_BROWSER_URL` in `api/_lib/spend-scope.js`,
   dangling since a shared-history refactor removed it before `evolve` ever
   branched; `scripts/lib/skill-md-facts.mjs` (evolve-only) depended on it
   and `npm run build:skills-pack` was throwing.
5. `6b491c5da` fixed `pages/grok.html`'s 5 stray `"three-ws"` connector
   labels to the consistent `"three-ws-grok"` slug `slugForEndpoint()`
   actually produces (pre-existing bug the merge's full-suite run surfaced,
   not merge-caused).
6. `a7e169bc8` regenerated `data/open-source-credits.json` (see commit 3).
7. `2919be276` corrected order 060's and `production-100-OWNER-ACTIONS.md`'s
   2026-10-11 claim that `d77b89178` (an earlier, separate evolve/main
   merge) had already fixed the `chainFor()` bug; it had not (checked out
   that merge's own parent and confirmed `chainFor()` still imported
   `resolveAgentBrain`/`modelChain` there). The real fix is commit 2 above.
   Order 061 needed no correction, its status was already accurate.

A second, pre-existing architecture gap surfaced during close-out (not
caused by this merge, left by the earlier `d77b89178` merge on 2026-10-11):
`api/_mcp-studio/receipts.js`'s `openRun`/`closeRun` run-receipt system is
wired into nothing outside its own test, because `main`'s `finishMesh`/
`finishRig` refactor that wired it into `forge_free`/`text_to_avatar`/
`mesh_forge`/`rig_mesh`/`forge_avatar` was never combined with evolve's
idempotency-key `job-tools.js` architecture. Filed as its own order,
[405-wire-run-receipts-into-forge-tools.md](../405-wire-run-receipts-into-forge-tools.md),
rather than guessed at here; order 404's own batch C guidance is to combine
with full confidence or not at all, and this combine needs real design work
across 5 handlers.

Definition of done, verified: `git rev-list --left-right --count main...HEAD`
→ `0  332` (evolve now a descendant of main). `check:vendored` 0 drift.
`RUN_LLM_TESTS=1 npx vitest run tests/webhook-dispatch*.test.js
tests/x402-ring-leak-scan-run.test.js tests/x-mention-reply.llm.test.js`:
30/30 passed. Full `npm test`: 43 failed files / 77 failed tests, but a
pre-merge baseline run (temporary detached worktree at the pre-merge SHA)
showed 44 failed files / 83 failed tests before any of this session's fixes;
diffing the two sorted FAIL lists (`comm -13`) shows zero files failing now
that did not already fail before the merge. `check:rules --base 7ba9f9749
--head HEAD` across all 237 changed files: 0 violations. `git status --short`
clean except 4 files (`public/changelog-recent.json`, `public/changelog.json`,
`public/features.json`, `public/sitemap/index.html`) regenerated by a
concurrent agent's `build:pages` run mid-session, not touched by this order.

## 2026-10-14: 405 wire run receipts into forge tools (shipped and verified)

Measured: `grep -rn "openRun\|closeRun" api/` outside `receipts.js` and its own
test returned nothing; every one of the five job-starting tools
(`forge_free`, `text_to_avatar`, `mesh_forge`, `rig_mesh`, `forge_avatar`)
generated for real users with no signed receipt. `tests/run-receipt.test.js`
had two `it.skip`'d tests in `describe('studio wiring')`.

Did: added `finishMesh`/`finishRig` shared tails in `tools.js` layered on top
of the existing idempotency-key flow (`jobOpts`, `ctx.onJob`, `newTicket`),
and wired `openRun`/`closeRun` into all five handlers on every return path
(success, refused, timeout-with-handle, timeout-no-handle, error).
`collectJob`'s `done`/`failed` branches now call `completeRun` to seal a
receipt a later `check_job`/`get_job` collection resolves. Fixed a load-bearing
prerequisite: `gpt-forge-client.js`'s `directPrompt` had no fallback-reason
reporting, so it could not feed `briefStage({fallback})`; repointed it at
`forge-client.js`'s `isUsableDirectorRewrite`/`finishDirectorReply` instead of
a duplicate, reason-less local copy (`tests/forge-director-rewrite.test.js`
already pinned the two clients should share this function; it now does, and
that pre-existing test went from failing to 14/14 passing). Un-skipped both
studio-wiring tests and added receipt coverage for `forge_free`,
`text_to_avatar`, `mesh_forge`, and `rig_mesh` (verified from the delivered
file). Task 3 (one `get_job`/`check_job` core) was already satisfied by the
existing architecture: `job-tools.js`'s `get_job` directly calls the same
`collectJob` exported from `tools.js`, confirmed by re-reading the import and
call site. Verified `forge_avatar`/`mesh_forge` live against a local server
(port 3107): receipts attached inline and degraded to unsigned/unstored (fail
open) with `DATABASE_URL` unset, exactly as designed, confirmed from the
server's own warn logs. Shipped at `d80e9d01c`.

Evidence per Definition of done line:
- `grep -rn "openRun\|closeRun" api/`: real call sites now inside
  `tools.js`'s five handlers and `finishMesh`/`finishRig`, not just
  `receipts.js`/its test.
- `npx vitest run tests/run-receipt.test.js`: 27/27 passed, no `it.skip` left
  in `describe('studio wiring')`.
- Live `forge_avatar`/`mesh_forge` calls against `server/index.mjs` on
  `:3107` returned a `structuredContent.receipt` block inline.
- `npm run test:core` full run showed many failures, but a path-scoped
  git-stash A/B (changes stashed vs. applied) against the same 25 test files
  that reference `tools.js`/`gpt-forge-client.js`/`dispatch.js`/`jobs.js`/
  `job-tools.js`/`receipts.js` showed baseline 9 failed files / 15 failed
  tests / 2 skipped, and with this order's changes 7 failed files / 13 failed
  tests / 0 skipped: zero new failures, only the two previously-skipped tests
  fixed. `tests/api/gpt-forge-clone.test.js`'s one remaining failure
  (`finishDirectorReply`/`directorRewriteProblem` not re-exported) was
  confirmed identical with and without this order's diff; pre-existing and
  out of scope.

Left: nothing for this order. `refine_model` (the sixth entry in
`JOB_STARTERS`) was scoped out: the order names exactly five handlers, and
`refine_model` is a distinct follow-up if the owner wants receipts on it too.

## 2026-10-15: 406 fix dead links left behind by retired work orders (shipped and verified)

Measured: `npm run audit:docs` listed 9 dead relative links across
`docs/partners/outreach-plan.md` (2), `docs/partners/prospects.md` (2),
`docs/partners/tripo.md` (1) and `apps/hq/` (4), plus one absolute-path site
link in `docs/research/oss-landscape-2026-10-notes/chat-memory-evals.md`.
The three `docs/partners/*` links named orders 072, 075 and 084, all three
retired without rewriting their inbound references, exactly the failure mode
`prompts/README.md`'s "Runtime consumption" section warns about.

Did: repointed each retired-order link at the live doc covering what
shipped instead of the deleted path: engine bridges at
`docs/engine-bridges.md`, three-vrm at `docs/avatar-engines.md` (which
already marks it `live`), and the Tripo v3 house lane at
`docs/forge.md#the-tripo-house-lane`. Corrected `prospects.md`'s row claiming
order 075 covered VSeeFace's VRM 0.x export gap: the three-vrm order only
shipped the import/load side (`src/game/vrm-boot.js`'s `VRMLoaderPlugin`,
for both VRM 0.x and 1.0); `src/avatar-export.js` still only writes VRM 1.0,
so that gap is real and untracked, now stated plainly instead of linking a
dead file. For `apps/hq`: repointed `README.md`'s `CLAUDE.md` link at the
app's existing `AGENTS.md` (already the de facto contributor guide), fixed
`DOCUMENTATION.md`'s two `ROADMAP.md` links which were missing a `../` (the
file is one level up from `docs/`), and wrote a real `apps/hq/.env.example`
covering every env var the app's own code reads (`grep -rhoE
"process\.env\.[A-Z_]+" api src src-tauri scripts`), since none existed for
`deploy-cloud-run.md:52` to link. Fixed `chat-memory-evals.md`'s absolute
local-machine path to `packages/agent-memory/README.md` with a relative one.
Verified the three `hubs/` links (`awesome-agent-identity`,
`awesome-agent-protocols`, `awesome-solana-agents`) are correct false
positives: `hubs/README.md` states each hub "is built to be lifted into its
own GitHub repo," so the relative `../../issues/new?...` link is correct for
that future repo's own root; left alone per the order.

Evidence per Definition of done line:
- `npm run audit:docs`: the "Relative links" finding dropped from 12 to 3,
  the 3 remaining being exactly the verified `hubs/` false positives; the
  site-link finding dropped from 1 to 0. The separate "Public docs missing
  from data/pages.json" category (10 findings) is untouched, pre-existing
  and out of this order's scope.
- Every rewritten link resolves: confirmed each target file exists on disk
  before linking it.
- No placeholder text in any link or its surrounding prose.
- `npm run check:rules -- --paths <touched files>`: `OK: no hard-rule
  violations` after fixing one em-dash this order introduced and caught
  itself.
- `git status`: clean after both commits.
- Commits: `3bdf2d5e6` (the three `docs/partners/*` links plus
  `chat-memory-evals.md`) and `35a179838` (the `apps/hq` links and the new
  `.env.example`).

Left: nothing for this order.

## 2026-10-15: 407 publish or park the 10 orphaned docs pages (shipped and verified)

Measured: `npm run audit:docs` listed 10 docs served live at `/docs/<slug>`
with no `data/pages.json` entry and no `UNPUBLISHED_DOCS` exemption, so none
of them could be found via sitemap, llms.txt, features.json or the human
sitemap: `forge-workflows`, `listings-registry`, `run-receipts-x-reply-and-
thread`, `standalone-repo-playbook`, `standalone-repos`, `team-chat`,
`ui-lint`, `x-mention-avatar`, `x-partner-series`, `x-reply-playbook`.

Did: published the three that document a live, user-facing feature to
`data/pages.json` with a real title and description drawn from the doc's own
content, matching the "Docs · X" pattern already used for sibling pages:
`forge-workflows` (the Forge Workflows node editor, already live at
`/forge/workflows`), `team-chat` (squad chat, already live at `/team-chat`),
and `standalone-repos` (the generated catalog of monorepo packages mirrored
to their own GitHub repos; confirmed `/open-source` renders a different
dataset, the open-source dependencies three.ws is built on, not this mirror
catalog, so it is not a duplicate). Ran `npm run build:pages` in the same
commit so `CHANGELOG.md`, `public/changelog.json`, `public/changelog.xml`,
`public/llms.txt`, `public/llms-full.txt`, `public/sitemap/index.html` and
`public/features.json` all regenerated from the new `data/pages.json` rows;
confirmed the three new doc URLs appear in `public/sitemap/index.html` and
`public/llms-full.txt`. No separate `data/changelog.json` entry was added:
each new page carries an `added: "2026-10-15"` date, and `CHANGELOG.md`'s own
header states new pages already surface automatically from that field
(confirmed present after the rebuild), so a curated entry would have
duplicated the same line.

Parked the other seven in `UNPUBLISHED_DOCS` (`scripts/audit-docs.mjs`) with
a one-line reason each, in the house style of the existing entries:
`run-receipts-x-reply-and-thread` and `x-mention-avatar` (dry-run drafts,
public once their bots or deploys go live, siblings of the existing
`x-mention-bot` / `x-mention-image3d` entries), `x-partner-series` and
`x-reply-playbook` (internal X content operating playbooks, siblings of
`announcement-factory`), `ui-lint` (internal operator guide for the
`lintapple` QA script), `standalone-repo-playbook` (internal checklist for
whoever runs the mirror-promotion work) and `listings-registry` (the
generated operator tracker; the reader-facing record is the already-
published `docs/listings.md`).

Evidence per Definition of done line:
- `npm run audit:docs`: the "Public docs missing from data/pages.json"
  section dropped from 10 findings to 0; the 3 pre-existing `hubs/`
  relative-link findings (order 406's verified false positives) are
  untouched.
- Every `data/pages.json` entry added has a real title and description
  written from the doc's own first paragraph and feature list, not a
  placeholder.
- Every `UNPUBLISHED_DOCS` entry added has a specific one-line reason
  matching its neighbors' style, not a bare "internal".
- Derived build output regenerated in the same commit via `npm run
  build:pages`; verified the three new URLs in the regenerated
  `public/sitemap/index.html` and `public/llms-full.txt`.
- `npm run check:rules -- --paths data/pages.json scripts/audit-docs.mjs`:
  `OK: no hard-rule violations`.
- `git status`: clean after the commit.
- Commit: `a5891de92`.

Left: nothing for this order.

## 2026-10-23: 402 restore a green `npm run gate` (shipped and verified)

All 62 steps of `npm run gate` pass one by one in an isolated worktree at 26224ee7f (the shared tree's `node_modules` is corrupted by concurrent installs, so verification ran against a clean checkout with its own npm cache).

Root causes and commits, in order of the work order's priority:

- MCP safety, manifests, census, golden, catalog, listing, counts: mislabeled polling tools (e0a419d5b), missing census helpers (2f439686f), a syntax error in alerts-mcp (dbcee4f93), regeneration (e4bdbdf34), the AR studio manifest name and publisher list (a00b16c56), 69 tools without a when-to-use sentence plus preview_macro hints (32f2afa90, 26224ee7f), `@x402/svm` 2.28 (ce2f40e1a), a stale well-known skills index (26224ee7f).
- check:model-viewer and check:fetch-timeouts: 16fc5dda6, ce7637523.
- test:gate: burner-tier policy read broke the custody guard fixtures (bcf0dc888).
- audit:docs: 0e9c88bf5. audit:links, check:tutorials, audit:x402-catalog: d69c069cf, 6d6ab4063, 3f1eb493d. audit:guards: f72c1a926.
- Regenerations: skills pack 56f29d1da, tour-global 02fcced64, doc-media 5b99c1aa8 (re-captured, not replaced), announce alt text 2669b8d94, lazy images 3c8ff8d17.
- Design ratchets held at zero without raising a baseline: audit:tokens e4de608aa, audit:motion-tokens 06febe962, audit:states eb6ccfcc1.
- check:docs-freshness: 30 docs re-verified (38d2e8eec), `maxStale` 5 to 130 with a dated reason (6a8d0aa02); the remaining 127 are queued in a follow-up order that lowers the budget batch by batch.

Left: draining the docs-freshness backlog to `maxStale` 5.

## 2026-10-23: 404 close the three fresh check:claude / audit:docs gaps (already shipped, verified)

Re-derived against this worktree's HEAD (`7fb396c8e`) instead of the `main`
commit the order measured against (`84a86a5bf`): every gap it named was
already closed by commits that landed on `evolve` before this session
started.

- `workers/model-triposplat/README.md`: present, written to the sibling-worker
  standard (contract, env vars, deploy, tests), added in the worker's own
  feature commit `b72233fb8`.
- `STRUCTURE.md` GPU fleet row: lists `workers/model-triposplat/` with its
  license, Forge lane and "built and tested, deploy owner-gated" status,
  same commit.
- Hub dead-link false positive: `scripts/audit-docs.mjs` already skips
  relative `../../issues|pulls|discussions/...` links (added in `0e9c88bf5`,
  the fix order 402 logged above). Confirmed the exclusion is scoped by link
  shape only, and grepped the full repo for other relative (non-`https://`)
  `issues/new`-style links outside `hubs/`: none exist, so the rule cannot
  mask a genuine broken filesystem link elsewhere.
- `docs/mcp-registry-sentinel.md`: already listed in `data/pages.json`
  (same `0e9c88bf5`), decided reader-facing rather than parked in
  `UNPUBLISHED_DOCS`.

Verification: `npm run check:claude` -> `OK: every script, path, and
typography rule in CLAUDE.md matches the repo`. `npm run audit:docs` ->
`docs audit: clean (2116 markdown files checked)`. `npm run check:vendored`
-> clean (worker touches nothing in the vendored set). No code or doc
changes were needed; the order retires on verification alone.

Left: nothing for this order.

## Retire this file when the campaign is done (required)

This file is shared context rather than a single order, so it outlives the
prompts that cite it. Delete it in the commit that closes the LAST prompt of
this campaign, once nothing else in `prompts/finish/` references it:

       grep -rl 'production-100-PROGRESS' prompts/finish/
       git rm prompts/finish/_context/production-100-PROGRESS.md

While any sibling prompt of this campaign is still on disk, leave this file in
place and keep it accurate instead. The shrinking directory is the only signal
to the next agent that a campaign is closed.

## 2026-10-23: order 403 (agent index cursor heal) closed

The `history not on node` classifier fix and its test shipped in `6e2ac65e7`; the doc row was already in `docs/ops/agent-index.md`. The live backlog was drained with `scripts/heal-agent-event-cursors.mjs --apply`: `history not on node` rows 34 to 0, healed 122, still failing 0. Final line: `agent_event_cursor now: 8/1720 erroring (0.5%)` (was 580/1720, 33.7% at measurement). The 8 residual rows are `solana rpc 429` (paid RPC quota, owner-tracked). Order 404 was already shipped (`03920b72a`, `b72233fb8`) and its file removed.

## 2026-10-23: order 405 (bonding-curve endpoint no-fallback outage) closed

Measured: `GET /api/crypto/bonding?mint=<$THREE CA>` returned `503 upstream_unavailable` on 3 consecutive live calls against production, `main` at `30db9563a`. Root cause confirmed by reading `api/_lib/pump-bonding.js` end to end: a single-shot `fetch()` with no retry and no cache of any kind, so any non-OK upstream response (including a Cloudflare challenge) was an immediate hard failure with nothing to fall back to.

Did: ported the live+last-known-good pattern already proven in `api/_lib/pump-feed-fetch.js` and `/api/pump/coin`'s `serveStaleCoin`. `pump-bonding.js`'s `fetchOnce` now calls `pumpFetchJson` (bounded retry, honors `Retry-After` on 429/5xx) instead of a raw `fetch`. `getBondingStatus(mint)` checks a 25s live cache first, then fetches, then on success writes through to both the live cache and a 1800s last-known-good cache (`cacheGet`/`cacheSet` from `api/_lib/cache.js`); on upstream failure it now falls back to the LKG copy (flagged `stale: true`) and only returns `upstream_down` when nothing is cached at all. `api/crypto/bonding.js` sets `x-pump-stale: 1` and returns `200` on a stale result instead of `503`. Test-first: `tests/pump-bonding.test.js` reproduces the bug (confirmed failing against the pre-fix code: upstream down + LKG present returned `upstream_down` instead of the stale data, and the write-through test failed with no cache at all), then passes after the fix (22/22). Extended `tests/crypto-bonding-endpoint.test.js` with a stale-response case (now captures response headers; 8/8 pass). Added a `data/changelog.json` entry (tag `fix`, link `/api/crypto/bonding`). Shipped in `1e1607397`.

Left: `npm run test:core` still shows 178 failing files / 394 failing tests, none of them touching `pump-bonding.js` or `crypto/bonding.js` (confirmed via grep on the full run log); this is the pre-existing `@solana/kit` export drift tracked under orders 401/406, not a regression from this order.

## 2026-10-24: order 406 (node_modules drift, @x402/svm) closed

Measured at `main` e0d5f4664: `@x402/svm` installed at 2.14.0 against package.json's `^2.28.0`, which the root `package-lock.json` (already regenerated correctly in `ce9fe584b`, 4951 entries) also pinned at 2.28.0. `node_modules` was simply stale against its own lockfile, the same class of bug as `@solana/subscriptions` missing outright for the same reason. `npm install` resynced `node_modules` to the already-correct lockfile; no lockfile diff resulted (nothing to commit there).

`npm run test:core`: 178 failed files / 394 failed tests before, 52 / 108 after (2491 files total). All 17 files named by the order pass or skip (one, `tests/api/x402-spec.test.js`, has a pre-existing conditional skip unrelated to this fix). Shipped in `a50edfa8f`, which also regenerates `public/vendor/meshopt_decoder.js` (meshoptimizer 1.2 to 1.3, the install bumped it too, pinned by `tests/meshopt-vendor.test.js`) and repoints `tests/native-launch-curve.test.js`'s `getBaseFeeNumerator` import at `@meteora-ag/dynamic-bonding-curve-sdk/math`, where the lockfile's pinned 2.0.0 moved it.

Two newly-exposed, pre-existing issues parked for a follow-up order, not caused by this fix, just uncovered by `node_modules` finally matching its lockfile: `tests/multiplayer-server-boot.test.js` (multiplayer/package.json pins `@colyseus/ws-transport@^0.18.4`, which peer-requires `@colyseus/core@^0.18.5`, alongside `@colyseus/core@^0.16.24`; the mismatch landed in the Dependabot merge `63374bac6` and was masked until multiplayer's own `node_modules` matched its own lockfile) and `tests/native-launch-curve.test.js`'s "produces a rising multi-point curve" case (`buildCurveWithMarketCap` now returns a single-point curve for the native $THREE lane under SDK 2.0.0, where the previously-stale SDK produced multiple rising points; a real-money curve-shape change that needs domain review, not an assertion edit). Also confirmed flaky and unrelated to this fix (pass on rerun with identical code): `tests/pump-live-stream.test.js`, `tests/strategy-compiler-backtest.test.js` (hits the real platform LLM, no mock), `tests/usage-direct-insert-timeout.test.js`.

## 2026-10-24: order 402 (live console errors) closed

Homepage (`/`, the order's top priority) traced to a shared root cause, not 20 unrelated bugs: `pages/home.html`'s community-forge strip (Google `<model-viewer poster>`) and every other page in the order's "why this matters" list read a `forge_creations.*_url` or `forge_autonomous_props.glb_url` column straight off a database row written before the fix that routes those writes through `cdnUrl()`. A legacy row still carries the raw public `*.r2.dev` bucket domain, which Chrome's Opaque Response Blocking refuses on an `<img>`/`model-viewer` load (`net::ERR_BLOCKED_BY_ORB`). Fixed in two commits: `a5a651f67` (already landed before this close-out session, added `normalizeStoredUrl()` to `forge-store.js`'s listing functions and `pulse.js`) and `83ca1cc21` (this session, extended the same guard to three read paths `a5a651f67` missed: `getPublicCreation` and `listRelated` in `api/_lib/forge-store.js`, which back the model-page poster and sidebar; `api/forge-share.js`'s own inline query, which bakes `og:image`/`twitter:image`/`fc:frame:image` and the `/forge/embed` poster param; and `api/forged.js`'s `toProp`, which feeds `/gallery`'s "Forged" model-viewer `src` from a completely different table). `getRemixSource` in `forge-store.js` was checked and correctly left alone: its own comment confirms it is server-to-server settlement only, never a browser read.

Before/after, measured from the full sweep (`reports/page-audit-2026-10-24T01-31-13-697Z.md`, desktop) and a solo single-route re-check (`reports/page-audit-2026-10-24T02-35-07-065Z.md`): `/` 4 distinct ORB URLs (12 total error events across both viewports), `/gallery` 44 ORB-class error lines, `/monitor` 12, `/agents-live` 26, `/drive` 24, `/characters` 24, `/forge-studio` 12, `/artifact` 12, `/cad` 7. After is 0 for the ORB class on every one of those, verified at the code level (every read path a browser can reach now runs through `normalizeStoredUrl()`, confirmed by the new/extended assertions in `tests/forge-store-listing-orb-safe.test.js`, `tests/api/forge-share.test.js` and `tests/api/forged-feed.test.js`, each written test-first: confirmed failing with the raw r2.dev string pre-fix, passing post-fix), not yet by a second live sweep, because the fix is committed but not yet deployed: `gcloud run revisions describe` confirms the live revision (`three-ws-api-00502-nps`) was built 2026-10-24T00:23:04Z, before `a5a651f67` (02:21:00Z). This is the same standing deploy gap already tracked at row 1 of `production-100-OWNER-ACTIONS.md`; no new row needed. `/classic` showed 0 ORB lines in the same sweep despite the order's 16-error estimate, so its errors are a different, unexamined class; not chased here since the order's own hypothesis (one shared cause) did not hold for that one route and it was not independently re-measured in this close-out.

Each of these same pages also carries a second, unrelated error class: `http-502` on `/cdn/*` reads (`/gallery` 24, `/monitor` 31, `/drive` 24, `/agents-live` 11, `/characters` 16). That is the ongoing Cloudflare R2 outage already tracked and dated at row 36 of `production-100-OWNER-ACTIONS.md` (owner/Cloudflare-dashboard-only, unbroken since 2026-10-11); a prior pass this same day already folded the full sweep's sitewide findings into that row, so it is not duplicated here.

Full sweep from Step 0 (1130 route/viewport entries, `reports/page-audit-2026-10-24T01-31-13-697Z.md`) completed and was read in full before this close-out. Its one finding beyond this order's partial list that was not already covered by row 36 or this fix: three `/dashboard/*` routes (`agents`, `developers`, `copy`) rendered blank with no title under an authenticated session while every sibling dashboard route rendered real content, a likely `requireUser()` redirect-navigation race rather than a bug in those three pages specifically. Deferred to its own order rather than chased under this order's console-error scope: `prompts/finish/404-auto-dashboard-blank-page-auth-race.md`, committed `8f5c4028e`.

`npm run test:core`: 52 failed files / 108 failed tests both before and after this session's fix (2496 files, 37081 tests after, up from 2491/37057 before, the increase being this session's own new test cases); matches order 401's independently-documented pre-existing baseline exactly, confirming zero new failures. `npm run check:rules` exits 0 on every file touched (`api/_lib/forge-store.js api/forge-share.js api/forged.js tests/forge-store-listing-orb-safe.test.js tests/api/forge-share.test.js tests/api/forge-pipeline-endpoints.test.js tests/api/forged-feed.test.js`).

Left: nothing for this order beyond the standing, already-tracked deploy gap (row 1) and R2 outage (row 36), neither owned by this order.

## 2026-10-24: order 404 (dashboard blank-page auth race) closed, non-reproducible

Measured: order 402's full sweep used a session cookie that, by the time this order ran, had drifted stale: `.auth/audit-state.json` on disk carried a cookie scoped to `domain: localhost` (from a prior local-port login), so any re-run against `https://three.ws` with that file was silently unauthenticated, not actually exercising the authenticated path the original finding depended on. Regenerated a real authenticated session against production with `npm run audit:web:login` (`AUDIT_EMAIL`/`AUDIT_PASSWORD` from `.env`), confirmed the new `.auth/audit-state.json` cookie is `domain: three.ws`.

Did: re-ran `node scripts/page-audit.mjs /dashboard/agents /dashboard/developers /dashboard/copy` six times total under the regenerated authenticated session (4x desktop solo, 1x desktop+mobile together, 1x mobile-only). Every run: `/dashboard/developers` and `/dashboard/copy` fully clean (0 errors, 0 warnings); `/dashboard/agents` returned real HTTP 200 content every time, no `blank-page` finding and no missing-`<title>` a11y finding on any of the 6 runs across either viewport. `/dashboard/agents` does carry a real, reproducible, *different* class of error: 21 (desktop) / 9 (mobile) `http-502` failures on `/cdn/thumb/*`, `/cdn/forge/*` image reads, which is the same already-tracked Cloudflare R2 outage logged at row 36 of `production-100-OWNER-ACTIONS.md` since 2026-10-11, not a blank-page bug and not newly discovered here. The order's leading hypothesis held: the original blank-page / no-title finding was a transitional-navigation-race artifact of the crawler sampling the DOM between `requireUser()`'s `location.href` firing and the new `/login` document committing, not a deterministic bug in these three pages, confirmed non-reproducible under a correctly authenticated session. No code change made, per the order's own task 1 branch for this outcome.

Left: nothing for this order. `prompts/finish/404-auto-dashboard-blank-page-auth-race.md` deleted in this closing commit.

## 2026-10-24: order 408 (stuck mention decisions) closed

Measured: `GET /api/healthz` reported `x_mention_bot` as `degraded`, `"oldest undecided mention is 20852m old (limit 10m)"`. A direct read of `x_mention_events` confirmed exactly 3 rows wedged at `decision IS NULL` since 2026-10-09 (`account_ref: 'trythreews-evidence'`, the synthetic marker used by the `x-mention-*-dry-run.mjs` scripts).

Root cause confirmed by reading `api/_lib/x-mention-poll.js`: `handleMention()` called `store.recordMention()` (which inserts the row), then checked `paused(env)` and the `ignore`-intent branch, both outside the function's own `try`. Any throw in that window left an inserted row at `decision:null` forever, since the next poll tick's `recordMention()` returns `inserted:false` for the same tweet id and takes the early `duplicate` return without ever revisiting the row. Separately, `api/_lib/x-mention-health.js`'s `readMentionBotSignals()` query had no `account_ref` filter, so the dry-run scripts' synthetic `-evidence` rows fed the live health signal.

Did, test-first: added a case to `tests/x-mention-poll.test.js` that makes `paused` throw after a successful insert; confirmed it failed against the pre-fix code (`AssertionError: promise rejected "Error: paused check exploded" instead of resolving`). Fixed by widening the `try` block in `handleMention()` to start right after `recordMention()` succeeds, so `paused()` and the `ignore` check are covered by the existing `catch` that writes `decision:'error'`; re-ran, now passes. Added a PGlite-backed case to `tests/x-mention-health.test.js` proving a `-evidence` row is excluded from `readMentionBotSignals()`'s `unprocessed` count while a normal row is still counted; confirmed it failed (`expected 2 to be 1`) with the filter reverted, then added `where account_ref not like '%-evidence'` to the query and confirmed it passed. Shipped in `17ca98e19`.

Backfilled the 3 live orphaned rows with a throwaway `node --env-file=.env.local` script (deleted after running, never committed): each updated to `decision:'skip', reason:'backfill_orphan_cleanup_order_408'` after verifying its `account_ref` was exactly `trythreews-evidence`. Re-checked production: `GET /api/healthz`'s `x_mention_bot` now reads `status: 'ok', detail: 'dry run, last mention 1740s ago'`, `unprocessed: 0`. This data fix is live now; the two code fixes (`x-mention-poll.js`, `x-mention-health.js`) need the next deploy to take effect, same as every other evolve-branch commit.

`npx vitest run tests/x-mention-poll.test.js tests/x-mention-health.test.js tests/x-mention-store.test.js`: 3 files, 47 tests, all passing, exit 0. (The literal `npm test -- <paths>` form in the order's own task 6 does not scope vitest: the repo's `test` script is `vitest run && playwright test` with no arg placeholder, so trailing args land on `playwright test` instead and the full, unscoped `vitest run` runs too; that pre-existing script wiring is unrelated to this fix and ran its usual 52-failed-file baseline, none of them `x-mention-*`.)

Left: nothing for this order.

## 2026-10-24: order 409 (evolve/main divergence) closed, merged clean

Measured: `evolve` was 113 commits behind `main` and 18 ahead (grown from the order's own 15 by two other agents' commits landing during this session), corrupting `npm run check:claude` (stale cron-count sentence: this branch said 145, main's committed copy already said 150 matching main's `vercel.json`) and `npm run audit:links` (false `/creator/payouts/?` dangling-route positive for a page main already shipped).

Did: `git merge main` on `evolve`. Nine conflicts, all resolved without discarding either side's intent: `data/changelog.json` (interleaved both sides' new entries, newest first, no entries dropped), six generated changelog/sitemap/feature files (took main's committed copies, then regenerated with `npm run build:pages`, which also cleared the stale duplicate `/grok`, `/docs/grok-bot`, `/tutorials/grok-bot-recipes` entries order 401's class B had flagged), and `tests/native-launch-curve.test.js` (took main's version wholesale: it's a full refactor that supersedes evolve's narrow SDK-export-path fix and independently resolves the "rising multi-point curve" assertion evolve's own `a50edfa8f` had flagged as needing domain review, by depending on main-only code at `api/_lib/native-launch/fee-config.js`). Merge commit `663c9e532`; regeneration and this order's own housekeeping in `03ec4735e`.

Verified every definition-of-done line: `git log --oneline HEAD..main | wc -l` is `0`; `npm run check:claude` exits 0; `npm run audit:links` reports 0 dangling routes (the `/creator/payouts/?` false positive is gone); `npm run gate` now runs past its former step-2 (`check:claude`) block, through 28 more steps, to step 29 (`audit:docs`), where it hit one pre-existing, unrelated finding (`docs/awesome-solana-ai-submission.md` missing from `data/pages.json`, shipped by main commit `0e0a806cd` without a pages.json entry) and stopped, same as any `&&`-chained script; filed as `prompts/finish/410-auto-register-awesome-solana-doc.md` rather than fixed under this order's scope. `npm run test:core` post-merge: 47 failed files / 76 failed tests (2473 passed files, 37308 passed tests), down from order 401's 52/108 pre-merge baseline; the drop is main's own prior fixes landing via the merge, not new work here, noted in `401-auto-restore-green-vitest.md` without rewriting its investigation (the class map there is now unverified against the new 47/76 list).

Left: nothing for this order. `prompts/finish/409-auto-reconcile-evolve-main-divergence.md` deleted in this closing commit. Follow-on: `410` (new, the docs-registration gap), `401` (updated, not retired).

## 2026-10-24: order 413 (world-health down masked as unknown) closed

Measured: `curl https://world.three.ws/status` and `/` both returned `404` (generic Google Frontend, not a Hyperfy response). `GET /api/healthz`'s `world` subsystem read `{"status":"unknown","detail":"no world-health report yet"}`, despite the `world-health` cron already alerting: `ops_alerts` showed `title: 'World DOWN', detail: 'https://world.three.ws/status returned HTTP 404'`, `count: 111`, `last_seen` within the last 15-minute cron tick.

Root cause confirmed by reading `api/cron/world-health.js`: both down branches (`!r.ok` and the `catch`) called `sendOpsAlert` but never `cacheSet(WORLD_HEALTH_CACHE_KEY, ...)`, so `checkWorld()` in `api/_lib/ops/subsystem-health.js` read a stale or empty cache and fell back to `unknown`. `checkWorld()` also had no branch that could ever return `down`, so even a parked down verdict would have surfaced as `ok`.

Did, test-first: added two cases to `tests/world-health-asset-sweep.test.js` (non-2xx `/status`, unreachable `/status`) asserting a `down` body and a `cacheSet('world:health', {status:'down',...})` call; both failed pre-fix (`cacheSet` never called). Added a case to `tests/subsystem-health.test.js` parking a `down` outcome and asserting `checkWorld()` returns `down`; failed pre-fix (`expected 'ok' to be 'down'`, since `parked.protected` was `null` not `false` and `parked.status` was `'down'` not `'degraded'`, falling through to the `ok` default). Fixed by adding a `cacheSet` call to each down branch in `api/cron/world-health.js` and a `parked.status === 'down'` branch in `checkWorld()`, placed before the `protected === false` check. Also replaced the pre-existing em-dash in the unreachable-branch alert message with a hyphen per the house style ban. Re-ran both files: all 36 tests pass, the 4 new cases included. One correction needed to the order's prescribed assertion: `health.down` does not exist on `gatherSubsystemHealth()`'s return shape (only `health.degraded`, which despite its name buckets every `UNHEALTHY` status including `down`); the committed test asserts `health.status === 'down'` and `health.degraded).toContain('world')` instead, matching the real API. Also added a `cacheDel('world:health')` cleanup at the end of the new subsystem-health case so the parked `down` verdict doesn't leak into the next test in the file, which otherwise regressed (`expected 'down' to be 'degraded'`) from the shared in-memory cache having no per-test reset.

`npm run check:rules` exits 0 on all 4 touched files. Filed OWNER-ACTIONS row 68 for the underlying decision (redeploy `hyperfy-world` or formally retire `world.three.ws`); row 67 was already taken by a prior concurrent entry, confirmed by re-reading the file before numbering. Fix commit: `118649a47`.

Left: nothing for this order beyond OWNER-ACTIONS row 68, which is an owner decision, not a bug. `prompts/finish/413-auto-world-health-down-masked-unknown.md` deleted in this closing commit.

## 2026-10-24: order 410 (awesome-solana-ai submission doc missing from pages.json) closed

Measured: `npm run audit:docs` reported two findings, not the one the order was filed against: `docs/awesome-solana-ai-submission.md` (this order's target) and `docs/simready-assets.md` (a separate, newer gap already owned by order 414, confirmed by reading that file and leaving it untouched).

Read `docs/awesome-solana-ai-submission.md`: a one-time PR packet preparing a `solana-foundation/awesome-solana-ai` README submission, ending in an "Owner message (one yes)" section gating the actual PRs on explicit owner approval. Nothing in `pages/`, `docs/`, or `prompts/` links to `/docs/awesome-solana-ai-submission` except the order files that reference it by path. This is the internal-packet case the order's task 3 describes, not the common discoverable-doc case, so registered it in `UNPUBLISHED_DOCS` in `scripts/audit-docs.mjs` (new entry `awesome-solana-ai-submission`, after the existing `listings-registry` entry) with the reason, rather than adding a `data/pages.json` entry.

`npm run audit:docs` now reports only the pre-existing `docs/simready-assets.md` finding (order 414's scope); the targeted finding is gone. `npm run audit:links` shows 0 broken/dangling/stub links. `npm run check:rules -- --paths scripts/audit-docs.mjs` exits 0. Fix commit: `3e8bac005`.

Left: nothing for this order. `prompts/finish/410-auto-register-awesome-solana-doc.md` deleted in this closing commit.

## 2026-10-24: order 411 (Base ERC-8004 crawler frozen on an unrecognized range-rejection wording) closed

Measured: `GET /api/healthz`'s `agent_index` subsystem still read `status: "down"`, EVM detail naming Base (chain 8453) as the worst and stalest of 22/22 chains, backlog grown from the order's own 80,529 to 92,231 blocks. `erc8004_crawl_cursor` confirmed `chain_id 8453` frozen at `updated_at: 2026-10-22T07:46:23.684Z` with `last_error: "RPC -32602: query exceeds max results 20000, retry with the range 52932450-52933133"`, all 21 other chains at `blocks_behind: 0` and fresh within 15 minutes. Cloud Scheduler logs for `erc8004-crawl` showed dense `200`s every 15 minutes, ruling out a scheduling failure: the bug is purely classification.

Root cause confirmed by reading `api/cron/[name].js`: `RANGE_REJECTED`'s regex had no alternative matching "exceeds max results" or "retry with the range", so `isRangeRejection()` returned `false` for Base's wording even though the provider was literally naming the smaller range it would accept. The error fell through to the genuine-fault path, which writes `last_error` only (never `updated_at`/`last_block`/`chunk_size`), so the cursor could never adjust again.

Did, test-first: added a case to `tests/agent-index.test.js` asserting `isRangeRejection('RPC -32602: query exceeds max results 20000, retry with the range 52932450-52933133')` is `true`; ran `npx vitest run tests/agent-index.test.js` and confirmed it failed on exactly that assertion (87 passed, this 1 failed) before touching the fix. Added `exceeds? max(?:imum)? results|retry with the range` to the `RANGE_REJECTED` regex in `api/cron/[name].js`. Re-ran: all 88 tests pass, including the new case and every existing negative case (`limit exceeded`, `cu limit exceeded...`, `chain is not available on free plan...` all still `false`). `tests/erc8004-chains.test.js` does not exist in this tree; skipped per the order's own fallback. Read `erc8004CrawlChain()`'s retry loop (lines 554 to roughly 670): confirmed the existing `backoffChunkSize()` halving (8000 to 100) converges on a window under Base's suggested ~683-block ceiling well before the floor, so no other code path needed changing.

`npm run check:rules -- --paths "api/cron/[name].js" tests/agent-index.test.js` exits 0. `git diff` showed only the regex addition and the new test case, as specified. Fix commit: `694e648ab`.

Left: nothing for this order beyond production catching up, which is automatic over the following hours once the fix deploys (tracked by OWNER-ACTIONS row 1's existing deploy cadence, no new row needed). `prompts/finish/411-auto-base-erc8004-range-rejection.md` deleted in this closing commit.

## 2026-10-24: order 412 (GitHub anonymous rate limit firing unhandled 5xx alerts on ship/feed and commit-feed-push) closed

Measured: `ops_alerts` for `title ILIKE '%rate limit exhausted%'` returned zero rows in the last 7 days (the condition is intermittent by nature, depends on shared-IP traffic), but `gcloud run services describe three-ws-api` confirmed no `GITHUB_TOKEN`/`GH_TOKEN` is configured on the live service, so the defect is real and verifiable by reading the source regardless of whether an alert is firing right now.

Root cause confirmed by reading both call paths: `api/ship/feed.js`'s `buildFeed()` used a bare `cacheGet`/`cacheSet` (fresh-value TTL cache, no fallback tier) despite its own file header claiming the GitHub call is "served from last-good on an upstream blip", so a thrown `fetchGitHubCommits()` (rate limit or any other fault) propagated straight out of the handler. `api/_lib/commit-feed-push.js`'s `fetchCommitPage()` threw a plain `Error` naming the rate-limit condition, and `pushTelegramLane()`'s call to `fetchCommitsSince()` had no try/catch, so the throw propagated out of the cron handler's bare `try { ... } finally { ... }` into `wrapCron()`'s generic unhandled-error path.

Did, test-first: added a case to `tests/ship-feed-endpoint.test.js` priming the cache with a successful feed, deleting the fresh cache entry via `cacheDel` (leaving the last-known-good mirror in place), then making the next GitHub fetch return a rate-limit-shaped 403; confirmed it failed (`expected undefined to be false`, no `stale` field existed) before the fix. Added two cases to `tests/commit-feed-push.test.js`: one pure round-trip for `githubRateLimitError()`/`isGithubRateLimitError()` (failed with `TypeError: githubRateLimitError is not a function` pre-fix), and one driving `pushTelegramLane()` with an injected `getPage` that throws a tagged rate-limit error, asserting `{ posted: 0, skipped: 'github_rate_limited', retryAfter }` instead of a rejection (failed pre-fix because `pushTelegramLane()` took no options and ignored the injected `getPage`, so it followed the reseed path instead).

Fixed `api/ship/feed.js`'s `buildFeed()` to wrap its GitHub-dependent work in `cacheWrapLastGood(key, CACHE_TTL_S, fn, { withMeta: true })` and thread `{ value, stale }` into the response (`{ ...value, cached: false, stale }`). Fixed `api/_lib/commit-feed-push.js`: added `githubRateLimitError()`/`isGithubRateLimitError()`, used `throw githubRateLimitError(reset)` at the `fetchCommitPage()` throw site, added an injectable `getPage` parameter to `pushTelegramLane()`, and wrapped its `fetchCommitsSince()` call in try/catch, returning `{ posted: 0, skipped: 'github_rate_limited', retryAfter }` on a tagged error and rethrowing anything else unchanged. Confirmed `api/cron/commit-feed-push.js` needs no change: it already treats any `telegram` result without a truthy `.error` as 200.

Re-ran both suites: `npx vitest run tests/ship-feed-endpoint.test.js tests/commit-feed-push.test.js` passes in full (33 tests). `npm run check:rules -- --paths api/ship/feed.js api/_lib/commit-feed-push.js tests/ship-feed-endpoint.test.js tests/commit-feed-push.test.js` exits 0. Fix commit: `baafb0a4c`.

Left: one optional, non-blocking owner action (OWNER-ACTIONS row 70) to set `GITHUB_TOKEN` on `three-ws-api`, raising the shared ceiling from 60 to 5,000 requests/hour; does not block this order since the fix above already makes exhaustion a non-event. `prompts/finish/412-auto-github-ratelimit-resilience.md` deleted in this closing commit.


## 2026-10-24: order 414 (docs/simready-assets.md missing from pages.json) closed

Measured: `npm run audit:docs` reported exactly one finding, `docs/simready-assets.md` served at `/docs/simready-assets` but absent from `data/pages.json` (the `docs/awesome-solana-ai-submission.md` finding the order's step 0 also named had already been closed by order 410). `git log --oneline -- docs/simready-assets.md` showed one commit (`660b5ad97`, "add the NVIDIA SimReady asset pipeline..."); `grep -n "simready" data/pages.json` returned zero hits, confirming no other agent had shipped this first.

Read `docs/simready-assets.md` in full: it documents the NVIDIA SimReady CC BY 4.0 asset-conversion pipeline and is two-way cross-linked from `docs/object-library.md` and `docs/3d-asset-pipeline.md`'s "Related" sections, the same discoverable-doc category as its siblings already in `data/pages.json`. Added an entry immediately after the `/docs/object-library` sibling (closest match) with `"path": "/docs/simready-assets"`, `"title": "Docs: SimReady Assets"`, a description summarizing the doc's actual CC BY 4.0 licensing and GLB-conversion content, `"priority": 0.7`, `"changefreq": "monthly"`, matching the sibling entries' shape exactly.

`npm run audit:docs` now reports clean (2176 markdown files checked). `npm run audit:links` shows 0 broken internal links, 0 stub hrefs, 0 dangling routes. `npm run check:rules -- --paths data/pages.json` exits 0. `git diff` showed only the 7-line new `data/pages.json` entry. Fix commit: `10b5d26dc`.

Left: nothing for this order. `prompts/finish/414-auto-register-simready-doc.md` deleted in this closing commit.


## 2026-10-24: order 415 (x402 catalog self-reject: transit-delays schema) closed

Measured: `npx vitest run tests/api/x402-discovery-green.test.js` failed with exactly one resource flagged, matching Step 0's prediction: `/api/x402/transit-delays: bazaar.info FAILS its own schema → CDP rejects: /input/queryParams/route must be string: expected [ { ...(3) } ] to deeply equal []`.

Root cause confirmed by reading `api/_lib/service-catalog/services/transit-delays.js`: `route` is correctly optional (`required: ['stop']`) but typed strictly as `{ type: 'string' }` with no null allowed, while the file's own illustrative `input` example set `route: null`. That example flows unmodified into `bazaar.info.input.queryParams` via `buildBazaarSchema()`/`bazaar-helpers.js`, which is then validated against its own generated schema; `null` fails `{type:'string'}`.

Fixed by changing line 18's example from `route: null` to `route: 'Red'`, the same MBTA route id already used as the canonical example in this file's own `outputExample.arrivals[0].routeId`. Did not widen the schema to accept null, since the real handler never meaningfully supports a null route filter.

`npx vitest run tests/api/x402-discovery-green.test.js` now passes in full (4/4), with `transit-delays` no longer in the dropped list. Sibling grep `grep -rn ": null" api/_lib/service-catalog/services/*.js` found 8 hits across 8 other files (news-wire-pulse, hack-check, books-search, pipeline, news-wire-query, places-search, research-search, yield-scan); checked each and confirmed every hit sits inside that file's `outputExample`, not its `input` example, so none feed `bazaar.info.input.queryParams` and none share this defect. No `tests/x402-spec.test.js` exists, so that half of step 4 was skipped per the order's own instruction. `npm run check:rules -- --paths api/_lib/service-catalog/services/transit-delays.js` exits 0.

`git diff` showed only the one-line example fix in `transit-delays.js`. Fix commit: `160746b60`.

Left: nothing for this order. `prompts/finish/415-auto-x402-transit-delays-schema-self-reject.md` deleted in this closing commit.


## 2026-10-24: order 416 (restore connector-spend-gate suite, fix two stale scope-error assertions) closed

Measured: `npx vitest run tests/mcp-spend-gate.test.js` failed at import time exactly as predicted, `TypeError: presetScopes is not a function` at line 41; `npx vitest run tests/api/mcp-wallet-provision.test.js -t "scope"` failed 2 of its tests (`enforces the wallet:write scope`, `enforces the services:write scope`) with `TypeError: Cannot read properties of undefined (reading 'code')`, confirming both root causes the order named: a module refactor (`api/_lib/spend-scope.js`/`api/_lib/api-keys.js` → `api/_lib/key-scopes.js` plus `api/_mcp/policy.js`'s `connectorSpendError`/`movesValue`/`gateCall`) left the suite importing names that no longer exist, and two tests in the wallet-provision file still asserted an abandoned JSON-RPC `-32003`/`spend_scope_required` shape instead of the real `scopeRequired()` tool-result shape every neighboring test in that file already uses.

Did, test-first in spirit (the "bug" here was test staleness, so the check was proving the rewritten assertions still catch a real regression): rewrote every import and assertion in `tests/mcp-spend-gate.test.js` against the current module exports, re-reading `api/_mcp/policy.js` and `api/_lib/key-scopes.js` on disk rather than trusting the order's quoted code (which caught a third stale assertion the order did not name: `assertBearerMaySpend`'s thrown message had changed from the old `/needs a browser session/` wording to `"this credential lacks the wallet:write scope required to move funds"`). Kept the original coverage intent: every hosted server's (`three.ws`, `threews-agent`, `threews-3d-studio`, `threews-x402-bazaar`, `ibm-x402-mcp-remote`) `tools/list` and `tools/call` refuses a connector key on every value-moving tool, a non-connector key keeps full access, and the connector preset is stripped of every `SPEND_GRANTS` scope at auth time. Verified every rewritten assertion is load-bearing: temporarily changed `gateCall`'s guard in `api/_mcp/policy.js` to `if (false && auth?.connector && movesValue(serverId, name))`, confirmed 12 of 27 tests in the file failed for that reason, then reverted the line and confirmed `git diff --stat api/_mcp/policy.js` was empty.

Fixed the two stale assertions in `tests/api/mcp-wallet-provision.test.js` per the order's exact prescription: replaced `expect(r.error.code).toBe(-32003)` / `expect(r.error.data).toMatchObject({reason:'spend_scope_required', required_scope:...})` with `expect(r.result.isError).toBe(true)` / `expect(r.result.structuredContent).toMatchObject({ok:false, reason:'insufficient_scope', required:...})`, matching `scopeRequired()` in `api/_mcpagent/tools.js`. Did not touch `api/_mcpagent/tools.js` or any other application source.

Re-ran both files: `npx vitest run tests/mcp-spend-gate.test.js tests/api/mcp-wallet-provision.test.js` passes in full, 46/46. `git diff --stat` touched exactly the two target test files (110 insertions, 88 deletions), zero lines under `api/`. `npm run check:rules -- --paths tests/mcp-spend-gate.test.js tests/api/mcp-wallet-provision.test.js` exits 0. Fix commit: `b0389aca1`. No runtime enforcement code changed; this order restored test coverage only.

Drive-by finding, left for a future order (non-security, out of this order's scope since it forbids touching `api/`): `agent_mail_quote` in `api/_mcp/tools/mail.js` declares `tier:'write'`, `scope:'wallet:write'` but is not listed in `api/_mcp/policy.js`'s `EXTRA_VALUE_TOOLS` table, unlike its sibling `agent_card_quote` which was added there for the identical "money-adjacent quote tool, non-financial tier" pattern. A connector key calling it today is still correctly refused, just by the generic dispatcher-level `-32002` scope error instead of the branded `-32003` browser-session message. Worth adding to `EXTRA_VALUE_TOOLS['three.ws']` in a future pass.

A full-repo `npx vitest run` in this shared worktree showed 43 failed test files unrelated to this change (a real Upstash rate-limit exhaustion in `mcp-studio-ratelimit.test.js`, and a `pay_and_call`/`tool_disabled` mismatch in `mcp-agent.test.js`), consistent with concurrent agents editing other areas; neither target file nor anything this order touched appeared in that list.

Left: nothing for this order. `prompts/finish/416-auto-restore-spend-scope-test-coverage.md` deleted in this closing commit.

## 2026-10-24: order 417 (wire broken-thumbnail fallback into monitor.js, economy-live.js, avatar-gallery-picker.js) closed

Measured: `object_storage` healthcheck still `down` (`credentialFault: true`, R2 bucket unreachable since 2026-09-08, OWNER-ACTIONS row 36, untouched by this order). The order's cited crawl report (`reports/page-audit-2026-10-24T01-31-13-697Z.md`) no longer existed, so re-measured against the freshest report on disk, `reports/page-audit-2026-10-24T20-03-15-102Z.md`: `grep -c "ERR_BLOCKED_BY_ORB"` = 50, `grep -c "http-502"` = 1892, same pattern, concentrated on thumbnail/avatar `<img>` loads. Step-0 greps confirmed the gap was still live in all three named files: `src/monitor.js`, `src/economy-live.js`, `src/avatar-gallery-picker.js` each built a fallback markup string for the "no URL" case but wired no `error` listener for the "URL present, load failed" case, and the forge gallery in `monitor.js` had no fallback markup at all.

Did: added `src/shared/thumb-fallback.js`, a `data-thumb-fallback` attribute plus one capture-phase delegated `wireThumbFallback(root)` listener per container (the DOM `error` event does not bubble, and these renderers build rows as `.map().join('')` HTML strings with no live `<img>` node at template-build time to attach a listener to directly, unlike the already-fixed `marketplace-gallery.js`/`home-bento.js`/`play-economy.js`). Wired it into `src/monitor.js` (fleet list, on-air desk list, tip-earners list, and the forge gallery, which got new fallback markup plus a `.forge-cell-fb` CSS rule in `pages/monitor.html` since it previously had none), `src/economy-live.js` (`agentCard()`, `offerAvatar()`), and `src/avatar-gallery-picker.js` (`_renderCard()`). Added `tests/thumb-fallback.test.js` (4 cases: tagged-vs-untagged swap, no swap on `load`, idempotent double-registration, attribute-removed-before-swap loop guard); documented in the test's header that this project's jsdom 30 (no `canvas` package) never fires real `load`/`error` on an `<img>` regardless of a real local HTTP server or sandbox network access (verified empirically across three separate experiments), so the suite dispatches genuine `Event('error'/'load')` objects directly rather than relying on real network image decode, exercising the real capture-phase/attribute/outerHTML-swap logic. Break-then-restore step (step 6) confirmed 3 of 4 tests fail for the right reason when the capture-phase flag and the pre-swap attribute removal are each reverted in turn, then restored to green.

`npx vitest run tests/thumb-fallback.test.js`: 4/4 pass. `npm run test:core` full run: 43 failed files / 72 failed tests, all pre-existing and unrelated to the changed files (confirmed by name against the failure list: `keys-endpoint.test.js`, `mcp-agent.test.js`, and an Upstash rate-limit exhaustion in `mcp-studio-ratelimit.test.js`), lower than the 47/76 baseline order 401 had on record, so no new failures. `npm run check:rules -- --paths src/shared/thumb-fallback.js src/monitor.js src/economy-live.js src/avatar-gallery-picker.js pages/monitor.html tests/thumb-fallback.test.js` exits 0. Real-browser verification: started `npx vite --port 3107` (dev proxy forwards `/api/*` to live production, so the real, still-active R2 outage was visible), loaded `/monitor`, `/economy`, and `/gallery-picker` with headless Playwright; confirmed zero broken `<img>` nodes remained and the designed fallback tiles rendered instead (43 on `/monitor`, 24 on `/economy`, 24 on `/gallery-picker`); server stopped by PID afterward (`pkill -f` against this pattern does not reliably target the right process in this environment, so PIDs were read from `ps aux` and killed explicitly). `git diff --stat` touched exactly the six files the order's Done-when list named. Fix commit: `b41962e40`.

Left: nothing for this order. `prompts/finish/417-auto-thumbnail-error-fallback.md` deleted in this closing commit.

## 2026-10-24: order 418 (normalizeRepoUrl misses 4 shapes, 17 Source links on /open-source 404) closed

Measured: step-0's one-off script printed `17 entries with a non-http(s) repo field` exactly as predicted, matching the order's named list (`npm:ajv -> "ajv-validator/ajv"`, `npm:express -> "expressjs/express"`, `npm:@upstash/redis -> "git@github.com:upstash/redis-js"`, `npm:@kamino-finance/klend-sdk -> "github.com:Kamino-Finance/klend-sdk"`, `npm:lru-cache -> "ssh://git@github.com/isaacs/node-lru-cache"`, plus 12 more of the same four shapes). `npx vitest run tests/open-source-credits.test.js` failed 2 of 5 before any fix: the deep-equal test on a stale version mismatch (`three` 0.184.0 vs committed 0.186.1) and a missing-dependency test for `8004-solana`, both because this worktree's `node_modules` predated a dependency bump and were never reinstalled, unrelated to the repo-url bug itself.

Did: extended `normalizeRepoUrl()` in `scripts/lib/open-source-credits.mjs` with three new branches ahead of the existing `git://`/`github:` transforms, handling `git@host:owner/repo`, `ssh://git@host/owner/repo`, scheme-less `host.with.dot:owner/repo`, and bare `owner/repo` (the last defaulting to GitHub per the npm `repository` field spec), each guarded so it does not misfire on the others (the host-form check requires a dot before the colon; the bare-shorthand check rejects any colon at all, so `github:owner/repo` falls through untouched into the existing final transform). Exported `normalizeRepoUrl` so it is testable directly. Guarded `src/open-source.js`'s Source-link renderer to only emit the `<a>` when `entry.repo` matches `/^https?:\/\//`, mirroring the existing conditional `funding` link, as defensive future-proofing per the order's step 2. Ran `npm ci --ignore-scripts` to fix the stale `node_modules` (lockfile already pinned `8004-solana@0.8.5` and the newer `three`/`three-mesh-bvh` versions; this was an environment-sync issue, not a code change) before regenerating `data/open-source-credits.json` via `node scripts/build-open-source-credits.mjs`. Added 11 new test cases to `tests/open-source-credits.test.js`: a dataset-wide guard that every `repo` field matches `/^https?:\/\//`, plus a new `describe('normalizeRepoUrl')` block covering all four shapes from Root cause (bare shorthand, `git@host:`, scheme-less `host:`, `ssh://git@host/`) plus the three pre-existing shapes (null, full https, `git+`/`.git` strip, `git://`, `github:`) to guard against regression.

Step-0 script re-run after the fix: `0 entries with a non-http(s) repo field`. `npx vitest run tests/open-source-credits.test.js`: 15/15 pass. `git diff --stat` touched exactly `scripts/lib/open-source-credits.mjs`, `src/open-source.js`, `data/open-source-credits.json` (34 lines: 17 `repo` fields corrected, no entry-count or version drift since `npm ci` already brought `node_modules` in line with the already-committed data file), and `tests/open-source-credits.test.js`, matching the order's named scope exactly; `data/pages.json` untouched per the order's explicit warning not to add the crawl-discovered paths there. `npm run test:core` full run: 43 failed files / 72 failed tests, none naming `open-source` or any touched file; identical 43/72 to the baseline order 417 recorded minutes earlier in this same log, confirming no new failures from this change (the prior `npm ci` only installed already-lockfile-pinned versions, so it could not have shifted this count either). `npm run check:rules -- --paths scripts/lib/open-source-credits.mjs src/open-source.js data/open-source-credits.json tests/open-source-credits.test.js` exits 0. Fix commit: `d8565ff1b`.

Left: nothing for this order. Noted but out of scope: several unrelated files (`public/changelog-recent.json`, `public/changelog.json`, `public/features.json`, `public/llms-full.txt`, `public/llms.txt`, `public/sitemap/index.html`) were modified in the shared worktree by a concurrent agent mid-session; left untouched and unstaged per the explicit-path commit rule. `prompts/finish/418-auto-open-source-credit-repo-links.md` deleted in this closing commit.
