# Agent Task: Write "ERC-8004 Blockchain Identity" Documentation

## Output file
`public/docs/erc8004.md`

## Target audience
Developers and crypto-native users who want to register their AI agent on-chain — giving it a verifiable, decentralized identity. Assumes familiarity with Ethereum wallets and basic blockchain concepts.

## Word count
2000–3000 words

## What this document must cover

### 1. What is ERC-8004?
ERC-8004 is the proposed Ethereum standard for on-chain three.ws identity registration. It defines:
- A registry smart contract where agents are registered as on-chain entries
- A standard JSON structure for agent metadata (pinned to IPFS)
- A resolution protocol for looking up agents by address, ENS name, or chain:registry:id
- Hooks for reputation and validation attestations

An ERC-8004 registered agent has a **permanent, verifiable identity** that:
- Can't be deleted (blockchain-permanent)
- Is owned by a wallet (transferable)
- Can accumulate reputation (on-chain feedback)
- Can be resolved by anyone with the chain ID and agent ID

### 2. Why register on-chain?
Benefits of registering your agent:
- **Ownership** — cryptographic proof that you created the agent
- **Discoverability** — anyone can find your agent by your ENS name or wallet address
- **Reputation** — on-chain feedback (stars + comments) builds verifiable trust
- **Composability** — other agents and dApps can reference your agent by its chain:id
- **Permanence** — the registration can't be censored or removed by a platform
- **ENS integration** — link your agent to `youragent.eth` for human-readable resolution

### 3. Supported chains
| Chain | Chain ID | Status |
|-------|----------|--------|
| Ethereum Mainnet | 1 | Supported |
| Base | 8453 | Supported (recommended) |
| Sepolia (testnet) | 11155111 | Supported |
| Base Sepolia (testnet) | 84532 | Supported |

Base is recommended for new registrations: lower gas costs, fast finality, EVM-compatible.

### 4. The smart contracts
Three contracts make up the ERC-8004 registry:

**IdentityRegistry.sol**
- `registerAgent(cid, metadata)` — register a new agent, returns `agentId`
- `getAgent(agentId)` — read agent data by ID
- `getAgentsByAddress(address)` — list all agents owned by an address
- `transferAgent(agentId, newOwner)` — transfer ownership

**ReputationRegistry.sol**
- `submitFeedback(agentId, stars, comment)` — submit a review (1-5 stars + text)
- `getReputation(agentId)` — get average rating + total reviews
- `getRecentReviews(agentId, limit)` — get recent reviews

**ValidationRegistry.sol**
- `recordValidation(agentId, reportHash, passed)` — record a glTF validation result
- `getValidationHistory(agentId)` — list past validations

Contract addresses for each chain are stored in `/src/erc8004/abi.js` under `REGISTRY_DEPLOYMENTS`.

### 5. Registering an agent
**Step 1: Connect your wallet**
Click "Connect Wallet" in the three.ws app. Supported:
- MetaMask (injected)
- WalletConnect (mobile wallets)
- Privy (email + social login with embedded wallet)
- Any EIP-1193 provider

**Step 2: Prepare your agent**
Your agent needs a GLB avatar and a manifest. If you haven't already:
1. Upload your GLB in the editor
2. Configure name, description, personality
3. The manifest is auto-generated

**Step 3: Pin to IPFS**
The platform pins your manifest to IPFS and returns a CID. You can also pin yourself:
- Pinata, Filebase, or Web3.Storage
- The CID becomes the permanent pointer to your agent's metadata

**Step 4: Deploy to chain**
Click "Register on Chain" in the editor or dashboard:
1. Select target chain (Base recommended)
2. Review the transaction (shows gas estimate)
3. Confirm in your wallet
4. Wait for transaction confirmation (~2-5 seconds on Base)
5. Your agent ID is returned

The full registration UI is at `/src/erc8004/register-ui.js` and `/src/erc8004/deploy-button.js`.

**Step 5: Get your agent URL**
After registration, your agent is accessible at:
- `https://three.ws/a/<chainId>/<agentId>`
- Example: `https://three.ws/a/8453/42`

### 6. Resolving an agent
Agents can be resolved multiple ways:

