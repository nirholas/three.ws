# parity 14: pricing levers (API key tiers with enforced limits, a $THREE deposit bonus)

How to run: paste this file's repo path into a fresh Claude Code chat in this repository and say "run this work order". Band 900: prices and limits are owner decisions. Build both levers so each is a config change, with defaults that reproduce today's behaviour exactly, then ask.

## Operating clause (binding)

- Read CLAUDE.md first, then [_context/parity-00-CONTEXT.md](_context/parity-00-CONTEXT.md). CLAUDE.md overrides everything, including this file.
- Finish 100% in this session. Never end the turn with a question, an option list, or an unexecuted plan. A judgment call goes in one line of the final report; it never becomes a question that halts work.
- The only permitted stops are the CLAUDE.md stop-and-ask gates: spending real funds or any irreversible on-chain write, git push or a production deploy, committing content that names a crypto project other than $THREE, and destroying unrecoverable data. Where this order hits one, it says so, and you batch every such ask into ONE message after everything else is done.
- Never name Competitor X in anything you commit. If a reference is unavoidable, write "Competitor X".
- No mocks, no fake data, no placeholder stubs, no unfinished-work markers, no commented-out code. Real APIs and real integrations only.
- The em-dash and en-dash characters are banned in everything you write.
- Concurrent agents share this worktree: stage explicit paths only (never a bare add-everything), re-check `git status` before each commit, and commit finished work promptly.
- Before committing, run `npm run check:rules -- --paths <files you touched>`. It must exit 0.

## What remains (everything else shipped; verified 2026-10-24)

The mechanisms this order asked for already exist, under different names:

- Enforced tiers: developer plans (`api/_lib/dev-plans/config.js`: Free, Builder, Scale, Enterprise) with monthly quota, per-minute burst and concurrency enforced in `api/_lib/gateway.js` via `api/_lib/dev-plans/quota.js` (tests: `tests/dev-plans-quota.test.js`, `tests/dev-plans-config.test.js`). Visible on the dashboard at `src/dashboard-next/pages/developers-plan.js` (used, limit, reset); documented in `docs/api-reference.md` and `docs/developer-plans.md`.
- Deposit bonus lever: `THREE_CREDIT_BONUS_BPS` (default 0) read by `creditBonusBps()`, credited as a separate `deposit.three_bonus` grant, shown on the credits page (tests: `tests/credit-deposit-assets.test.js`).

Remaining, owner-owned: the pricing proposal. Read production `usage_events` (kind `api`) for the per-key monthly call distribution (needs working gcloud/DB access; the env reader timed out in the 2026-10-24 session), then send the owner one message proposing plan limits and prices and a `THREE_CREDIT_BONUS_BPS` value, each with reasoning, asking yes/no per lever. On a yes, change only `config.js` or the env var.

## Close out

Delete this file once the owner has answered on each lever and the config reflects the answer. Never delete on a partial.
