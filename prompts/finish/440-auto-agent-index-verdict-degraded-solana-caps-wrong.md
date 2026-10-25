# 440. `/api/healthz` reports `agent_index` as `down` when Solana is only `degraded`, not actually down

How to run: paste this file's repo path into a fresh Claude Code chat in this repository and say "run this work order". Runnable now, no gate, no owner action required.

## Operating clause (binding)

- Read CLAUDE.md first. CLAUDE.md overrides everything, including this file.
- Finish 100% in this session. Never end the turn with a question, an option list, or an unexecuted plan.
- This is a bug fix: follow the test-first rule (CLAUDE.md, "Bug fixes are test-first"). Write the failing test first, confirm it fails for the stated reason, then fix the code, then confirm it passes. Commit the test with the fix.
- The only permitted stops are the CLAUDE.md stop-and-ask gates (spend/on-chain writes, push/deploy, posting externally, committing content referencing a crypto project other than `$THREE`, destroying unrecoverable data). This order touches none of them.
- Concurrent agents share this worktree: stage explicit paths only (never `git add -A` or `git add .`), re-check `git status` and `git diff --staged` before committing.
- The em-dash and en-dash characters are banned in everything you write.

## Why this matters (measured 2026-10-25)

`curl -s https://three.ws/api/healthz` right now returns the `agent_index` subsystem as `status: "down"`:

    "agent_index": {
      "status": "down",
      "detail": "Solana: 45m median lag across 1971 agents (1h30m full sweep at 240/tick), 104 erroring (5.3%), 2599 events. EVM: 69h19m worst cursor age (Base) across 22/22 chains, worst backlog 125,079 blocks (Base), 1 behind, 1 stale, ...",
      "metrics": { "solana": { "medianLagMin": 45, "errored": 104, "agents": 1971 }, "evm": { "lagMin": 4159, "worstBlocksBehind": 125079, "behindChains": 1, "staleChains": 1 } }
    }

This is wrong by the code's own stated design. `api/_lib/ops/index-lag.js`'s `indexLagVerdict()` (lines 233-310) computes `solStatus` and `evmStatus` separately, then at line 268:

    const evmOnlyFault = solStatus === 'ok' && evmStatus === 'down';
    const status = worst(solStatus, evmOnlyFault ? 'degraded' : evmStatus);

The comment immediately above it (lines 260-267) explains the intent: "Letting the EVM leg alone drive the whole subsystem to `down` reports an outage that no user is experiencing... So an EVM-only fault caps at `degraded`." The gap: the guard requires `solStatus === 'ok'` *exactly*. Live numbers right now:

- Solana error rate: `104 / 1971 = 5.28%`, which is `>= SOLANA_ERROR_RATE_DEGRADED (0.05)` and `< SOLANA_ERROR_RATE_DOWN (0.25)`, so `legStatus` returns `'degraded'`, not `'ok'` (`api/_lib/ops/index-lag.js:244-254`, `SOLANA_ERROR_RATE_DEGRADED`/`_DOWN` at lines 58-59). Solana's median lag (45m) is well under `SOLANA_LAG_DEGRADED_MIN` (90), so the only reason `solStatus` is not `'ok'` is this error rate, by 0.28 points.
- EVM: Base (chain 8453) has been frozen since 2026-10-22 (see order 441 below for that bug); `lagMin` 4159min (69h19m) `>= EVM_LAG_DOWN_MIN` (480), so `evmStatus = 'down'` regardless of the blocks-behind leg.
- Because `solStatus` is `'degraded'`, not `'ok'`, `evmOnlyFault` is `false`, so `status = worst('degraded', 'down') = 'down'`.

The result: a Solana leg that is fresh on lag and only mildly over an error-rate threshold (a secondary signal the code itself treats as weaker than `down`, per the existing `degraded`/`down` split at `SOLANA_ERROR_RATE_DEGRADED`/`_DOWN`) gets combined with one stuck EVM chain out of 22 to report `down` for the entire `agent_index` subsystem on `/api/healthz`, which feeds `subsystems.status` (also `down` right now) and any alerting or dashboard reading it. This is the exact failure mode the `evmOnlyFault` cap was written to prevent, just one threshold short of triggering it.

