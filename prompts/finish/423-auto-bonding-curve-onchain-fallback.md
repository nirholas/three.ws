# 423. `/api/crypto/bonding` hard-fails for every mint, including $THREE's own, while a proven on-chain reader already exists

How to run: paste this file's repo path into a fresh Claude Code chat in this repository and say "run this work order". Runnable now, no gate.

## Operating clause (binding)

- Read CLAUDE.md first. CLAUDE.md overrides everything, including this file.
- Finish 100% in this session. Never end the turn with a question, an option list, or an unexecuted plan. A judgment call goes in one line of the final report; it never becomes a question that halts work.
- The only permitted stops are the CLAUDE.md stop-and-ask gates: spending real funds or any irreversible on-chain write, git push or a production deploy, posting to an external channel, committing content that references a crypto project other than $THREE, and destroying unrecoverable data. This order touches none of them.
- No mocks of the thing under test, no fake data, no unfinished-work markers, no commented-out code, no `it.skip` / `.todo` to make a failure disappear.
- The em-dash and en-dash characters are banned in everything you write.
- Concurrent agents share this worktree: stage explicit paths only (never `git add -A` or `git add .`), re-check `git status` and `git diff --staged` before committing.
- Before committing, run `npm run check:rules -- --paths <files you touched>`. It must exit 0.
- Bug fixes are test-first (CLAUDE.md): `tests/pump-bonding.test.js` already has a test named `reproduces the outage: upstream down, no last-known-good, reports upstream_down` (line 189) that asserts the CURRENT broken behavior as if it were correct. Confirm it still passes (proving the bug is live), then change the implementation, then change that test to assert the fixed behavior, and confirm it passes for the right reason.

## Why this matters (measured 2026-10-24 08:21-08:35 UTC, from HEAD `a3b0b8f2e`)

`/api/crypto/bonding` is dead for every mint right now, including the platform's own promoted coin, $THREE:

    curl -s "https://three.ws/api/crypto/bonding?mint=FeMbDoX7R1Psc4GEcvJdsbNbZA3bfztcyDCatJVJpump"
    → HTTP 503 {"error":"upstream_unavailable","error_description":"pump.fun data source is temporarily unreachable, retry shortly", ...}

Root cause, confirmed live: pump.fun's own frontend API now answers every request from this environment with a Cloudflare interstitial challenge, not a transient blip:

    curl -s -D - -o /dev/null --max-time 10 "https://frontend-api-v3.pump.fun/coins/FeMbDoX7R1Psc4GEcvJdsbNbZA3bfztcyDCatJVJpump"
    → HTTP 403, cf-mitigated: challenge, server: cloudflare

`api/_lib/pump-bonding.js` has exactly two tiers: a 25s live cache, then a straight fetch to `frontend-api-v3.pump.fun`, then a 1800s (30 min) last-known-good cache (`LKG_TTL_S`), and only THEN a hard `{kind:'upstream_down'}` → `503`. The Cloudflare block has outlasted the 30-minute LKG window, so every mint with no very-recent successful fetch now hard-fails, $THREE included. Pulled from production logs (`gcloud logging read 'resource.type="cloud_run_revision" resource.labels.service_name="three-ws-api" severity>=ERROR httpRequest.status>=500'`, most recent 1000 rows, which span only 08:21:29 to 08:29:54 UTC: roughly 28 failing requests/min): 236 of those 1000 rows (23.6%) are `/api/crypto/bonding` 503s, the single largest error class in the sample, bigger than every `/cdn/*` R2 class combined.

This is NOT the same as the already-tracked R2/`object_storage` flapping (owner-actions row 36) or the Solana-RPC-quota rows (2, 23, 24): `credentialFault` is irrelevant here, no SOL or quota is involved, and the fix is entirely ours to make, because **a working on-chain substitute for the exact same data already ships in this repo and answers correctly right now**:

    curl -s "https://three.ws/api/pump/curve?mint=FeMbDoX7R1Psc4GEcvJdsbNbZA3bfztcyDCatJVJpump"
    → HTTP 200 {"mint":"...","curve":{...,"complete":true,...},"graduated":true,"graduatedPrice":{"priceUsd":0.000311...,"source":"jupiter","marketCapUsd":311748.1...}}

`api/_lib/pump-curve-view.js`'s `getCurveView()` reads the bonding-curve account straight off Solana RPC (via `@nirholas/pump-sdk` + the shared `RpcFallback`), with a Jupiter price fallback for graduated coins, and is already proven live behind `/api/pump/curve` and `/api/v1/pump/curve`. `/api/crypto/bonding` never calls it.

