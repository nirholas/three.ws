# Cleanup task: relocate working/internal docs into docs/internal/

## Goal

Four working documents sit at the repo root and dilute the canonical
top-level docs (README, LICENSE, CONTRIBUTING, CODE_OF_CONDUCT, CLAUDE):

- `NEXT.md`     — `/loop` blockers & decisions for the user
- `PROGRESS.md` — running progress log
- `STATUS.md`   — scheduled-agent run log (one line per run)
- `TODO.md`     — open TODOs

`docs/internal/` already exists (see `docs/internal/SETUP.md`,
`docs/internal/DEVELOPMENT.md`). Move these four files there so the
top-level docs are limited to repo-canonical files.

## Inputs (verify before acting)

```
ls NEXT.md PROGRESS.md STATUS.md TODO.md
ls docs/internal/                                         # confirm dir exists
git grep -nE '\b(NEXT|PROGRESS|STATUS|TODO)\.md\b' \
  | grep -vE '^(NEXT|PROGRESS|STATUS|TODO)\.md:'          # exclude self-matches
```

Self-references inside these files (e.g. `STATUS.md` mentioning
`TODO.md`) are fine — their relative paths still resolve once both files
are siblings under `docs/internal/`. External references (anywhere
*outside* these four files) must be updated. Common suspects:

- `CLAUDE.md` instructions that point at "see TODO.md" or "log to STATUS.md"
- `.claude/`, `.github/`, or task files telling agents where to write

Update any such references to use the new `docs/internal/<name>.md` path.

## Steps

1. `git mv NEXT.md docs/internal/NEXT.md`
2. `git mv PROGRESS.md docs/internal/PROGRESS.md`
3. `git mv STATUS.md docs/internal/STATUS.md`
4. `git mv TODO.md docs/internal/TODO.md`
5. For every external reference found by the grep above, rewrite the
   path from `NEXT.md` → `docs/internal/NEXT.md` (same for the others).
   If a reference is a bare filename used as an instruction (e.g.
   "log progress to PROGRESS.md") rewrite to the new full path so
   future agents land in the right place.

## Acceptance criteria

1. `ls NEXT.md PROGRESS.md STATUS.md TODO.md 2>&1` → all four report
   "No such file" at the repo root.
2. `ls docs/internal/{NEXT,PROGRESS,STATUS,TODO}.md` lists all four.
3. `git grep -nE '\b(NEXT|PROGRESS|STATUS|TODO)\.md\b'` does not show
   any path that omits the `docs/internal/` prefix (except matches that
   are inside the files themselves and are intentionally relative).

## Commit

```
git -c user.name=nirholas -c user.email=nirholas@users.noreply.github.com \
    commit -m "chore(root): move working docs (NEXT/PROGRESS/STATUS/TODO) into docs/internal/"
```

The commit must also include deleting this prompt file
(`prompts/cleanup-root/05-working-docs.md`).
