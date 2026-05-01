# 49 — vite.config.js: verify build config is correct after changes

## Status
Verification — `vite.config.js` appears in git status as modified. This must be reviewed before shipping to ensure the build doesn't have unintended changes.

## File
`vite.config.js`

## What to do

1. Run `git diff vite.config.js` to see exactly what changed
2. Confirm the changes are intentional (not accidental edits from tooling)
3. If the diff is empty or the changes are correct, mark done
4. If there are unintended changes, restore the file: `git checkout vite.config.js`

## Common safe changes to vite.config.js in this project

- Adding new entry points for test pages
- Adjusting asset inclusion patterns (e.g. to bundle `walk.json` correctly)
- Setting `assetsInclude` for GLB or JSON animation files

## Common dangerous changes

- Removing `build.lib` config (breaks the CDN library build)
- Changing `rollupOptions.external` (changes what's bundled vs external)
- Removing the `public` directory from static assets

## Verification

```bash
git diff vite.config.js
```

If the diff shows intentional changes, run a production build to verify:
```bash
npm run build
```

Build should complete with zero errors. Output should include the expected entry points.
