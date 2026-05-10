# Task: Trigger Coinbase Bazaar Indexing for three.ws/api/mcp

## Context

`https://three.ws/api/mcp` is a paid MCP endpoint using the x402 protocol. It has passed all 19/19 checks at `https://agentic.market/validate?url=https%3A%2F%2Fthree.ws%2Fapi%2Fmcp` but does not yet appear in the Bazaar because it has never received a real facilitator verify+settle cycle.

The Bazaar indexes endpoints after witnessing a real on-chain payment settlement. One successful paid call is enough to trigger indexing.

## Current 402 spec (live as of writing)

```json
{
  "accepts": [
    {
      "scheme": "exact",
      "amount": "1000",
      "maxTimeoutSeconds": 60,
      "network": "eip155:8453",
      "payTo": "0x0C70c0e8453C5667739E41acdF6eC5787B8ff542",
      "asset": "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
      "extra": { "name": "USD Coin", "version": "2", "decimals": 6 }
    },
    {
      "scheme": "exact",
      "amount": "1000",
      "maxTimeoutSeconds": 60,
      "network": "solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp",
      "payTo": "BUrwd1nK6tFeeJMyzRHDo6AuVbnSfUULfvwq21X93nSN",
      "asset": "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v",
      "extra": { "name": "USDC", "decimals": 6, "feePayer": "2wKupLR9q6wXYppw8Gr2NvWxKBUqm4PPJKkQfoxHDBg4" }
    }
  ]
}
```

Note: after the current Vercel deployment completes, the Base `payTo` will change to `0x00000000b43689a688e51a06fCC0e3F2E058720a`. Always fetch the live 402 spec first.

## What to Build

Write `scripts/trigger-bazaar.mjs` — a Node.js script that makes a real x402 paid call to `three.ws/api/mcp`, triggering a facilitator verify+settle.

### Script behavior

1. Fetch the live 402 spec from `three.ws/api/mcp` (POST without payment, parse the 402 response)
2. Based on `CHAIN=base|solana` env var, select the appropriate payment method
3. Construct and sign the payment client-side
4. Re-POST with `X-PAYMENT` header
5. Print the tool result and confirm settlement

### Base/EVM mode (`CHAIN=base`)

Required env vars:
- `PK=0x...` — private key for a Base wallet with >0.001 USDC
- `BASE_RPC_URL` — optional, defaults to `https://rpc.ankr.com/base`

Payment construction:
- Use viem to sign an EIP-712 `TransferWithAuthorization` (EIP-3009)
- USDC contract on Base: `0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913`
- EIP-712 domain: `{ name: "USD Coin", version: "2", chainId: 8453, verifyingContract: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913" }`
- Type: `TransferWithAuthorization { address from; address to; uint256 value; uint256 validAfter; uint256 validBefore; bytes32 nonce }`
- validAfter: 0, validBefore: Math.floor(Date.now()/1000) + 60, nonce: 32 random bytes
- Facilitator: `https://x402.sperax.io`

x402 payload structure:
```json
{
  "x402Version": 2,
  "scheme": "exact",
  "network": "eip155:8453",
  "payload": {
    "signature": "<hex sig>",
    "authorization": {
      "from": "<address>",
      "to": "<payTo>",
      "value": "1000",
      "validAfter": "0",
      "validBefore": "<unix>",
      "nonce": "<hex>"
    }
  }
}
```

### Solana mode (`CHAIN=solana`)

Required env vars:
- `SOLANA_KEY_BASE58=...` — base58-encoded 64-byte keypair

Payment construction:
- Use `@solana/web3.js` to build an SPL `transferChecked` instruction
- From: derived ATA of the keypair's public key for USDC
- To: derived ATA of `payTo` for USDC
- Amount: 1000 (raw, 6 decimals)
- Mint: `EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v`
- feePayer: `2wKupLR9q6wXYppw8Gr2NvWxKBUqm4PPJKkQfoxHDBg4` (from the 402 spec)
- Partially sign with your keypair, base64-encode the serialized tx
- Facilitator: `https://facilitator.payai.network`

### Tool call body

```json
{
  "jsonrpc": "2.0",
  "id": 1,
  "method": "tools/call",
  "params": {
    "name": "validate_model",
    "arguments": {
      "url": "https://threejs.org/examples/models/gltf/Duck/glTF/Duck.gltf"
    }
  }
}
```

### Output

```
fetching 402 spec from three.ws/api/mcp…
payTo (base): 0x00000000b43689a688e51a06fCC0e3F2E058720a
signing EIP-3009 transferWithAuthorization…
posting with X-PAYMENT header…
✅ tool result: { ok: true, warnings: [], meta: { ... } }
check https://agentic.market to confirm indexing
```

## Usage

```bash
# Base
PK=0x... CHAIN=base node scripts/trigger-bazaar.mjs

# Solana  
SOLANA_KEY_BASE58=... CHAIN=solana node scripts/trigger-bazaar.mjs
```

## Definition of done

- Script runs without errors
- Receives a 200 response from `three.ws/api/mcp` (not 402)
- Tool result is printed
- `https://agentic.market` shows `three.ws/api/mcp` within ~5 minutes of running the script
