---
mode: agent
description: "Remove dead code, unused dependencies, and fix package.json metadata"
---

# Cleanup: Dead Code & Package Metadata

## Tasks

### 1. Fix `package.json` `main` field
- Change `"main": "public/app.js"` → `"main": "src/app.js"`
- The file `public/app.js` does not exist; the real entry point is `src/app.js`

### 2. Remove unused dependency `@avaturn-live/web-sdk`
- Listed in `dependencies` but never imported anywhere in the codebase
- Only `@avaturn/sdk` is used (in `src/avatar-creator.js`)
- Run `npm uninstall @avaturn-live/web-sdk`

### 3. Delete dead API endpoint
- `api/avaturn-session.js` explicitly says `"This file is no longer used. Safe to delete."`
- It returns a 410 Gone response — remove the file entirely

### 4. Remove unused `IS_IOS` constant
- In `src/viewer.js`, the constant `const IS_IOS = isIOS()` is computed but never referenced
- Remove the constant declaration
- Check if the `isIOS()` function at the bottom of the file is used elsewhere — if not, remove it too

### 5. Fix test script
- `package.json` has `"test": "node test/gen_test.js"` but no `test/` directory exists
- Either create a minimal test scaffold (see `add-tests.md` prompt) or change to `"test": "echo 'No tests configured' && exit 0"` as a placeholder

## Validation

- `npm install` should succeed without warnings about missing dependencies
- `npm run build` should succeed
- `npm test` should not crash
- No dead imports or unused variables in modified files
