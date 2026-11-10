# backlog/ progress log

Cross-chat handoff. Append one block per work order attempt: what you measured,
what you changed, what is left, and who owns it. Newest at the bottom.

Format:

```
## <date>: <NN work-order name>
Measured: <the numbers you read, with the command>
Did: <what changed, with commit SHAs or env var names>
Left: <exactly what remains, and who owns it>
```

**Older entries:** [backlog-PROGRESS-archive-1.md](backlog-PROGRESS-archive-1.md) (2026-08-01 to 2026-09-09), [backlog-PROGRESS-archive-2.md](backlog-PROGRESS-archive-2.md) (2026-09-01 to 2026-09-02), [backlog-PROGRESS-archive-3.md](backlog-PROGRESS-archive-3.md) (2026-09-02 to 2026-09-09), [backlog-PROGRESS-archive-4.md](backlog-PROGRESS-archive-4.md) (2026-09-09 to 2026-09-09). They were moved there verbatim on 2026-11-10 to keep every file under the 50,000-character limit; search them too when you need history.

---

## Retire this file when the campaign is done (required)

This file is shared context rather than a single order, so it outlives the
prompts that cite it. Delete it in the commit that closes the LAST prompt of
this campaign, once nothing else in `prompts/finish/` references it:

       grep -rl 'backlog-PROGRESS' prompts/finish/
       git rm prompts/finish/_context/backlog-PROGRESS.md

While any sibling prompt of this campaign is still on disk, leave this file in
place and keep it accurate instead. The shrinking directory is the only signal
to the next agent that a campaign is closed.

## 2026-09-09 (second pass): 05 R2 bucket CORS

Re-measured all three surfaces independently, raw `curl` plus
`node scripts/set-r2-cors.mjs --probe`, no bucket credentials:

| Surface | Result |
|---|---|
| Site edge `three.ws/avatars/*.glb`, `Origin: https://example.org` GET | PASS. `200`, `access-control-allow-origin: *`, `access-control-allow-methods: GET, HEAD, OPTIONS`. |
| Site edge, same route, `OPTIONS` preflight | PASS. `204`, `access-control-allow-origin: *`, `access-control-allow-headers: range`. |
| Public bucket host `pub-*.r2.dev`, real `200` object | FAIL. `example.org` gets no `access-control-allow-origin`; `three.ws` gets `Access-Control-Allow-Origin: https://three.ws` with `Vary: Origin`. The differential is the proof the live read rule is still the old allowlist. |
| Presigned `PUT` preflight on `chatty-storage.<account>.r2.cloudflarestorage.com` | FAIL for anything off the allowlist. `204` for `three.ws` (`Access-Control-Allow-Methods: GET, PUT, HEAD, POST, DELETE`, one combined rule); bare `403` for `www.three.ws`, `localhost:5173`, `example.org`. |
| First-party `three.ws/cdn/<key>` and `three.ws/api/glb?src=`, foreign origin | PASS, `access-control-allow-origin: *` on both, including `/api/glb` over a `pub-*.r2.dev` source. Both documented mitigations are live. |

So the item does not close: the bucket policy is still the pre-split allowlist and
applying the fix needs the admin token. `--get` prints the credential steps and exits
cleanly rather than crashing; `.env`/`.env.local` still hold no R2 token, and `gcloud`
auth is expired in this session so Secret Manager could not be re-read from here.
The two doc lines in the work order were verified, not redone: the script header warns
against `vercel env pull` and names `.env.local` plus `read-service-env.mjs` instead,
and the `/api/glb` docs state per-host when the proxy is needed.

Did:
- Closed ISSUES.md item 10, the object-storage credential fault filed earlier the same
  day. Every symptom is gone: `object_storage` is `ok` (`signed read ok, 216ms`),
  `POST /api/forge-upload` is `200` with a presigned URL, `/api/avatars/library` and
  `/api/objects/library` return 107 and 511 entries, `forge_generation` is `ok` at 95%
  (60/63, 6h). Moved to the closed section with the recurrence note, since nothing in
  this repo changed and the fix is always that one Secret Manager value.
- Refreshed item 9: added the `/api/glb` row to its measured table, dated the
  no-local-token check to today, and removed the now-stale "fix the storage secret
  first" ordering. One credential is the whole remaining blocker.
- Updated this pack's index row for 05 to match.

Left: one owner action. Mint an "Admin Read & Write" R2 token for `chatty-storage`,
put it in `.env.local` as `R2_ACCESS_KEY_ID`/`R2_SECRET_ACCESS_KEY`, run
`node scripts/set-r2-cors.mjs`, confirm with `--probe`. The work order stays on disk
because its "policy applied" line is that action.

## 2026-09-09 (15:00 UTC): 09 telegram-bots-durability (re-verified after the fix, one gate left)

Measured, independently of the earlier pass in this file and without `gcloud`,
which is unusable in this codespace: every call answers `Reauthentication failed.
cannot prompt during non-interactive execution`, and the org reauth policy cannot
be satisfied non-interactively. So the work order's own `/stats` recipe could not
run, and the feeds were confirmed from the public Telegram surface instead, which
is the stronger signal anyway: a post proves the deployed service decoded a real
event and delivered it, not merely that a container is `Ready`.

