# 409. Reconcile the evolve branch: it is 113 commits behind main and every order run from here inherits stale measurements

How to run: paste this file's repo path into a fresh Claude Code chat in this repository and say "run this work order". Runnable now, no gate, no owner action required except the final ship (commit only; this session cannot push). Written 2026-10-24 from a live measurement, not a document.

Binding clause: follow `CLAUDE.md` in this repo exactly, in particular the commit-message rules (describe the diff, no generic subjects) and the concurrent-agents rule (stage explicit paths, re-check `git status`/`git diff --staged` immediately before every commit; other agents may be committing on `main` or `evolve` while this runs). Merging `main` into `evolve` is a normal, reversible git operation on this worktree's own branch; it is not a push, deploy, or destructive action, so no CLAUDE.md gate blocks it.

## Measurement (2026-10-24)

This worktree's `evolve` branch (`HEAD`) has diverged hard from `main`:

```
$ git log --oneline main..HEAD | wc -l
15
$ git log --oneline HEAD..main | wc -l
113
$ git diff --stat $(git merge-base HEAD main) main -- pages/ api/ | tail -1
 131 files changed, ~12000 insertions(+), ... deletions(-)
```

`main` carries 113 commits of already-shipped, already-deployed product surface that this worktree's checkout does not have, including entire pages (`pages/creator-payouts.html`, `pages/earnings.html`, `pages/agent-earnings.html`, `pages/why-three-ws.html`, `pages/compete.html`, `pages/agent-predictions.html`, `pages/skills-community.html`) and API routes (`api/forge-keep.js`, `api/revenue/[...route].js`, `api/native-launch/[action].js`, `api/v1/chat/completions.js`, several `api/skills/*` files). Production already serves these (confirmed live: `curl -s -o /dev/null -w '%{http_code}' https://three.ws/creator-payouts.html` returns 200).

This is not cosmetic. It actively corrupts scouting and order-writing from this worktree:

- `npm run audit:links` on this branch flags `/creator/payouts/?` -> `pages/creator-payouts.html` as a dangling route, because the file is missing *here*, even though it exists on `main` and in production. A scout session that does not check `main` first would write a false "missing page" bug order for a feature that already shipped.
- `CLAUDE.md`'s own cron-count sentence has drifted twice over: this branch's copy says `"the crons (145 as of 2026-10-23, see vercel.json)"`, this branch's `vercel.json` actually has 147 crons, and `main`'s copy already reads `"the crons (150 as of 2026-10-24, see vercel.json)"` matching `main`'s `vercel.json` (150 crons) exactly. `npm run gate` is a single `&&`-chained command of ~55 steps; its 2nd step, `check:claude`, fails on this exact drift and aborts the entire chain, silently hiding the pass/fail status of every other audit in the chain for every order run from this worktree until now.
- Every future scout/queue cycle in this worktree risks re-diagnosing bugs `main` already fixed, duplicating features `main` already shipped, and hitting merge conflicts that compound the longer this goes unreconciled.

`evolve`'s own 15 unique commits are today's scout/queue housekeeping and small fixes (`chore(prompts)`, `fix(orb)`, etc, see `git log --oneline main..HEAD`); none of them touch the same files as the 113 main-only commits in a way that looks unresolvable (checked via the file lists above: no overlap in `pages/*.html` or the new `api/` routes). A straight merge of `main` into `evolve` is the right shape, not a rebase: several `main`-side files (for example `prompts/finish/_context/production-100-OWNER-ACTIONS.md`) are already cited elsewhere by commit SHA, and a rebase would rewrite this branch's 15 commit SHAs and break those references for no benefit; a merge keeps every existing SHA intact on both sides and still leaves `main` as an ancestor of the result, which is exactly what the evolve runner needs to fast-forward-land this branch later.

A trial merge run during this scouting pass (`git merge --no-commit --no-ff main`, immediately aborted without committing) hit no content conflicts; it only refused because this worktree's tree had pre-existing uncommitted changes to 5 generated files (`data/upstream-baseline.json`, `public/changelog-recent.json`, `public/changelog.json`, `public/features.json`, `public/sitemap/index.html`) that differ from `main`'s committed versions of the same files. Those are build outputs (changelog/sitemap/feature-list derivations); handle them as part of Task 1 below, they are not a reason to skip the merge.

