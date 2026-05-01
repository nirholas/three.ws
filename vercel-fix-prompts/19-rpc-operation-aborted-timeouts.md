# Fix: RPC Calls Timing Out / Being Aborted (2,770+ instances)

## Problem

The `index-delegations` cron job logs 2,770+ instances of:

```
{"stage":"index-delegations","chainId":11155111,"error":"This operation was aborted"}
```

`chainId 11155111` = Ethereum Sepolia testnet. The operation is being aborted, likely due to an `AbortController` timeout or the Vercel function timing out while RPC calls are in-flight.

## What to investigate

1. Find the `index-delegations` handler and look for `AbortController` usage — check if there's a timeout set that's too aggressive for Sepolia.
2. Check if Sepolia RPC calls are slower than mainnet (testnet nodes are often less performant).
3. Verify the Sepolia RPC endpoint being used is responsive and not overloaded.
4. Check if the Vercel function's overall 300-second timeout is being hit, which would abort all pending operations.

## Expected fix

**For AbortController timeout being too short:**
```js
// Increase the abort timeout for testnet RPCs
const controller = new AbortController();
const timeout = setTimeout(() => controller.abort(), 30_000); // 30s instead of default
try {
  const logs = await fetchWithAbort(url, { signal: controller.signal });
} finally {
  clearTimeout(timeout);
}
```

**For Vercel function timeout (if the overall cron times out):**
- Process fewer blocks per invocation to complete within time limits.
- Skip Sepolia in production if testnet data isn't needed in prod.
- Use a more reliable Sepolia RPC provider (Alchemy Sepolia, Infura Sepolia).

**For unreliable Sepolia RPC:**
- Switch the Sepolia RPC URL to a more reliable provider.
- Add it as a Vercel environment variable: `RPC_URL_11155111=https://eth-sepolia.g.alchemy.com/v2/YOUR_KEY`.
