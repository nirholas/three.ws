# Cleanup task: walk-*.png scratch screenshots

## Goal

Five PNG files in the repo root (`walk-after.png`, `walk-before.png`,
`walk-multi-A.png`, `walk-multi-B.png`, `walk-smoke.png`) are output
artifacts written by `scratch/walk-smoke.tmp.mjs` — scratch test
screenshots that should never have been checked in. Remove them, make
the scratch script write to a non-tracked subdirectory, and ignore that
subdirectory in git.

## Inputs (verify before acting)

```
ls walk-*.png                                # the 5 files
grep -n "screenshot" scratch/walk-smoke.tmp.mjs   # write paths
git grep -nE "walk-(after|before|smoke|multi-[AB])\.png"   # who references them
```

Only `scratch/walk-smoke.tmp.mjs` should reference these names. If any
other source references them, surface the hits before deleting — those
references may need to be retargeted.

## Steps

1. `git rm walk-after.png walk-before.png walk-multi-A.png
   walk-multi-B.png walk-smoke.png`
2. Edit `scratch/walk-smoke.tmp.mjs` so every
   `page.screenshot({ path: 'walk-*.png', ... })` writes into
   `scratch/screenshots/` instead (e.g.
   `path: 'scratch/screenshots/walk-before.png'`). Create the directory
   at script startup with `mkdirSync('scratch/screenshots', { recursive: true })`.
3. Append a single line to `.gitignore` so future runs don't re-pollute:
   ```
   scratch/screenshots/
   ```
   Only add the line if it's not already present.

## Acceptance criteria

1. `ls walk-*.png` at repo root → "No such file or directory" (or empty).
2. `scratch/walk-smoke.tmp.mjs` no longer mentions a bare `walk-*.png`
   path; all screenshot paths live under `scratch/screenshots/`.
3. `.gitignore` contains `scratch/screenshots/`.
4. `node scratch/walk-smoke.tmp.mjs --help` (or whatever the script's
   no-op invocation is) does not error from a missing directory. If the
   script has no flag-based exit, dry-check by running it briefly and
   confirming files land under `scratch/screenshots/`. If the script
   needs a running dev server to do anything, skip the dry-run and just
   confirm the path constants in source.

## Commit

```
git -c user.name=nirholas -c user.email=nirholas@users.noreply.github.com \
    commit -m "chore(root): remove walk-*.png scratch screenshots; redirect smoke output"
```

The commit must also include deleting this prompt file
(`prompts/cleanup-root/02-walk-screenshots.md`).
