# Fix: RPC Rate Limiting (429) from Solana and Ethereum Providers

## Problem

Multiple endpoints hit RPC rate limits causing 502/500 errors:

```
[agents/solana/activity] RPC fetch failed Error: 429 Too Many Requests   → /api/agents/[id]
{"stage":"index-delegations","chainId":1,"error":"RPC HTTP 429 from https://1rpc.io/eth"}
```

The code already has retry logic with exponential backoff (500ms, 1000ms, 2000ms, 4000ms) but this isn't enough — requests still fail.

## What to investigate

1. Identify all RPC providers currently configured for Solana and Ethereum (mainnet chain 1).
2. Check if the app is using public/free-tier RPC endpoints (e.g. `1rpc.io`, `mainnet-beta.solana.com`) that have aggressive rate limits.
3. Find all places in the codebase that make RPC calls and check if they share a single connection or create new connections per request.
4. Check if cron jobs and user-facing requests share the same RPC quota.

## Expected fix

**Short-term:**
- Switch Solana RPC from public endpoint to a paid provider: Helius, QuickNode, or Triton.
- Switch Ethereum mainnet RPC from `1rpc.io` to Alchemy or Infura with a proper API key.
- Add RPC API keys as Vercel environment variables.

**Medium-term:**
- Add RPC request queuing with proper rate limiting using a library like `p-queue` or `bottleneck`.
- Cache RPC responses where possible (e.g. block numbers, account balances) to reduce call volume.
- Separate cron job RPC traffic from user-facing request RPC traffic using different API keys/quotas.

**For the cron job specifically:**
- Add jitter to retry backoff to avoid thundering herd.
- Consider reducing cron frequency if the data doesn't need real-time updates.
