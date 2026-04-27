---
mode: agent
description: 'Deploy ERC-8004 contracts and complete on-chain agent registration'
---

# Deploy ERC-8004 Contracts & Complete Integration

## Problem

The entire ERC-8004 on-chain agent registration flow is fully coded in `src/erc8004/` but **non-functional** because all contract addresses in `src/erc8004/abi.js` are empty strings:

```js
84532: {
    identityRegistry: '',   // TODO: fill once deployed
    reputationRegistry: '', // TODO: fill once deployed
    validationRegistry: '', // TODO: fill once deployed
},
```

The UI (`register-ui.js`), registry interaction (`agent-registry.js`), and ABI are complete — only deployment is missing.

## Implementation Plan

### Phase 1: Smart Contracts

1. **Create `contracts/` directory** at project root
2. **Initialize Hardhat or Foundry** project for Solidity development
3. **Implement ERC-8004 Identity Registry** contract:

    - ERC-721 base (agent identity NFTs)
    - `register(string agentURI)` → mints token, stores URI
    - `setAgentURI(uint256 agentId, string newURI)` — owner-only
    - `setAgentWallet(uint256, address, uint256, bytes)` — delegated wallet with sig verification
    - `getMetadata(uint256, string)` / `setMetadata(uint256, string, bytes)` — key-value metadata
    - Events: `Registered`, `URIUpdated`, `MetadataSet`
    - Must match the ABI already defined in `src/erc8004/abi.js`

4. **Implement Reputation Registry** contract:

    - Submit reputation feedback for agents
    - Query reputation scores
    - Only registered agents (holders of Identity NFT) can receive reputation

5. **Implement Validation Registry** contract:
    - Store validation proofs on-chain
    - Link validation results to agent identities
    - Support for multiple validators

### Phase 2: Deployment (Base Sepolia Testnet)

1. **Write deployment scripts** for Base Sepolia (chain 84532)
2. Deploy all three contracts
3. **Update `src/erc8004/abi.js`** with deployed addresses
4. Verify contracts on BaseScan

### Phase 3: Fill Registration Data

1. **Register three.ws itself** on the Identity Registry
2. **Update `public/.well-known/agent-registration.json`**:
    - Fill the empty `registrations` array with the on-chain registration
    - Format: `{ "agentRegistry": "eip155:84532:0x...", "agentId": "1" }`
3. Set agent metadata (capabilities, version, etc.)

### Phase 4: Complete Reputation & Validation

1. Add Reputation Registry ABI to `src/erc8004/abi.js`
2. Add Validation Registry ABI to `src/erc8004/abi.js`
3. Wire validation results from `src/validator.js` → Validation Registry
4. Add reputation submission UI
5. Add reputation query display on agent profiles

## File Structure

```
contracts/
├── src/
│   ├── IdentityRegistry.sol
│   ├── ReputationRegistry.sol
│   └── ValidationRegistry.sol
├── test/
│   ├── IdentityRegistry.t.sol
│   ├── ReputationRegistry.t.sol
│   └── ValidationRegistry.t.sol
├── script/
│   └── Deploy.s.sol
├── foundry.toml
└── README.md
```

## Validation

- All contracts deploy to Base Sepolia without errors
- `registerAgent()` from the browser UI successfully mints an identity NFT
- Agent URI resolves to the registration JSON
- Contract addresses in `abi.js` are populated and the UI is functional end-to-end
- Contracts verified on BaseScan
