# Fix: Deprecated fetchConnectionCache Option in Web3 Connections

## Problem

Multiple endpoints log this warning:

```
The 'fetchConnectionCache' option is deprecated (now always 'true')
```

This comes from `@solana/web3.js` — the `fetchConnectionCache` option was made the default and the explicit option was deprecated. While it's a warning (not an error), it's cluttering logs.

## What to investigate

1. Search the codebase for `fetchConnectionCache` to find all occurrences.
2. They will likely be in `new Connection(rpcUrl, { fetchConnectionCache: true })` calls.

## Expected fix

Remove the `fetchConnectionCache` option from all `Connection` constructor calls — since it's now always `true` by default, explicitly passing it is unnecessary:

```js
// Before:
const connection = new Connection(rpcUrl, { fetchConnectionCache: true, commitment: 'confirmed' });

// After:
const connection = new Connection(rpcUrl, { commitment: 'confirmed' });
```

Search for all instances and remove the deprecated option. This is a cleanup-only change with no functional impact.