- Firehose `@pumpfunclaimed` (`-1003905427189`): posting continuously, four posts
  in the four seconds around 14:50:58 UTC, latest content a
  `CLAIMS DIGEST last 1m 20 claims $57 total` with per-claim rows. That is the
  ~20 claims/min baseline this order set, hit on the nose, eight hours after the
  fix deployed.
- Tracker `@trackpumpfun` (`-1003965305979`): a supergroup, so `t.me/s/` returns
  302 and the id-embed walk is the way in. 16 posts in 187 s (ids 67971 to
  67987), latest content a decoded launch with market cap, dev launch count and
  chart links.
- Neither is a local process: no `node` under `pump-fun-sdk` in `/proc/*/cwd`,
  and `localhost:3900` and `3901` both refuse the connection. Cloud Run is the
  source.
- Both channels answer `getChat` on their numeric ids with distinct titles and
  usernames, so the separate-identity line still holds.

Re-checked in the sibling repo at `2a12ec3a` (HEAD, clean worktree): the endpoint
list, the 20-second traffic-based liveness check, the rotating reconnect in both
`claim-monitor.ts` and `channel-bot/src/event-monitor.ts`, the cleared heartbeat
timer, and `activeWs`/`wsEventsReceived` on `/stats` are all present. Test counts
match the claim exactly: 95 passing in allclaims (7 files), 205 in channel-bot
(14 files). Both `.env` files carry the publicnode plus mainnet-beta lists with no
magicblock. Both deploy scripts pin the build and runtime service accounts and use
`--env-vars-file`, never `--set-env-vars`. `DECODERS.md` records the canonical
copy and now the matching transport rule.

Did: added the `gcloud`-free verification recipe to the work order's Verify
section, since the documented one is unusable on a recycled codespace and its
absence is what would stall the next person, plus the re-proof line on the first
definition-of-done box.

Left: one owner action, the last box on that order. Approve committing the
launchpad-referencing update into three.ws under the coin gate. Nothing technical
remains; the code and the deploys landed in the sibling repo, which the gate
exempts.

## 2026-09-09 (third pass): 05 R2 bucket CORS

Re-measured all three surfaces a third time, independently, raw `curl` plus
`node scripts/set-r2-cors.mjs --probe`, no bucket credentials. Every row is
unchanged from the two earlier passes today.

| Surface | Result |
|---|---|
| Site edge `three.ws/avatars/cesium-man.glb`, `Origin: https://example.org` GET | PASS. `200`, `access-control-allow-origin: *`, `access-control-allow-methods: GET, HEAD, OPTIONS`. |
| Site edge, same route, `OPTIONS` preflight | PASS. `204`, `access-control-allow-origin: *`, `access-control-allow-headers: range`, `access-control-max-age: 86400`. |
| Public bucket host `pub-*.r2.dev`, real `200` object | FAIL. `example.org` gets no `access-control-allow-origin`; `three.ws` gets its origin echoed with `Vary: Origin`. |
| Presigned `PUT` preflight on `chatty-storage.<account>.r2.cloudflarestorage.com` | FAIL off the allowlist. `204` for `three.ws` (`Access-Control-Allow-Methods: GET, PUT, HEAD, POST, DELETE`, one combined rule); bare `403` for `www.three.ws`, `localhost:5173`, `example.org`. |

The probe's own drift table names five origins the live policy refuses that the
script's policy would allow: `www.three.ws`, `*.app.github.dev`, `localhost:5173`,
`example.org`, `localhost:8080`.

Credential routes re-checked and all still shut: `.env` holds three keys and none
is an R2 or Cloudflare one, `.env.local` holds no `R2_*`/`CLOUDFLARE_*`/`S3_*`
variable, and `gcloud` answers `Reauthentication failed. cannot prompt during
non-interactive execution` on every call, so Secret Manager cannot be read from
here either. The two doc lines of the definition of done were verified rather
than redone: the script header warns against `vercel env pull` and names
`.env.local` plus `read-service-env.mjs` instead, and `docs/media-api.md`,
`docs/character-library.md` and both embed tutorials say per-host when `/api/glb`
is needed and when a direct fetch is fine.

Found and fixed what three measurement passes had walked past: **the narrow
allowlist was breaking a first-party origin.** `www.three.ws` resolves to the
same load balancer as the apex (`136.68.246.178` for both), is on the managed
cert, and served the identical app with a `200`, but the bucket echoes the apex
alone. So `https://www.three.ws/api/avatars/library` handed the browser
`pub-*.r2.dev` GLB URLs and every one of them was blocked: an `<img>` thumbnail
survives without CORS, a GLTFLoader fetch does not, so 3D was simply dead on that
host while looking healthy on the apex. Measured on one object the same day:
apex gets `Access-Control-Allow-Origin: https://three.ws`, www gets no header.

Did:
- `server/index.mjs` redirects the whole www host to the apex, 301 on GET/HEAD
  and 308 on everything else so an API write keeps its method and body. The
  target is re-parsed through `new URL(req.url, CANONICAL_ORIGIN)` rather than
  concatenated, so an absolute-form request target cannot smuggle an origin in.
  This needs no bucket credential and matches what the site already declared:
  `server/seo-head.mjs` pins every canonical URL to `https://three.ws`, and the
  page served on www already carried `<link rel="canonical" href="https://three.ws/">`.
- Exported that pinned origin as `CANONICAL_ORIGIN` from `server/seo-head.mjs`
  so the redirect and the canonical tags cannot drift apart.
