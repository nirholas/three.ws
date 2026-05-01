# Fix: RPC Rate Limiting — Switch to Paid Providers for Production

## Confirmed Issue

Vercel logs show 429 errors from public RPC providers:
```
{"stage":"index-delegations","chainId":1,"error":"RPC HTTP 429 from https://1rpc.io/eth"}
[agents/solana/activity] RPC fetch failed Error: 429 Too Many Requests
```

`api/cron/[name].js` lines 333–368 list public RPC fallbacks for all chains including Ethereum mainnet (chain 1). Public endpoints like `1rpc.io`, `cloudflare-eth.com`, `llamarpc.com` have low rate limits and are unsuitable for production cron jobs that run every few minutes.

`api/agents/_id/_sub.js` (Solana activity) also uses public Solana RPC endpoints that rate-limit.

## Fix

### Ethereum / EVM chains

Set paid RPC endpoints in Vercel environment variables. Use Alchemy (recommended), Infura, or QuickNode:

```
RPC_URL_1=https://eth-mainnet.g.alchemy.com/v2/YOUR_KEY      # Ethereum mainnet
RPC_URL_8453=https://base-mainnet.g.alchemy.com/v2/YOUR_KEY  # Base mainnet  
RPC_URL_84532=https://base-sepolia.g.alchemy.com/v2/YOUR_KEY # Base Sepolia
RPC_URL_421614=https://arb-sepolia.g.alchemy.com/v2/YOUR_KEY # Arbitrum Sepolia
RPC_URL_11155420=https://opt-sepolia.g.alchemy.com/v2/YOUR_KEY
```

The env var is read first in `idxRpcUrls()` (`api/cron/[name].js` line 372 — note: after prompt 06 is applied, this uses `RPC_URL_${chainId}`). Public RPCs remain as automatic fallbacks.

### Solana

Set in Vercel:
```
SOLANA_RPC_URL=https://mainnet.helius-rpc.com/?api-key=YOUR_KEY
```

Helius and QuickNode both offer free tiers with much higher limits than the public Solana endpoint.

### For the cron specifically

`api/cron/[name].js`'s `idxRpc()` already tries multiple URLs in order and retries on 429. After setting paid providers as the first URL, the public fallbacks only activate when the paid provider is down — which is the correct behavior.
