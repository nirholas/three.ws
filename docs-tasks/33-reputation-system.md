# Agent Task: Write "Reputation System" Documentation

## Output file
`public/docs/reputation.md`

## Target audience
Users who want to review agents, developers building reputation-aware applications, and agent creators who want to understand how reputation works.

## Word count
1000–1500 words

## What this document must cover

### 1. What is the reputation system?
The reputation system lets users leave on-chain reviews for registered agents:
- 1-5 star rating
- Optional text comment
- One review per wallet address per agent
- Reviews signed and stored on the ReputationRegistry smart contract
- Tamper-proof: reviews can't be deleted or modified once submitted

### 2. Why on-chain reputation?
Traditional ratings (app store reviews, Trustpilot) can be:
- Removed by the platform
- Faked with fake accounts
- Hidden from view

On-chain reputation is:
- Permanent (blockchain is immutable)
- Publicly verifiable (anyone can read the contract)
- Sybil-resistant (requires a real wallet per review)
- Composable (other apps can read reputation data)

### 3. Leaving a review

**Via the UI:**
1. Visit an agent's on-chain page: `https://three.ws/a/<chainId>/<agentId>`
2. Scroll to the reputation section
3. Connect wallet (MetaMask, WalletConnect, Privy)
4. Click the star rating (1-5)
5. Write an optional comment (max 280 characters)
6. Click "Submit Review"
7. Confirm the transaction in your wallet (~$0.10 on Base)

**One review per wallet:** If you've already reviewed this agent, a "Update Review" option appears.

**Via the API:**
```js
import { submitFeedback } from '@3dagent/sdk/erc8004';
const { txHash } = await submitFeedback({
  chainId: 8453,
  agentId: 42,
  stars: 5,
  comment: 'Amazing experience! The avatar is incredible.',
  wallet: connectedWallet
});
```

### 4. Reading reputation

**Via the reputation panel (UI):**
The reputation panel (`reputation-panel.js`) is embedded in:
- Agent on-chain pages (`/a/<chainId>/<agentId>`)
- The ERC-8004 Passport widget
- The agent profile page

Shows:
- Overall average rating (stars)
- Total review count
- Recent reviews (with wallet address, rating, comment, timestamp)

**Via the SDK:**
```js
import { getReputation, getRecentReviews } from '@3dagent/sdk/erc8004';

// Overall stats
const { averageRating, totalReviews } = await getReputation(8453, 42);

// Recent reviews
const reviews = await getRecentReviews(8453, 42, { limit: 10 });
reviews.forEach(r => {
  console.log(r.reviewer, r.stars, r.comment, r.timestamp);
});
```

**Via the Passport widget:**
```html
<agent-3d widget="passport" agent-id="8453:0xRegistry:42" show-reputation="true"></agent-3d>
```

### 5. Reputation display
The `reputation-ui.js` module renders:
- Star display (filled/empty stars, half stars)
- Average score (e.g., "4.8 / 5")
- Total count (e.g., "23 reviews")
- Recent reviews list with pagination

The `/public/reputation` page is a full reputation dashboard for an agent.

### 6. Reputation in agent discovery
Agents with higher reputation rank higher in:
- The explore page (`/explore`)
- Showcase selection
- API search results (when sorted by reputation)

```
GET /api/explore?sort=reputation&order=desc
```

### 7. Smart contract details
The `ReputationRegistry` contract:
- `submitFeedback(agentId, stars, comment)` — submit or update review
  - `stars`: uint8, 1-5
  - `comment`: string, max 280 chars
  - Can only be called once per (reviewer, agentId) pair (update allowed)
- `getReputation(agentId)` — returns `(averageRating, totalReviews)` as packed uint
- `getRecentReviews(agentId, limit)` — returns array of recent reviews

Contract addresses in `/src/erc8004/abi.js` under `REGISTRY_DEPLOYMENTS`.

### 8. Validation attestations (related)
Separate from star ratings, glTF validation can also be recorded on-chain:
- Run validation → hash the report → submit to `ValidationRegistry`
- Attestation is linked to the agent ID
- Shows that the model passes glTF spec as of a specific date
- The validation history is shown on the agent's page

See the Validation documentation for details.

## Tone
Clear and informative. Cover both user-facing (how to review) and developer-facing (how to integrate). The "why on-chain" section is important for users unfamiliar with blockchain.

## Files to read for accuracy
- `/src/erc8004/reputation.js`
- `/src/erc8004/reputation-panel.js`
- `/src/reputation-ui.js`
- `/contracts/src/ReputationRegistry.sol`
- `/src/erc8004/abi.js`
- `/public/reputation/` — reputation dashboard page
- `/api/agents.js` — reputation in agent listing
