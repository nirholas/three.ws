# Agent Task: Write "Smart Contracts" Documentation

## Output file
`public/docs/smart-contracts.md`

## Target audience
Developers who want to interact with the ERC-8004 contracts directly — deploying their own registry, reading on-chain data, or building applications on top of the registry. Assumes Solidity and Ethereum familiarity.

## Word count
2000–2500 words

## What this document must cover

### 1. Overview
Three Solidity contracts make up the ERC-8004 registry:

| Contract | Purpose |
|----------|---------|
| `IdentityRegistry.sol` | Register and resolve three.wss on-chain |
| `ReputationRegistry.sol` | Submit and read on-chain agent reviews |
| `ValidationRegistry.sol` | Record glTF validation attestations |

All contracts are deployed on Ethereum mainnet, Base, Sepolia, and Base Sepolia. Addresses in `/src/erc8004/abi.js`.

Built with Foundry. Source in `/contracts/src/`.

### 2. IdentityRegistry

**Purpose:** The canonical on-chain registry for three.ws identities. Stores IPFS CIDs pointing to agent manifests.

**Key functions:**

`registerAgent(string calldata cid, bytes calldata metadata) returns (uint256 agentId)`
- Registers a new agent
- `cid` — IPFS CID of the agent manifest JSON
- `metadata` — ABI-encoded extra metadata (name, avatarUrl, etc.)
- Emits `AgentRegistered(agentId, creator, cid)`
- Returns the new agent's numeric ID

`getAgent(uint256 agentId) returns (Agent memory)`
- Returns: `{ id, creator, cid, metadata, createdAt, updatedAt }`

`getAgentsByAddress(address creator) returns (uint256[] memory)`
- Returns all agent IDs created by an address

`updateAgent(uint256 agentId, string calldata newCid)`
- Update the IPFS CID (owner only)
- Useful for updating the manifest without re-registering

`transferAgent(uint256 agentId, address newOwner)`
- Transfer ownership to a new address
- Emits `AgentTransferred(agentId, from, to)`

`totalAgents() returns (uint256)`
- Total registered agents (useful for enumeration)

**Agent struct:**
```solidity
struct Agent {
    uint256 id;
    address creator;
    string cid;          // IPFS CID of manifest
    bytes metadata;      // ABI-encoded: (name, avatarUrl, description)
    uint256 createdAt;
    uint256 updatedAt;
}
```

**Events:**
```solidity
event AgentRegistered(uint256 indexed agentId, address indexed creator, string cid);
event AgentUpdated(uint256 indexed agentId, string newCid);
event AgentTransferred(uint256 indexed agentId, address indexed from, address indexed to);
```

**Reading from ethers.js:**
```js
import { ethers } from 'ethers';
import { IDENTITY_ABI, REGISTRY_DEPLOYMENTS } from '@3dagent/sdk/erc8004';

const provider = new ethers.JsonRpcProvider('https://mainnet.base.org');
const registry = new ethers.Contract(
  REGISTRY_DEPLOYMENTS[8453].identity,
  IDENTITY_ABI,
  provider
);

const agent = await registry.getAgent(42);
console.log(agent.creator, agent.cid);

const agentIds = await registry.getAgentsByAddress('0xYourAddress');
```

**Registering from ethers.js:**
```js
const signer = await provider.getSigner();
const registryWithSigner = registry.connect(signer);

const name = 'Aria';
const avatarUrl = 'ipfs://QmXyz.../aria.glb';
const description = 'Product guide';

const metadata = ethers.AbiCoder.defaultAbiCoder().encode(
  ['string', 'string', 'string'],
  [name, avatarUrl, description]
);

const tx = await registryWithSigner.registerAgent(manifestCid, metadata);
const receipt = await tx.wait();

// Parse the agentId from the event
const event = receipt.logs.find(l => l.fragment?.name === 'AgentRegistered');
const agentId = event.args.agentId;
```

### 3. ReputationRegistry

**Purpose:** On-chain reviews for registered agents.

**Key functions:**

`submitFeedback(uint256 agentId, uint8 stars, string calldata comment)`
- Submit a review (1-5 stars, optional comment)
- One per (reviewer, agentId) — calling again updates the review
- `stars` must be 1-5 (reverts otherwise)
- `comment` max 280 characters

`getReputation(uint256 agentId) returns (uint256 averageRating, uint256 totalReviews)`
- Returns the average star rating (scaled by 1e18 for precision) and total count

`getRecentReviews(uint256 agentId, uint256 limit) returns (Review[] memory)`
- Returns the most recent reviews (up to `limit`)

`hasReviewed(uint256 agentId, address reviewer) returns (bool)`
- Check if an address has already reviewed this agent

**Review struct:**
```solidity
struct Review {
    address reviewer;
    uint8 stars;
    string comment;
    uint256 timestamp;
}
```

**Events:**
```solidity
event FeedbackSubmitted(uint256 indexed agentId, address indexed reviewer, uint8 stars);
event FeedbackUpdated(uint256 indexed agentId, address indexed reviewer, uint8 newStars);
```

