# parity 15: launch a coin by mentioning @trythreews on X

How to run: paste this file's repo path into a fresh Claude Code chat in this repository and say "run this work order". Band 900: reading mentions may need a paid X API tier (a new paid API needs approval), and replying on X is posting to an external channel. Build and prove the whole flow in dry-run mode; going live is one env change the owner approves.

## Operating clause (binding)

- Read CLAUDE.md first, then [_context/parity-00-CONTEXT.md](_context/parity-00-CONTEXT.md). CLAUDE.md overrides everything, including this file.
- Finish 100% in this session. Never end the turn with a question, an option list, or an unexecuted plan. A judgment call goes in one line of the final report; it never becomes a question that halts work.
- The only permitted stops are the CLAUDE.md stop-and-ask gates: spending real funds or any irreversible on-chain write, git push or a production deploy, committing content that names a crypto project other than $THREE, and destroying unrecoverable data. Where this order hits one, it says so, and you batch every such ask into ONE message after everything else is done.
- Never name Competitor X in anything you commit. If a reference is unavoidable, write "Competitor X".
- No mocks, no fake data, no placeholder stubs, no unfinished-work markers, no commented-out code. Real APIs and real integrations only.
- The em-dash and en-dash characters are banned in everything you write.
- Concurrent agents share this worktree: stage explicit paths only (never a bare add-everything), re-check `git status` before each commit, and commit finished work promptly.
- Before committing, run `npm run check:rules -- --paths <files you touched>`. It must exit 0.

## Status (2026-10-24)

Built and committed: `api/_lib/x-mention-launch.js` (prefilled `/launch` link reply, no spend path), wired in `composeAnswer` of `api/_lib/x-mention-poll.js`, tests in `tests/x-mention-launch.test.js`, docs in `docs/x-mention-bot.md` ("Launch by mention"), STRUCTURE row, changelog entry. The reader, cron (`/api/cron/x-mentions`), cursor, dedupe, per-author limits and dry-run default already existed (x-grok orders 046 to 050). Mentions are readable on the current X credentials (`prompts/x-grok/_generated/mentions-probe.json`, HTTP 200).

## Status (2026-11-14)

Production runs commit `518f61469`, which includes the launch work; `/api/cron/x-mentions` returns 200 every two minutes. The ledger holds 1,227 decisions, every one `dry_run = true` with no `reply_tweet_id`, and none with `intent = 'launch'`: no real author has posted a launch mention yet.

Evidence instead: `scripts/x-mention-launch-dry-run.mjs` sent launch posts through `handleMention` (the cron's own function) into the production ledger under `account_ref = 'trythreews-evidence'`. Results in `prompts/x-grok/_generated/launch-dry-run.json`: `launch_unlinked`, `launch_malformed` and `launch_reserved_ticker` each recorded with `dry_run = true`, no `reply_tweet_id`, and every link in the reply returning 200. That run caught a bug, now fixed test-first: a launch post with a missing or reserved ticker got the generic make-a-model help instead of the launch grammar (`launchHelpReply` in `api/_lib/x-mention-launch.js`).

`launch_link` cannot be shown on real data yet: production has zero X-linked accounts (`social_connections` has no `x` rows; `agent_x_connections` and `user_identities` are empty), so `reachableAuthors = 0`. The branch is covered by `tests/x-mention-launch.test.js` through `handleMention`.

## What remains

1. **`launch_link` on real data.** Once any account connects X (via `/x/claim`) and owns an agent with a body, run `node scripts/x-mention-launch-dry-run.mjs` (an admin's own connected X account is picked automatically, or pass `--linked-x-id`) and confirm the `launch_link` row. Owner: the owner, by connecting their own X account.
2. **Going live.** No paid X tier is needed at current volume (mentions read 200, 300 reads per 15 minutes). The owner sets `X_MENTION_BOT_LIVE=1` (order 928) once the dry-run decisions look right.

Delete this file once item 1 is confirmed.
