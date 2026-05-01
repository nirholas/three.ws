# Fix: Missing RPC URLs for Chains 8453 / 421614 / 11155420 in Permissions Handler

## Confirmed Bug

`api/permissions/[action].js` line 635–642 defines `getRpcUrl()`:

```js
function getRpcUrl(chainId) {
    return (
        process.env[`RPC_URL_${chainId}`] ||
        (chainId === 84532 ? process.env.BASE_SEPOLIA_RPC_URL : null) ||
        (chainId === 11155111 ? process.env.SEPOLIA_RPC_URL : null) ||
        null
    );
}
```

This function has hardcoded fallbacks only for chains `84532` and `11155111`. It returns `null` for any other chain.

`src/erc7710/abi.js` lines 17–25 shows `DELEGATION_MANAGER_DEPLOYMENTS` includes:
- `8453` — Base mainnet
- `1` — Ethereum mainnet
- `84532` — Base Sepolia ✓ (has fallback)
- `11155111` — Ethereum Sepolia ✓ (has fallback)
- `421614` — Arbitrum Sepolia ✗ (no fallback)
- `11155420` — Optimism Sepolia ✗ (no fallback)

When `handleRedeem` or `handleVerify` is called for chains `8453`, `1`, `421614`, or `11155420`, `getRpcUrl` returns `null`, and line 828 throws:
```
throw new Error(`no RPC URL configured for chain ${chainId} (set RPC_URL_${chainId})`)
```

Note: The `index-delegations` cron (`idxRpcUrls`) already has public fallbacks for all these chains — this is isolated to the permissions handler.

## Fix

Replace `getRpcUrl` in `api/permissions/[action].js` line 635–642 with fallbacks for all deployed chains, matching the pattern used in `api/cron/[name].js` lines 333–368:

```js
const PERMISSIONS_PUBLIC_RPCS = {
    1:        'https://cloudflare-eth.com',
    8453:     'https://mainnet.base.org',
    84532:    'https://sepolia.base.org',
    11155111: 'https://rpc.sepolia.org',
    421614:   'https://sepolia-rollup.arbitrum.io/rpc',
    11155420: 'https://sepolia.optimism.io',
};

function getRpcUrl(chainId) {
    return (
        process.env[`RPC_URL_${chainId}`] ||
        (chainId === 84532 ? process.env.BASE_SEPOLIA_RPC_URL : null) ||
        (chainId === 11155111 ? process.env.SEPOLIA_RPC_URL : null) ||
        PERMISSIONS_PUBLIC_RPCS[chainId] ||
        null
    );
}
```

Also add `RPC_URL_8453`, `RPC_URL_421614`, `RPC_URL_11155420` to `.env.example` under the existing RPC section (after line 98) with Alchemy/Infura endpoints so production deployments use paid providers instead of public ones.
