# Task: Remove accidentally-cloned experiments/eips-ercs directory

## Context

`/workspaces/3D-Agent/experiments/eips-ercs` is an accidentally-cloned external repository that was committed into this project. It's unrelated to the 3D avatar / AI chat purpose of this project and adds significant bloat.

Check `/workspaces/3D-Agent/experiments/` — there should be a README or note indicating `eips-ercs` was an accidental clone.

## What to do

1. Verify the directory is not referenced anywhere:
```bash
grep -r "eips-ercs" /workspaces/3D-Agent --include="*.js" --include="*.ts" --include="*.svelte" --include="*.go" --include="*.json" | grep -v "node_modules" | grep -v ".git"
```

If no results, proceed.

2. Delete the directory:
```bash
rm -rf /workspaces/3D-Agent/experiments/eips-ercs
```

3. Stage the deletion and commit:
```bash
git add -A
git commit -m "remove accidentally-cloned eips-ercs experiment"
```

## Verification
- `ls /workspaces/3D-Agent/experiments/` should not show `eips-ercs`
- `git status` should be clean after the commit
- No build or import errors after deletion
