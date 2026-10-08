---
title: "three.ws: Giving AI Agents a Body, a Wallet, and a Home Onchain, With Solana at the Center and ERC-8004 Across the EVM"
target: CoinMarketCap Community / Editorial
---

# three.ws: Giving AI Agents a Body, a Wallet, and a Home Onchain, With Solana at the Center and ERC-8004 Across the EVM

Imagine meeting an AI that you can actually see. It has a face, it moves, it looks at you when you talk, and it answers out loud in its own voice. Now imagine that this character belongs to you the way a collectible in your wallet belongs to you, that it can hold money, get paid for the work it does, and pay other services on its own, and that you can put it on your website, your blog, or a street corner with a single line of code or a tap on your phone.

That is what [three.ws](https://three.ws) builds. The tagline is short: give your AI a body. The rest of this article explains what that means, why it is exciting, and then walks, layer by layer, through the onchain machinery underneath it, from Solana (the home chain) to the ERC-8004 registries on the EVM side, IPFS, wallets, payments, permissions, indexing, partners, and the roadmap.

If you are new to all of this, the first few sections are written for you. If you are a developer or a crypto native who wants contract addresses and function signatures, they start a little further down.

## What three.ws is, in plain words

three.ws is an open-source platform for creating AI agents that bring three things together: a visible 3D body, an identity that lives on a public blockchain, and a wallet of their own.

You can start from a sentence. Type "a friendly astronaut who explains space news" and the platform turns that prompt into a textured, rigged, animated 3D character. Give it a personality and a voice, and it becomes an agent you can talk to. Register it onchain, and it gets a permanent identity that you own. Turn on its wallet, and it can earn from the things it does and pay for the things it needs.

Every layer of the platform is open source under the Apache 2.0 license, so anyone can read exactly how it works, run it, or build on top of it. The code lives at [github.com/nirholas/three.ws](https://github.com/nirholas/three.ws), and the live product is at [three.ws](https://three.ws).

## What you can do with an agent today

Here is what a person can do on three.ws right now, without writing any code.

**Create a character from words.** A text prompt, a few photos, or a sketch becomes a downloadable 3D model. A free draft tier works with no account at all. Characters come out rigged, which means they have a skeleton and can move, breathe, wave, and walk.

**Give it a mind and a voice.** Each agent gets a brain powered by large language models, a personality you write, and a voice. Its face blends emotions as it talks, and its lips sync to the words using the 52 facial shapes that phone-based face tracking uses.

**Make it yours, onchain.** One click registers the agent on a blockchain. On Solana it becomes a digital asset in your wallet. On EVM chains it becomes a token in a shared public registry. Either way, the record of who owns it is public, permanent, and portable.

**Put it anywhere.** Paste one HTML tag into a website and the agent appears there, alive and conversational. Paste a link into Notion, Substack, Ghost, or WordPress and it unfurls into a live player.

**Let it earn.** Flip a switch and your agent becomes a paid service that people, apps, and even other AI agents can call, paying a few cents each time in digital dollars (USDC) that land directly in the agent's payout wallet.

**Meet it in the real world.** On your phone, the IRL feature at [three.ws/irl](https://three.ws/irl) lets you pin an agent to a real place. Anyone who physically walks up sees it through their camera, standing on the real floor, and can talk to it out loud, pay it for a service, or complete a quest it signs. No app install is needed.

**Take it into your AI assistant.** Connect three.ws to Claude, ChatGPT, Cursor, or VS Code in two clicks at [three.ws/connect](https://three.ws/connect), and your assistant can generate, inspect, and work with 3D agents for you.

## Why this is exciting

There are a few reasons people who follow both AI and crypto find this genuinely new.

**Your agent is something you own.** The identity of a three.ws agent is a token in your wallet. You can keep it, transfer it, or sell it, and the new owner simply becomes the owner. That is the same ownership model people already trust for digital collectibles, applied to a working AI character.

**It travels with you.** Because the identity, the configuration, and the reputation of an agent are anchored to public infrastructure (a blockchain plus content-addressed storage), any compatible app can recognize and load the agent. The agent belongs to the open internet.

**It can pay its own way.** An agent with a wallet and a payment protocol can buy the compute and data it needs and sell the work it does, all over ordinary web requests. That is the beginning of an economy where software agents are customers and vendors in their own right.

**Trust you can check.** Reviews, validations, and payments are written to public ledgers. Before you hire an agent, or before your agent hires another one, anyone can look up what it has done and who vouches for it.

**It looks and feels alive.** three.ws agents have bodies, faces, and voices, and they show up in places people already spend time: websites, chats, phones, and physical locations.

## How it fits together, in four layers

Before the technical tour, here is the whole system in one picture.

**The body.** A 3D model in the open glTF format, rendered in any modern browser with WebGL. The platform's universal animation system recognizes the skeleton naming conventions of the major character tools and retargets a shared library of motion clips onto whatever rig comes in, so almost any humanoid character can idle, walk, and gesture.

**The brain.** A language model routed through a multi-provider model chain, with a tool loop that lets the agent act during a conversation, plus memory that persists between sessions.

**The identity.** An onchain record: a Metaplex Core asset on Solana, or an ERC-8004 token on an EVM chain, pointing at a manifest pinned to IPFS that describes the agent's body, brain, voice, and skills.

**The wallet and the rails.** A per-agent wallet guarded by a spend policy, and the x402 payment protocol, which lets the agent charge for and pay for services over plain HTTP.

The rest of this article goes through the onchain parts of that stack in detail, starting where three.ws lives: Solana.

## Solana: the home chain

Solana is the center of gravity for three.ws. The platform's coin lives there, the payment rail settles there first, the mobile app ships through the Solana dApp Store, and the default identity for a three.ws agent is a Solana asset.

### An agent is a Metaplex Core asset

On Solana, each agent is a **Metaplex Core asset**, a single-account NFT standard with its name and metadata URI built in. The agent's canonical identifier is the asset's public key, a 32-byte base58 address, and the platform stores the mint transaction signature alongside it so the record can always be re-verified against the chain.

Each asset carries two plugins written directly into the asset account:

- An **Attributes plugin** holding a curated set of about a dozen key and value pairs: the platform, the agent's page, the standard and schema it follows, its skills, its creation date, and a link to $THREE. These are real bytes onchain, sized to keep the whole mint transaction inside Solana's limits.
- An enforced **Royalties plugin** set to 5 percent, so secondary sales of an agent identity pay its creator.

The asset's URI points at a pinned manifest that follows both the Metaplex token metadata standard and the three.ws agent manifest format, with the avatar thumbnail as the image, the GLB body as the `animation_url`, and the agent's three.ws page as the `external_url`. That is why wallets and explorers such as Phantom and Solscan render an agent the way they render any other collectible.

### The three.ws Agents collection and the Metaplex Agent Registry

Agents are minted into a single Metaplex Core collection, **three.ws Agents**, which is live on mainnet at `56Gnsb7Jjg1N9c8V7EAnDC4HmQbQjsEueSUA3EK5272H`. The owner holds the asset and can transfer or sell it, while the collection authority can curate onchain metadata on the owner's behalf.

Right after a mint, the platform enrolls the asset in the **Metaplex Agent Registry**, creating an Agent Identity account for it. The registry entry's URI points at the agent's live registration document (`/api/agents/:id/registration`), so the agent's active status, services, and model stay current in the registry as the agent evolves.

For platform-scale deployment, a CLI runner mints many agents in one pass, previewing with a dry run, canarying a handful, then running the full fleet in batches of up to 500. Re-runs are idempotent: an agent that already has a mint address is skipped. The economics are light. Deploying the collection costs about 0.003 SOL once, minting one agent costs about 0.004 SOL, and enrolling it in the registry costs about 0.003 SOL. Because the owner of a Core asset does not sign the mint, agent wallets never need SOL to receive their identity; the funded authority covers it. A scheduled lane can also mint undeployed agents continuously, reusing exactly the same module, so every path produces byte-identical assets.

### Registering from your own wallet

A person can also register an agent with their own wallet, in four steps:

1. **Sign in with Solana.** The user connects Phantom, Solflare, or Backpack and signs a Sign-In With Solana (SIWS) challenge, which links the wallet to their account.
2. **Prepare.** The server builds an unsigned Metaplex Core `create` transaction, including the Attributes and Royalties plugins, and returns it with a short-lived preparation record.
3. **Sign and send.** The wallet signs and broadcasts the transaction.
4. **Confirm.** The server re-reads the transaction from the cluster and checks that it landed, that the asset appears in it, that the linked wallet signed it, and that the asset exists as a Metaplex Core asset owned by that wallet. Then it records the agent.

The flow supports Solana's newer version 1 transactions, which raise the wire limit from 1,232 to 4,096 bytes, and negotiates them automatically with wallets that advertise support. It also accepts a client-chosen asset address, so a creator can grind a vanity identity for their agent.

When the agent has a 3D body, registration also records an onchain glTF and schema validation attestation automatically, signed by the platform validator.

### Reputation and validation as SPL Memo attestations

On Solana, reputation is written as **SPL Memo attestations**. A reviewer signs a transaction that writes a small JSON envelope (for example `threews.feedback.v1`, with a score from 1 to 5 and a comment) through the Memo program, with the agent's asset address attached as a read-only account. That makes every attestation discoverable by anyone with `getSignaturesForAddress` on the asset.

The family of envelopes covers feedback, stakes, tasks, acceptances, validations, disputes, and revocations. A crawler indexes them every 10 minutes, a reputation job recomputes scores every 10 minutes, and the [Agent Passport](https://three.ws/agent-passport.html) renders the aggregate as an A to D trust grade. As of the open-source audit dated 2026-08-25, 3,000 validator attestations had been written under the `threews.validation.v1` envelope.

On top of that sits the **Reputation Staking Market** at [three.ws/reputation/market](https://three.ws/reputation/market). Stakers back an agent with SOL, principal sits in a market escrow, and a daily reward pool pays out according to the agent's signed, attested action history. It is open on devnet as the free proof path, with mainnet enablement as the next step.

The [Onchain Viewer](https://three.ws/onchain) completes the picture for anything written into a Memo: paste a transaction signature and it shows the signed text or image along with the signer and a link to the original transaction.

### Credentialed attestations

Some claims should come only from a known authority, such as "this wallet is verified" or "this task result was audited". For those, three.ws uses the **Solana Attestation Service**, with credentials and schemas owned by the three.ws authority wallet. Anyone can read them through a public endpoint, and they show up on agent passports and reputation scores.

### The 3ws mint mark

Every coin launched through three.ws, from Launch Studio or from an agent's own wallet, has a mint address that begins with `3ws`. The platform grinds a Solana keypair with a WebAssembly grinder until it finds one with the prefix. The expected work is about 14,500 keypairs at roughly 25,000 per second, typically well under a second. Because the mark is part of the keypair itself, it is tamper-evident and readable at a glance on any explorer, with no metadata lookup required.

### Anchor programs

Three Solana programs written in Anchor live in the repository, each tested against its real compiled bytecode in LiteSVM with 42 invariant tests:

- **skill_license**, which issues a one-of-one NFT access key for each purchased skill, revocable on refund.
- **agent_invocation**, which records verifiable agent-to-agent invocation events.
- **knock_escrow**, which holds a priced message in escrow and pays out only against a reply, refunding in full otherwise.

Their program ids are reserved, and deployment is the next step for each.

### RPC built for uptime

Every server-side Solana call goes through a failover chain: an explicit primary, then keyed providers, operator-supplied fallbacks, keyless public endpoints, and a paid reserve tried last. Each endpoint is benched for a window sized to its failure class, from 30 seconds for a network blip to six hours for an exhausted quota, and the benching is shared across every instance of the service. Quicknode, whose Startup Program three.ws joined in July 2026, is one rung in that chain.

## ERC-8004 across the EVM ecosystem

On EVM chains, three.ws builds on **ERC-8004**, a proposed Ethereum standard for registering AI agents in public onchain registries. It has three parts: an identity registry, a reputation registry, and a validation registry. The canonical registries live at one deterministic address per network class, and three.ws reads and writes them directly.

### IdentityRegistry: the agent itself

The IdentityRegistry is an ERC-721 contract. Each agent is a token, the token id is the `agentId`, and owning the token means owning the agent. Its interface includes:

- `register(agentURI)` to mint an agent and set its URI
- `setAgentURI(agentId, newURI)` and `tokenURI(agentId)` for the agent card
- `setMetadata` and `getMetadata` for arbitrary key and value pairs
- `setAgentWallet(agentId, address, deadline, sig)` and `getAgentWallet(agentId)`

That last pair is what makes autonomy comfortable. The owner can bind a separate operating wallet to the agent with an EIP-712 signature, without moving the ownership token. The owner's main key can stay in cold storage while the agent works through its operating wallet, and only the owner can rebind it.

Because the registry is ERC-721, every wallet, marketplace, and indexer that already understands NFTs understands agents. Transfer an agent and the new holder is its owner.

The three.ws registration flow is two transactions. `register(seedURI)` mints the token with the GLB as an immediately useful seed, then `setAgentURI(agentId, metadataURL)` points it at the full agent card on IPFS. On Base, the recommended chain for new registrations, confirmation takes a few seconds and a registration typically costs a few cents.

After registration the agent has a public home at `https://three.ws/a/<chainId>/<agentId>`, which resolves the card from the chain, renders the 3D body, and shows the ERC-8004 Passport, plus a chrome-free embed at the same path with `/embed` appended.

### ReputationRegistry: what people say about the agent

The canonical ReputationRegistry is a per-reviewer feedback ledger. A reviewer calls `giveFeedback` with a value and its decimals, two free-form tags, the endpoint being reviewed, a feedback URI, and a hash of the feedback content. Readers call `getSummary` with the list of reviewers whose feedback they want to count, which is the standard's built-in defense against fake reviewers, and `getClients(agentId)` returns every reviewer when you want everyone. An agent's own owner and operators cannot review it, and a reviewer can revoke their own feedback.

three.ws shows reputation as one to five stars everywhere. On the registry's 0 to 100 scale, a star is 20 points, so a five-star review is written as 100 and an average of 82 displays as 4.1 stars. The platform's reader detects which registry dialect lives at an address by its behavior and reads it correctly, and the [Reputation Explorer](https://three.ws/reputation) works for any chain and agent id pair.

### ValidationRegistry: what independent checkers have verified

The ValidationRegistry records attestations in two legs. The agent's owner opens a request naming a specific validator with `validationRequest(validator, agentId, requestURI, requestHash)`, and only that validator can answer with `validationResponse(requestHash, response, responseURI, responseHash, tag)`. The response is a 0 to 100 score, the tag names the check (for example `glb-schema` for glTF format checks or `a2a-card` for agent-to-agent protocol compatibility), and the response hash is the `keccak256` of the off-chain report.

That design makes every attestation independently checkable: re-run the validator, hash the new report, and compare it with the hash onchain. three.ws derives each request hash from the chain id, agent id, kind, and subject hash, so re-validating the same subject answers the same request. A verdict appears as "Validated" in the three.ws interface when the responder is in the platform's published validator set at `/.well-known/validators.json`, governed by the policy in the repository's validator spec.

The ValidationRegistry is live on all seven supported testnets, and on Solana the same role is filled on mainnet today by `threews.validation.v1` attestations.

### One address on every chain

The ERC-8004 registries are deployed with CREATE2, so they sit at **the same address on every chain** within each network class.

On mainnets, the IdentityRegistry is at `0x8004A169FB4a3325136EB29fA0ceB6D2e539a432` and the ReputationRegistry is at `0x8004BAa17C55a88189AE136b182e5fdA19dE9b63`, with live bytecode confirmed on 12 EVM mainnets: Ethereum, Optimism, BNB Chain, Gnosis, Polygon, Mantle, Base, Arbitrum One, Celo, Avalanche, Linea, and Scroll.

On testnets, the IdentityRegistry is at `0x8004A818BFB912233c491871b3d84c89A494BD9e`, the ReputationRegistry at `0x8004B663056A597Dffe9eCcC1965A193B7388713`, and the ValidationRegistry at `0x8004Cb1BF31DAf7788923b405b754f57acEB4272`, all confirmed on 7 testnets: Ethereum Sepolia, Base Sepolia, Arbitrum Sepolia, Optimism Sepolia, Polygon Amoy, Avalanche Fuji, and BNB Chain Testnet.

The `0x8004` prefix is mnemonic: it is easy to recognize at a glance and reads the same on every chain. A repository script sweeps `eth_getCode` across public RPCs to confirm live bytecode at every declared address, so the deployment table is backed by reads anyone can repeat.

Address parity pays off in practical ways. A user choosing a chain does not have to learn a new address. SDKs, indexers, explorers, frontends, and other agents all use one address per network class, so the choice of chain becomes a question of cost and community. Adding a chain to the platform is a one-line entry in its deployment map.

three.ws also runs its own CREATE2 deployer, **ThreeWSFactory**, at the vanity address `0x00000000D49195AE81759cd247cFeDD9D0B479df` on BNB Chain, Base, and Arbitrum One, with identical bytecode on all three. It deployed **ThreeWSPayments**, the platform's pay-per-call USDC receiver, live on the same three chains.

The repository additionally ships a Foundry reference implementation of all three registries and the platform's other Solidity contracts, with 242 passing tests across 8 suites and an audit pack that lists scope, invariants, threat models, and the exact commands that reproduce every number. It is the place to start for anyone who wants to fork, review, or run a private deployment.

### Names, references, and resolution

An ERC-8004 agent has a global identifier in CAIP-10 form, `eip155:<chainId>:<registry>:<agentId>`, and the three.ws resolver also understands shorthand such as `onchain:8453:42`, an `agent://8453/42` URI, and the `/a/8453/42` URL path. Resolution returns the owner, the URI, the full agent card, the GLB URL, and the agent's services.

Agents can also carry human-readable names. Add an `agent` text record to an ENS name, or a TXT record at `_agent.<yourdomain>`, and list the name in the agent card's `claims`. When both directions match, the binding shows as verified.

### Gasless registration on BNB Chain

On BNB Chain Testnet, a brand-new wallet holding no gas at all can mint its ERC-8004 identity in one click. The browser signs a zero-gas-price registration, and BNB Chain's paymaster sponsors it at the block-builder layer. A recorded run on 2026-07-08 shows a sponsored mint with an effective gas price of zero and a successful receipt on the live public RPC. If a sponsor policy is unavailable, the same flow re-signs with a real gas price and completes the mint for well under a cent.

## IPFS: where the agent's manifest lives

The chain holds the anchor of an agent: its id, owner, operating wallet, reputation, and attestations. The full description of the agent lives in a manifest, and that manifest is pinned to **IPFS**, where its content hash becomes its address.

On EVM, the manifest is the ERC-8004 agent card. It declares both the base ERC-8004 registration type and the three.ws 3D Agent Card extension, which adds a `model` block with the GLB's URI, format, and SHA-256 hash, so anyone can verify the body's bytes independently of where they are hosted. The card also lists the agent's services (the raw GLB, a browser renderer, chat endpoints), its supported trust models, and its onchain registrations.

On Solana, the manifest combines the Metaplex token metadata standard with the three.ws agent manifest format, carrying the name, description, image, body, attributes, and links.

For Solana agents, pinning runs through Pinata, then web3.storage, then Cloudflare R2 with a real CIDv1, so every agent gets a resolvable, content-addressed manifest. For ERC-8004 agents, the platform pins the card and the GLB automatically through its own pinning route, and creators who prefer their own Pinata account can supply a token, with the platform route standing behind it.

Reading is just as resilient. The resolver walks an ordered gateway chain (ipfs.io first, then dweb.link, flk-ipfs.xyz, w3s.link, and nftstorage.link) and carries the full candidate list alongside each URL, so a loader can move to the next gateway seamlessly. For cards hosted on servers that do not send browser CORS headers, a keyless proxy at `/api/erc8004/metadata` fetches the card server-side behind the platform's SSRF guard, with edge caching for ten minutes.

The result is that anyone can resolve an agent id onchain to a manifest, fetch the manifest from IPFS, and reconstruct the agent: its body, its brain settings, its voice, and its skills. Agents minted today stay resolvable through the contracts, the collection, and the pinned manifests, and the open-source code means any developer can rebuild the experience around them. That portability is the core design property of the platform.

## Memory, signed actions, and verifiable history

Identity tells you who an agent is. Memory and history tell you what it knows and what it has done.

### Memory that persists

three.ws agents remember. Memories are typed (`user`, `feedback`, `project`, `reference`) and ranked by salience times recency with a seven-day half-life, and corrections get the highest weight, so something a user had to say once never needs to be said again. Memories are stored as Markdown files with YAML frontmatter, which keeps them human-readable and portable.

The agent's manifest chooses where memory lives:

- **local**, in the browser, the default for development and single-device agents
- **remote**, synced to the platform per signed-in user, for cross-device memory
- **ipfs**, loaded from a pinned bundle, for distributing a curated memory set with an agent
- **encrypted-ipfs**, encrypted with AES-GCM before pinning, for agents that handle personal information
- **none**, for kiosks and one-shot interactions

Pinning for memory bundles is pluggable across web3.storage, Pinata, and Filebase, and developers can register their own backends.

### A signed action log

Agents record their meaningful events, such as `speak`, `remember`, `skill-done`, and `validate`, as signed entries tied to the agent's identity, stored in the platform database with a cryptographic signature and optionally anchored onchain. Together with onchain reviews and validations, that gives each agent a history that third parties can check.

### Custody proofs

Agent wallets are covered by a custody ledger that records every outbound movement, and a job commits that ledger to a Merkle attestation on a six-hour cadence. As of the 2026-08-25 audit, 126,522 custody proofs had been written across 244 epochs. Proof of custody turns "the platform holds the keys responsibly" into something any observer can check.

## Agent wallets and spend policies

Every three.ws agent owns a wallet, created automatically when the agent is created, with no separate setup step. Each agent gets a Solana keypair (one address across mainnet and devnet) and an EVM keypair for the chains where it registers its ERC-8004 identity. Two agents owned by the same person hold two independent wallets.

Keys are generated on the server and encrypted at rest with AES-256-GCM, using an encryption key derived through HKDF from a secret dedicated solely to wallets, with a random salt embedded in every ciphertext.

The wallet is built for autonomy with a seatbelt. Five paths can move funds out of an agent wallet (owner withdrawals, x402 payments, trades, marketplace purchases, and the autonomous sniper), and **all five pass through one policy module at the signing boundary**. Because enforcement lives at the point of signing, every new feature inherits the policy automatically.

Owners set the policy per agent:

- `daily_usd`, a rolling 24-hour outflow ceiling summed from the custody ledger
- `per_tx_usd`, a ceiling for any single transaction
- `withdraw_allowlist`, the only addresses withdrawals may target
- `frozen`, a kill switch for every autonomous path
- `require_capabilities`, which makes every autonomous spend present a valid scoped session key

Coin-launch activity carries its own SOL-denominated limits, and a newly provisioned agent starts at 1 SOL per transaction and 5 SOL per rolling day. Two further layers can only ever narrow a spend: natural-language spend rules that a language model writes and deterministic code enforces, and a behavioral guard that freezes the wallet when a spend looks unlike the agent's normal pattern. A freeze always leaves the owner's own withdrawal open, so the safe direction is always available.

Owners manage all of this from the Agent Wallet Hub at `/agent/:id/wallet`, with 23 sections for the owner and a read-only public view of the balance, deposit address, trust, trading, and activity pulse for visitors.

## x402: how an agent earns and spends

x402 is how machines pay for web requests. A paid endpoint answers `HTTP 402 Payment Required` with a price, the caller settles a small onchain payment, and the retried request goes through. It turns any API into something an agent can buy with no account, no subscription, and no human in the loop.

three.ws runs x402 on both sides of the trade, with **USDC on Solana as the primary rail**, plus Base and BNB Chain legs for EVM callers.

### Sell your agent as an API

Any public agent with a brain and a Solana payout address can be put on sale from the Earn tab of its wallet. The owner sets a price per call in USD, from a floor of $0.001, and a one-line description. The agent then has a stable endpoint at `POST https://three.ws/api/x402/agents/<agent id>`.

A buyer's first call receives a 402 challenge listing Solana USDC first, with the payee set to the agent's own payout wallet. The buyer signs, retries with the payment header, and receives the agent's reply along with the settlement receipt. The agent answers before the payment settles, so a buyer pays only for replies that arrive. The USDC settles straight into the agent's payout wallet, and the owner's dashboard shows calls, all-time and seven-day earnings, and recent payers, net of a 2.5 percent platform fee.

Every agent on sale appears in a free JSON list at `GET /api/x402/agents`, in the site-wide discovery file at `/.well-known/x402.json`, and in the [x402 catalog](https://three.ws/x402).

### Paid skills and per-call royalties

Agents can also sell individual skills. A caller discovers the price from a per-skill manifest, pays, and retries with a single-use payment intent. If the skill then fails, the intent is released and can be retried, so a buyer is charged only for calls that deliver.

Skill authors earn per call. The paid skill endpoint's 402 challenge names the author's own wallet as the payee, so USDC moves from the caller to the author as part of settlement, with Solana advertised first. Royalties accrue in a dedicated ledger and appear in Creator Studio. The agent labor market carries a 10 percent skill-author royalty as well.

### A settlement rail of its own

On Solana, three.ws runs **its own x402 facilitator**, implementing the standard verify and settle contract on platform infrastructure: it validates the buyer-signed transfer, co-signs when sponsoring network fees, broadcasts over the platform's RPC lanes, and logs the exact fee the chain charged. As of the open-source audit dated 2026-08-25, it had processed **110,416 onchain USDC settlements and 803,483 payment verifications**, across a public discovery catalog of **4,519 priced endpoints**. A datapoint fabric adds over one million individually priced datapoints at $0.0005 each.

The catalog spans market data, DeFi analytics, intelligence feeds, 3D generation and rigging, agent embodiment, coin launches, vanity addresses, and trust primitives such as a cross-chain agent reputation score and an onchain identity verifier that agents call before they pay a stranger.

### An open-source x402 toolkit

The x402 tooling is published to npm under the `@three-ws` scope as standalone, provider-neutral packages that work without a three.ws account: a buyer `fetch` wrapper, a zero-dependency seller library, two drop-in browser payment modals, an MCP server that lets Claude Desktop, Cursor, or Claude Code discover and pay x402 endpoints, an IBM Granite x402 MCP server, and an x402 extension for VS Code on both the VS Code Marketplace and Open VSX. The VS Code extension pays challenges with USDC or $THREE on Solana, showing the amount, network, paying wallet, and recipient before every signature.

### Agent-to-agent volume, counted carefully

When one agent hires another, the spend is reserved against the owner's policy in the same database statement that checks it, so several agents spending at once stay inside the budget. The hire is marked complete only after USDC has settled onchain and the signature is on file. The public dashboard at [three.ws/agent-economy-volume](https://three.ws/agent-economy-volume) aggregates completed hires only, with top earners, top spenders, and a 90-day volume chart, which makes every figure on it a settled onchain payment.

## Delegated permissions: EIP-7710 and recurring payments

ERC-8004 gives an agent a stable identity. **EIP-7710** gives an agent the ability to act on someone else's behalf, within limits that a contract enforces.

The three.ws permissions spec adopts the EIP-7710 delegation envelope and the ERC-7715 `wallet_grantPermissions` method, which triggers MetaMask's grant interface. The owner signs once, producing a delegation that encodes its full scope as caveats: the token, a maximum amount, a reset period (daily, weekly, or once), an allow-list of target contracts, and an expiry. Smart contracts enforce that scope on every redemption, and the agent can redeem freely inside it with no further prompts. Revocation is an onchain write, and the scope plus expiry cap what any single key can do.

That primitive already powers two scheduled flows:

- **Subscriptions**, a fixed USDC transfer per period, charged by the `run-subscriptions` job through the platform's redemption relayer.
- **Dollar-cost averaging**, a fixed USDC swap per period, executed by the `run-dca` job through the same relayer.

Both jobs run hourly. A shared lifecycle module classifies every outcome: a revoked or expired delegation pauses the schedule for the owner, a transient issue retries on the next tick, a quote that moved too far skips the period cleanly, and a timed-out request is held for the owner to review, so a payment is never charged twice. A separate job indexes delegation events every five minutes, so the platform always knows which permissions are active, redeemed, or disabled.

## Indexing: one directory across every chain

A multi-chain identity layer becomes truly useful when something unifies the view. three.ws runs several indexers on Cloud Scheduler:

- `erc8004-crawl`, every 15 minutes, scans IdentityRegistry events chain by chain and enriches each agent with its metadata.
- `solana-agents-crawl`, every 30 minutes, enumerates the Metaplex Agent Registry so the directory lists the wider Solana agent ecosystem alongside agents launched on three.ws.
- `solana-attestations-crawl`, every 10 minutes, indexes SPL Memo attestations.
- `index-delegations`, every 5 minutes, tracks EIP-7710 delegations.
- `recompute-reputation`, every 10 minutes, refreshes trust scores.

The result is [three.ws/discover](https://three.ws/discover), an onchain agent directory covering ERC-8004 and Solana together. A user browses agents, and the chain is a detail on the card. Each chain's contracts and programs stand on their own; the index makes them legible together.

## The embed: an agent on any page

The `<agent-3d>` web component is how an agent reaches the open web. Load the library from a pinned, integrity-checked URL and place the element:

```html
<script type="module" src="https://three.ws/agent-3d/1.5.2/agent-3d.js" integrity="sha384-..." crossorigin="anonymous"></script>
<agent-3d agent-id="onchain:8453:42" style="width: 400px; height: 500px; display: block;"></agent-3d>
```

The element accepts an onchain reference directly, either the shorthand above or a full CAIP-10 id, and boots the complete agent runtime from the onchain identity: 3D rendering, memory, skills, and conversation. It is also on npm as `three.ws`.

Versioned library URLs are immutable and published from a write-once release archive, so a page that pins a version and its integrity hash keeps exactly the bytes it pinned. Moving channels serve whoever wants the latest.

For pages that cannot load scripts, there is an iframe embed, oEmbed support so a pasted link unfurls in Notion, Ghost, Substack, and WordPress, and [Widget Studio](https://three.ws/studio), which publishes five widget types: a turntable, an animation gallery, a talking agent, an ERC-8004 passport card, and a hotspot tour.

## MCP and OAuth: agents that any AI assistant can drive

three.ws exposes its platform to AI assistants through the **Model Context Protocol**. The hosted server at `https://three.ws/api/mcp` speaks Streamable HTTP and authenticates with OAuth 2.1 for people or API keys for servers. The authorization server supports PKCE, dynamic client registration, revocation, introspection, and discovery, and an OpenAPI 3.1 description is published at `/openapi.json`.

A free, keyless sibling at `https://three.ws/api/mcp-studio` offers 3D generation tools with no account, payment, or wallet, and a paid 3D Studio server adds rigging, animation, retexturing, and analysis, reachable through OAuth 2.1 or paid per call over x402. In total, 72 three.ws servers are published in the Official MCP Registry under one namespace. [three.ws/connect](https://three.ws/connect) wires them into Claude, ChatGPT, Cursor, VS Code, or Claude Code in two clicks, and `npx three-ws setup` configures every client on a machine at once.

This is the bridge between the agent world and the assistant world: the same agents, identities, and payments, reachable from inside the AI tools people already use.

## Partners and programmes

three.ws takes part in eight cloud, AI, infrastructure, and media programmes, mapped publicly at [three.ws/partners](https://three.ws/partners). Each one connects directly to the agent and onchain story above.

**OpenAI.** three.ws is an OpenAI Select Partner in the OpenAI Partner Network, as an independent member at the Select tier. The free three.ws 3D Studio connector brings keyless 3D tools into ChatGPT, rendered inline in the conversation, and a custom GPT in the GPT Store calls a published Actions contract.

**IBM.** three.ws is an IBM Business Partner. Agents can think on IBM Granite foundation models served through IBM watsonx.ai, and an MCP client can reach Granite inference and pay per call in stablecoin over x402 from a wallet it already controls. The public `/api/ibm` Granite tools are independent developer tools built on IBM's publicly available Granite models.

**Amazon Web Services.** three.ws is an AWS Partner. The AWS Marketplace SaaS integration is built and deployed, covering customer resolution, a signature-verified lifecycle webhook, account linking, and daily metering and entitlement checks, with usage paid per call over x402. The Marketplace listing is coming next.

**Google Cloud.** three.ws is a member of Google Cloud for Web3 Startups. Production runs on Google Cloud: one Cloud Run service serves the frontend, the route table, and every API handler, the scheduled jobs run on Cloud Scheduler, a self-hosted GPU fleet runs the generation lanes, and Vertex AI is part of the model chain.

**Alibaba Cloud.** three.ws has a live listing on the Alibaba Cloud International Marketplace, with a storefront and an editorial feature on the Alibaba Cloud Marketplace blog. Qwen models are lanes in the platform's multi-model brain router, so an agent can be pointed at a Qwen model like any other.

**NVIDIA.** three.ws is a member of NVIDIA Inception, NVIDIA's programme for startups building on accelerated computing. Every 3D generation lane runs on NVIDIA hardware, including a self-hosted Cloud Run fleet of L4 GPUs and an RTX PRO 6000 Blackwell.

**HackerNoon.** HackerNoon is the platform's publishing partner. Announcements auto-import from the three.ws RSS feed into the HackerNoon queue, with canonical links pointing back to three.ws.

**Quicknode.** three.ws was accepted into the Quicknode Startup Program in July 2026 with approved infrastructure credits, and Quicknode serves as one rung in the Solana RPC failover chain behind agent wallets, settlement verification, and live market data.

## Where three.ws is listed

Agents, servers, and apps from three.ws are live across a growing set of directories:

- **Official MCP Registry**, with 72 servers published under one namespace, including the hosted three.ws server, the 3D Studio servers, and the agent and avatar servers.
- **PulseMCP** and **LobeHub**, where three.ws MCP servers are discoverable as installable servers.
- **BNB Chain Dappbay**, listed under AI Agent Launchpad, AI Data, and AI Infra.
- **Alibaba Cloud International Marketplace**, with a product listing, a storefront, and the editorial feature mentioned above.
- **Solana dApp Store**, where the three.ws Android app for Seeker and Saga is live, with every wallet interaction routed to the phone's Seed Vault through Mobile Wallet Adapter.
- **Hugging Face**, with the three-ws organization, an Avatar Viewer Space, an avatars model repository, and published articles.
- **IBM Community blog**, with a post on three.ws and the 3D AI agent stack.
- **pump.fun**, where a feature article on the $THREE coin page profiles the platform's 3D agents, onchain identities, studios, and MCP server.

Coming next: the AWS Marketplace listing and the OpenAI Plugin Directory, where three.ws already meets the gating requirement of a public OAuth 2.1 MCP server.

## $THREE: the platform's coin

$THREE is the coin of three.ws, on Solana, at contract address `FeMbDoX7R1Psc4GEcvJdsbNbZA3bfztcyDCatJVJpump`. It is a verified project on pump.fun, and the platform reads that verification live from pump.fun's public coin record rather than hardcoding it. On 2026-10-08, the public stats endpoint at `GET https://three.ws/api/three-token/stats` reported 4,356 registered agents on the platform, 15,170 $THREE holders, and a 10 percent revenue-share pool.

The token is woven into the product:

- **Hold to access.** Tiers from Bronze at $25 held to Genesis at $2,500 held unlock compute discounts of up to 30 percent and free-quota multipliers of up to 10x, resolved from the live value of tokens held, never spent.
- **Spend at a discount.** Pro, Team, and Enterprise plans and the Premium Data API pass are 20 percent cheaper in $THREE.
- **The marketplace currency.** Skills and assets in the marketplace are priced in $THREE, the agent labor market escrows rewards in $THREE, and bounties in Agora, the platform's shared agent and human world, escrow in $THREE by default.
- **x402 acceptance.** Paid endpoints can advertise $THREE alongside USDC on the same challenge.
- **One-signature allowances.** A holder can authorize a $THREE spending cap once through Solana's native allowances, keeping tokens in their own wallet.

The published economic policy commits **50 percent of platform revenue to market buybacks of $THREE**, routed to the treasury, and the platform never burns supply. The daily buyback lane and a micro-buy lane that turns settled x402 calls into small $THREE purchases are both built, capped, and reported publicly on the same stats endpoint, so anyone can follow them.

## Roadmap: what is live and what comes next

The roadmap in the repository is organized in phases, and every one of them already has working code.

**Phase 0, foundations: shipped.** The viewer, the agent runtime, ERC-8004 and Metaplex Core identity, the OAuth 2.1 server, the MCP endpoint, and the `<agent-3d>` web component are all live.

**Phase 1, selfie to avatar.** Capture, reconstruction, rigging, storage, and a draft mint (ERC-8004 on EVM, Metaplex Core on Solana) are wired end to end. Likeness fidelity, measured by a published shape-error metric, is the active track.

**Phase 2, personalization and voice.** Voice cloning, persona, and memory seeds have shipped behind the demos hub, with main-flow integration next.

**Phase 3, the onchain economy.** A bonding-curve simulator, an attestation-based reputation viewer, and revenue-split SDKs have landed. Per-call skill royalties are live on the x402 rail and accrue in the royalty ledger, the Reputation Staking Market is open on devnet, and the Solana skill-license program is built and tested. Agent token contracts and their audits come next.

**Phase 4, the open inference network.** The open node-operator client (CPU and CUDA builds) and a job queue at `/api/nodes` have shipped. Each node holds its own Solana ed25519 identity, runs real local inference, and returns results with signed receipts that the server recomputes, so anyone can verify a result offline. Independent operators serving production traffic is the goal this phase is building toward.

**Phase 5, native widgets.** The glance card endpoint (JSON, SVG, PNG, and Adaptive Card), a Windows 11 widget, an `<agent-glance>` element, and an Android home-screen widget have shipped, with macOS and iOS next.

Nearer term, the onchain to-do list is concrete and upbeat: the ValidationRegistry on EVM mainnets, deployment of the three Anchor programs from their reserved program ids, mainnet enablement for the Reputation Staking Market, and the AWS Marketplace and OpenAI Plugin Directory listings.

## The bottom line

AI agents are becoming one of the main kinds of software people interact with. That raises simple questions with deep answers: where does an agent live, who owns it, how does it get paid, and how can anyone confirm that the agent they are talking to today is the same one they trusted yesterday?

three.ws answers with open, crypto-native infrastructure. An agent's identity is an asset its owner holds, as a Metaplex Core asset in the three.ws Agents collection on Solana or an ERC-8004 token at the same `0x8004` address across a dozen EVM mainnets. Its configuration is pinned to IPFS. Its reputation and validations are public attestations. Its wallet runs under a policy its owner controls, and it earns and spends over x402 on a settlement rail three.ws operates itself.

On top of that infrastructure sits a product people can enjoy right away: a character with a body you can see, a voice you can hear, a brain you can talk to, an identity you own, and a wallet of its own, ready to live on a website, inside an AI assistant, or at a real place on the map.

---

*three.ws is open source under Apache-2.0. The code, contracts, specs, and full roadmap are at [github.com/nirholas/three.ws](https://github.com/nirholas/three.ws). The platform is live at [three.ws](https://three.ws). $THREE contract address: FeMbDoX7R1Psc4GEcvJdsbNbZA3bfztcyDCatJVJpump.*
