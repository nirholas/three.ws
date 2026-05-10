---
name: onchain-agent
description: >
  Register a three.ws agent onchain via ERC-8004. Covers building the agent
  manifest bundle, pinning it to IPFS, calling the identity registry contract,
  and confirming registration with the three.ws API. Does not include any
  signing implementation — the user's wallet handles signing.
metadata:
  author: three.ws
  version: "1.0"
---

# Register an Agent Onchain (ERC-8004)

ERC-8004 is the onchain identity standard for AI agents. Registering gives the agent a permanent, portable identity: an NFT token ID on any EVM chain that resolves to its manifest from any `<agent-3d>` embed in the world.

## Overview

1. Build the agent manifest bundle (see `agent-manifest` skill)
2. Pin the bundle to IPFS → get a `ipfs://Qm...` CID
3. Call `register(agentURI)` on the ERC-8004 Identity Registry contract — the user's wallet signs this transaction
4. Confirm the registration with the three.ws API

## Supported chains

The ERC-8004 Identity Registry is deployed at the same address on every chain (CREATE2):

| Chain | Chain ID | Explorer |
|-------|----------|---------|
| Base | 8453 | basescan.org |
| Ethereum | 1 | etherscan.io |
| Optimism | 10 | optimistic.etherscan.io |
| Arbitrum One | 42161 | arbiscan.io |
| Polygon | 137 | polygonscan.com |
| BNB Chain | 56 | bscscan.com |
| Avalanche | 43114 | snowtrace.io |
| Base Sepolia (testnet) | 84532 | sepolia.basescan.org |

**Recommended for new registrations:** Base (low fees, fast finality).

## Contract interface

The registration function is:

```solidity
function register(string agentURI) external returns (uint256 agentId)
```

- `agentURI` — the IPFS URI pointing to the agent manifest, e.g. `ipfs://QmXyz.../manifest.json`
- Returns `agentId` — the NFT token ID assigned to this agent (also emitted in the `Registered` event)

The full ABI:

```json
[
  "function register() external returns (uint256 agentId)",
  "function register(string agentURI) external returns (uint256 agentId)",
  "function setAgentURI(uint256 agentId, string newURI) external",
  "function tokenURI(uint256 tokenId) external view returns (string)",
  "function ownerOf(uint256 tokenId) external view returns (address)",
  "function totalSupply() external view returns (uint256)",
  "event Registered(uint256 indexed agentId, string agentURI, address indexed owner)"
]
```

## Step 1 — Pin the manifest to IPFS

Use any IPFS pinning service. The bundle must be a directory so the CID resolves as a folder:

```bash
# Using the IPFS HTTP API (local node or Infura)
ipfs add -r ./my-agent/

# Or with web3.storage CLI
w3 up ./my-agent/

# Or with Pinata (REST)
curl -X POST https://api.pinata.cloud/pinning/pinFileToIPFS \
  -H "Authorization: Bearer <PINATA_JWT>" \
  -F "file=@manifest.json"
```

The resulting CID forms the `agentURI`:

```
ipfs://QmXyz.../manifest.json
```

## Step 2 — Call the registry contract

Use ethers.js or viem. The user's browser wallet (MetaMask, Coinbase Wallet, etc.) handles the actual signing — never request or handle the user's private material.

### ethers.js v6

```js
import { Contract, BrowserProvider } from 'ethers';

const REGISTRY_ABI = [
  'function register(string agentURI) external returns (uint256)',
  'event Registered(uint256 indexed agentId, string agentURI, address indexed owner)',
];

// Use the same address on every supported chain
const REGISTRY_ADDRESS = '0x...'; // canonical ERC-8004 registry — verify at https://three.ws/docs/erc8004

async function registerAgent(agentURI) {
  const provider = new BrowserProvider(window.ethereum);
  const signer = await provider.getSigner();
  const registry = new Contract(REGISTRY_ADDRESS, REGISTRY_ABI, signer);

  const tx = await registry.register(agentURI);
  const receipt = await tx.wait();

  // Parse agentId from the Registered event
  const iface = registry.interface;
  const log = receipt.logs
    .map(l => { try { return iface.parseLog(l); } catch { return null; } })
    .find(l => l?.name === 'Registered');

  const agentId = log.args.agentId.toString();
  const ownerAddress = await signer.getAddress();

  return { txHash: receipt.hash, agentId, chainId: (await provider.getNetwork()).chainId };
}
```

### viem

```js
import { createWalletClient, custom, parseAbi } from 'viem';
import { base } from 'viem/chains';

const REGISTRY_ABI = parseAbi([
  'function register(string agentURI) external returns (uint256)',
]);

const client = createWalletClient({ chain: base, transport: custom(window.ethereum) });
const [account] = await client.getAddresses();

const hash = await client.writeContract({
  address: REGISTRY_ADDRESS,
  abi: REGISTRY_ABI,
  functionName: 'register',
  args: [agentURI],
  account,
});
```

## Step 3 — Confirm with three.ws

After the transaction is mined, notify the three.ws API so it indexes the agent and associates it with the user's account:

```
POST https://three.ws/api/erc8004/register-confirm
Authorization: Bearer <token>
Content-Type: application/json
```

```json
{
  "chainId": 8453,
  "txHash": "0x...",
  "agentId": "42",
  "metadataUri": "ipfs://QmXyz.../manifest.json",
  "ownerAddress": "0xUserWalletAddress"
}
```

The API verifies the transaction onchain (reads the `Registered` event from the receipt) and indexes the agent. It does not trust the request body — it checks the chain.

**Response (200):**

```json
{ "success": true, "agentId": "42", "chainId": 8453 }
```

**Error codes:**

| Code | Meaning |
|------|---------|
| `tx_not_mined` | Transaction not yet included in a block — wait and retry |
| `tx_failed` | Transaction reverted |
| `event_not_found` | `Registered` event not present in the receipt — wrong contract or tx |
| `mismatch` | `agentId` or `ownerAddress` in the request doesn't match the event |

## Step 4 — Embed with the on-chain URI

Once confirmed, the agent is accessible permanently via:

```html
<agent-3d src="agent://base/42"></agent-3d>
```

Or via CAIP-10:

```html
<agent-3d agent-id="eip155:8453:0xRegistry:42"></agent-3d>
```

## Updating the URI after registration

If you pin a new version of the manifest:

```js
const tx = await registry.setAgentURI(agentId, 'ipfs://QmNewCID.../manifest.json');
await tx.wait();
```

Only the token owner can call `setAgentURI`. Same flow — wallet signs, no private material needed in your code.

## Agent URI format

```
agent://<chain>/<agentId>
```

Chain aliases recognized by the `<agent-3d>` loader:

| Alias | Chain ID |
|-------|---------|
| `base` | 8453 |
| `base-mainnet` | 8453 |
| `base-sepolia` | 84532 |
| `ethereum` | 1 |
| `mainnet` | 1 |
