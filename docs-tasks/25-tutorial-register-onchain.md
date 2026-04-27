# Agent Task: Write Tutorial — "Register Your Agent On-Chain"

## Output file
`public/docs/tutorials/register-onchain.md`

## Target audience
Users and developers who want to give their agent a permanent blockchain identity via ERC-8004. They may be new to blockchain but should have a wallet (MetaMask or similar). Step-by-step guide.

## Word count
1500–2500 words

## What this tutorial must cover

### Learning objectives
By the end, the reader will have:
- Created a three.ws on the platform
- Connected an Ethereum wallet
- Registered the agent on Base (chain ID 8453)
- An on-chain agent URL they can share
- Their agent's reputation page live

### Why register on-chain?
Start with motivation — concrete benefits:
- Anyone can verify you created the agent (no platform lock-in)
- Your agent gets a permanent URL: `https://three.ws/a/8453/<id>`
- Users can leave verifiable on-chain reviews
- Agent can be transferred (sold, gifted) to another wallet
- Glasslike auditability — all registrations public on-chain

### What you'll need
- An Ethereum wallet with ~$1 worth of ETH on Base
  - No Base ETH? Bridge from Ethereum at bridge.base.org (costs ~$2 in ETH gas)
  - Or use a faucet: base-sepolia-faucet.com (testnet, free)
- Your agent created on three.ws (covered in Step 1)

### Step 1: Create your agent
If you haven't already:
1. Go to https://three.ws/create
2. Take a selfie or upload a photo
3. Your avatar is generated (takes ~30 seconds)
4. Give it a name and description
5. Click "Save"

Or upload an existing GLB:
1. Go to https://three.ws/app
2. Drag your GLB into the viewer
3. Go to the Manifest tab in the editor
4. Fill in name and description
5. Click "Save to Account"

### Step 2: Get ETH on Base
Base is the recommended chain — cheap and fast.

**Option A: Already have ETH on Ethereum?**
1. Go to bridge.base.org
2. Connect wallet
3. Bridge 0.001 ETH from Ethereum to Base (~$3-4 total including bridge fee)

**Option B: Buy directly on Base**
Use Coinbase (they support Base natively) or any exchange that supports Base withdrawals.

**Option C: Use testnet (free, for practice)**
1. Go to https://docs.base.org/docs/tools/network-faucets
2. Get free testnet ETH on Base Sepolia
3. Register on Base Sepolia first to practice

### Step 3: Connect your wallet
1. In the three.ws app, click "Connect Wallet" (top right)
2. Choose your wallet:
   - MetaMask — click MetaMask icon
   - WalletConnect — scan QR with mobile wallet
   - Coinbase Wallet — click Coinbase icon
   - Email login (Privy) — creates embedded wallet automatically
3. Approve the connection in your wallet
4. Your address appears in the header

### Step 4: Open your agent for editing
1. Go to https://three.ws/dashboard
2. Find your agent → click "Edit"
3. You should see the editor with your avatar loaded

### Step 5: Open the registration flow
1. In the editor, click "Register on Chain" button (top right)
2. The registration modal opens

The modal shows:
- Your agent name and description
- A preview of the JSON that will be registered
- Chain selection (Base is pre-selected)
- Gas estimate (~$0.20 on Base)

### Step 6: Pin your manifest to IPFS
Before registering, your manifest is pinned to IPFS:
1. The manifest JSON is prepared
2. "Pinning to IPFS..." spinner appears
3. After ~5 seconds: "Pinned! CID: QmXyz..."

The CID is the permanent, content-addressed reference to your agent's metadata. This is what gets stored on-chain.

If pinning fails (provider issue):
- Try again — it usually succeeds on retry
- Or configure your own IPFS provider in settings

### Step 7: Confirm the transaction
1. Click "Register on Base"
2. MetaMask (or your wallet) opens with a transaction prompt
3. Review: contract address, gas fee (~0.0001 ETH = ~$0.20)
4. Click "Confirm"
5. Wait 2-5 seconds for Base to confirm

If the transaction fails:
- "Insufficient funds" → bridge more ETH to Base
- "Rejected by user" → try again and confirm
- "Transaction reverted" → check that your manifest is valid JSON

### Step 8: Celebrate! Your agent is on-chain
After confirmation:
- Your agent ID is shown: `#42` (a number unique to the registry)
- Your on-chain URL: `https://three.ws/a/8453/42`
- Open this URL in a new tab — it shows your agent with the ERC-8004 Passport widget

### Step 9: Share your agent
Your on-chain agent URL works anywhere:
- Share on Twitter/X, Farcaster, Lens
- Add to your website
- Embed the Passport widget:
  ```html
  <agent-3d widget="passport" agent-id="8453:0xRegistry:42"></agent-3d>
  ```
- Generate a QR code (built into the passport page)

### Step 10: Build your reputation
Your agent now has a reputation page at `https://three.ws/a/8453/42#reputation`.

Ask friends to leave reviews:
1. Visit your agent's page
2. Scroll to reputation section
3. Connect wallet → Leave a review (1-5 stars + comment)
4. Review submitted on-chain

Check your reputation:
```js
import { getReputation } from '@3dagent/sdk/erc8004';
const { averageRating, totalReviews } = await getReputation(8453, 42);
```

### Step 11: Link to your ENS name (optional)
If you own an ENS name (e.g., `yourname.eth`):
1. Go to app.ens.domains
2. Click your ENS name → Records
3. Add text record: key `3dagent`, value `8453:42`
4. Save (requires gas)

Now `yourname.eth` resolves to your agent. Share as: `https://three.ws/agent/ens/yourname.eth`

### Troubleshooting
Common issues and solutions:
- Wallet won't connect → try refreshing, use a different wallet
- IPFS pinning slow → wait up to 60 seconds; pin services can be slow
- Transaction reverts → check gas limit, try increasing by 20%
- Wrong chain → make sure MetaMask is set to Base (chain ID 8453)

## Tone
Encouraging and practical. Many readers will be new to blockchain. Explain gas in plain English. Include the "why" at every step. The troubleshooting section is important.

## Files to read for accuracy
- `/src/erc8004/register-ui.js`
- `/src/erc8004/deploy-button.js`
- `/src/erc8004/agent-registry.js`
- `/src/erc8004/chain-meta.js`
- `/src/erc8004/privy.js`
- `/src/wallet/connect-button.js`
- `/specs/ENS_AGENT_CLAIM.md`
- `/specs/3D_AGENT_CARD.md`