- `tests/server-canonical-host.test.js` (8 tests, all passing): the redirect,
  query preservation, the port and case forms of the Host header, the 308 on a
  POST, the absolute-form target, and that the apex, `dev.three.ws`, `localhost`
  and a `*.run.app` host all pass through untouched.
- Runbook row in `docs/ops/gcp-production.md` under DNS / TLS / CDN, ISSUES.md
  item 9 refreshed with the finding and this third measurement, and a
  `data/changelog.json` entry (`npm run build:pages` regenerated the feeds).

Verified: `npm run audit:docs` clean (1593 files), `check:rules` clean on every
touched path, the new suite plus `server-media-cors-preflight`, `server-404-routes`,
`server-rewrite-query`, `seo-head` and `ssr-pages` all green run per suite. Two
`server-rewrite-query` tests time out when three server-spawning suites run in one
vitest invocation and pass alone; the endpoint answers in 22ms against a
hand-started server, so that is harness contention, not this change.

Left: the same one owner action, unchanged. Mint an "Admin Read & Write" R2 token
for `chatty-storage`, put it in `.env.local` as `R2_ACCESS_KEY_ID` /
`R2_SECRET_ACCESS_KEY`, run `node scripts/set-r2-cors.mjs`, confirm with `--probe`.
The work order stays on disk because its "policy applied" line is that action.
The www fix removes the largest real-user consequence of the wait; third-party
embeds still need `/cdn/<key>` or `/api/glb` until the policy is applied.

## 2026-09-09 (third pass): 01 x402 settle runway, the hint named the wrong mechanism

Re-measured live, nothing carried forward. Production is still `880bdcef8`,
revision `three-ws-api-00420-ljh`. `gcloud` auth is dead in this codespace this
session (`Reauthentication failed` on `read-service-env.mjs`), so `CRON_SECRET`
was unreadable and the `treasury-topup?dry=1` plan could not be run from here.
Everything below came from public endpoints and public Solana RPC.

| Fact | Value | Source |
|---|---|---|
| `x402_settle` | **down**, 0.0% (0/132 paid attempts, 3h), `cause: sponsor_floor` | `/api/healthz` |
| Sponsor / economy master `Wwwu...T3WwW` | **1,157,626 lamports**, spendable 0, floor 2,000,000 | `getBalance` + `/api/x402/runway-lab` |
| Shortfall to the floor | **842,374 lamports (0.000842 SOL)** | same |
| Ring payer `X4o2...stML` | 812,444 lamports, 4.163 USDC | `/api/x402/runway-lab`, `/api/x402-ring` |
| Treasury `wwwww...ccrU` | 0.06 USDC, SOL fenced behind `minSol` 0.1 | `/api/x402-ring` |
| Settle rejects since boot | `fee_wallet_below_floor` 164, `broadcast_failed` 1; `fee_runway_exhausted` **absent** | `/api/healthz` |
| Verify rejects since boot | `simulation_failed` 1,835 of 1,835 | same |
| Last settlement on chain | 2026-09-08T21:47:36Z | `/api/x402-ring` `recent[0]` |
| Observed fee per settle | 5,033 lamports (`observed_median_24h`) | runway-lab |

The sponsor drained a further 10,002 lamports since the second pass today, which
is two settle-fee attempts. DoD line 2 still passes: `fee_runway_exhausted` does
not appear in the reject book at all.

### The finding: the outage hint described the opposite mechanism

`diagnoseSettleDrop()` fires `cause: sponsor_floor` on `floorSignals > 0` OR the
withdrawn-accept shape, and then printed ONE hint for both. Its opening sentence
asserted the withdrawal unconditionally:

```
The Solana accept is being WITHDRAWN, not rejected: 0 no_solana_accept + 25 floor
refusal(s) against 132 rail faults. ... Do NOT start at the facilitator.
```

Read the counter it prints in its own first clause: **0 no_solana_accept**. The
accept was not withdrawn. Tracing the ring's own recorder settles it: in
`api/_lib/x402/pay.js` a 402 probe carrying no Solana accept returns
`no_solana_accept` and never builds a transaction, while `http_402` can ONLY be
produced on the paid replay (line 553), after the ring parsed a real accept,
signed a real payment, and had it rejected. 126 of the window's 132 faults were
`http_402`. So every one of those calls got a payable Solana accept, signed, and
was turned away by **our own facilitator** at the floor gate.

The detail row an operator reads first was self-contradicting in a single clause:

```
; Solana accept withdrawn (0 no_solana_accept, sponsor under SOL floor)
```

And the hint's "Do NOT start at the facilitator" pointed away from the one table
that names the wallet and both numbers, `fee_wallet_below_floor:1167627<2000000`
in `x402_self_facilitator_log.reject_reason`. In the genuinely withdrawn regime
that instruction is correct (with no accept on the challenge the facilitator
never saw those calls); in this one it is exactly backwards. Same
`cause: sponsor_floor`, same wallet, same remedy, opposite evidence trail.

This is the third instance of the same defect shape found on this order: one
string covering two opposite operator situations (`at_or_below_floor` fenced vs
empty, `simulation_failed` sponsor vs buyer, and now withdrawn vs refused).

### Landed (`30e83da5c`, no funds moved, no config changed, deployable)

