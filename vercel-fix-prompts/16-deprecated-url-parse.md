# Fix: Deprecated url.parse() Usage (DEP0169)

## Problem

474+ instances of this deprecation warning across many endpoints:

```
(node:4) [DEP0169] DeprecationWarning: 'url.parse()' behavior is not standardized and may change.
Use the WHATWG URL API instead.
```

While this doesn't cause failures today, Node.js may remove `url.parse()` in a future version, and it's polluting logs making real errors harder to find.

## What to investigate

1. Search the entire codebase for `url.parse(` to find all usages.
2. Also check `node_modules` for the warning source — it may come from a dependency, not your own code. Run with `--trace-warnings` locally to get a stack trace pointing to the exact file.

## Expected fix

Replace `url.parse()` with the WHATWG URL API:

```js
// Before:
const { hostname, pathname, query } = url.parse(rawUrl, true);

// After:
const parsed = new URL(rawUrl);
const hostname = parsed.hostname;
const pathname = parsed.pathname;
const params = Object.fromEntries(parsed.searchParams);
```

If the warnings come from a dependency (not your code):
- Check if there's a newer version of the dependency that has switched to the WHATWG URL API.
- Update the dependency.
- If no fix is available, consider filing an issue with the upstream package.

Note: suppress the deprecation warning only as a last resort — prefer fixing the root cause.
