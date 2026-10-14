# 405. Wire signed run receipts into the live forge tool handlers

Written by the evolve scout lane on 2026-10-14, during order 404's close-out, from a gap order 404 found but correctly judged outside its own scope (it predates the divergence order 404 reconciled).

How to run: paste this file's repo path into a fresh Claude Code chat in this repository and say "run this work order". Runnable now, no gate.

## Operating clause (binding)

- Read CLAUDE.md first. CLAUDE.md overrides everything, including this file.
- Finish 100% in this session. Never end the turn with a question, an option list, or an unexecuted plan. A judgment call goes in one line of the final report; it never becomes a question that halts work.
- The only permitted stops are the CLAUDE.md stop-and-ask gates: spending real funds or any irreversible on-chain write, git push or a production deploy, posting to an external channel, committing content that names a crypto project other than $THREE, and destroying unrecoverable data. This order touches none of them.
- No mocks, no fake data, no unfinished-work markers, no commented-out code, no `it.skip` to make a failure disappear.
- The em-dash and en-dash characters are banned in everything you write.
- Concurrent agents share this worktree: stage explicit paths only (never `git add -A` or `git add .`), re-check `git status` and `git diff --staged` before each commit.
- Before committing, run `npm run check:rules -- --paths <files you touched>`. It must exit 0.

## Why this matters

`api/_mcp-studio/receipts.js` (common ancestor commit `a83f8e8ce`, so it predates the evolve/main split) defines `openRun`/`closeRun`/`attachReceipt`: a signed, per-stage run receipt (expected vs observed, a `/runs` page, replay) for every job a forge tool starts. On `main`, this got fully wired into `api/_mcp-studio/tools.js`'s job-starting handlers (`forge_free`, `text_to_avatar`, `mesh_forge`, `rig_mesh`, `forge_avatar`) through two internal helpers, `finishMesh`/`finishRig` (last shipped on `main` at commit `41e8e201a`, "fix(forge): stop discarding every director brief, and make run receipts name why a brief fell back"). On `evolve`, a parallel, independent feature landed instead: `api/_mcp-studio/job-tools.js`'s idempotency-key/`collectJob` architecture (`1396f1146`, "feat(mcp-studio): get_job, idempotency_key and progress notifications so agent retries never generate twice"), with no receipt wiring at all.

The earlier evolve/main reconciliation merge (`d77b89178`, 2026-10-11) kept evolve's idempotency-key architecture in `tools.js` and did not bring `main`'s `finishMesh`/`finishRig`/receipt wiring across. The result, confirmed live today (2026-10-14): `openRun`/`closeRun` are defined in `receipts.js` and imported by nothing except that file's own test (`tests/run-receipt.test.js`); `grep -rn "openRun\|closeRun" api/` outside `receipts.js` and its test returns nothing. Every forge tool generates for real users today with no signed receipt, no `/runs` page entry, and no replay record. `tests/run-receipt.test.js` documents this with a skipped test (`it.skip('records a full forge_avatar run: ...')`, in `describe('studio wiring')`) whose comment used to point at a progress file that was never created; order 404 corrected that pointer to this file.

This is a real combine, not a mechanical copy: whichever handler shape wins has to keep BOTH the idempotency-key retry contract (`ctx.onJob`, `jobOpts`, `newTicket`, the `get_job` tool `job-tools.js` registers) and the receipt contract (`openRun` at the start of a handler, `closeRun` at every return, `finishMesh`/`finishRig` as the shared tail for the two-stage tools). That is why order 404 did not attempt it mid-merge unattended, and why it is its own order now instead of inline reconciliation debt.

## Step 0: re-derive the current state

    grep -n "openRun\|closeRun" api/_mcp-studio/receipts.js api/_mcp-studio/tools.js
    sed -n '1,120p' api/_mcp-studio/receipts.js
    sed -n '580,860p' api/_mcp-studio/tools.js
    git show 41e8e201a:api/_mcp-studio/tools.js | sed -n '1,620p'   # main's last wired version, for reference only; do not restore verbatim, it predates job-tools.js entirely

## Tasks

1. Design the combined shape: each job-starting handler in `tools.js` (`forge_free`, `text_to_avatar`, `mesh_forge`, `rig_mesh`, `forge_avatar`) opens a run with `openRun(tool, {...})` before generating, and every return path (success, pending/timeout, refused, failed) closes it with `closeRun(run, result, {...})`, exactly as `main`'s `finishMesh`/`finishRig` did, but built on top of the current idempotency-key control flow (`jobOpts`, `ctx.onJob`, `newTicket`) rather than replacing it.
2. Re-add `finishMesh`/`finishRig` (or equivalently named shared tails) so the five handlers do not each hand-roll receipt open/close bookkeeping.
3. Resolve the "second conflicting `get_job` tool registration" the old `run-receipt.test.js` comment flagged between `job-tools.js` and `tools.js`'s own job-status path, so there is exactly one `get_job`/`check_job` status core, matching the existing comment at `api/_mcp-studio/tools.js:27`.
4. Un-skip `tests/run-receipt.test.js`'s `'records a full forge_avatar run: fallback brief, tier downgrade, and a rig verified from the file'` test and make it pass for real against the wired handler, plus add coverage for the other four job-starting tools' receipts.
5. Confirm `/runs` (whatever page or endpoint reads receipts today) renders a receipt produced by a real `forge_avatar` call end to end.

## Definition of done

- [ ] `grep -rn "openRun\|closeRun" api/` shows real call sites inside `tools.js`'s job-starting handlers, not just `receipts.js` and its own test.
- [ ] `tests/run-receipt.test.js` has no `it.skip` left in `describe('studio wiring')`; `npx vitest run tests/run-receipt.test.js` is fully green.
- [ ] A real `forge_avatar` (or `forge_free`) call in dev produces a receipt visible wherever receipts are surfaced (check `src/receipts.js` / the `/runs` page for the actual surface).
- [ ] `npm run test:core` shows no new failures versus the baseline measured at the start of this order.

## Never blocked

| Blocker | Resolution (act, do not ask) |
|---|---|
| Unsure which handler shape should "win" | Combine, per the operating clause: keep the idempotency-key contract live (it is what retries depend on today) and add receipt open/close around it, not instead of it. |

## Close out (required)

1. Verify every Definition of done line with the actual command output in front of you.
2. Commit with explicit paths and a subject that describes the diff.
3. If every Definition of done line passes, delete this file in that same commit and append a dated entry to [_context/production-100-PROGRESS.md](_context/production-100-PROGRESS.md) with the commit SHAs. If a line cannot pass this session, leave this file in place and log exactly which line remains.
4. Final report: what step 0 measured; what changed; evidence for each Definition of done line; one-line judgment calls. No trailing questions.