- `diagnoseSettleDrop()` returns a `mechanism`: `accept_withdrawn`,
  `settle_refused`, `paced` or `rail`. The `sponsor_floor` branch picks its
  opening sentence from it; the shared funding remedy paragraph
  (`treasury-topup`, `agent_reclaim.failed`, `secret_undecryptable`,
  `skipped_floor_held_sol 0`) is byte-identical across both, because the fix
  really is the same. The refused text says START at the facilitator and names
  the reject-book token to read.
- Both signals lit resolves to `accept_withdrawn`, the harder stop: a call that
  never carried a payable accept never reached the reject book, so a
  facilitator-first instruction would under-count the outage.
- `classifySettleBuckets()` carries `mechanism` through all four verdicts
  (including the two `attempts < minAttempts` early returns) and the detail row
  now prints `N settle(s) refused at the fee-wallet floor (accept still
  advertised)` instead of a withdrawal beside a zero counter.
- Six tests in `tests/api/x402-settle-health.test.js` built from today's exact
  production bucket shape (126 `http_402`, 6 aborted, 25 floor refusals): the
  refused verdict, the detail row never claiming a withdrawal beside a zero
  counter, the withdrawn wording preserved, the flapping both-signals case, the
  identical remedy in both hints, and `paced`/`rail` keeping their own mechanism.
  72 green across the 3 suites that import the module, 122 green across those
  plus the economy suites (`economy-master-sponsor-floor`, `economy-sweepback`,
  `economy-ledger`).
- One pre-existing test (`the sponsor-floor hint refuses to promise a self-heal
  ...`) asserts the hint says "sponsor"; the refused branch names the sponsor
  wallet and `X402_SPONSOR_SOL_FLOOR_LAMPORTS` explicitly rather than weakening
  the assertion.
- `docs/ops/production-log-triage.md` gained "The third variant" with a
  four-row mechanism table and today's numbers. `npm run audit:docs` clean
  (1,593 files). `data/changelog.json` entry added (`fix`, `infra`),
  `npm run build:pages` regenerated the feed.
- `npm run check:rules -- --paths <the 4 touched files>`: clean.

A follow-up (`019277358`) closes a gap the runbook edit created: `mechanism` was
computed in the classifier but `readSettleHealth()` builds its `metrics` object
from an explicit field list, so the field never reached `/api/healthz` and the
new table pointed at something that was not in the payload. It is listed now, and
a test reads the metrics block to pin the wiring so the next classifier field
cannot go missing the same way. 73 green across the 3 importing suites.

The commit stages four paths only. A peer's in-flight `www.three.ws` changelog
entry was in the shared working tree, so `data/changelog.json` was committed as a
clean blob built from HEAD plus this entry alone, and the regenerated feed
artifacts were deliberately left uncommitted for whoever lands that entry; the
build regenerates them at deploy time either way.

### Still open, unchanged, and still one owner decision

Nothing here changes what settles. The sponsor is **0.000842 SOL** under its
floor. Both options move SOL, so both are stop-and-ask gate 1:

1. Release the fenced platform SOL: lower `pump-x402-launcher`'s `minSol` from
   0.1 to about 0.02 in `api/_lib/solana-signers.js`, then run
   `POST /api/cron/treasury-topup` without `?dry=1`. Path `wwwww...ccrU` to
   `Wwwu...T3WwW` to `X4o2...stML`. No owner capital.
2. Send SOL to `WwwuGbqHrwF5RG89KhUbmRWEvjnRH9k5kVM5p7T3WwW` and nowhere else.
   0.1 SOL restarts settlement; 2 SOL clears the fleet deficit with real runway.

DoD lines 1 and 3 stay open behind that decision (line 3 additionally needs
`CRON_SECRET`, which needs `gcloud` re-auth in this codespace). Line 2 passes.
Lines 4 to 6 are done. The prompt file stays on disk.

## 2026-09-10 | 05-r2-bucket-cors | CLOSED, order retired

**The credential was never missing.** Six weeks of passes filed this as blocked on the owner
minting an "Admin Read & Write" R2 token, on the finding that the only `S3_*` pair reachable from
this machine was object-scoped and answered `403 AccessDenied` on `GetBucketCors` and
`PutBucketCors`. The pair resolved off the Cloud Run service, through the Secret Manager reference
that `gcloud run services describe` prints as `valueFrom` rather than a value, is admin-scoped:

    node scripts/read-service-env.mjs '^S3_(ACCESS_KEY_ID|SECRET_ACCESS_KEY|BUCKET|ENDPOINT|PUBLIC_DOMAIN)$'

`--get` read the live policy on the first try. The general lesson is the CLAUDE.md credential row:
a credential is not missing until the service's Secret Manager references have been resolved, and
"the local copy is object-scoped" says nothing about the production copy.

**Measured before, on the bucket's own host, real key, foreign origin:** `GET` returned `200` with
no `access-control-allow-origin` (so a browser downloads the bytes and discards them) and its
`OPTIONS` preflight was a bare `403`. `Origin: https://three.ws` got its own origin echoed, which
is how the live rule was known to be the old allowlist.

**Applied:** the canonical policy already in `scripts/set-r2-cors.mjs`, split as designed into
`public-read` (GET/HEAD, `AllowedOrigins: ['*']`) and `browser-upload` (PUT, origin-locked).

