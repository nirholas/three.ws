# Fix: index-delegations Cron Uses RPC_<chainId> but Docs Say RPC_URL_<chainId>

## Confirmed Issue

Two different patterns exist for RPC URL env vars in this codebase:

**`api/cron/[name].js` line 372** (index-delegations):
```js
const envUrl = process.env[`RPC_${chainId}`];
```

**`api/permissions/[action].js` line 637** (permissions handler):
```js
process.env[`RPC_URL_${chainId}`]
```

**`.env.example` line 96–98** documents the pattern as `RPC_URL_<CHAINID>`:
```
# Pattern: RPC_URL_<CHAINID>. Override the default public RPCs with Alchemy/Infura for production.
RPC_URL_84532=https://sepolia.base.org
RPC_URL_11155111=https://rpc.sepolia.org
```

The cron uses `RPC_${chainId}` (no `_URL_`). If an operator sets `RPC_URL_8453=https://...` in Vercel (following `.env.example`), the cron will ignore it and fall back to public RPCs. The variable name mismatch means production RPC overrides have no effect on the indexer.

## Fix

Standardize on `RPC_URL_${chainId}` everywhere. In `api/cron/[name].js` line 372:

```js
// Before:
const envUrl = process.env[`RPC_${chainId}`];

// After:
const envUrl = process.env[`RPC_URL_${chainId}`];
```

Then update `.env.example` to document all chains that have DelegationManager deployments (from `src/erc7710/abi.js`):

```
RPC_URL_1=          # Ethereum mainnet — use Alchemy/Infura, public RPCs rate-limit heavily
RPC_URL_8453=       # Base mainnet
RPC_URL_84532=https://sepolia.base.org
RPC_URL_11155111=https://rpc.sepolia.org
RPC_URL_421614=     # Arbitrum Sepolia
RPC_URL_11155420=   # Optimism Sepolia
```

Set the production values in Vercel env vars, especially `RPC_URL_1` (Ethereum mainnet hits 1rpc.io's rate limits in logs).
