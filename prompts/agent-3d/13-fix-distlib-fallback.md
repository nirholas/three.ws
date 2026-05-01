---
id: 13-fix-distlib-fallback
title: Fix /dist-lib/ fallback — make the backup CDN path work in production
area: deploy
---

# Fix: /dist-lib/ fallback path in production

## Problem

`public/dashboard/dashboard.js` line 3295–3305 has a two-URL fallback chain for loading
the `<agent-3d>` web component:

```js
async function _ensureAgent3DLib() {
  if (customElements.get('agent-3d')) return true;
  const candidates = [
    '/agent-3d/latest/agent-3d.js',   // primary CDN path
    '/dist-lib/agent-3d.js'           // fallback
  ];
  for (const url of candidates) {
    try {
      await import(/* @vite-ignore */ url);
      if (customElements.get('agent-3d')) return true;
    } catch { /* try next */ }
  }
  return false;
}
```

The fallback `/dist-lib/agent-3d.js` only exists in the source tree (`dist-lib/agent-3d.js`).
Vercel deploys the `dist/` directory as the public root. `dist-lib/` is NOT inside `dist/`,
so the fallback URL hits 404 in production too.

In dev (vite serve) it works because Vite serves the whole project root.

## What exists right now

| Path | Accessible in production? |
|------|--------------------------|
| `dist-lib/agent-3d.js` (1.9 MB) | ❌ not under `dist/` |
| `dist/agent-3d/latest/agent-3d.js` | ❌ also missing (see prompt 12) |
| `dist/dist-lib/agent-3d.js` | ❌ does not exist |

## Goal

Make `/dist-lib/agent-3d.js` resolvable in production so the fallback chain actually
falls back instead of failing silently.

## Key files

- `dist-lib/agent-3d.js` — source file (ES module, ~1.9 MB, built by `npm run build:lib`)
- `dist-lib/agent-3d.umd.cjs` — UMD build (~1.2 MB)
- `scripts/publish-lib.mjs` — copies dist-lib → dist/agent-3d/, runs after build:lib
- `public/dashboard/dashboard.js` line 3297 — the fallback array
- `vercel.json` — routes config; `dist/` is the deployed root

## Tasks — all must be real, no placeholders

### Task 1 — Mirror dist-lib into dist in publish-lib.mjs

Open `scripts/publish-lib.mjs`.

After the existing loop that copies files to `dist/agent-3d/{channel}/` directories,
add a block that also copies both files into `dist/dist-lib/`:

```js
import { mkdirSync, writeFileSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const distLibMirror = resolve(root, 'dist', 'dist-lib');
mkdirSync(distLibMirror, { recursive: true });

for (const f of files) {
  if (f.skip) continue;
  const bytes = readFileSync(resolve(srcDir, f.name));
  writeFileSync(resolve(distLibMirror, f.name), bytes);
}

console.log(`[publish-lib] mirrored dist-lib → dist/dist-lib/`);
```

Insert this block before the final `console.log` lines. Reuse the already-read
`bytes` values if already in scope, or read the files again — either is fine as
long as the actual file bytes are written.

### Task 2 — Add vercel.json route for /dist-lib/

Open `vercel.json`. Add a route entry that serves `dist-lib/` with a short cache
(5 minutes — same as the mutable `/agent-3d/latest/` channel) so it can be refreshed
on new deploys:

```json
{
  "src": "/dist-lib/(.*)",
  "headers": {
    "cache-control": "public, max-age=300, s-maxage=300, stale-while-revalidate=86400",
    "access-control-allow-origin": "*",
    "cross-origin-resource-policy": "cross-origin"
  },
  "dest": "/dist-lib/$1"
}
```

Place this entry in the routes array **before** the catch-all route at the bottom
of the file. Do not change any existing entries.

### Task 3 — Verify the mirror in check-dist.mjs

If `scripts/check-dist.mjs` already exists (from prompt 12), add these checks to it.
If it does not exist, create it with at least these checks:

1. `dist/dist-lib/agent-3d.js` exists and is ≥ 1 MB
2. `dist/dist-lib/agent-3d.umd.cjs` exists and is ≥ 100 KB
3. Print `[check-dist] dist-lib mirror OK` if both pass; exit 1 with a clear message if not.

### Task 4 — Verify locally

Run:
```
npm run build:lib
node scripts/publish-lib.mjs
npx serve dist -p 5000 --no-clipboard
```

Then confirm with curl or a browser:

- `http://localhost:5000/dist-lib/agent-3d.js` → 200, `~1.9 MB`
- `http://localhost:5000/dist-lib/agent-3d.umd.cjs` → 200, `~1.2 MB`

Also confirm the primary path still works:

- `http://localhost:5000/agent-3d/latest/agent-3d.js` → 200

## Success criteria

- [ ] `dist/dist-lib/agent-3d.js` exists and matches `dist-lib/agent-3d.js` byte-for-byte after running `publish:lib`
- [ ] `dist/dist-lib/agent-3d.umd.cjs` exists and matches `dist-lib/agent-3d.umd.cjs`
- [ ] `vercel.json` has a `/dist-lib/(.*)` route with 5-minute cache headers
- [ ] Local static server returns 200 for both fallback URLs above
- [ ] `scripts/publish-lib.mjs` still passes `node --check` (no syntax errors)
- [ ] `npm run build:all` completes without error

## Do not

- Do not change the fallback array in `dashboard.js` — the URLs are correct; the files just need to exist
- Do not give `/dist-lib/` an immutable cache — these files are replaced on every build
- Do not remove or change the existing CDN routes for `/agent-3d/…` in vercel.json
- Do not create a new build script — add the mirror step inside the existing `scripts/publish-lib.mjs`
