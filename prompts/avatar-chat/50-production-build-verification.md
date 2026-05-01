# 50 — Production build verification

## Status
Required final step — run the full production build, check bundle size impact, confirm no regressions in the existing feature set, and verify the avatar-chat feature works end-to-end in the built output (not just in Vite dev mode).

## Commands to run

```bash
# 1. Build animations (should already be done — walk.json exists)
npm run build:animations

# 2. Build the main app and library
npm run build

# 3. Check bundle size diff
# Walk.json is 106kB (already built). No new JS dependencies were added.
# Verify the element.js additions haven't ballooned the bundle:
ls -lh dist/assets/*.js | sort -k5 -h

# 4. Check for build errors
# Any TypeScript/JSDoc annotation errors, missing imports, etc.

# 5. Preview the production build
npm run preview
# Then open http://localhost:4173 and run through the manual QA checklist (prompt 43)
```

## What to verify in production build

### No new dependencies
```bash
git diff package.json package-lock.json | grep '^\+'
```
Should show no new `dependencies` or `devDependencies` from the avatar-chat work.

### Animation manifest is correct
```bash
cat public/animations/manifest.json | python3 -m json.tool | grep '"name"'
```
Should include `"walk"` entry.

### walk.json exists and is valid
```bash
ls -lh public/animations/clips/walk.json
node -e "JSON.parse(require('fs').readFileSync('public/animations/clips/walk.json','utf8')); console.log('valid')"
```

### No console errors in production
Open the production preview. Open DevTools console. Load an agent. Send a message. Should be zero errors.

### avatar-chat="off" still works in production
Add `avatar-chat="off"` to the element. Verify original bottom-bar layout renders correctly.

## Regression checklist

- [ ] Existing animations (dance, wave, celebrate) still play via the animation strip
- [ ] Chat messages still render correctly with sentiment tinting
- [ ] Tool calls (if applicable) still display tool cards
- [ ] Voice mode (browser TTS) still works
- [ ] Floating mode pill collapse/expand works on mobile viewport
- [ ] Agent identity card still loads
- [ ] Memory still persists across page refreshes

## Sign-off

Mark this prompt complete only after running through ALL items above with zero failures.
