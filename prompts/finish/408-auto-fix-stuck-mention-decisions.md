# 408. Stop the X mention bot from permanently orphaning mentions at decision=null

How to run: paste this file's repo path into a fresh Claude Code chat in this repository and say "run this work order". Runnable now, no gate, no owner action required except the final ship (commit only; this session cannot push). Written 2026-10-24 from a live measurement, not a document.

Binding clause: follow `CLAUDE.md` in this repo exactly (bug fixes are test-first: reproduce with a failing test before touching the fix; commit the test and the fix together). Nothing here needs push, deploy, spend, a signature, or a non-$THREE coin reference, so no gate in CLAUDE.md blocks finishing this order end to end in one session.

## Measurement (2026-10-24)

`curl -s https://three.ws/api/healthz` reports the `x_mention_bot` subsystem as `degraded`:

```
"detail": "oldest undecided mention is 20852m old (limit 10m)"
```

That is a real, live gap, not a flaky probe: a direct read of `x_mention_events` (via `node --env-file=.env.local` against the production `DATABASE_URL`) shows exactly 3 rows stuck at `decision IS NULL` since 2026-10-09, 15 days before this was written, with zero progress in between:

```json
[
  { "tweet_id": "7514357880548491265", "account_kind": "company", "account_ref": "trythreews-evidence", "intent": "ignore", "decision": null, "created_at": "2026-10-09T16:15:28.846Z" },
  { "tweet_id": "7514357880548491266", "account_kind": "company", "account_ref": "trythreews-evidence", "intent": "ignore", "decision": null, "created_at": "2026-10-09T16:15:28.965Z" },
  { "tweet_id": "7514357880548491267", "account_kind": "company", "account_ref": "trythreews-evidence", "intent": "ignore", "decision": null, "created_at": "2026-10-09T16:15:29.001Z" }
]
```

Root cause, read directly from the code:

1. `api/_lib/x-mention-store.js` `recordMention()` inserts a mention row with `decision = null` and returns `{ inserted: true }` only for the *first* caller for a given `tweet_id` (`on conflict (tweet_id) do nothing`). Every later call for the same id returns `{ inserted: false }`.
2. `api/_lib/x-mention-poll.js` `handleMention()` calls `recordMention()` at line 121, then runs `await paused(env)` (line 124) and the `parsed.intent === 'ignore'` branch (lines 129-132) **outside** its own `try { ... } catch` block, which only wraps lines 134-201.
3. If anything throws between the insert (line 121) and the start of that `try` (line 134), the thrown error propagates out of `handleMention` uncaught by its own inner handler. `pollAccount()`'s caller loop (lines 257-266) catches it, logs it, and deliberately stops the batch *without* advancing the cursor, exactly as documented: "Only ever throws for a store failure on the mention row itself, which the caller treats as 'not fully recorded' and stops the batch there."
4. That contract is correct when the insert itself failed, but wrong here: the row **was** inserted. On the next poll tick, the same mention comes back, `recordMention()` now returns `inserted: false` (the row already exists), `handleMention()` takes the `if (!inserted) return { decision: 'duplicate' }` early return at line 122, and the loop proceeds normally. The orphaned row never gets a decision, never gets retried, never gets logged as an error, and nothing in the codebase ever revisits it. `readMentionBotSignals()` (`api/_lib/x-mention-health.js`) has no way to tell "wedged forever" apart from "about to be decided", so it just reports growing lag.
5. The 3 rows found are not real X traffic: `account_ref: 'trythreews-evidence'` is the synthetic marker used by `scripts/x-mention-make-dry-run.mjs`, `scripts/x-mention-avatar-dry-run.mjs`, and `scripts/x-mention-image3d-dry-run.mjs` specifically "so they never appear in the real account's review console or rate limits" (their own comments). `readMentionBotSignals()`'s query (`api/_lib/x-mention-health.js` lines 66-80) has no `account_ref` filter at all, so these evidence rows feed the live health signal anyway, and whichever dry-run invocation created them on 2026-10-09 hit the same orphan path and never finished. That is a second, independent bug: evidence data is leaking into a production health metric by design gap, not by the dry-run scripts misbehaving.

Both bugs are real and both are fixable without any owner action. This is a live production defect (the healthz dashboard has been wrong for 15 days) and it is also a latent reliability gap for real mentions: any transient failure in `paused(env)` (a DB read) between insert and the inner try (a real possibility, `isPaused()` has no timeout of its own) would orphan a genuine user's mention the same way, with zero error visibility, forever.

## Tasks

