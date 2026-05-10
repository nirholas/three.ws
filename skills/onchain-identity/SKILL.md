---
name: onchain-identity
description: Prepare an onchain identity registration for a three.ws agent on EVM chains (Base, Arbitrum, Ethereum) or Solana. The API builds the transaction; the user's connected wallet signs it. Returns the agent's ERC-8004 token ID or Solana asset address after confirmation.
allowed-tools: Read, Bash
---

# onchain-identity

Anchor a three.ws agent to an onchain identity. The platform constructs the transaction; the user reviews and approves it in their wallet. No raw keys or credentials are handled by this skill.

## Supported chains

| Chain | CAIP-2 | Description |
|---|---|---|
| Base | `eip155:8453` | Recommended — low fees, fast finality |
| Arbitrum | `eip155:42161` | EVM L2 |
| Ethereum | `eip155:1` | Mainnet |
| Solana | `solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp` | Mainnet via Metaplex Core |
| Solana Devnet | `solana:EtWTRABZaYq6iMfeYKouRu166VU2xqa1` | For testing |

## How it works

```
1. POST /api/agents/onchain/prep
   → Server builds an unsigned transaction + metadata

2. User's wallet signs the transaction
   (happens in the browser / wallet app — not in this skill)

3. POST /api/agents/onchain/confirm
   → Server verifies the signature, mints the identity token,
     updates the agent record with its onchain ID
```

## Step 1 — Prepare the transaction

```bash
curl -X POST https://three.ws/api/agents/onchain/prep \
  -H "Authorization: Bearer $THREEWS_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "agentId": "a_abc123",
    "chain": "eip155:8453"
  }'
```

**Request fields:**

| Field | Required | Description |
|---|---|---|
| `agentId` | yes | The agent to register (must be yours) |
| `chain` | yes | CAIP-2 chain identifier |
| `walletAddress` | no | Override — defaults to the wallet linked to your account |

**Response:**
```json
{
  "prepId": "prep_7f3k2m",
  "chain": "eip155:8453",
  "agentId": "a_abc123",
  "unsignedTx": {
    "to": "0xRegistryAddress...",
    "data": "0x...",
    "value": "0x0",
    "chainId": 8453
  },
  "metadata": {
    "name": "Aria",
    "description": "AI agent registered on three.ws",
    "image": "https://cdn.three.ws/avatars/a_abc123/poster.png"
  },
  "expires_at": "2026-05-10T12:30:00Z"
}
```

## Step 2 — User signs (browser side)

The unsigned transaction is sent to the user's wallet for approval. This is the only step that requires a wallet — the user reviews what they're signing before confirming.

Example using ethers.js in a web app:
```js
const tx = await signer.sendTransaction(prepResponse.unsignedTx);
const receipt = await tx.wait();
// Pass receipt.hash to the confirm step
```

## Step 3 — Confirm registration

```bash
curl -X POST https://three.ws/api/agents/onchain/confirm \
  -H "Authorization: Bearer $THREEWS_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "prepId": "prep_7f3k2m",
    "txHash": "0xabc123..."
  }'
```

**Response:**
```json
{
  "agentId": "a_abc123",
  "onchainId": 42,
  "chain": "eip155:8453",
  "txHash": "0xabc123...",
  "agentUri": "agent://base/42",
  "explorerUrl": "https://basescan.org/tx/0xabc123..."
}
```

## After registration

The `agentUri` (`agent://base/42`) can be used directly in the `<agent-3d>` web component:

```html
<agent-3d src="agent://base/42" mode="floating"></agent-3d>
```

The agent's full record — name, avatar, instructions, signed action history — is now readable from the chain. The ERC-8004 token ID serves as the permanent, portable identity.

## Solana flow

The prep/confirm steps are identical. The `unsignedTx` for Solana will be a base64-encoded serialized transaction instead of an EVM object. Pass it to the user's Solana wallet (Phantom, Backpack, etc.) for signing, then return the transaction signature as `txHash` in the confirm call.

```bash
# Prep for Solana mainnet
curl -X POST https://three.ws/api/agents/onchain/prep \
  -H "Authorization: Bearer $THREEWS_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "agentId": "a_abc123",
    "chain": "solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp"
  }'
# → unsignedTx is base64 serialized tx; Solana asset address returned after confirm
```

## What gets stored onchain

| Data | Where |
|---|---|
| Agent name | Token metadata (IPFS) |
| Avatar model URL | Token metadata (IPFS) |
| System instructions hash | Token metadata |
| Signed action log | On-chain events (ERC-8004) |
| Reputation score | ReputationRegistry contract |
| Owner address | Token ownership |

## Look up an agent by onchain ID

```bash
# By ERC-8004 token ID on Base
curl "https://three.ws/api/agents?onchain=true" \
  -H "Authorization: Bearer $THREEWS_API_KEY"

# Get a specific agent by its URI
curl "https://three.ws/api/agents/a_abc123"
# → includes erc8004_agent_id, chain, agentUri if registered
```

## Test on devnet first

Use `solana:EtWTRABZaYq6iMfeYKouRu166VU2xqa1` (Solana devnet) or a testnet EVM chain to verify the flow before spending real gas.