**Reading reputation:**
```js
import { REPUTATION_ABI, REGISTRY_DEPLOYMENTS } from '@3dagent/sdk/erc8004';

const repRegistry = new ethers.Contract(
  REGISTRY_DEPLOYMENTS[8453].reputation,
  REPUTATION_ABI,
  provider
);

const [avgRating, totalReviews] = await repRegistry.getReputation(42);
// avgRating is scaled by 1e18: divide by 1e18 to get actual average
const displayRating = Number(avgRating) / 1e18;

const reviews = await repRegistry.getRecentReviews(42, 10);
reviews.forEach(r => {
  console.log(r.reviewer, r.stars, r.comment);
});
```

### 4. ValidationRegistry

**Purpose:** Immutable on-chain record of glTF validation results.

**Key functions:**

`recordValidation(uint256 agentId, bytes32 reportHash, bool passed)`
- Record a validation result for an agent
- `reportHash` — keccak256 hash of the serialized validation report JSON
- `passed` — true if 0 errors, false otherwise
- Anyone can record (not just the owner) — useful for third-party attestors

`getValidationHistory(uint256 agentId) returns (ValidationRecord[] memory)`
- Returns all validation records for an agent

`getLatestValidation(uint256 agentId) returns (ValidationRecord memory)`
- Returns the most recent validation

**ValidationRecord struct:**
```solidity
struct ValidationRecord {
    address validator;   // who ran the validation
    bytes32 reportHash;  // hash of the report JSON
    bool passed;         // 0 errors = true
    uint256 timestamp;
}
```

**Recording a validation:**
```js
import { ValidationRegistry } from '@3dagent/sdk/erc8004';
import { keccak256, toUtf8Bytes } from 'ethers';

// After running validation
const reportJson = JSON.stringify(validationReport);
const reportHash = keccak256(toUtf8Bytes(reportJson));
const passed = validationReport.issues.numErrors === 0;

const tx = await valRegistry.connect(signer).recordValidation(agentId, reportHash, passed);
await tx.wait();
```

**Verifying a validation:**
```js
// Re-run validator on the GLB → get report → hash it → compare with on-chain hash
const onChainRecord = await valRegistry.getLatestValidation(agentId);
const recomputedHash = keccak256(toUtf8Bytes(JSON.stringify(freshReport)));
const isValid = recomputedHash === onChainRecord.reportHash;
```

### 5. Deployed addresses

Read the current addresses from `/src/erc8004/abi.js`:
```js
export const REGISTRY_DEPLOYMENTS = {
  1: {      // Ethereum mainnet
    identity: '0x...',
    reputation: '0x...',
    validation: '0x...'
  },
  8453: {   // Base
    identity: '0x...',
    reputation: '0x...',
    validation: '0x...'
  },
  11155111: { // Sepolia
    identity: '0x...',
    reputation: '0x...',
    validation: '0x...'
  },
  84532: {  // Base Sepolia
    identity: '0x...',
    reputation: '0x...',
    validation: '0x...'
  }
};
```

Always read addresses from the SDK rather than hardcoding — they may be updated with new deployments.

### 6. Deploying your own registry

```bash
cd contracts
forge build
forge test

# Deploy to Base Sepolia (testnet)
forge script script/Deploy.s.sol \
  --rpc-url https://sepolia.base.org \
  --private-key $DEPLOYER_PRIVATE_KEY \
  --broadcast \
  --verify

# Deploy to Base mainnet
forge script script/Deploy.s.sol \
  --rpc-url https://mainnet.base.org \
  --private-key $DEPLOYER_PRIVATE_KEY \
  --broadcast \
  --verify
```

After deploying, update `REGISTRY_DEPLOYMENTS` in `/src/erc8004/abi.js` with your contract addresses.

Verify addresses with the check script:
```bash
node scripts/check-erc7710-addresses.js
```

### 7. Gas optimization notes
- `registerAgent` — most expensive (~120k gas). Called once per agent.
- `submitFeedback` — moderate (~50k gas). Called per review.
- `recordValidation` — moderate (~45k gas). Called per validation run.
- All read functions (getAgent, getReputation, etc.) — free (view functions, no gas).

On Base at typical gas prices (0.001 gwei base fee + priority fee), registration costs ~$0.20.

## Tone
Technical Solidity/blockchain reference. Code examples use ethers.js v6 syntax. Include the full struct definitions and event signatures — developers need these for ABI encoding/decoding.

## Files to read for accuracy
- `/contracts/src/IdentityRegistry.sol` — read fully
- `/contracts/src/ReputationRegistry.sol` — read fully
- `/contracts/src/ValidationRegistry.sol` — read fully
- `/src/erc8004/abi.js` — ABIs and deployed addresses
- `/src/erc8004/agent-registry.js` — SDK wrapper
- `/src/erc8004/queries.js` — read operations
- `/src/erc8004/reputation.js` — reputation SDK
- `/src/erc8004/validation-recorder.js`