1. **Reproduce first.** Add a test to `tests/x-mention-poll.test.js` (near the existing "does not advance the cursor past a mention that failed to record" case around line 154) that: records a mention successfully (so `recordMention` returns `inserted: true`), then makes the `paused` dependency passed into `handleMention` throw. Assert that after the call, `getMentionEvent(tweetId)` (or the store mock's recorded state) does **not** have `decision: null` forever, i.e. assert the row ends up with `decision: 'error'`. Run `npx vitest run tests/x-mention-poll.test.js` and confirm this new test fails against the current code (the row currently stays `null`, or the test throws instead of recording).
2. **Fix the orphan path.** In `api/_lib/x-mention-poll.js`, widen the `try` block in `handleMention()` so it starts immediately after the `recordMention()` call succeeds (i.e. move the `await paused(env)` check and the `ignore`-intent check inside the `try`, ahead of the `guard()` call), so that any throw from that point forward always reaches the existing `catch` at line 197 and is written back via `store.updateDecision(mention.id, { decision: 'error', ... })`. Keep the early `if (!inserted) return { decision: 'duplicate' }` outside the try (that path never inserted a decision-less row owned by this caller). Re-run the test from step 1 and confirm it now passes.
3. **Stop evidence data from polluting the live health signal.** In `api/_lib/x-mention-health.js`, add an `and account_ref not like '%-evidence'` (or equivalent, matching the exact marker the three dry-run scripts use) to the `readMentionBotSignals()` query in `api/_lib/x-mention-health.js` (the `select ... from x_mention_events` block, lines 66-80), so synthetic dry-run rows never again feed `unprocessed`, `oldest_unprocessed_at`, `decided_last_hour`, `errors_last_hour`, `replies_24h`, `handles_served`, or `median_reply_seconds`. Add a unit test to `tests/x-mention-health.test.js` (or `tests/x-mention-store.test.js`, wherever a DB-backed test fixture already exists for this table) proving a row with `account_ref` ending `-evidence` is excluded from `readMentionBotSignals()`'s counts while a normal row is still counted.
4. **Clean up the 3 live orphaned rows.** Write a small one-off script (model it on the throwaway pattern already used for diagnosis: `node --env-file=.env.local <script>`, delete the script after running it, never commit it) that calls `updateDecision('7514357880548491265', { decision: 'skip', reason: 'backfill_orphan_cleanup_order_408' })` and the same for `...266` and `...267`. Do not delete the rows outright (auditability); do not touch any row that is not one of these exact 3 known tweet ids. This is data correction on synthetic test rows, not destruction of real data, and it directly resolves the live healthz symptom.
5. Re-run `curl -s https://three.ws/api/healthz | python3 -c "import json,sys;d=json.load(sys.stdin);print([s for s in d['subsystems']['subsystems'] if s['name']=='x_mention_bot'])"` after step 4 lands (production reads live each request, no deploy needed for this specific check since the fix in step 4 is a data change, not a code change) and confirm the detail no longer cites a 20000+ minute lag. Note: steps 2 and 3 are code changes that need the next deploy to take effect in production; say so plainly in the report rather than claiming the live healthz reflects them before a deploy ships.
6. Run `npm test -- tests/x-mention-poll.test.js tests/x-mention-health.test.js tests/x-mention-store.test.js` and confirm all green.
7. Append a dated entry to `prompts/finish/_context/production-100-PROGRESS.md` noting the orphan-decision fix and the evidence-filter fix, each with the commit SHA.

## Done when

- The new regression test from Task 1 exists, is committed, and passes.
- `api/_lib/x-mention-poll.js`'s `handleMention()` never again leaves an inserted row at `decision: null` on an unhandled throw; `api/_lib/x-mention-health.js` excludes `*-evidence` account refs from its aggregate query.
- The 3 known orphaned rows (`7514357880548491265/266/267`) carry a non-null decision.
- `npm test -- tests/x-mention-poll.test.js tests/x-mention-health.test.js tests/x-mention-store.test.js` exits 0.
- This file is removed with a dated entry in `prompts/finish/_context/production-100-PROGRESS.md` citing the commit SHA(s).

## Never blocked

| Looks like a blocker | It is not | Do this |
|---|---|---|
| Need production DB credentials to verify the 3 rows | `.env.local` already has `DATABASE_URL` for this project (same database healthz reads) | `node --env-file=.env.local <script>.mjs`, delete the script after use |
| Fixing `handleMention()` might change other decisions' behavior | The only change is *where* the try block starts; every existing branch's logic and return shape is untouched | Run the full `x-mention-*` test suite (not just the new test) before committing |
| The 3 orphaned rows might be real user mentions, risky to touch | `account_ref` is literally `trythreews-evidence`, the documented synthetic marker; `intent: 'ignore'` confirms they were never going to post anything | Mark them `decision: 'skip'`, do not delete, do not touch any other row |
| Can't confirm the healthz fix without a deploy | Code fixes (steps 2-3) need a deploy to show in the live endpoint; the data fix (step 4) does not | Say plainly in the report which part is verified live now and which needs the next deploy |

## Report format

State: the failing test's exact assertion and error before the fix, the same test green after, the diff to `x-mention-poll.js` and `x-mention-health.js`, the 3 tweet ids updated and their new decision, the full test command and its exit code, and the PROGRESS.md entry added. Note explicitly that steps 2-3 are code awaiting the next deploy to affect the live healthz endpoint.