This bug already has partial test coverage proving the intent, and a clean gap: `tests/agent-index.test.js:919-927` ("caps an EVM-only fault at degraded and says why") only exercises the case where Solana is fully `lagFixture()`-default (`errored: 0`, so `solStatus === 'ok'` exactly). `tests/agent-index.test.js:936-942` ("scores a wedged Solana leg on its error rate") exercises a Solana-degraded-alone case with EVM healthy, asserting `down` because the error rate there is pushed to `1101/1604 = 68.6%` (above `SOLANA_ERROR_RATE_DOWN`). No existing test combines "Solana merely `degraded` (error rate between the two thresholds, lag fine)" with "EVM `down`", exactly today's live shape. Confirm this gap before changing anything:

    grep -n "evmOnlyFault" api/_lib/ops/index-lag.js
    grep -n "caps an EVM-only fault\|scores a wedged Solana leg" tests/agent-index.test.js

This is distinct from and does not duplicate any open order: a grep of every file in `prompts/finish/` for `index-lag`, `evmOnlyFault`, or `indexLagVerdict` found no existing order naming this gap. It is also distinct from order 441 (below), which fixes *why* Base's EVM leg is stuck; this order fixes how a stuck EVM leg's severity combines with an already-slightly-degraded Solana leg. Fixing 441 alone does not fix this: any other single stuck EVM chain, at any future date, recreates this exact miscount the moment Solana's error rate is anywhere in its own `degraded` band.

## Task

1. Re-derive current state: run `curl -s https://three.ws/api/healthz | node -e "let d='';process.stdin.on('data',c=>d+=c);process.stdin.on('end',()=>console.log(JSON.stringify(JSON.parse(d).subsystems.subsystems.find(x=>x.name==='agent_index'),null,2)))"` and confirm the live `status` and the Solana error rate relative to `SOLANA_ERROR_RATE_DEGRADED`/`_DOWN`. Numbers will have drifted since 2026-10-25; the shape (Solana `degraded`-but-not-`down`, EVM `down`) is what matters, not the exact percentages. If Solana's error rate has since dropped under 5% or risen past 25%, the live symptom may not reproduce today; proceed with the fix regardless, since the code path is wrong independent of today's exact numbers, and say what you observed in the report.
2. Add a failing test to `tests/agent-index.test.js`, in the `describe('indexLagVerdict', ...)` block (after the existing "caps an EVM-only fault at degraded" test at line 927), modeled on the live shape:

       it('still caps at degraded when Solana is merely degraded, not ok, and EVM is down', () => {
         // Measured on production 2026-10-25: Solana error rate 5.28% (104/1971,
         // just over the 5% degraded threshold) with a fresh 45-minute median lag,
         // while Base (EVM) sat 69h19m stale. The guard required solStatus === 'ok'
         // exactly, so this combination escalated the whole subsystem to `down`
         // even though no user-visible Solana fault exists.
         const verdict = indexLagVerdict(
           lagFixture({
             solana: { agents: 1971, errored: 104, medianLagMin: 45 },
             evm: { lagMin: 4159, worstBlocksBehind: 125_079, behindChains: 1, staleChains: 1 },
           }),
         );
         expect(verdict.status).toBe('degraded');
       });

   Run `npx vitest run tests/agent-index.test.js -t "still caps at degraded"` now, before the fix, and confirm it fails with `status` reading `'down'`, not a setup/typo error.
3. Fix `api/_lib/ops/index-lag.js` line 268. Change:

       const evmOnlyFault = solStatus === 'ok' && evmStatus === 'down';

   to:

       const evmOnlyFault = solStatus !== 'down' && evmStatus === 'down';

   This widens the cap to cover `solStatus === 'degraded'` as well as `'ok'`, matching the comment's stated intent ("an EVM-only fault caps at degraded") without weakening the one case the existing test at line 929-934 ("still reports down when Solana itself is the leg that is behind") already locks down: when Solana itself is `'down'`, `evmOnlyFault` must stay `false` so the real Solana outage is never softened. `solStatus !== 'down'` preserves that exactly (`'down' !== 'down'` is `false`).
4. The detail string at line 297 currently reads `'... Secondary-chain cursors only: the Solana index users read is fresh, so this is degraded, not down.'` when `evmOnlyFault` is true. That claim ("is fresh") is inaccurate when `solStatus` is `'degraded'` rather than `'ok'`, since Solana is not clean in that case, only not `down`. Change the suffix at line 297 from:

       (evmOnlyFault ? ' Secondary-chain cursors only: the Solana index users read is fresh, so this is degraded, not down.' : '');

   to:

       (evmOnlyFault ? ` Secondary-chain cursors only: the Solana index users read is ${solStatus === 'ok' ? 'fresh' : 'degraded but not down'}, so this is degraded, not down.` : '');

