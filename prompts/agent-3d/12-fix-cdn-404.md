---
id: 12-fix-cdn-404
title: Fix agent-3d CDN 404 — publish dist/agent-3d/ and lock the deploy pipeline
area: deploy
---

# Fix: agent-3d CDN 404

## Problem

`https://three.ws/agent-3d/latest/agent-3d.js` returns 404.
Every page on three.ws that loads the `<agent-3d>` web component is broken.

Root cause: `npm run publish:lib` was not run before the last Vercel deploy.
The script `scripts/publish-lib.mjs` copies `dist-lib/agent-3d.js` into
`dist/agent-3d/{version}/`, `dist/agent-3d/latest/`, etc.
That copy step was skipped, so the Vercel-deployed `dist/` has no `agent-3d/` subdirectory.

The Vercel project has **no `buildCommand` set** in `vercel.json`, so Vercel is
deploying whatever `dist/` is on disk — it does not run `npm run build:all` itself.

## What exists right now

| Path | Status |
|------|--------|
| `dist-lib/agent-3d.js` (1.9 MB ES module) | ✅ exists, built Apr 29 |
| `dist-lib/agent-3d.umd.cjs` (1.2 MB UMD) | ✅ exists |
| `dist/agent-3d/` | ❌ does not exist |
| `scripts/publish-lib.mjs` | ✅ correct, just never ran |

## Key files

- `package.json` — version is `1.5.1`; scripts: `build:lib`, `publish:lib`, `build:all`, `deploy`
- `scripts/publish-lib.mjs` — reads `dist-lib/`, copies to `dist/agent-3d/{version,major.minor,major,latest}/`, writes `dist/agent-3d/versions.json` and per-version `integrity.json`
- `vercel.json` lines 234–263 — three route patterns serving `/agent-3d/…` from the `dist/` tree

## Tasks — all must be real, no placeholders

### Task 1 — Run publish:lib and verify output

```
npm run build:lib
node scripts/publish-lib.mjs
```

Confirm these paths now exist and are non-empty files:

- `dist/agent-3d/1.5.1/agent-3d.js`
- `dist/agent-3d/1.5.1/agent-3d.umd.cjs`
- `dist/agent-3d/1.5.1/integrity.json`
- `dist/agent-3d/1.5/agent-3d.js`
- `dist/agent-3d/1/agent-3d.js`
- `dist/agent-3d/latest/agent-3d.js`
- `dist/agent-3d/versions.json`

Log the SRI hash for `agent-3d.js` from `versions.json` — you'll need it for the next task.

### Task 2 — Add buildCommand to vercel.json

Open `vercel.json`. Right now it has no top-level `buildCommand` or `outputDirectory`.

Add both so Vercel runs the full pipeline automatically on every production deploy:

```json
{
  "buildCommand": "npm run build:all",
  "outputDirectory": "dist"
}
```

Place them at the top of the JSON object (before `"routes"`).

Do not change any existing route entries.

### Task 3 — Add a pre-deploy guard script

Create `scripts/check-dist.mjs`. It must:

1. Check that each of these paths exists (use `existsSync` from `node:fs`):
   - `dist/agent-3d/latest/agent-3d.js`
   - `dist/agent-3d/latest/agent-3d.umd.cjs`
   - `dist/agent-3d/versions.json`
2. Parse `dist/agent-3d/versions.json` and confirm `latest` field matches `package.json` version.
3. If any check fails: print a descriptive error and `process.exit(1)`.
4. If all pass: print `[check-dist] OK — dist/agent-3d/latest/ ready for deploy` and exit 0.

Add it to `package.json` scripts:
```json
"check:dist": "node scripts/check-dist.mjs"
```

Update the `deploy` script in `package.json` to run the check before vercel:
```json
"deploy": "npm run build:all && npm run check:dist && vercel --local-config vercel.json --prod"
```

### Task 4 — Verify locally with a static server

Serve `dist/` on a local HTTP server (e.g. `npx serve dist -p 5000 --no-clipboard`) and confirm:

- `http://localhost:5000/agent-3d/latest/agent-3d.js` → 200, content-type `text/javascript`, ~1.9 MB
- `http://localhost:5000/agent-3d/1.5.1/agent-3d.js` → 200, same file
- `http://localhost:5000/agent-3d/versions.json` → 200, valid JSON with `latest: "1.5.1"`

## Success criteria

- [ ] `dist/agent-3d/latest/agent-3d.js` exists and is ≥ 1 MB
- [ ] `dist/agent-3d/versions.json` contains `"latest": "1.5.1"` and valid SRI hashes
- [ ] `npm run check:dist` exits 0
- [ ] `vercel.json` has `"buildCommand": "npm run build:all"` and `"outputDirectory": "dist"`
- [ ] Local static server serves all four paths above with 200
- [ ] `npm run deploy` runs `build:all → check:dist → vercel` in that order without error

## Do not

- Do not mock any file reads/writes — all paths must actually exist on disk
- Do not skip `npm run build:lib`; the `dist-lib/` files must be freshly generated before publish:lib reads them
- Do not change any `vercel.json` route entries (lines 234–263) — only add the top-level `buildCommand` / `outputDirectory`
- Do not modify `scripts/publish-lib.mjs` — it is correct as-is
