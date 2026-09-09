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

## Retire this file when the campaign is done (required)

This file is shared context rather than a single order, so it outlives the
prompts that cite it. Delete it in the commit that closes the LAST prompt of
this campaign, once nothing else in `prompts/finish/` references it:

       grep -rl 'production-100-PROGRESS' prompts/finish/
       git rm prompts/finish/_context/production-100-PROGRESS.md

While any sibling prompt of this campaign is still on disk, leave this file in
place and keep it accurate instead. The shrinking directory is the only signal
to the next agent that a campaign is closed.