## Step 0: re-derive the current state

    git log --oneline -1
    curl -s "https://three.ws/api/crypto/bonding?mint=FeMbDoX7R1Psc4GEcvJdsbNbZA3bfztcyDCatJVJpump" -D - -o /dev/null   # confirm still 503
    curl -s "https://three.ws/api/pump/curve?mint=FeMbDoX7R1Psc4GEcvJdsbNbZA3bfztcyDCatJVJpump"                        # confirm the on-chain reader still works
    curl -s -D - -o /dev/null --max-time 10 "https://frontend-api-v3.pump.fun/coins/FeMbDoX7R1Psc4GEcvJdsbNbZA3bfztcyDCatJVJpump"  # confirm the CF block (if this one has cleared, re-check a few recent production mints for the same 503 before assuming the order is stale)
    npx vitest run tests/pump-bonding.test.js    # should be green; the "reproduces the outage" test currently expects the broken behavior
    sed -n '1,320p' api/_lib/pump-curve-view.js   # the module to reuse: getCurveView({mint, network})
    sed -n '1,210p' api/_lib/pump-bonding.js      # the module to fix: getBondingStatus(mint)

If pump.fun's Cloudflare block has cleared and `/api/crypto/bonding` answers 200 for several real mints on a fresh fetch (not served from a stale LKG), the immediate outage is over, but still ship the fallback: the block has now recurred at least once and will again, and the fix cost is small next to leaving $THREE's own bonding/graduation display permanently hostage to pump.fun's edge.

## Tasks

