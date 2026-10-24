# 414. Register `docs/simready-assets.md` in `data/pages.json`, or mark it deliberately unpublished

How to run: paste this file's repo path into a fresh Claude Code chat in this repository and say "run this work order". Runnable now, no gate, no owner action required.

## Operating clause (binding)

- Read CLAUDE.md first. CLAUDE.md overrides everything, including this file.
- Finish 100% in this session. Never end the turn with a question, an option list, or an unexecuted plan.
- The only permitted stops are the CLAUDE.md stop-and-ask gates (spend/on-chain writes, push/deploy, posting externally, committing content referencing a crypto project other than `$THREE`, destroying unrecoverable data). This order touches none of them.
- Concurrent agents share this worktree: stage explicit paths only (never `git add -A` or `git add .`), re-check `git status` and `git diff --staged` before committing.
- The em-dash and en-dash characters are banned in everything you write.

## Step 0: re-derive the current state

    npm run audit:docs

As measured 2026-10-24, this reports exactly 2 findings:

    Public docs missing from data/pages.json (live but undiscoverable) (2):
      docs/awesome-solana-ai-submission.md  served at /docs/awesome-solana-ai-submission but absent from data/pages.json...
      docs/simready-assets.md  served at /docs/simready-assets but absent from data/pages.json, so no crawler can find it. Add an entry there, or add the slug to UNPUBLISHED_DOCS in this script with the reason it stays unpublished.

The first line (`docs/awesome-solana-ai-submission.md`) is already tracked by order 410; do not touch it here, do not duplicate it. This order is scoped to the second line only: `docs/simready-assets.md`.

Confirm the doc shipped recently without a pages.json entry, and that this is not an in-flight edit another agent is mid-way through:

    git log --oneline -- docs/simready-assets.md
    grep -n "simready" data/pages.json

Expect one commit (`660b5ad97` or similar, "add the NVIDIA SimReady asset pipeline...") and zero hits in `data/pages.json`. If `data/pages.json` already has a `simready` entry (another agent shipped this first), skip straight to retiring this order per the table below.

## Task

1. Read `docs/simready-assets.md` in full (29 lines). It documents the NVIDIA SimReady CC BY 4.0 asset-conversion pipeline (`scripts/ingest-simready.py`, `scripts/simready-to-glb.py`, `scripts/slim-glb.mjs`, `scripts/publish-simready.mjs`, `scripts/build-object-library.mjs`) and is explicitly cross-linked from `docs/object-library.md` and `docs/3d-asset-pipeline.md`'s "Related" sections (and vice versa), so it is clearly meant to be a discoverable, ongoing user-facing doc, the same category as its siblings already in `data/pages.json` (`/docs/object-library`, `/docs/character-library`, `/docs/3d-asset-pipeline`), not a one-time internal packet.
2. Add an entry for it in `data/pages.json`, matching the shape and section used by the sibling doc entries (see `/docs/object-library` around line 5341 of `data/pages.json` as the closest sibling, same docs section/array). Use:
   - `"path": "/docs/simready-assets"`
   - `"title": "Docs: SimReady Assets"`
   - A `description` summarizing the doc in the same style as its siblings (one or two sentences, CC BY 4.0 licensing and what it covers), written from the doc's actual content, not invented.
   - `"priority": 0.7` and `"changefreq": "monthly"` to match the sibling entries in that array.
3. Run `npm run audit:docs` and confirm only the `docs/awesome-solana-ai-submission.md` finding remains (owned by order 410), and the `docs/simready-assets.md` line is gone.
4. Run `npm run audit:links` to confirm no new dangling/broken link resulted from the `data/pages.json` edit.
5. Run `npm run check:rules -- --paths data/pages.json` and fix anything it flags.

## Done when

- `npm run audit:docs` no longer lists `docs/simready-assets.md`.
- `npm run audit:links` shows no new broken/dangling entries caused by this change.
- `git diff` shows only the new `data/pages.json` entry (plus whatever `check:rules` required).
- This file is removed, with a dated entry added to `prompts/finish/_context/production-100-PROGRESS.md` (create it with a one-line header if it does not exist) citing the fix commit SHA.

## Never blocked

| Looks like a blocker | It is not | Do this |
|---|---|---|
| Another agent already fixed this | Routine for a shared worktree | Re-run `npm run audit:docs` first (step 0); if the `simready-assets` line is already gone, retire this order without a code change |
| Unsure whether the doc should be public or internal | The doc's own content and its two-way cross-links from `docs/object-library.md` and `docs/3d-asset-pipeline.md` already settle this: it is meant to be discoverable, matching its siblings that are already in `data/pages.json` | Add the `data/pages.json` entry per the task; do not route this one to `UNPUBLISHED_DOCS` |
| Tempted to also fix the `docs/awesome-solana-ai-submission.md` line while in here | That finding belongs to order 410, written separately and already in `prompts/finish/` | Leave it untouched; touching it here would make two orders fight over the same line |

## Report format

State: the step-0 `npm run audit:docs` result, the exact `data/pages.json` entry added, the post-fix `npm run audit:docs` and `npm run audit:links` output, and the commit SHA.