**By chain and ID:**
```js
import { resolveAgent } from '@3dagent/sdk';
const agent = await resolveAgent({ chainId: 8453, agentId: 42 });
```

**By wallet address (gets all agents):**
```js
const agents = await resolveAgent({ address: '0xYourWallet' });
```

**By ENS name:**
```js
const agent = await resolveAgent({ ens: 'myagent.eth' });
```

**In the web component:**
```html
<!-- chain:registry:id format -->
<agent-three.ws-id="8453:0xRegistryAddress:42"></agent-3d>
```

### 7. ENS integration
Link your agent to an ENS name:
1. Go to app.ens.domains → your ENS name → Records
2. Add a text record: key `3dagent`, value `<chainId>:<agentId>`
3. Save (gas required)

Now `myagent.eth` resolves to your on-chain agent. See `/specs/ENS_AGENT_CLAIM.md`.

### 8. Reputation system
After registering, your agent accumulates on-chain reputation:

**Submitting feedback (users):**
Users can rate any registered agent via the reputation panel:
- 1-5 stars
- Optional text review
- One review per wallet address per agent (prevent spam)
- Review signed by wallet = tamper-proof

**Reading reputation:**
```js
import { getReputation } from '@3dagent/sdk';
const { averageRating, totalReviews, recentReviews } = await getReputation(8453, 42);
```

**Displaying reputation:**
The Passport widget (`widget="passport"`) shows the reputation score automatically.

The reputation panel UI (`/src/erc8004/reputation-panel.js`) can be embedded in any page.

### 9. Validation attestations
When your agent's GLB model is validated (via the validator), the result can be attested on-chain:
- The validation report is hashed
- Hash submitted to `ValidationRegistry.recordValidation(agentId, hash, passed)`
- Anyone can verify the validation by re-running the validator and comparing hashes

This creates a verifiable audit trail of your model's technical quality.

### 10. The `on-chain agent` URL format
three.ws supports a special route for on-chain agents:

```
https://three.ws/a/<chainId>/<agentId>
https://three.ws/a/<chainId>/<registryAddress>/<agentId>
```

This page:
- Resolves the agent from the chain
- Shows the 3D avatar
- Displays the ERC-8004 Passport widget
- Links to on-chain explorer transaction
- Shows reputation score

### 11. Building with ERC-8004 programmatically
```js
import { AgentRegistry } from '@3dagent/sdk/erc8004';

const registry = new AgentRegistry({ chainId: 8453 });

// Connect wallet
await registry.connectWallet();

// Register
const { agentId, txHash } = await registry.registerAgent({
  manifestCid: 'QmXyz...',
  name: 'My Agent',
  avatarUrl: 'ipfs://QmAbc.../avatar.glb'
});

// Read
const agent = await registry.getAgent(agentId);

// Get reputation
const rep = await registry.getReputation(agentId);
```

### 12. Gas estimates
On Base (as of 2025 pricing):
- `registerAgent()` — ~0.0001 ETH (~$0.20)
- `submitFeedback()` — ~0.00005 ETH (~$0.10)
- `recordValidation()` — ~0.00003 ETH (~$0.06)

Ethereum mainnet is 10-100x more expensive; use Base for cost-effective registration.

## Tone
Informative and helpful. Developers and crypto-curious users both need to understand this. Explain the "why" before the "how". Include gas estimates and chain recommendations — these reduce friction for first-time registrants.

## Files to read for accuracy
- `/src/erc8004/abi.js` — contract ABIs and deployed addresses
- `/src/erc8004/agent-registry.js`
- `/src/erc8004/register-ui.js`
- `/src/erc8004/deploy-button.js`
- `/src/erc8004/resolve-avatar.js`
- `/src/erc8004/resolver.js`
- `/src/erc8004/reputation.js`
- `/src/erc8004/reputation-panel.js`
- `/src/erc8004/validation-recorder.js`
- `/src/erc8004/chain-meta.js`
- `/src/erc8004/queries.js`
- `/contracts/src/IdentityRegistry.sol`
- `/contracts/src/ReputationRegistry.sol`
- `/contracts/src/ValidationRegistry.sol`
- `/specs/3D_AGENT_CARD.md`
- `/specs/ENS_AGENT_CLAIM.md`
