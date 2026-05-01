# Fix: remove stale `[id]/` helper directory → clean up duplicate + Vercel build confusion

## What is broken

The repo has two copies of the agent sub-route helpers:

```
api/agents/[id]/        ← OLD — must be deleted
api/agents/_id/         ← CORRECT — already in use
```

`api/agents/[id].js` already imports from `_id/` correctly. The old `[id]/` directory
was left behind after the rename. Vercel's file-system scanner sees the `[id]/` directory
and tries to deploy its files as additional serverless functions under the dynamic-route
namespace — causing duplicate deployments, build warnings, and potential routing confusion.

Additionally, `api/agents/_id/memory/[cid].js` still uses a bracket filename (the `[cid]`
rename from `04-memory-cid-bracket-filename.md` may not be done yet). The import in
`api/agents/[id].js` currently reads `./_id/memory/[cid].js`, which Vercel's nft tracer
will miss. That is handled in a separate prompt — do not fix it here.

## Current state

```
api/agents/[id]/         ← exists, stale — delete this entire directory
  _sub.js
  embed.js
  livekit-token.js
  memory/
    [cid].js
    pin.js
  pricing/
    index.js
    [skill].js
  voice.js

api/agents/_id/          ← exists, correct — keep, do not touch
  _sub.js
  embed.js
  livekit-token.js
  memory/
    [cid].js
    pin.js
  pricing/
    index.js
    [skill].js
  voice.js

api/agents/[id].js       ← correct, already imports from ./_id/ — do not change
```

## Fix

### Step 1 — delete the stale `[id]/` directory

```bash
rm -rf "api/agents/[id]"
```

Note: use quotes — the `[` and `]` characters require quoting in bash.

### Step 2 — verify

```bash
# Should output "no such file or directory":
ls "api/agents/[id]" 2>&1

# Should still exist:
ls api/agents/_id/

# Imports in [id].js should all reference _id/ — confirm zero [id]/ references:
grep "\./\[id\]/" "api/agents/[id].js"
# Expected: no output
```

### Step 3 — confirm no import breakage

Open `api/agents/[id].js` and scan through every `import()` call. Each one should
reference `./_id/` — not `./[id]/`. If you find any that still say `./[id]/`, update
them to `./_id/` (though this should already be done).

## Constraints

- Delete ONLY `api/agents/[id]/` (the directory). Do not touch `api/agents/[id].js`
  (the Vercel function file).
- Do not change any files inside `api/agents/_id/` — they are correct.
- Do not change `vercel.json` — the route rewrites pointing to `api/agents/[id]` are
  correct (they reference the `.js` function file, not the directory).
- This is a deletion. No logic changes, no new code.

## Done when

- `api/agents/[id]/` directory no longer exists.
- `api/agents/_id/` directory still exists with all helper files intact.
- `api/agents/[id].js` has zero references to `./[id]/` (run `grep "\./\[id\]/" "api/agents/[id].js"` to verify).
- `npx vercel build` (or local Vercel CLI) completes without "duplicate function" warnings.