**Measured after:** foreign-origin `GET` returns `access-control-allow-origin: *` with the
`ExposeHeaders` set; foreign-origin `OPTIONS` returns `204` with `Access-Control-Max-Age: 86400`;
a `three.ws` PUT preflight returns `204` for `PUT`; the site edge is unchanged. Then
`node scripts/set-r2-cors.mjs --probe`, which needs no credentials at all, exited 0 with all nine
probe origins matching expectations.

**Side effect worth naming:** this also fixes a FIRST-party breakage. `www.three.ws` served the
app but had every GLB blocked by the browser, because the bucket echoed only the apex. It now
reads and writes. The `server/index.mjs` www-to-apex redirect stays correct and ships independently.

**Docs corrected in the same change,** because they all documented the workaround as permanent:
`docs/media-api.md` (the "when you need the proxy" table now says a direct fetch is the default and
names the two cases the proxy still serves), `docs/character-library.md`,
`docs/tutorials/character-library-to-embed.md` (Step 6 was an entire step built on the failure, now
a confirmation with the stale-policy case kept as a fallback), and
`docs/tutorials/render-avatar-images.md`. `/api/glb` and `/cdn/<key>` were deliberately NOT removed:
the proxy is still right for a URL on a host that is not ours, and `/cdn/<key>` is still the
cheapest path for our own objects. `docs/model-diff.md` needed no change, its claim is about
arbitrary third-party CDNs. `npm run audit:docs` clean across 1,599 files; `docs/ALL.md` regenerated.

**ISSUES.md** item 9 moved to the closed section with the evidence above.

## 2026-09-10 | cross-lane finding | the free LLM chain was full of retired model ids

Found while looking for a translation lane that Vertex's billing hold does not cover. Checked
every NVIDIA-routed model id in the tree against the live catalog
(`GET https://integrate.api.nvidia.com/v1/models`). Most were dead, all answering `410 Gone`:
`meta/llama-3.3-70b-instruct` (EOL 2026-08-26), `nvidia/nv-embedqa-e5-v5` (EOL 2026-08-25),
`nemotron-3-nano-30b-a3b`, `llama-3.3-nemotron-super-49b-v1.5`, `nvidia-nemotron-nano-9b-v2`
and `meta/llama-4-maverick-17b-128e-instruct`. Fixed in `4dbe02cc7`.

**Why nobody noticed, and why it still cost something.** A fallback chain cannot distinguish
`410 Gone` from a rate limit: it moves on. No outage is logged and every surface still answers.
But each dead id consumed one of a deliberately small number of retry slots, so the chain
reached its paid backstop, or gave up, sooner and more often than designed. This is the kind of
rot that only a live-catalog audit finds; reading the code tells you nothing.

The embedding half is the one with state. `NIM_EMBED_TAG` now points at
`nvidia/nemotron-3-embed-1b` at 2048 dims (measured from a live call, not assumed), and the old
1024-dim tag stays in the registry as `NIM_EMBED_TAG_RETIRED`, resolvable forever but reporting
`configured: false` so it is never chosen for new work. Rows written before today keep resolving,
which is the whole point of the tagging scheme. Vectors are jsonb, not pgvector, so the dimension
change needed no migration.

`api/_lib/rerank.js` is deliberately left pinned to a model verified dead: the stage is opt-in
behind `KNOWLEDGE_RERANK_ENABLED`, which is unset on the service, and `rerank()` fails open by
contract. A verified-dead pin with a comment beats an unverified guess.

