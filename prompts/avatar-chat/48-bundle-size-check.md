# 48 — Bundle size audit: no unintended dependency growth

## Status
Required — the avatar-chat feature should add zero new npm dependencies. All new code is pure DOM, CSS, and calls to existing Three.js APIs. Verify this before shipping.

## What to check

### 1 — No new imports in modified files

Check that no new `import` statements were added to:
- `src/element.js`
- `src/runtime/index.js`
- `src/runtime/providers.js`
- `src/agent-protocol.js`

Run:
```bash
git diff main --name-only | xargs grep "^import" | grep -v "from '\.\." | grep -v "from 'three"
```

Any new third-party import (`from 'some-lib'`) would be a problem. The only acceptable new imports are from `'three'` (e.g. `THREE.Vector3` for head tracking in prompt 13) or relative paths within the project.

### 2 — Animation clip size (already built)

The walk clip is 106kB (uncompressed JSON). It will gzip to ~30-40kB. This is acceptable for a lazy-loaded asset that isn't in the main bundle.

Verify it's lazy-loaded (not inlined into the JS bundle):
```bash
grep -r "walk.json" src/
```
Should only appear in the manifest and in the AnimationManager loading logic — never as a static import.

### 3 — Build output size

Run the library build and compare before/after:
```bash
npm run build:lib 2>&1 | grep "dist/"
```
(Or whatever build command produces the distributable.) The main bundle should not grow by more than ~3KB (gzip) for the avatar-chat JS additions.

### 4 — CSS in BASE_STYLE

The new CSS added to `BASE_STYLE` in `element.js` is a string literal — it's included in the JS bundle but adds negligible size (~1.5KB unminified → ~400B gzip).

## Acceptable size budget

| Addition | Max size (gzip) |
|---|---|
| New JS in element.js | +2KB |
| New JS in runtime/index.js | +0.5KB |
| New JS in runtime/providers.js | +1KB |
| New CSS in BASE_STYLE | +0.5KB |
| walk.json animation clip | 30-40KB (lazy, not bundled) |
| **Total JS bundle growth** | **< 4KB gzip** |

## Verification
Run `npm run build` or `npm run dev:lib`. Compare bundle sizes before and after the avatar-chat commits. No new npm dependencies in `package.json`.
