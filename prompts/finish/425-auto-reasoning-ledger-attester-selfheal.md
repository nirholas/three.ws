# 425. Register the reasoning-ledger attester wallet in SOLANA_SIGNERS so the existing self-heal cron can fund it

How to run: paste this file's repo path into a fresh Claude Code chat in this repository and say "run this work order". Runnable now, no gate, no owner action required for the code fix (the one remaining owner action, funding the economy master, is already tracked separately and is not part of this order's Definition of Done).

## Operating clause (binding)

- Read CLAUDE.md first. CLAUDE.md overrides everything, including this file.
- Finish 100% in this session. Never end the turn with a question, an option list, or an unexecuted plan.
- Bug fixes are test-first: reproduce with a failing test before touching the fix, confirm it fails for the stated reason, then fix, then confirm green. Commit the test with the fix.
- The only permitted stops are the CLAUDE.md stop-and-ask gates (spend/on-chain writes, push/deploy, posting externally, committing content referencing a crypto project other than `$THREE`, destroying unrecoverable data). This order touches none of them: it edits one registry array and adds tests, it never signs or sends anything.
- Never place a live secret VALUE in any file this order touches. Reference the wallet only by its env var name (`ATTEST_AGENT_SECRET_KEY`) and by its public key (`Fcwqit9x1KmfUboPtoVWBUdEuonNyTA8T6xtfAEPpPeH`), exactly as the rest of `api/_lib/solana-signers.js` already does for every other signer.
- Concurrent agents share this worktree: stage explicit paths only (never `git add -A` or `git add .`), re-check `git status` and `git diff --staged` before committing.
- The em-dash and en-dash characters are banned in everything you write.

## Step 0: re-derive the current state

