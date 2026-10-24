# 410. Register `docs/awesome-solana-ai-submission.md` in `data/pages.json`, or mark it deliberately unpublished

How to run: paste this file's repo path into a fresh Claude Code chat in this repository and say "run this work order". Runnable now, no gate, no owner action required.

## Operating clause (binding)

- Read CLAUDE.md first. CLAUDE.md overrides everything, including this file.
- Finish 100% in this session. Never end the turn with a question, an option list, or an unexecuted plan.
- The only permitted stops are the CLAUDE.md stop-and-ask gates (spend/on-chain writes, push/deploy, posting externally, committing content referencing a crypto project other than `$THREE`, destroying unrecoverable data). This order touches none of them.
- Concurrent agents share this worktree: stage explicit paths only (never `git add -A` or `git add .`), re-check `git status` and `git diff --staged` before committing.
- The em-dash and en-dash characters are banned in everything you write.

## Step 0: re-derive the current state

    npm run audit:docs

Confirm it still reports exactly this finding (it may have already been fixed by another agent; if `npm run audit:docs` is already clean, verify that, then retire this order the same way described below instead of making a change):

    Public docs missing from data/pages.json (live but undiscoverable) (1):
      docs/awesome-solana-ai-submission.md  served at /docs/awesome-solana-ai-submission but absent from data/pages.json, so no crawler can find it.

This was surfaced by order 409 (evolve/main reconciliation merge) as a pre-existing gap: the doc was added by main commit `0e0a806cd` ("docs(parity): add the awesome-solana-ai submission kit...") without a matching `data/pages.json` entry, so it has been live and undiscoverable since that commit, unrelated to the merge itself.

## Task

1. Read `docs/awesome-solana-ai-submission.md` to confirm what it documents and whether it is meant to be a crawlable, linked-to doc page or an internal-only submission kit (check whether anything in the repo links to `/docs/awesome-solana-ai-submission`; `npm run audit:links` output and a `grep -rn 'awesome-solana-ai-submission'` across `pages/`, `docs/`, and `prompts/` will show this).
2. If it is meant to be discoverable (the common case for `docs/*.md`): add an entry for it in `data/pages.json`, matching the shape and section used by sibling doc entries already there (title, description, path `/docs/awesome-solana-ai-submission`, section, dates).
3. If it is deliberately internal (for example, a one-time submission packet for a third-party directory rather than ongoing user-facing documentation): add its slug to the `UNPUBLISHED_DOCS` map in `scripts/audit-docs.mjs` (around line 287) with a one-line reason, following the existing entries' format exactly.
4. Run `npm run audit:docs` and confirm the finding is gone.
5. Run `npm run audit:links` to confirm no new dangling/broken link resulted.
6. Run `npm run check:rules -- --paths <files you touched>` and fix anything it flags.

## Done when

- `npm run audit:docs` exits with 0 findings.
- `npm run audit:links` shows no new broken/dangling entries caused by this change.
- This file is removed with a dated entry in `prompts/finish/_context/production-100-PROGRESS.md` citing the fix commit SHA.

## Never blocked

| Looks like a blocker | It is not | Do this |
|---|---|---|
| Unsure whether the doc should be public or internal | The doc's own content and whether anything already links to it settles this | Read it; check for existing inbound links; default to publishing (the audit's own preferred fix) unless the content is clearly a one-time internal packet |
| Another agent already fixed this | Routine for a shared worktree | Re-run `npm run audit:docs` first (step 0); if clean, retire this order without a code change |

## Report format

State: the step-0 `npm run audit:docs` result, which of the two fixes was applied and why, the post-fix `npm run audit:docs` and `npm run audit:links` output, and the commit SHA.