**Working lanes as of today:** NVIDIA (free, the one that works), Groq (key valid but capped at
200k tokens/day, far too small for bulk), OpenAI (`billing_not_active`), Google Vertex AND the
Generative Language API (both denied project-wide by the same dunning hold, so ISSUES item 1 and
the fact-check order's row 20 share one cause).

## 2026-09-24 | 01 x402 settle runway | settle is ok again; the reject book was a caller-gate leak

Re-measured live against production `c8f10f437` (revision `three-ws-api-00458-njs`) at
06:32 UTC, nothing carried forward. Since the 2026-09-09 pass the sponsor was refunded
(1,157,626 lamports then, 31,994,962 now), so the regime changed from floor refusals to
governor pacing.

| Fact | Value | Source |
|---|---|---|
| `x402_settle` | **ok, 92.2%** (235/255 paid attempts, 3h), 900 paced by the fee governor | `/api/healthz` |
| Facilitator settle rejects, 24h | `fee_runway_exhausted` **40,939**, `broadcast_failed` 33, `signature_already_settled` 33, `settlement_pending` 22, `idempotent_replay` 17; settled 4,341 | `x402_self_facilitator_log` grouped by reason class |
| Hourly shape | ~230 settled and ~1,700 refused every hour, one buyer (the ring payer), all day | same, by hour over 30h |
| Sponsor / economy master `Wwwu...T3WwW` | 0.031995 SOL (runway-lab), 0.034730 SOL (treasury-topup a minute later) | both endpoints |
| Governor | pacing ON, `runway_days` 1, min budget 10,000,000; 8,960,879 spent by 06:32 | `/api/x402/runway-lab` |
| Fee per settle | 10,001 lamports (`observed_median_24h`); 24h burn 48,813,416 lamports = **0.0488 SOL/day** | runway-lab |
| `treasury-topup?dry=1` | `master_deficit_sol` **0.27508**, `spendable_sol` 0.00273, plan `[]` (`master_insufficient_spendable` for both targets), reclaim moves `[]`, agent_reclaim moves `[]`, 2 `secret_undecryptable` (Atlas #22 0.0684, Echo #22 0.0545) | cron dry run |

### Findings and fixes (`22f1e08df`, no funds moved, no config changed)

1. **The caller-side admission gate leaked under pacing.** A fresh read cached "yes" for
   20 seconds. With pacing on, the unlocked budget sits at the spent line all day, so each
   read found room for about one settle and then admitted every call in the window: about
   1,700 an hour reached the settle-path meter and were refused there after an ATA read, a
   signature and a simulated verify. That is why `fee_runway_exhausted` was back on top of
   the reject book while `x402_settle` itself read ok. Admissions now spend their fee from
   the snapshot's headroom with the same pure arithmetic, concurrent callers share one
   in-flight read, and the first call past the headroom becomes the cached refusal. Four
   new tests in `tests/x402-fee-admission.test.js`.
2. **`/api/x402/runway-lab` undercounted refusals about a hundredfold.** It grouped on the
   full reject string (which carries per-call lamport arithmetic) under `LIMIT 40`, so it
   counted 391 of 40,987 governor refusals and reported `capacity_admission_rate` 0.917
   for a rail admitting 0.096. It now groups by reason class in SQL; verified against the
   production table.
3. **A fourth instance of the one-string-two-situations defect.** 31 agent wallets read
   `at_or_below_floor:0.019334483<0.01`, a reason whose own numbers disprove it. They sit
   above their keep line with excess under `ECONOMY_SWEEPBACK_MIN_SOL` (0.01). They now
   read `below_min_sweep:<excess><<min>`, with `excessSol`; the settle-health and
   sponsor-runway hints and both runbooks name the class. Total excess across them:
   **0.161 SOL**.

Verification: 2,227 tests green across the 185 x402/economy/treasury/sweep suites;
`npm run test:gate` green; `check:rules` clean on all touched files; `audit:docs` has no
findings in touched docs. `npm run gate` is red on two peers' files only
(`check:model-viewer` on `src/erc8004/register-ui.js` pinning 4.3.1, and
`check:fetch-timeouts` on `api/_lib/sandbox/clients/node/three_ws/index.js:98`), plus
five README-less directories under `packages/` and `workers/`; none are touched here.

### DoD after this pass

1. `x402_settle` ok above 90%: **passes** (92.2%, 3h window).
2. `fee_runway_exhausted` not the top reject class: **fails until `22f1e08df` is deployed**
   (it moves those refusals from the facilitator book to caller-side governor skips).
3. Non-zero deficit AND non-zero reclaim plan: deficit passes (0.27508), plan is empty.
4. to 6. Recurrence guard, changelog, PROGRESS: done.

### Owner actions (stop-and-ask gate 1 and gate 2)

- **Deploy** `22f1e08df` (runbook in CLAUDE.md, `npm run deploy:gcp:full` from a prepared
  worktree), then re-read the reject book after 3h.
- **Fund the fee wallet before it hits its floor.** At 0.0488 SOL/day against about 0.030
  SOL spendable above the 0.002 SOL floor, and with `runway_days` 1 letting the governor
  spend it all in a day, the sponsor reaches its floor in under a day and `x402_settle`
  returns to `down / sponsor_floor`. Send SOL to `WwwuGbqHrwF5RG89KhUbmRWEvjnRH9k5kVM5p7T3WwW`
  only: about **0.7 SOL** buys 14 days of settle fees; about **1.39 SOL** also lifts the
  master to its 0.3 SOL operating reserve (0.265) and fills both treasury-topup targets
  (relayer bundle `wwwq...HGUn` 0.00496 to 1.0, ring payer `X4o2...stML` 0.04989 to 0.18).
- **Free alternative for part of it:** lowering `ECONOMY_SWEEPBACK_MIN_SOL` (for example to
  0.001) lets the armed reclaim cron sweep the 0.161 SOL of `below_min_sweep` excess back to
  the master. It is a config change whose effect is an automatic SOL move, so it is the
  owner's call, not a pre-approved config tweak.

## 2026-09-25 | 01 x402 settle runway | settle still ok; the top rail fault was paid forge calls the ring abandoned

Re-measured live against production `c8f10f437` (revision `three-ws-api-00458-njs`, so
`22f1e08df` is still not deployed) at 05:13 UTC.

| Fact | Value | Source |
|---|---|---|
| `x402_settle` | **ok, 92.6%** (224/242 paid attempts, 3h), 923 paced by the fee governor; top faults `This operation was aborted` 17, `rpc_preflight_failed` 1 | `/api/healthz` |
| Facilitator settle rejects since boot | `fee_runway_exhausted` **42,760** of 42,784; settled 3,403 | `x402.self_facilitator` on `/api/healthz` |
| Sponsor / economy master `Wwwu...T3WwW` | **0.019011 SOL**, spendable 0.017011 (was 0.031995 on 09-24) | `/api/x402/runway-lab` |
| 24h fee burn | 27,602,800 lamports = **0.0276 SOL/day** at a 10,000 lamport median | runway-lab |
| `treasury-topup?dry=1` | `master_deficit_sol` **0.290989**, `spendable_sol` 0, plan `[]` (`master_insufficient_spendable` for both targets), reclaim and agent_reclaim moves `[]`; agent wallets still read the pre-`22f1e08df` `at_or_below_floor:0.0193<0.01` wording | cron dry run |

### Finding and fix (`fb533a6ec`, swept in by a peer commit; no funds moved, no config changed)

**The ring abandoned paid Forge generations that the server went on to settle.** All 17
`aborted` faults trace to `x402_autonomous_log`: 84 in 24h from the forge prop pipeline
(each run logs twice, a pipeline row plus the loop's summary row) plus 8s timeouts on
third-party uptime probes. `/api/x402/forge` generates before it settles, a standard NIM
job takes 20 to 55s, and `payX402` gave the paid replay the shared 20s budget. Aborting
did not cancel the server: `forge_creations` holds 9 ring-paid generations with settle
signatures in 24h, and 7 of them match a ring row reading `This operation was aborted`.
That is 1.05 USDC/day charged, recorded as rail faults, and never written to
`forge_autonomous_props` (so never shown on `/forged`). `payX402` now takes
`paidTimeoutMs` for the paid replay only (probe unchanged), and the forge pipeline passes
`FORGE_PAID_TIMEOUT_MS` = 90,000. Four tests in `tests/x402-pay-paid-timeout.test.js`
against a real local 402 server; the payX402 402-retry, blockhash-freshness and forge
suites stay green. Docs in `docs/forged.md` (`871b307c5`); the `/forged` empty state now
states the real 30 minute cadence (`842dd8d53`). The other 84 locales still say hourly:
re-translation failed here because Vertex returned 403 (the workspace needs `gcloud auth
login`) and the service's Gemini key is billing-denied, so the old translations were kept.

### DoD after this pass

1. `x402_settle` ok above 90%: **passes** (92.6%). With the forge fix deployed, about 5
   aborted faults per 3h become settles.
2. `fee_runway_exhausted` not the top reject class: **fails until `22f1e08df` is deployed.**
3. Non-zero deficit AND non-zero reclaim plan: deficit passes (0.290989), plan empty.
4. to 6. Recurrence guard, changelog (`fb533a6ec` carries the forge entry), PROGRESS: done.

### Owner actions (unchanged, now more urgent)

- **Deploy** (gate 2): HEAD carries `22f1e08df` and the forge budget fix.
- **Fund `WwwuGbqHrwF5RG89KhUbmRWEvjnRH9k5kVM5p7T3WwW`** (gate 1). 0.017 SOL spendable
  against 0.0276 SOL/day of burn: the sponsor hits its 0.002 SOL floor within about 15
  hours of this reading, after which `x402_settle` goes `down / sponsor_floor`. The sizing
  from the 09-24 entry still holds: about 0.4 SOL buys 14 days at today's burn; about 1.4 SOL
  also fills the 0.3 SOL operating reserve and both topup targets, which is what makes the
  DoD 3 plan non-zero.

## 2026-09-29 | 01 x402 settle runway | the refusal flood was our own feed seeder, not buyers

Re-measured live against production `f2081d946` (revision `three-ws-api-00459-pxd`, which
carries `22f1e08df` and `fb533a6ec`) at 06:22 to 06:45 UTC. Nothing carried forward.

| Fact | Value | Source |
|---|---|---|
| `x402_settle` | **ok, 97.0%** (262/270 paid attempts, 3h), 924 paced by the fee governor | `/api/healthz` |
| Facilitator settles, 24h | 46,375 attempts, 2,492 settled, **43,848 `fee_runway_exhausted`**, 34 other | `/api/x402/runway-lab`, `x402_self_facilitator_log` |
| Who paid | **every** one of 45,483 verifies in 24h was the ring payer `X4o2...stML`; zero external buyers | verify rows grouped by payer |
| Refusals by amount | 43,662 at 1,000 atomic (the seeder's tip), 186 at 10,000 atomic (the MCP canary) | settle rows, all sponsor fee payer, payer NULL |
| Sponsor `Wwwu...T3WwW` | 0.007810 SOL, spendable 0.005810; 24h fees 7,720,766 lamports over 772 settles | runway-lab, facilitator log |
| Ring payer `X4o2...stML` | 0.047933 SOL; 24h self-pay fees 8,667,553 lamports over 1,723 settles | same |
| Governed demand skipped caller-side, 24h | 7,439, all sponsor-mode (+10000): health 2,774, oracle 2,431, volume 1,246, sniper 356, feed 236, canonicalize 220, observability 174 | `x402_autonomous_log` |

### Demand by source

- **x402 seed cron, ~1,830 attempts/hour (about 95%).** `api/cron/x402-seed-cron.js`, called
  by `economy-tick` every two minutes, builds and fires 60 sponsor-mode $0.001 tips at
  `/api/x402/dance-tip` per tick. Its only preflight was the sponsor's hard floor and the
  payer's balance, never the fee governor. Logs: 61 ticks in 2h, 3,660 sent, **60 settled**,
  3,600 refused (dance-tip answers 503). Request logs match: 580 `GET /api/x402/dance-tip 503`
  from `threews-x402-seed/1.0` in 20 minutes. It also took about 720 of the sponsor's 772
  daily settles, so the budget the paid pipelines needed went to seeding.
- **Streaming MCP canary, ~8/hour.** `api/_lib/x402/pipelines/streaming-mcp-health.js`
  hand-builds a $0.01 sponsor payment to `POST /api/mcp` without asking the gate; 183
  `not_settled` rows a day, matching the 186 refusals.
- **The ring and the autonomous loop: 0 facilitator refusals.** Both already gate; their
  7,439 governed skips are recorded caller-side, as designed.
- **External buyers: none in 24h.** For the record, an external buyer is never refused by the
  governor (the settle meter admits a non-platform payer since `c5d701b68`); under the floor it
  gets a 503 and its transfer is never broadcast, so it is not charged.

Root cause: the admission gate works; two callers never called it. `runway-lab`'s
`capacity_admission_rate` 0.054 and the green `x402_settle` were both true at once because
the settle sensor reads `x402_autonomous_log`, which the seeder never writes.

### Fixes (`c7befebdd`, `ce7365b40`; no funds moved, no config changed)

1. `reserveFeeAdmissions()` (wallet-fee-meter) sizes a batch against the shared admission
   snapshot and leaves `keepLamports` for other tenants; pure math in
   `admissibleSettleCount()` (wallet-fee-governor), boundary-identical to the settle meter.
   The seed cron sends only what it admits and keeps `X402_SEED_FEE_RESERVE_LAMPORTS`
   (default 200,000) for the paid pipelines, so seeding yields to data.
2. `admitSponsorSettle()` (pay.js) gates the three pipelines that hand-build sponsor payments:
   streaming MCP canary, builder-code attribution, payment-proof idempotency audit.
3. The facilitator records `payer` on floor and governor refusals (was NULL).
4. Recurrence guard for this shape: `x402_settle` goes `degraded`, `mechanism: gate_bypass`,
   `metrics.gateBypass`, when facilitator governor refusals with no ring row behind them are
   at least 20 and exceed settles. Docs: `docs/x402-ring-economy.md`,
   `docs/ops/production-log-triage.md` mechanism table.

Tests: 20 new across `tests/x402-wallet-fee-governor.test.js`, `tests/x402-fee-admission.test.js`,
`tests/x402-seed-batch-plan.test.js`, `tests/api/x402-settle-health.test.js`; 177 x402 /
facilitator / economy / treasury / healthz files run, 2,033 passed, one suite failing on a
peer's uncommitted import (`api/_lib/solana-transfer.js` now pulls `token-program.js` into
`tests/api/x402-pay-routing.test.js`, whose `node:fs` mock throws), unrelated here.
`check:rules` clean, `audit:docs` no findings in touched docs, `build:pages` green.

### DoD after this pass

1. `x402_settle` ok above 90%: **passes** (97.0%).
2. `fee_runway_exhausted` not the top reject class: **pending deploy.** Both callers that
   produced 100% of today's governor refusals are fixed in `c7befebdd`.
3. Non-zero deficit AND non-zero reclaim plan: deficit passes (0.30221); reclaim moves are
   empty (every source is `at_or_below_floor` or `below_min_sweep`). Reclaim only runs while
   the deficit is positive, so funding cannot make the reclaim plan non-zero; only the
   sweep-minimum lever below can. Funding makes the topup `plan` non-zero instead.
4. Recurrence guard: the governor config test existed; this pass adds the healthz degraded
   reason (`gate_bypass`). Done.
5. Changelog: `ce7365b40`. 6. PROGRESS: this entry.

### Owner actions

- **Deploy** (gate 2). Then re-read `runway-lab` 3h later: expect governor refusals near 0.
- **Fund `WwwuGbqHrwF5RG89KhUbmRWEvjnRH9k5kVM5p7T3WwW`** (gate 1), sized from today's numbers:

  | Line | SOL | Basis |
  |---|---|---|
  | Operating reserve back to 0.3 | 0.3022 | `master_deficit_sol` 0.30221 |
  | Ring payer to its 0.18 target | 0.1321 | 0.047902 now; 8.67M lamports/day self-pay, so about 20 days |
  | 14 days of sponsor fees at measured paid demand | 1.049 | 7,490 sponsor settles/day (7,439 skipped + ~50 settled) x 10,000 lamports |
  | **Recommended** | **1.48** | the three lines above |
  | Minimum instead | 0.57 | reserve + ring payer + 14 x the 0.01 SOL/day heartbeat |
  | Optional, not settle-related | 0.9875 | relayer bundle `wwwq...HGUn` 0.012453 to its 1.0 target |

  Pair it with `X402_WALLET_FEE_RUNWAY_DAYS=14` (config-only, pre-approved). Today's value
  is 1, which lets the governor spend the sponsor's whole spendable balance in a day; with
  the seeder now filling any surplus above its reserve, that would burn a funding in about a
  day. At today's balance the change is inert for the sponsor (the 0.01 SOL/day floor already
  exceeds spendable) and tightens the ring payer from 0.046 to 0.01 SOL/day against its
  0.0087 SOL/day burn, which is why it is left for the funding moment.
- **Free lever, not applied (it moves SOL):** `ECONOMY_SWEEPBACK_MIN_SOL` 0.01 to 0.001 lets
  the armed reclaim sweep 33 wallets (31 agent wallets 0.151203 + the x402 receiver 0.004995
  + the a2a payer 0.002851) = **0.159 SOL** gross, about 0.000165 in fees. At 0.002: 29
  wallets, 0.153 SOL; at 0.005: 17 agent wallets, 0.114 SOL. It makes the DoD 3 reclaim
  plan non-zero at once but leaves the master (0.167) under its 0.3 reserve.

Unrelated, seen in the same logs: an external `node-fetch/1.0` client drives over 1,800
`GET /api/v1/pump/curve` a minute, 98.7% answered 429 by the rate limiter.
