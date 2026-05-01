# Fix: Syntax Error in @bonfida/spl-name-service ESM Bundle

## Problem

`/api/pump-fun-mcp` returns 500 due to a syntax error in a dependency's ESM bundle:

```
SyntaxError in /var/task/node_modules/@bonfida/spl-name-service/dist/esm/instructions/burnInstruction.js:1
```

The ESM build of `@bonfida/spl-name-service` has a syntax error, which means either:
- The installed version is corrupt or incompatible with the Node.js version on Vercel.
- There is an ESM/CJS conflict causing the wrong bundle to be loaded.

## What to investigate

1. Check the version of `@bonfida/spl-name-service` in `package.json`.
2. Look at the actual content of `burnInstruction.js:1` in `node_modules/@bonfida/spl-name-service/dist/esm/` to understand the specific syntax issue.
3. Check if a newer version of the package fixes this (look at the package's GitHub releases/changelog).
4. Check if the package is supposed to be imported as CJS instead of ESM — look at the package's `main` vs `module` fields in its `package.json`.

## Expected fix

Option A: Update `@bonfida/spl-name-service` to a version that has a valid ESM bundle.

Option B: If the package doesn't have a working ESM build, force CJS import by adding to your bundler/build config:
```json
// vercel.json or next.config.js
"transpilePackages": ["@bonfida/spl-name-service"]
```
or in Next.js `next.config.js`:
```js
experimental: { esmExternals: false }
```

Option C: Pin the last known-good version of the package.

After fixing, confirm `/api/pump-fun-mcp` loads without syntax errors.
