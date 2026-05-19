# Cleanup task: remove root-level JS helpers

## Goal

Two ad-hoc JS files live at the repo root:

- `commit.js` — auto-commits + pushes as a hard-coded identity. It
  rewrites `git config user.name`/`user.email` globally, hard-codes a
  commit message, and silently swallows errors with `catch (e) {}`. It
  has no callers in the codebase. Delete it.
- `run-trigger.js` — a 4-line wrapper that does `execSync('bash
  trigger-bazaar.sh')`. Trivial; users can just invoke the shell script
  directly. Delete it.

Neither script is referenced by `package.json`, the build, or any other
tracked file (verify before deleting).

## Inputs (verify before acting)

```
git grep -nE '(^|[^A-Za-z])(commit|run-trigger)\.js' \
  | grep -vE '^(commit|run-trigger)\.js:'    # exclude self-matches
```

If anything comes back, stop and surface it — there's a hidden caller
that needs to be retargeted first.

## Steps

1. `git rm commit.js run-trigger.js`

That's it — no replacement, no docs to update (the files have no
documented usage).

## Acceptance criteria

1. `ls commit.js run-trigger.js 2>&1` → both report "No such file".
2. `git grep -nE '(^|[^A-Za-z])(commit|run-trigger)\.js'` returns
   nothing.
3. `npm test` still passes the same tests as before this task (no
   regressions caused by the deletion — these files weren't imported by
   any test).

## Commit

```
git -c user.name=nirholas -c user.email=nirholas@users.noreply.github.com \
    commit -m "chore(root): remove unused commit.js and run-trigger.js helpers"
```

The commit must also include deleting this prompt file
(`prompts/cleanup-root/04-root-js-scripts.md`).
