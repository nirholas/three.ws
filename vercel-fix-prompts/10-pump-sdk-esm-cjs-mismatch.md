# Fix: @pump-fun/pump-sdk ESM Module Loading Failure

## Problem

`/api/agents/[id]` returns 500 with a warning about ES module loading failure:

```
[api] unhandled /var/task/node_modules/@pump-fun/pump-sdk/dist/esm/index.js:8905
Failed to load the ES module
```

This indicates an ESM/CJS interop issue where the bundler or runtime cannot load the ESM version of `@pump-fun/pump-sdk`.

## What to investigate

1. Check `@pump-fun/pump-sdk`'s `package.json` — look at the `exports`, `main`, and `module` fields to understand what module formats it publishes.
2. Check how the SDK is imported in the codebase (named imports, default import, dynamic import).
3. Check Node.js version on Vercel (set in `package.json` `engines` field or `.nvmrc`). ESM support varies by Node version.
4. Check if `vercel.json` or `next.config.js` has any `esmExternals` or `transpilePackages` config that might affect this package.

## Expected fix

Option A: Force the CJS build by importing from the CJS entry point:
```js
// Instead of: import { X } from '@pump-fun/pump-sdk'
const { X } = require('@pump-fun/pump-sdk');
// or import from CJS path:
import { X } from '@pump-fun/pump-sdk/dist/cjs/index.js';
```

Option B: Add the package to `transpilePackages` in `next.config.js`:
```js
transpilePackages: ['@pump-fun/pump-sdk']
```

Option C: Update to a version of the SDK that has proper dual CJS/ESM exports.

Confirm `/api/agents/[id]` no longer crashes with the ESM load failure after the fix.
