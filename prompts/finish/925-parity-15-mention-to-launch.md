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

## What remains

1. **Real dry-run tick evidence.** After the next deploy (order 919 owns deploys), read `/x/ops` (or `x_mention_events` where `intent = 'launch'`) and confirm launch mentions show `reason = launch_link` with `dry_run = true` and no `reply_tweet_id`. Owner: whoever deploys.
2. **Owner message.** Tier: no paid tier is needed at current volume (mentions read 200, 300 reads per 15 minutes). Ask the owner to set `X_MENTION_BOT_LIVE=1` (order 928) once the dry-run decisions look right.
3. **Cron count.** `npm run check:claude` reports CLAUDE.md says 145 crons but `vercel.json` has 150; unrelated to this order, owned by whoever added the five crons.

Delete this file once item 1 is confirmed.