5. Add a second assertion to the new test from task 2 confirming the detail text is accurate in the degraded-Solana case: `expect(verdict.detail).toContain('degraded but not down')`. Also add one line to the existing "caps an EVM-only fault at degraded and says why" test (around line 926) confirming the `solStatus === 'ok'` branch still says `'is fresh'`: `expect(verdict.detail).toContain('is fresh')`.
6. Run `npx vitest run tests/agent-index.test.js` and confirm every test in the file passes, including the two new assertions and the pre-existing "still reports down when Solana itself is the leg that is behind" test (must remain `down`).
7. Run `npm run check:rules -- --paths api/_lib/ops/index-lag.js tests/agent-index.test.js` and fix anything it flags.
8. Read the full diff (`git diff api/_lib/ops/index-lag.js tests/agent-index.test.js`) and confirm every changed line traces to a task above.
9. This fix cannot be verified against production from this session (no deploy in an evolve lane). The report must say plainly that the live `/api/healthz` reading is unverified until this ships, and give the current live `curl` reading from task 1 as the baseline a deploy should change.

## Done when

- `api/_lib/ops/index-lag.js`'s `evmOnlyFault` guard caps at `degraded` whenever Solana is not itself `down`, not only when Solana is exactly `ok`.
- The detail text for an EVM-only fault accurately distinguishes "Solana is fresh" from "Solana is degraded but not down" instead of always claiming "fresh".
- `tests/agent-index.test.js` has a new test proving the exact live production shape (Solana degraded on error rate alone, EVM down) now resolves to `degraded`, confirmed to fail against the pre-fix code first.
- The pre-existing test "still reports down when Solana itself is the leg that is behind" (line 929) still passes unchanged: a real Solana outage is never softened by this change.
- `npx vitest run tests/agent-index.test.js` passes in full.
- `npm run check:rules -- --paths api/_lib/ops/index-lag.js tests/agent-index.test.js` passes.
- `git diff` reviewed; every changed line traces to a task above.
- The fix is committed on `evolve` with explicit paths and a commit message naming the bug and the fix.
- The report states plainly that the live `/api/healthz` reading is unverified until this ships, with the current live reading quoted as the baseline.
- This file is removed, with a dated entry added to `prompts/finish/_context/production-100-PROGRESS.md` citing the fix commit SHA and what was verified.

## Never blocked

| Looks like a blocker | It is not | Do this |
|---|---|---|
| "The Solana error rate might have dropped below 5% by the time this runs, so there's nothing to fix" | The code path is wrong independent of today's exact percentage: any future tick where Solana's error rate sits anywhere in its own `degraded` band (5%-25%) while any one of 22 EVM chains is `down` recreates this exact miscount. The test in task 2 reproduces the logic bug directly against `indexLagVerdict()`, not against today's live curl snapshot | Write the test against the fixture numbers given (which model the measured shape), not against a fresh live curl. Proceed with the fix regardless of today's live percentage |
| "This duplicates order 441 (the stuck Base crawl)" | 441 fixes why Base's cursor is frozen (a crawler bug in `api/cron/[name].js`). This order fixes how `indexLagVerdict()` combines a stuck EVM chain's severity with the Solana leg's severity, a bug in `api/_lib/ops/index-lag.js` that exists regardless of which EVM chain is stuck or why. Shipping 441 alone does not fix this: a different EVM chain getting stuck next month reproduces the same miscount if Solana's error rate happens to be in its `degraded` band that day | Fix both; they are independent files and independent bugs |
| "Widening `evmOnlyFault` to include `degraded` might mask a real Solana problem" | The guard change is `solStatus !== 'down'`, not `true`: if Solana itself crosses into `down` (lag >= 360min or error rate >= 25%), `evmOnlyFault` is still `false` and the real Solana status wins via `worst()`. The pre-existing test at line 929 locks this down and must keep passing | Run the full test file after the fix and confirm the "still reports down when Solana itself is the leg that is behind" test passes unchanged |

## Report format

State: the measured re-derivation from task 1 (live `curl` reading and the Solana error-rate math), the failing test's first (red) run output, the fix, the passing test run output (full `tests/agent-index.test.js`), the `check:rules` result, the diff, and the commit SHA. End with one explicit line: "Live production symptom: unverified, pending deploy." followed by the current live `/api/healthz` `agent_index.status` reading as the baseline.
