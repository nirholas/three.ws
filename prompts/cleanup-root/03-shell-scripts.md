# Cleanup task: relocate root shell scripts into scripts/

## Goal

Three shell scripts sit at the repo root: `claude.sh`, `gitpretty.sh`,
`trigger-bazaar.sh`. They belong in `scripts/` next to the other
shell/Node helpers (`scripts/fetch-animations.sh`,
`scripts/quick-fetch-anims.sh`, …). Move them and update every
reference.

## Inputs (verify before acting)

```
ls *.sh                                       # claude.sh gitpretty.sh trigger-bazaar.sh
git grep -nE '(^|[^/])(claude|gitpretty|trigger-bazaar)\.sh'
```

Known callers (re-confirm with the grep above before editing):

- `package.json`  — `"claude": "./claude.sh"`
- `run-trigger.js` — `execSync('bash trigger-bazaar.sh', …)`
  (this file will be deleted in a separate task — fix the path here
  anyway so this prompt remains independent.)

## Steps

1. `git mv claude.sh scripts/claude.sh`
2. `git mv gitpretty.sh scripts/gitpretty.sh`
3. `git mv trigger-bazaar.sh scripts/trigger-bazaar.sh`
4. In `package.json`, change `"claude": "./claude.sh"` to
   `"claude": "./scripts/claude.sh"`.
5. In `run-trigger.js`, change `bash trigger-bazaar.sh` to
   `bash scripts/trigger-bazaar.sh`. (If `run-trigger.js` has already
   been deleted by another task, skip this step silently.)
6. After moves, confirm executable bits are preserved
   (`ls -l scripts/claude.sh scripts/gitpretty.sh scripts/trigger-bazaar.sh`);
   `chmod +x` any that lost the bit.

## Acceptance criteria

1. `ls *.sh` at repo root prints nothing.
2. `ls scripts/{claude,gitpretty,trigger-bazaar}.sh` lists all three with
   the `x` permission bit set.
3. `git grep -nE '(^|[^/])(claude|gitpretty|trigger-bazaar)\.sh'` shows
   only references that include the `scripts/` prefix.
4. `npm run claude --help 2>/dev/null || true; head -1 scripts/claude.sh`
   — the path resolves (script still has a shebang and is invokable).
   The `npm run claude` script does not need to succeed end-to-end
   (it may spawn a long-running tool); the goal is just to confirm
   Node finds the file.

## Commit

```
git -c user.name=nirholas -c user.email=nirholas@users.noreply.github.com \
    commit -m "chore(root): move shell scripts into scripts/"
```

The commit must also include deleting this prompt file
(`prompts/cleanup-root/03-shell-scripts.md`).
