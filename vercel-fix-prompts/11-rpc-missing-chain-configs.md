# Fix: Missing RPC URLs for Chains 8453, 421614, 11155420

## Problem

The `/api/cron/[name]` (index-delegations) cron job logs 560+ errors per chain for:

```
{"stage":"index-delegations","chainId":8453,"error":"no RPC URL configured for chain 8453"}
{"stage":"index-delegations","chainId":421614,"error":"no RPC URL configured for chain 421614"}
{"stage":"index-delegations","chainId":11155420,"error":"no RPC URL configured for chain 11155420"}
```

Chain IDs:
- `8453` = Base Mainnet
- `421614` = Arbitrum Sepolia
- `11155420` = Optimism Sepolia

## What to investigate

1. Find where RPC URLs are configured in the codebase — likely an object/map keyed by chain ID, a config file, or environment variables like `RPC_URL_8453`.
2. Confirm whether RPC URLs for these chains are defined anywhere (env vars, config files, hardcoded maps).
3. Check if the environment variables are set in Vercel's dashboard for these chains.

## Expected fix

Add RPC URL configuration for the three missing chains. Options:

**Option A — Environment variables:**
```
RPC_URL_8453=https://mainnet.base.org          # or Alchemy/Infura Base endpoint
RPC_URL_421614=https://sepolia-rollup.arbitrum.io/rpc
RPC_URL_11155420=https://sepolia.optimism.io
```

**Option B — Update the hardcoded chain config map** in the codebase to include these chain IDs with their RPC endpoints.

Use a reliable RPC provider (Alchemy, Infura, QuickNode) for production — public endpoints may have rate limits. Set these in Vercel environment variables and redeploy.

After fixing, the `index-delegations` cron should process all chains without "no RPC URL" errors.