1. In `tests/pump-bonding.test.js`, add a case in the `getBondingStatus -- cache + last-known-good fallback` block: upstream fetch fails (reuse the existing `vi.stubGlobal('fetch', ...)` rejection pattern), no LKG cached, and `../api/_lib/pump-curve-view.js`'s `getCurveView` is mocked (via `vi.mock`, same style as the `cache.js` mock at the top of the file) to resolve with a realistic `{ httpStatus: 200, body: { curve: {...}, graduated: false, ... } }` shape (on-curve case) and a second case for the graduated shape (`{ graduated: true, graduatedPrice: { marketCapUsd, priceUsd, source: 'jupiter' } }`, matching what `/api/pump/curve` returned for $THREE above). Assert `getBondingStatus` now returns `{ kind: 'ok', status: {...}, stale: false, source: 'onchain' }`-shaped output (pick the exact discriminator field name that fits the existing `status.source` convention in `mapBondingStatus`, e.g. set `status.source` to `'onchain'` instead of `'pumpfun'`) rather than `upstream_down`. Run it; confirm it fails against the current code for the right reason (no fallback exists yet).
2. Update the existing test at line 189 (`reproduces the outage: upstream down, no last-known-good, reports upstream_down`) to reflect the new intended behavior once the fix lands: either it now asserts the on-chain fallback fires (preferred, if `getCurveView` is mocked in that test too), or it is narrowed to the case where the on-chain fallback *also* fails (e.g. `getCurveView` mocked to throw/404), still ending in `upstream_down`, with a comment explaining the narrowing. Do not just delete the regression coverage; keep a case proving the true double-failure path still reports `upstream_down` cleanly.
3. In `api/_lib/pump-bonding.js`, in `getBondingStatus(mint)`: when `fetchPumpCoin` reports `upstream_down` AND no `bondingLkgKey` cache entry exists, call `getCurveView({ mint, network: 'mainnet' })` from `../_lib/pump-curve-view.js` before giving up. Map its `{ httpStatus, body }` into the same status shape `mapBondingStatus` produces:
   - `httpStatus !== 200` or no usable `body` → fall through to the existing `{ kind: 'upstream_down' }`.
   - `body.graduated === true` → `{ onCurve: false, graduated: true, migratedTo: body.curve?.raydium_pool ? 'raydium' : 'pumpswap', bondingProgressPct: 100, solInCurve: null, tokensRemaining: null, marketCapUsd: body.graduatedPrice?.marketCapUsd ?? null, source: 'onchain' }`.
   - On-curve (`body.curve` present, not graduated) → derive `bondingProgressPct` by reusing the already-exported `bondingProgressPct(body.curve.realTokenReserves)` (field names come from `getBondingCurveState`'s BN-serialized output; read `api/_lib/solana/index.js`'s `getBondingCurveState` to confirm the exact property names before wiring the mapping, they may differ in case/shape from the raw pump.fun JSON's `real_token_reserves`), `solInCurve` from `realSolReserves / 1e9`, `tokensRemaining` from `realTokenReserves / 1e6`, `marketCapUsd` from `body.price` if present (check its shape the same way) else `null`, `source: 'onchain'`.
   - Write the mapped result through to `bondingLkgKey` the same way a successful pump.fun fetch does, so a subsequent request within the LKG window does not re-hit RPC, but do NOT write it to the pump.fun `liveKey` cache (keep that tier meaning "pump.fun answered this recently").
   - Return `{ kind: 'ok', status: mapped, coin: null, stale: false }` (there is no raw pump.fun `coin` object in this path; callers already treat `coin` as optional metadata, confirm by reading `api/crypto/bonding.js`'s response assembly before deciding).
4. Read `api/crypto/bonding.js` (the route handler) and confirm it renders `source: 'onchain'` sensibly in its response body and does not set the pump.fun-specific `x-pump-stale` header for this path, since this is not stale pump.fun data, it is live on-chain truth. Add a distinct header or field if the existing stale-flag plumbing would otherwise mislabel it (do not invent a header no consumer reads; check `tests/crypto-bonding-endpoint.test.js` for what is actually asserted before adding one).
5. Run `npx vitest run tests/pump-bonding.test.js tests/crypto-bonding-endpoint.test.js` until green.
6. Live-verify against production is not possible for the deployed code (deploys are owner-gated), but re-run the Step 0 curls once more and record the before/after `curl` output for `/api/crypto/bonding` against the CURRENT production code (still 503, unchanged by this order until deployed) in the report, so the before/after is honest: this order ships the fix on `evolve`, it does not deploy it.

## Definition of done

- [ ] `npx vitest run tests/pump-bonding.test.js tests/crypto-bonding-endpoint.test.js` exits 0, including a new case proving the on-chain fallback fires when pump.fun is unreachable and no LKG exists.
- [ ] `getBondingStatus` in `api/_lib/pump-bonding.js` calls `getCurveView` only on the true double-miss path (live cache miss, pump.fun fetch fails, LKG cache miss), never on the happy path, confirmed by reading the diff.
- [ ] No hardcoded third-party mint added to source or tests; the $THREE mint (`FeMbDoX7R1Psc4GEcvJdsbNbZA3bfztcyDCatJVJpump`) is the only real mint used, matching the existing test file's convention.
- [ ] `npm run check:rules -- --paths api/_lib/pump-bonding.js api/crypto/bonding.js tests/pump-bonding.test.js tests/crypto-bonding-endpoint.test.js` exits 0.
- [ ] One `data/changelog.json` entry (tag `fix`) describing the on-chain fallback, since `/api/crypto/bonding` is a documented public endpoint.
- [ ] Commit with explicit paths; subject names the actual fix (e.g. `fix(crypto): fall back to the on-chain curve reader when pump.fun's frontend API is Cloudflare-blocked and no cache survives`).

## Never blocked

| Blocker | Resolution (act, do not ask) |
|---|---|
| The CF block has cleared by the time you run this | Ship the fallback anyway; Step 0 explains why. Note in the report that the live symptom was not reproducible at run time, citing the log sample timestamps above as the evidence it happened. |
| `getBondingCurveState`'s field names do not match what step 3 assumes | Read `api/_lib/solana/index.js` and `api/_mcp`/`api/pump/curve.js`'s own consumption of the same shape (it already maps this correctly for `/api/pump/curve`); mirror that mapping exactly rather than guessing. |
| `getCurveView` itself fails (RPC lanes exhausted, per the already-tracked `rpc_lanes` degraded subsystem) | That is `getCurveView`'s own already-shipped stale/502 handling; let it propagate as `{ kind: 'upstream_down' }` same as today. This order does not need to fix RPC-lane exhaustion, that is tracked separately (production-100-OWNER-ACTIONS row 24). |
| Mapping `source: 'onchain'` breaks a consumer that only expects `'pumpfun'` | Grep every reader of `/api/crypto/bonding`'s response (`grep -rn "bondingProgressPct\|/api/crypto/bonding" src/ public/`) and confirm none switches behavior on the exact string `'pumpfun'`; if one does, make it treat any truthy `source` as live-ish and only special-case display text, never correctness. |

## Close out (required)

1. Verify every Definition of done line with the command output in front of you. Never claim a line you did not verify.
2. Commit with explicit paths, one commit (or a small number if the changelog/test edits are cleanly separable).
3. Delete this file in the final commit (`git rm prompts/finish/423-auto-bonding-curve-onchain-fallback.md`) once every Definition of done line is verified green, and append a dated entry to `prompts/finish/_context/production-100-PROGRESS.md` with the commit SHA(s). If a line cannot pass, leave the file and say which line remains and why.
4. Final report, in this order: the Step 0 measurements (reproduced or not, with the exact curl output); the diff summary; the before/after test counts for the two touched test files; the one-line judgment calls (field-name mapping decisions). No trailing questions.
