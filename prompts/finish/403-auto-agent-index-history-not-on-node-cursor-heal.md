# 403. Unwedge the 149 Solana agent cursors stuck on "history not on node" (agent_index is DOWN)

How to run: paste this file's repo path into a fresh Claude Code chat in this repository and say "run this work order." Runnable now, no gate. Written by the evolve scout lane on 2026-10-23 from a live measurement against production's own database.

## Operating clause (binding)

- Read CLAUDE.md first. CLAUDE.md overrides everything, including this file.
- Finish 100% in this session. Never end the turn with a question, an option list, or an unexecuted plan. A judgment call goes in one line of the final report; it never becomes a question that halts work.
- The only permitted stops are the CLAUDE.md stop-and-ask gates: spending real funds or any irreversible on-chain write, git push or a production deploy, posting to an external channel, committing content that names a crypto project other than $THREE, and destroying unrecoverable data. This order touches none of them: it edits one classification function, adds one test case, and runs an existing, documented, idempotent healing script against the live database (the same write path the production cron already performs every 10 minutes).
- No mocks, no fake data, no unfinished-work markers, no commented-out code, no widening a regex so far that it swallows a transient error class it should not. Every claim gets verified against the live database, not assumed from the code.
- The em-dash and en-dash characters are banned in everything you write.
- Concurrent agents share this worktree: stage explicit paths only (never `git add -A` or `git add .`), re-check `git status` and `git diff --staged` before committing.
- Before committing, run `npm run check:rules -- --paths <files you touched>`. It must exit 0.

## Why this matters (measured 2026-10-23, production database, `main` at `84a86a5bf`)

`curl -s https://three.ws/api/healthz` reports `agent_index` as **down**: "Solana: 3h1m median lag across 1720 agents (1h20m full sweep at 240/tick), **580 erroring (33.7%)**", well past the `SOLANA_ERROR_RATE_DOWN` threshold of 0.25 in `api/_lib/ops/index-lag.js`. `/agents` and every agent profile page read this index, and Solana leads it by design (CLAUDE.md: Solana first), so this is a live defect on the platform's core directory, not a secondary-chain nuisance.

Querying the live database directly groups the 580 errors into three classes:

| Class | Count | Cause | Self-heals today? |
|---|---|---|---|
| `solana rpc 429 @ <host>` | 425 | Paid RPC lanes exhausted (`rpc_lanes` degraded on the same healthz response). Owner action: top up/upgrade the RPC plans (`production-100-OWNER-ACTIONS.md`, the RPC-quota row). | Yes, once lanes recover; not this order's fix. |
| `solana rpc provider error -16401 @ api.tatum.io` | 6 | Tatum gates `getSignaturesForAddress` behind a paid tier; already in that lane's `blockedMethods` list per the live healthz response. Stale rows from before the method was blocked. | Yes, next successful crawl overwrites them. |
| **`solana rpc history not on node @ https://public.rpc.solanavibestation.com`** | **149** | **A real code gap: this error message is never recognized as a prunable cursor, so the self-heal that exists for the sibling error never fires. These agents are permanently wedged.** | **No. This is the fix.** |

Confirmed by reading `agent_event_cursor` for the third class: `last_indexed_at` is minutes old (the cron keeps retrying every tick, exactly as designed) but `last_event_at` is frozen as far back as mid-September for most rows, e.g. `GGfBcULgRsHUTVRSJCbi47bbZj4WJ5dzbJX1WyWcszDt` last indexed a real event on `2026-09-17`, `8kkys6HUoNHVahDHQs4JDmYedHGCxgjpEbXpySk3v4Dq` on `2026-09-16`. That agent has not had a single new on-chain event recorded for **over a month**, and the cron's own retry loop cannot see it: it reports `200` every time.

**Root cause, read end to end:**

1. `api/_lib/solana/connection.js:1194-1206` classifies the Solana JSON-RPC error code `-32020` ("history not on node") with `reason: 'history not on node'` and `noPenalty: true` (deliberately: another lane may hold the history, so this lane is not cooled or demoted).
2. The rotating fetch layer (`connection.js:1614`, `:1629`) throws `new Error(`solana rpc ${bad.reason} @ ${maskUrl(url)}`)` once every lane it tried has refused the same way, producing the exact string `solana rpc history not on node @ <host>`.
3. `api/_lib/solana-agent-events.js` catches that error through `signaturesSinceCursor()` in `api/_lib/solana/cursor-recovery.js`, which only treats an error as a prunable cursor (drop `until`, re-scan from the head) when `isPrunedCursorError()` returns true:
   ```js
   export function isPrunedCursorError(err) {
   	const msg = (err && typeof err === 'object' && 'message' in err ? String(err.message) : String(err || ''));
   	return /Transaction .* not found/i.test(msg) || /failed to get signatures for address/i.test(msg);
   }
   ```
   Neither regex matches `solana rpc history not on node @ <host>`. The function returns `false`, the original error re-throws, the cursor is never dropped, and the cron stamps the same dead `error` column forever (`docs/ops/agent-index.md` already documents this exact `last_indexed_at`-on-failure design, but its "self-healing" claim for this error class is wrong: the recovery path it describes was never wired to recognize this message shape).

The fix is one word of intent, not a new mechanism: this error means the same thing the two already-handled messages mean ("no lane we tried can resolve the stored cursor signature"), so it gets the same recovery.

## Step 0: re-derive the current state