Confirm the alert is still live and has never recovered:

    export DATABASE_URL=$(node scripts/read-service-env.mjs '^DATABASE_URL$' | sed -n "s/^export DATABASE_URL='\(.*\)'$/\1/p")
    node -e "
    const { Pool } = require('@neondatabase/serverless');
    const pool = new Pool({ connectionString: process.env.DATABASE_URL });
    (async () => {
      const a = await pool.query(\"select signature, title, count, first_seen, last_seen from ops_alerts where title ilike '%on-chain anchoring is down%' order by count desc\");
      for (const r of a.rows) console.log(r.signature, r.count, r.first_seen, '->', r.last_seen, '|', r.title);
      const b = await pool.query('select status, count(*) from ledger_anchors group by status order by 2 desc');
      for (const r of b.rows) console.log(r.status, r.count);
      process.exit(0);
    })();
    "

As measured 2026-10-24: signature `8de5979aae9fada7` ("Reasoning ledger: on-chain anchoring is down") has fired **10,087 times** between 2026-08-15T08:00Z and 2026-10-24T09:00Z, still firing as of the most recent cron run. `ledger_anchors` has **335 rows with status `pending`** and **44 rows with status `failed`**, and **zero** rows with status `anchored` or `deduped` across the entire 2+ month history: this anchoring path has never once succeeded.

Confirm the registry gap that explains why the platform's own self-heal (`api/cron/treasury-topup.js`) has never noticed or fixed this:

    grep -n "ATTEST_AGENT_SECRET_KEY" api/_lib/solana-signers.js   # no output today: the wallet is invisible to SOLANA_SIGNERS

Confirm the two features that share this one wallet, so the fix's scope is understood:

    grep -rn "loadAttesterKeypair\|ATTEST_AGENT_SECRET_KEY" api/_lib/attest-event.js api/_lib/ledger-anchor.js api/_lib/trader-score-attest.js

## Root cause

`api/_lib/ledger-anchor.js`'s `anchorLedgerHead()` signs and broadcasts an SPL-Memo transaction from the keypair in `ATTEST_AGENT_SECRET_KEY` (loaded via `loadAttesterKeypair()` in `api/_lib/attest-event.js`). Its own code correctly classifies "no key configured" as `pending` (a benign, undeployed-feature state) versus "key configured but broadcast rejected" as `failed` (a real outage). The 335 `pending` rows plus 44 `failed` rows, and the fact that `docs/reasoning-ledger.md` already documents this wallet and says "fixing an anchor_outage means funding the ATTEST_AGENT_SECRET_KEY wallet," together show the key IS configured in production and the wallet simply has no SOL to pay the memo transaction's fee.

Every other platform-managed signer wallet that can run dry is listed in `api/_lib/solana-signers.js`'s `SOLANA_SIGNERS` array, which is read by two self-healing mechanisms: `api/cron/relayer-balance-check.js` (alerts when a signer drops under `minSol`) and `api/cron/treasury-topup.js` (every 30 minutes, auto-refills any listed signer below `minSol` from the `economy-master` wallet). The attester wallet behind `ATTEST_AGENT_SECRET_KEY` has no entry in this array, so it is invisible to both mechanisms: nothing has ever topped it up, and nothing has ever alerted on its balance specifically (the generic "anchoring is down" alert fires instead, 10,087 times, without naming the fundable cause). This is a pure registry omission, not a design limitation: the economy master already knows how to fund wallets exactly like this one, it just has never been told this one exists.

`api/_lib/trader-score-attest.js` loads the same keypair through the same `loadAttesterKeypair()` for a separate attestation feature, so this one registry entry self-heals both features at once.

## Task

1. Add a test-first regression. Read `tests/economy-reconcile-recipients.test.js` and `tests/treasury-topup-shared-wallet.test.js` first to match the existing style for asserting against `SOLANA_SIGNERS` shape and for simulating a topup run. Add a case (in whichever of those two files its assertion style fits best, or a new `tests/solana-signers-attester.test.js` if neither fits) that asserts `SOLANA_SIGNERS` contains exactly one entry with `env === 'ATTEST_AGENT_SECRET_KEY'`. Run it and confirm it fails today (no such entry exists).
2. In `api/_lib/solana-signers.js`, add one new entry to the `SOLANA_SIGNERS` array (place it near the other small, non-critical utility signers such as `sns-parent-owner` or `coin-treasury`, not at the top near `economy-master`):

   ```js
   {
     name: 'reasoning-ledger-attester',
     env: 'ATTEST_AGENT_SECRET_KEY',
     minSol: 0.02,
     refillTo: 0.05,
     purpose:
       'signs the SPL-Memo tx that anchors the reasoning-ledger hash-chain head on-chain (api/_lib/ledger-anchor.js) and the separate trader-score attestation (api/_lib/trader-score-attest.js); both load this same key via loadAttesterKeypair(). Memo-only, pubkey Fcwqit9x1KmfUboPtoVWBUdEuonNyTA8T6xtfAEPpPeH: never holds tokens or user funds, only needs enough SOL for its own tx fees.',
     network: 'mainnet',
   },
   ```

   `minSol: 0.02` and `refillTo: 0.05` are sized for a memo-only signer: at ~5,000 lamports per transaction and the `reconcile-decisions` cron running every 10 minutes (`vercel.json`, `/api/cron/reconcile-decisions`, `*/10 * * * *`) with dedup against repeat chain heads, 0.02 SOL covers roughly 4,000 anchor attempts before the next auto-topup, far more than one 30-minute topup cycle needs.
3. Run the new test and confirm it passes.
4. Run the full existing suites for every test file found in Step 0's `grep -rln "solana-signers\|SOLANA_SIGNERS" tests/` listing (`tests/economy-reconcile-recipients.test.js`, `tests/treasury-topup-shared-wallet.test.js`, `tests/x402-ring-revshare.test.js`, `tests/treasury-topup-alias.test.js`, `tests/economy-rebalance.test.js`, `tests/treasury-selfheal-visibility.test.js`, `tests/migrate-plaintext-secrets.test.js`, `tests/economy-sweepback.test.js`, `tests/cron-sweepback-dryrun.test.js`, `tests/economy-reclaim-dryrun-key-gate.test.js`) and confirm none regress. These exercise the full `SOLANA_SIGNERS` array against mocked balances/sweeps, so a new entry with an unusual shape could break an assumption one of them makes; if any fails, read why before changing the new entry (do not weaken the test to accommodate a mistake in the entry).
5. Run `npm run check:rules -- --paths api/_lib/solana-signers.js <test file(s) touched>` and fix anything it flags.

## Done when

- `SOLANA_SIGNERS` in `api/_lib/solana-signers.js` contains the `reasoning-ledger-attester` entry with `env: 'ATTEST_AGENT_SECRET_KEY'`.
- The new regression test passes, and it failed for the stated reason (`grep` confirmed the entry was absent) before the fix.
- Every test file listed in Task step 4 still passes.
- `npm run check:rules` passes on the touched paths.
- `git diff` reviewed; the only functional change is the one new array entry plus its test(s). No secret value appears anywhere in the diff.
- The fix and its test are committed together on `evolve` with an explicit-path commit.
- This file is removed, with a dated entry added to `prompts/finish/_context/production-100-PROGRESS.md` citing the fix commit SHA and today's measured 10,087-count/335-pending/44-failed baseline so a future sweep can confirm the counts stopped climbing after deploy.

## Never blocked

| Looks like a blocker | It is not | Do this |
|---|---|---|
| The attester wallet has 0 SOL right now, so anchoring will keep failing even after this fix ships | Funding happens automatically: `api/cron/treasury-topup.js` tops up any under-floor `SOLANA_SIGNERS` entry from `economy-master` every 30 minutes, with no code change needed beyond this order. Whether `economy-master` itself currently holds enough SOL to cover this plus every other signer is a separately tracked owner-action row, not something this order controls or should re-litigate | Ship the registry entry; do not attempt to fund any wallet yourself (that would be a spend action and is gated regardless) |
| Tempted to also silence or rate-limit the `ops_alerts` "anchoring is down" alert itself since it fired 10,087 times | Out of scope and wrong fix: the alert is accurately reporting a real, ongoing, previously-unfixable outage; suppressing it would hide the next real regression | Fix the root cause (the registry gap); leave the alert's firing logic in `api/cron/reconcile-decisions.js` untouched |
| `loadAttesterKeypair()` throws if `ATTEST_AGENT_SECRET_KEY` is unset, so a test environment without it configured might fail when exercising the new entry | The new test only needs to assert the entry's shape in the static `SOLANA_SIGNERS` array, not actually load the keypair or hit the network | Write the test against the array's data, not against a live key load; follow the existing tests' mocking style, none of them load a real keypair either |
| Unsure which existing test file the new case belongs in | Either is defensible; a new small file avoids coupling to another test's setup/teardown assumptions | Prefer a new `tests/solana-signers-attester.test.js` if neither existing file's fixture obviously fits; keep it short |

## Report format

State: the Step-0 `ops_alerts`/`ledger_anchors` query output and the `grep` confirming the registry gap, the failing-test confirmation before the fix, the diff, the passing-test output after (including every file from Task step 4), and the commit SHA.
