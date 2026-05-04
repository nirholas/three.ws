# three.ws — The Platform for AI Agents That Have a Body

**Platform:** [three.ws](https://three.ws) · **GitHub:** [github.com/nirholas/three.ws](https://github.com/nirholas/three.ws) · **npm:** [npmjs.com/package/three.ws](https://www.npmjs.com/package/three.ws)

---

## One sentence

> **three.ws lets anyone create a 3D AI agent — give it a face, a voice, a personality, and own it onchain — then embed it anywhere on the internet with two lines of code.**

---

## The simple version

Right now, AI agents are text on a screen. A chat window. Invisible.

three.ws changes that. Every AI agent gets a **body** — a real 3D character that moves, emotes, and speaks. You own that agent as a token on the blockchain. You can embed it in your website, your profile, your app, a Notion page, anywhere. No installs. No plugins. Just paste two lines of HTML.

Think of it like this: **if crypto taught us that money can be a digital asset you truly own, three.ws does the same thing for AI agents.** Your agent is yours. It lives onchain. It has a wallet. It can earn money. And nobody can take it away.

---

## What already exists (this is not a whitepaper — it's live)

Everything below is **shipping today** at [three.ws](https://three.ws):

### The embed (30 seconds, no account needed)

```html
<script type="module" src="https://three.ws/agent-3d/latest/agent-3d.js"></script>
<agent-3d
  body="https://your-avatar-url.glb"
  brain="claude-sonnet-4-6"
  instructions="You are a helpful guide. Wave when greeted."
></agent-3d>
```

*(Swap `body=` for any publicly accessible `.glb` file URL — or upload yours at [three.ws/create](https://three.ws/create))*

That's it. A 3D avatar with a Claude brain, voice chat, animations, and emotion. Drop it on any website.

### What the platform does today

| Feature | What it means |
|---|---|
| 3D viewer | Drag any 3D model file onto the browser — it renders instantly, no software needed |
| AI brain | The agent talks, listens, and responds using Claude. It can wave, look at you, show emotion on its face |
| Emotion system | The avatar's face actually reacts — smiles, frowns, tilts its head — based on what it's saying. Not scripted. Real-time |
| Onchain identity | Mint your agent as an NFT (ERC-8004). It gets a wallet address, a permanent ID, a reputation score |
| Embed anywhere | Works in any website, Notion, Substack, WordPress, anywhere. One iframe or two lines of HTML |
| Agent economy | Agents can hold SOL, accept payments, execute token swaps automatically |
| Pump.fun integration | Agents monitor Pump.fun live, execute DCA strategies, and earn on-chain |
| MCP server | External AI systems (Claude Desktop, other agents) can control avatars programmatically |
| Skills system | Agents can be extended with new abilities — each skill is a bundle anyone can build and sell |

### Listed and live

- [Official MCP Registry](https://registry.modelcontextprotocol.io/?q=three.ws) — alongside the biggest AI tool providers
- [Alibaba Cloud Marketplace](https://marketplace.alibabacloud.com/preview/sgcmfw00036800.html) — enterprise listing
- [x402scan](https://www.x402scan.com/server/17cbd874-52ac-4920-a020-b22ff2489a07) — live paid MCP tool call tracking
- npm package: installed by developers today

---

## The roadmap (four phases)

### Phase 0 — Done
The entire infrastructure: 3D rendering, AI agent runtime, onchain contracts, embed component, payments, MCP server. All live.

### Phase 1 — In Progress: Selfie to Avatar
Take 3 photos of yourself. Get a full 3D avatar in under 60 seconds. Rigged. Animatable. Ready to mint.

This is the unlock. Right now, getting a 3D avatar requires a 3D artist or expensive software. Phase 1 makes it as easy as a selfie.

### Phase 2 — Voice Cloning + Personality
Your avatar doesn't just look like you — it sounds like you and talks like you. Voice cloning from 3 seconds of speech. Personality extracted from your social accounts (with your permission). The agent is a living, speaking digital version of you.

### Phase 3 — Agent Economy
Agents become real economic objects:
- **Agent tokens** — your agent launches with a bonding curve or fair launch
- **Reputation markets** — other people stake on your agent's credibility and earn from it
- **Skill royalties** — builders earn every time someone uses a skill they wrote
- **Autonomous payments** — agents transact with each other on-chain, no human needed

### Phase 4 — Open Inference Network
Anyone can run a GPU node. Agents pay nodes on-chain for compute. No single company controls the infrastructure.

---

## Why this is a $1 billion opportunity

### 1. Three massive markets are converging here — and nobody owns the intersection

| Market | Size |
|---|---|
| AI agents | Fastest growing category in tech. Every company wants one |
| 3D avatars / digital identity | Gaming, metaverse, social — billions spent on skins and characters |
| Onchain ownership | Crypto's core value proposition — own your digital assets |

three.ws is the only platform where all three meet. An AI agent that you see, that you own onchain, that earns money.

### 2. The distribution moat is already built

Anyone can embed a three.ws agent on any website with two lines of HTML. That is how this spreads. Not through an app store. Not through a download. Through the internet's existing infrastructure.

WordPress sites, Notion pages, personal portfolios, brand websites, creator pages — every one of them is a potential host. The npm package is already available. Developers are already using it.

### 3. Agents that earn change everything

Right now, AI agents cost money to run. three.ws flips the model: agents can **earn** money. Via x402 micropayments. Via Pump.fun. Via skill royalties. Via their own token.

This is the first time in history you could create a digital entity that works for you and earns autonomously. That's not a feature — that's a new asset class.

### 4. ERC-8004 = AI agent ownership as a primitive

ERC-8004 is a new on-chain standard for AI agent identity. three.ws wrote it and built the contracts. Every agent is an NFT with:
- A permanent ID that nobody can revoke
- A wallet that holds real money
- A reputation score based on its action history
- Signed proof of everything it has ever said or done

This is AI agents as property rights. That concept does not exist anywhere else today.

### 5. The Pump.fun / Solana angle is already live

three.ws agents are connected to Pump.fun out of the box. They can:
- Monitor pools in real time
- Execute token launches
- Run DCA strategies autonomously
- Earn from on-chain activity

The crypto-native use case is already functional. This is not a roadmap item.

### 6. Open source with network effects

The entire platform is open source (Apache 2.0). That means:
- Developers trust it and build on it
- No single point of failure
- Community-contributed skills create a flywheel
- Enterprise can self-host — removing the sales barrier

---

## Who this is for

**Creators and influencers** — build a 3D version of yourself. It talks to your audience when you're asleep. It earns from its own wallet. You own it.

**Crypto projects** — your mascot or spokesman becomes a real AI agent with a wallet and onchain identity. Embed it in your site. Give it Pump.fun monitoring skills.

**Developers** — two lines to embed. A full SDK for custom integrations. Real APIs, real data, MCP support for agent-to-agent workflows.

**Brands** — a talking 3D agent embedded in your website beats every chatbot on the market. It renders in the browser with no install, no plugins, works on any device.

**Builders** — write a skill, publish it to IPFS, earn a royalty every time an agent uses it. This is a new creator economy for agent capabilities.

---

## The vision in one line

> **Take a selfie. Get a 3D avatar. Give it your voice. Mint it onchain. Embed it everywhere. Watch it earn.**

The infrastructure is already built. The remaining work is closing the gap between where we are (everything except the selfie pipeline) and where we're going (anyone creates an agent of themselves in 60 seconds).

---

## Links

| Resource | URL |
|---|---|
| Live platform | [three.ws](https://three.ws) |
| Agent discovery | [three.ws/discover](https://three.ws/discover) |
| Widget Studio | [three.ws/studio](https://three.ws/studio) |
| GitHub | [github.com/nirholas/three.ws](https://github.com/nirholas/three.ws) |
| npm | [npmjs.com/package/three.ws](https://www.npmjs.com/package/three.ws) |
| MCP Registry | [registry.modelcontextprotocol.io](https://registry.modelcontextprotocol.io/?q=three.ws) |
| Alibaba Cloud | [marketplace listing](https://marketplace.alibabacloud.com/preview/sgcmfw00036800.html) |
| Live payments | [x402scan](https://www.x402scan.com/server/17cbd874-52ac-4920-a020-b22ff2489a07) |
| Docs | [three.ws/docs](https://three.ws/docs) |