```bash
git log --oneline -1
curl -s https://three.ws/api/healthz | node -e 'let d="";process.stdin.on("data",c=>d+=c).on("end",()=>{const j=JSON.parse(d);console.log(JSON.stringify(j.subsystems.subsystems.find(s=>s.name==="agent_index"),null,2))})'
node --env-file=.env.local -e "import('./api/_lib/db.js').then(async({sql})=>{console.table(await sql\`select regexp_replace(error,'[1-9A-HJ-NP-Za-km-z]{32,}','<sig>','g') as shape, count(*)::int as n from agent_event_cursor where chain='solana' and error is not null group by 1 order by 2 desc limit 15\`);process.exit(0)})"
grep -n "isPrunedCursorError" api/_lib/solana/cursor-recovery.js tests/solana-attestations-cursor-recovery.test.js
```

If the `history not on node` count is already 0, another agent fixed this; verify the regex in `cursor-recovery.js` covers it, confirm the test exists, and skip to Definition of Done. If the live counts differ meaningfully from the table above, trust the live numbers; they are this order's actual target, not the table.

## Tasks

1. **Fix the classifier.** In `api/_lib/solana/cursor-recovery.js`, extend `isPrunedCursorError()` to also recognize the `history not on node` message shape produced by `connection.js`'s `reason: 'history not on node'` path. Match it narrowly, by the literal phrase the code actually emits (`history not on node`), not a broad pattern that could catch an unrelated "history" substring elsewhere. Update the function's doc comment to name the third message shape, mirroring the existing two-shape explanation.
2. **Extend the regression test.** In `tests/solana-attestations-cursor-recovery.test.js`, add a case asserting `isPrunedCursorError(new Error('solana rpc history not on node @ https://example.com'))` is `true`, alongside the existing `PRUNED` and `'Transaction abc123 not found'` cases. Keep the existing negative cases (`429`, `fetch failed`, `null`) passing, since those must still propagate rather than drop the cursor.
3. **Update the doc.** `docs/ops/agent-index.md`'s error-classes table already lists `failed to get signatures for address: Transaction <sig> not found` as "Self-healing." Add the `history not on node` row (or fold it into the same row, since the fix makes them behave identically) so the table matches what the code now does, and correct the "Both legs now recover on their own" paragraph if it implied this class already recovered.
4. **Drain the live backlog.** This is the same write path the production cron performs every 10 minutes; running it now just collapses a month of accumulated backlog into one pass instead of waiting out the sweep cycle (documented, idempotent, safe to re-run per the script's own header):
   ```bash
   node --env-file=.env.local scripts/heal-agent-event-cursors.mjs            # report only first
   node --env-file=.env.local scripts/heal-agent-event-cursors.mjs --apply
   ```
   Expect the `history not on node` class to drop toward 0 (some rows may re-fail if the lane that answers this time still cannot resolve a truly pruned signature anywhere; that residual is legitimate and should be reported, not forced).
5. **Re-measure.** Re-run the Step 0 `healthz` and database queries. Record the before/after `580/1720 (33.7%)` figure and the new one. Do not expect the RPC-429 class (425 rows) to clear: that is the separate, owner-gated RPC-quota row, out of scope here.

## Definition of done

- [ ] `isPrunedCursorError()` returns `true` for the `history not on node` message shape and the new test case passes: `npx vitest run tests/solana-attestations-cursor-recovery.test.js` exits 0.
- [ ] `npm run test:core` shows no new failures introduced by this change (compare against the Step 0 baseline if the suite was already red for unrelated reasons).
- [ ] `node --env-file=.env.local scripts/heal-agent-event-cursors.mjs --apply` has been run against production and its final line (`agent_event_cursor now: X/1720 erroring (Y%)`) is quoted in the report, with Y materially below 33.7%.
- [ ] The `history not on node` row-count in `agent_event_cursor` (same query as Step 0) is reported before and after; it must have dropped, ideally to 0 or close to it.
- [ ] `docs/ops/agent-index.md`'s error-classes table reflects the fixed behavior.
- [ ] `npm run check:rules -- --paths api/_lib/solana/cursor-recovery.js tests/solana-attestations-cursor-recovery.test.js docs/ops/agent-index.md` exits 0.
- [ ] Committed as one topical commit (code + test together per the bug-fix-is-test-first rule; the doc and the heal-script run are not code changes so they can ride in the same commit or a second one, your call, each with an honest message).
- [ ] `git status --short` shows nothing left uncommitted from this order.

## Never blocked

| Blocker | Resolution (act, do not ask) |
|---|---|
| `.env.local` has no `DATABASE_URL` or the query fails | `.env.local` already exists in this worktree with production read access (used throughout this order's own research); if it is somehow missing, it is a credential gap covered by the `self-unblock-playbook` skill, not a reason to stop. |
| The RPC-429 class (425 rows) does not clear after the heal run | Expected and out of scope; it clears when the paid RPC lanes recover or are topped up (owner action, already tracked). Report the number, do not chase it. |
| A `history not on node` row still fails after the fix | Some signatures may genuinely be unresolvable on every lane right now (a transient full-fleet outage at that moment). Re-run the heal script once more; if a residual remains, report the exact count and move on, it will keep retrying every cron tick like any other agent. |
| `npm run test:core` is red for unrelated reasons (tracked in orders 401/402) | Compare only the files this order touches; do not attempt to fix unrelated red tests here. |

## Report format

1. Before/after table: total erroring, `history not on node` count, overall error rate percentage, each with the exact command used to measure it.
2. The diff to `cursor-recovery.js` and the new test, inline or by commit SHA.
3. The heal script's final output line, verbatim.
4. Anything parked (a residual count that did not clear, and why).
