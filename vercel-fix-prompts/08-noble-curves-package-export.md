# Fix: @noble/curves Package Subpath Export Error

## Problem

`/api/auth/siws/verify` returns 500 due to:

```
Error [ERR_PACKAGE_PATH_NOT_EXPORTED]: Package subpath './ed25519' is not defined
by "exports" in /var/task/node_modules/@noble/curves/package.json
```

This is a package version incompatibility — the code imports `@noble/curves/ed25519` but the installed version of `@noble/curves` does not export that subpath.

## What to investigate

1. Find all imports of `@noble/curves` in the codebase, particularly any that import `@noble/curves/ed25519`.
2. Check the installed version of `@noble/curves` in `package.json` and `package-lock.json`/`yarn.lock`.
3. Check the `@noble/curves` changelog — the `./ed25519` subpath export was added in a specific version. Identify the minimum version that exports it.
4. Check if another dependency is pulling in an older version of `@noble/curves` that conflicts with the one declared in `package.json`.

## Expected fix

- Update `@noble/curves` to the version that supports `./ed25519` subpath export (likely `^1.0.0` or later).
- If a transitive dependency is pinning an older version, use `overrides` (npm) or `resolutions` (yarn) in `package.json` to force the correct version:
  ```json
  "overrides": {
    "@noble/curves": "^1.4.0"
  }
  ```
- Run `npm install` and redeploy. Confirm `/api/auth/siws/verify` no longer errors.