## Tasks

1. Check `git status --short`. If the 5 generated files above (or others) are dirty with uncommitted changes, decide per file whether they are regenerable build output (most likely: run the generator script that produces each, e.g. `npm run build:pages`, and let the merge or the regeneration supersede the dirty copy) or real uncommitted work from another concurrent agent in this worktree (if so, commit that work with its own explicit-path, descriptive commit first, per the concurrent-agents rule, before touching the merge). Never run `git checkout --` or `git clean` blindly; inspect each file's diff first.
2. With a clean tree, run `git merge main` on the `evolve` branch (not a rebase, see justification above). Resolve any conflicts that appear; given the trial run found none in file content, expect this to be mostly mechanical, but re-verify since other agents may have committed to either branch since this order was written.
3. After the merge commits cleanly, regenerate derived files that depend on content from both sides: `npm run build:pages` (changelog/sitemap/features), and anything `npm run check:claude` names as still-drifted.
4. Run `npm run check:claude` and fix any remaining drift it reports (it should now match, since `main`'s copy was already correct and the merge brings that forward).
5. Run `npm run audit:links` and confirm the `/creator/payouts/?` dangling-route false positive (and any other route this divergence caused) is gone.
6. Run `npm run gate` to completion (it was never runnable past step 2 on this branch before the merge; this is the first real signal of the full chain's state post-merge). Record which steps, if any, still fail; do not attempt to fix unrelated pre-existing failures in this order, file a new order for anything genuinely new, and cross-reference anything that matches an already-open order (`401`, `403`) instead of duplicating it.
7. Run `npm run test:core` and compare its pass/fail counts against this session's pre-merge measurement (52 failed files / 108 failed tests, per order `401`) to see whether the merge changed the baseline; update `401` with a note if the numbers moved, do not rewrite its own investigation.
8. Commit the merge and the regenerated derived files with explicit paths and a commit message describing that this reconciles the evolve branch onto main (name the commit count and the fact that it unblocks `npm run gate` and `check:claude`), following the house commit-message format.

## Done when

- `git log --oneline HEAD..main | wc -l` is `0` (main is a full ancestor of evolve's HEAD).
- `npm run check:claude` exits 0.
- `npm run audit:links` no longer flags `/creator/payouts/?`.
- `npm run gate` runs past its former step-2 failure (whether or not every later step is clean; later failures become their own findings, not blockers to closing this order).
- This file is removed with a dated entry in `prompts/finish/_context/production-100-PROGRESS.md` citing the merge commit SHA and the post-merge `npm run gate` summary.

## Never blocked

| Looks like a blocker | It is not | Do this |
|---|---|---|
| Merge conflicts appear | A trial run found none; if they appear now it means something landed on either branch since this was written, still routine | Resolve file by file, favoring `main`'s version for anything derived/generated and this branch's version only where its 15 commits intentionally changed the same line |
| Dirty working tree blocks `git merge` | Pre-existing uncommitted generated-file diffs, not an unmergeable state | Follow Task 1: regenerate or commit, never discard blindly |
| `npm run gate` still fails after the merge | Expected; this order only unblocks the chain past step 2, it does not guarantee every later step is clean | Report exactly which steps fail post-merge; open a fresh numbered order only for anything not already covered by `401`/`403` |
| Another agent is mid-commit on `evolve` right now | The worktree is explicitly shared; this is routine, not a reason to stop | Re-run `git status`/`git log` immediately before merging and before committing, per the concurrent-agents rule |
| Rebasing looks "cleaner" than merging | It would rewrite this branch's 15 commit SHAs, breaking existing citations by SHA elsewhere in the repo, for no actual benefit | Merge, do not rebase, per the justification above |

## Report format

State: the pre-merge `main..HEAD`/`HEAD..main` commit counts, what Task 1 found in the dirty tree and how it was resolved, whether the merge hit any real conflicts and how they were resolved, the full post-merge `npm run gate` output summary (which steps pass/fail now), the `npm run test:core` counts compared to order `401`'s baseline, and the final merge commit SHA.
