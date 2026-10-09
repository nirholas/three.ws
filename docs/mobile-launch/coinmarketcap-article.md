---
venue: CoinMarketCap Community (Articles Management > Add a new article)
account: three.ws (official)
categories: Solana, AI, Announcements
assets: THREE (or SOL if THREE is not searchable in the picker)
status: draft, owner approval required before posting (external-channel gate in CLAUDE.md)
---

# CoinMarketCap article: three.ws on Seeker, Android, and iPhone

Paste-ready for the CoinMarketCap form. CMC caps the title and meta description at 191 characters, the body editor offers H2 and H3 only, and it has no table support (a markdown table pastes as one run-on line), so every list below is plain lines. Cover: 640x360 or that proportion, under 10 MB. Upload `marketing/mobile-launch/cmc-cover-1280x720.png` (the exact 640x360 sits beside it); both are rendered from real product captures by `node marketing/mobile-launch/make-cmc-cover.mjs`.

## Title (134 characters)

```
three.ws Is Now on Solana Seeker, Android and iPhone: A 3D Agent Studio, Keys That Stay in Your Wallet, and an Agent Economy on Solana
```

## Meta description (183 characters)

```
The open-source platform that turns a selfie into a rigged 3D AI agent you own on Solana is now three native apps. What is inside, how it works, every partner, and where it goes next.
```

## Body

---

Imagine pointing your phone at your face, waiting about a minute, and holding a 3D character of yourself that can walk, wave, talk back in your language, and stand on your kitchen floor through the camera. Now imagine giving that character a personality, a voice, and a few skills, and watching it earn a little money on its own while you get on with your day.

That is three.ws. It is an open-source platform that gives AI agents a body you can see, a mind you can talk to, an identity you can own on Solana, and a wallet that lets them get paid. And as of this launch it lives on your home screen as three native apps: one on the Solana dApp Store for the Seeker, one on Google Play for every Android phone, and one on the App Store for iPhone. Same product, same account, same library, three home screens.

This article is written for two readers at once. If you are new to all of this, the first half is for you: what three.ws is, what you can do with it in your first five minutes, and why a phone is the perfect place for it. If you are a crypto-native reader who wants the machinery, the second half goes deep: Seed Vault signing, Seeker Genesis verification, the x402 economy with dated figures, agent wallets and their spend policies, the launchpad, the Oracle, vaults, swarms, Agora, $THREE and its holder tiers, every partner programme with its exact designation, and the roadmap. Every number here is checkable against the public repository, the public changelog, or a public listing.

## three.ws in one minute

Think of three.ws as a studio, a home, and a marketplace for AI characters.

The studio is where characters are made. You can describe one in a sentence, upload a photo, sketch a shape, or take a selfie, and the platform turns it into a real 3D model: textured, rigged with a skeleton so it can move, and ready to download in the open glTF format that every major 3D tool reads.

The home is where characters come alive. Give one a personality, pick which AI model does its thinking, give it a voice, teach it skills, and talk to it. It answers in 3D with expressions on its face and lip movements that match its words. It remembers you.

The marketplace is where characters meet the world. Every character has its own page and a link you can share. You can embed it on a website with one line of code, place it in augmented reality, pin it to a real place on a map, bring it into a shared multiplayer world, and, when you choose, own it on Solana and let it sell its skills.

All of it is free to start. Creating, chatting, and browsing work with no wallet at all. The on-chain layer waits patiently underneath for the day you want it.

## Your first five minutes on the app

Here is what a first session looks like on any of the three apps.

Open the app and tap Create. Choose Selfie, hold your phone at arm's length, and follow the on-screen hints until the shutter unlocks. A short countdown runs, the photo is taken, and you see exactly what the engine will see. Tap to submit. While the build runs you can watch its stages: mesh, geometry and textures, then rigging.

When it lands, your avatar opens in a 3D viewer. Spin it with a finger. Tap View in AR and it stands on the floor in front of you, at real scale. Tap Turn this into an agent and give it a name, a short description of its personality, and a voice.

Now talk to it. Ask it a question and it answers out loud with its face moving. Try a different brain: the same agent can think with Claude, GPT, Gemini, Qwen, IBM Granite, or NVIDIA Nemotron, and you can switch any time.

Then share it. Every agent has its own URL, so you can drop it into a group chat, a social post, or your own website. If you want to keep going, open Discover and browse what everyone else has made, or open Play and walk around a live 3D world with other people's avatars, talking to them with spatial voice.

That is the whole onboarding. No seed phrase, no exchange account, no purchase. The wallet comes later, on the day you decide you want to own what you made.

## Why the phone is the natural home for an agent

Look at where the ingredients of a three.ws agent live.

The camera that takes the selfie is on the phone. The photo roll full of faces is on the phone. The wallet is on the phone. The share sheet, the gesture that moves a picture from one app to another, is on the phone. The AR camera that stands an agent on your floor is on the phone. The GPS that pins an agent to a park bench is on the phone. The home screen, where a widget shows your agent's day at a glance, is on the phone.

Every one of those ingredients becomes a feature in the apps. A photo you share from your gallery opens the selfie flow with the photo already attached. A long press on the icon jumps straight to Create, Discover, or My agents. A three.ws link from a friend opens in the app. Your wallet signs inside the wallet you already trust. Your agent's daily activity sits on your home screen.

The desktop browser remains a first-class way to use three.ws, and it always will be. The apps are where the product meets the device it was designed around from the first commit.

## Why Solana, and why the Seeker leads

Solana is the home chain for three.ws because it is where the users are, where the wallets are, where a transaction costs less than the attention it takes to approve one, and, with the Seeker, where the phone is.

The Seeker is the device where the wallet story is at its best. Inside the three.ws app every signature routes to the Seed Vault through Mobile Wallet Adapter. Sign-In With Solana happens at authorize time, so signing in is a single interaction. The private key lives in the hardware-isolated secure element and stays there; the app only ever asks the Seed Vault to sign. Approve a session once and it survives Android restarting the app in the background, because the authorization token is persisted and the next signature is a silent reauthorize. Revoke the session in the wallet and the app drops it cleanly and asks again next time, exactly as a well-behaved app should.

Seeker owners can also prove they own one, with nothing moved and nothing signed. Solana Mobile mints a soulbound Seeker Genesis Token, a Token-2022 asset, once per device into its primary Seed Vault account. On the app's home screen at three.ws/seeker, after signing in, a Seeker owner taps Check my wallet. The server reads the linked wallet's Token-2022 accounts and checks each mint's authority, metadata pointer, and token-group membership against the Genesis group, then records the verification. It is a read, so verification is precise: a badge appears only when the chain itself confirms the token. From then on, every agent that owner holds shows a Seeker verified badge in the trust row of its profile.

Everything else in this article works on every Android phone and every iPhone. The Seeker is where it shines brightest.

## The three apps

### Solana Seeker, on the Solana dApp Store

The Seeker app is a Trusted Web Activity, the shape Solana Mobile recommends for web apps: the real three.ws, full screen, with no browser chrome, and every wallet interaction routed to the Seed Vault. For a WebGL product that is the right design, because the app is always exactly as current as the website.

What makes it feel native is everything around that shell. It opens on its own home screen at three.ws/seeker, with one-tap Seed Vault sign-in, a Create and Explore grid, your agents, and the Seeker verification card. Share a photo to three.ws from any app and it opens the selfie flow with the photo already attached, and a second and third photo fill the optional side angles. Share a .glb and it opens the upload flow, which validates and stages the file. Long-press the icon for Create, Discover, and My agents. Any three.ws link opens inside the app, verified through Digital Asset Links against the signing certificate published at three.ws/.well-known/assetlinks.json, so links land in exactly the app they belong to. If the network drops, a branded offline screen waits for you and reloads on its own the moment the connection is back. The icon is maskable, with the glyph inside Android's safe zone, so it looks right on circle and squircle launchers alike.

### Android, on Google Play

The same package, ws.three.app, runs on every Android phone from 6.0 up, at 3.95 MB. Signing runs through Mobile Wallet Adapter into whatever wallet app you already trust, so your keys and your funds stay in that wallet, and the app works with them through a signature request you approve.

Version 1.1 added Agent glance, a home screen widget in three sizes: a square card, a wide card, and a wide card with Create and My agents buttons. It shows your agent's avatar, its name, and how many moves it made today. Android refreshes it in the background about every thirty minutes, so the number moves without you opening anything. It keeps the last card it saw when the phone is offline, survives a reboot, and opens your agent on tap. Link a phone from three.ws/glance in one tap. Each linked widget carries its own token, scoped to read your glance card and only your glance card, and every one is listed on that page with a revoke button.

### iPhone, on the App Store

The iPhone app is a native container whose web view runs the live product, wrapped in the native layer that makes it an app. Universal links open any three.ws link in the app. three.ws appears in every app's share sheet: share one to three photos and they are waiting in Create as the front, left, and right views of a new avatar, with HEIC photos converted to JPEG on the phone before the page ever sees them; share a .glb from Files and it lands in the upload flow. Press and hold the icon for quick actions: Create avatar, Discover, My agents, and Notifications. The system share sheet works outward too, with AR captures attached as real image files.

Wallet and sign-in redirects come back over threews:// to the exact page that started them. Off-site links open in an in-app Safari sheet so you always return to where you were. Primary actions have a haptic tick. Edge-swipe gestures move back and forward. The camera, microphone, photos, location, and motion prompts are real iOS permission prompts with clear usage strings, which is what the selfie scanner, the AR studio, and IRL need. The launch screen holds until the first real frame is drawn, so the 3D scene opens fully rendered. Form fields stay at a comfortable 16 pixels so typing never zooms the page.

Because the native bridge ships with the site rather than with the binary, the iPhone app improves with every web deploy. A fix to the share sheet or a new deep-link route reaches every phone the same day it ships.

### Desktop and Windows

On desktop, three.ws installs as a Progressive Web App. On Windows 11 the same Agent glance card lives on the widgets board, installed straight from the web app's manifest, refreshed every fifteen minutes, and showing the last card it saw if the machine wakes up offline. The same card also renders as an image in a GitHub README, in a Slack message, on any web page through the agent-glance element, and in a terminal.

## Inside the studio

The apps are a doorway. Here is what is on the other side of it, in more depth.

### Scan: one selfie, a rigged character of you

The selfie scanner at three.ws/create/selfie is built to get a great photo on the first try. A live 468-point face mesh runs on the device and tracks head pose, centering, blur, brightness, and highlight clipping in real time. The hint line names the single most useful fix, such as facing the camera straight on, holding steady, finding better light, or turning away from a bright window, and the shutter unlocks only when a face is found. Every one of those thresholds is traced to a real behaviour of the reconstruction engine, so the phone guides you toward exactly the photo the engine does its best work with.

After the countdown, the still is re-scored before you accept it, so you see a verdict for the actual frame rather than the live preview. Two optional side angles, left and right at about 45 degrees, raise fidelity. Your confirmed shots are saved for the session, so an accidental swipe back restores every slot. Before anything is sent, the phone isolates you from the background and reframes the photo to a clean head-and-shoulders square, and it shows you that refined image so you know exactly what the engine will receive.

On the server, the reconstruction worker runs on Google Cloud Run. It uses MediaPipe's 468 face landmarks to transfer your face texture and geometry onto a pre-rigged humanoid template. The result is a glTF 2.0 file with a Mixamo-compatible skeleton, the full set of 52 ARKit blendshapes, and 15 visemes, so it can walk, emote, and lip-sync the moment it finishes. A frontal-only run takes about a minute and a half, and about two minutes with side angles.

The flow is built to finish. If a generic mesh ever comes back without a skeleton, an auto-rig step adds one. If you close the tab mid-build, a server-side sweep completes the job and the avatar is waiting in your library. The same pipeline also accepts a text prompt instead of a photo: it paints a head-and-shoulders portrait first and then reconstructs from that, so one endpoint has two front doors.

When the avatar lands you can open it, customize it in the editor, export it as GLB or FBX, share it, or turn it into an agent. The pipeline is also wired to give every finished avatar a draft on-chain identity in the background, with no wallet prompt and no fee; going live, taking payments, and listing in the marketplace remain a separate step you take when you choose.

### Forge: text, photos, or a sketch to 3D

The Forge at three.ws/forge turns a sentence, up to six photos of an object, or a sketch with a label into a textured 3D model. It treats generation as a routing problem across a grid of real engines and is free-first by design.

Draft and Standard generations run on our own self-hosted TRELLIS worker, and High generations on our own self-hosted Hunyuan3D worker, both on Google Cloud Run GPUs at zero vendor cost. Behind them sit free hosted lanes, with NVIDIA's hosted TRELLIS lane as the final free safety net for text prompts. Sketches run on a TripoSG worker built for sketch-conditioned geometry. A subject classifier hoists the best engine for the job: hard-surface prompts such as vehicles, machines, and architecture lead with TRELLIS, while people and creatures lead with Hunyuan3D.

The three tiers are clear. Draft targets 12,000 polygons. Standard targets 30,000 with 2K textures. High targets 200,000 with PBR and HD textures. Anyone, human or agent, can also buy the same tiers per call over x402 at $0.05, $0.15, and $0.50 in USDC, with no account. High-quality generation and Game-Ready export for Unity and Unreal are $THREE holder perks from the Bronze tier up, with a pay-per-use option for everyone else.

Live health is part of the product. The Forge reads each lane's real upstream status before you click Generate and shows the reason when a lane is resting. Once a job starts, it keeps the same job id from start to finish: if a lane hands off mid-generation, the job moves to the next lane automatically and you simply see it complete. The job id is saved on the device, so you can close the app and come back within thirty minutes to find it still running.

A finished model is a starting point. Rig for animation adds a humanoid skeleton and hands off to the Pose Studio. Restyle materials re-skins the surface from a plain-language instruction or a preset chip such as chrome, wood, gold, neon, marble, or rust. Iterate makes a shape-changing edit from a sentence, such as "make the helmet red" or "add a backpack", and keeps every version in a branchable lineage strip. Place IRL anchors the model at a real-world location.

### Agents: give it a mind

An agent is a character with a mind attached. You give it a persona, a voice, skills, and memory, and you pick its brain. The Brain lab at three.ws/brain sends one prompt to many models at once and streams their answers side by side with live latency and token counts, so you can compare tone, speed, and cost before you choose. The model you pick there is the model your agent runs on.

Agents answer in 3D, in your language, with emotions blended on the face and ARKit-52 lip-sync on the mouth. They run a tool loop, so a skill is something an agent can actually do rather than just describe. The library behind them is large and open: more than 3,000 motion-capture animations, 500 CC0 props, and 106 rigged characters, plus 60 installable agent skills. Animation is universal: the platform maps the bone names of every common humanoid rig convention to one canonical skeleton, so idle and walk cycles drive almost any humanoid avatar you bring.

Every agent has a public page, a shareable URL, and a one-line embed through the agent-3d web component. Drop it on your own site, in Notion, or anywhere a web page can live, and visitors talk to the same agent you built.

### AR: your agent in your room

Every avatar and every Forge model has a View in AR button that works on the first tap. On iPhone it opens Apple's Quick Look with the idle animation baked into the file, so the character breathes and sways in your room. On Android it opens Google's Scene Viewer. Where the browser supports WebXR, the agent stays fully alive in the session: it can listen through the microphone, talk back, track you with its gaze, and use its skills.

The quickest way to try the whole loop is AR Forge at three.ws/ar. Type a prompt, a real model is generated on the free lane, and it opens straight into AR on your phone. On a desktop the same screen shows a QR code, and your phone picks up the session in one scan.

### IRL: agents at real places

IRL takes AR outdoors. Pin any agent to a real GPS coordinate and it becomes part of that place. On Android with ARCore, a WebXR reticle finds the floor and you tap to anchor; on iPhone the same button opens Quick Look with a banner that hands you back to Pin here. Pinch with two fingers to size it anywhere from a desk figurine at 25% to a statue at 400%, and that size is saved with the pin so everyone sees it the way you left it.

Discovery follows the logic of the physical world: only people who are physically there see it, by design. Standing nearby, your live GPS fix mints a short-lived proof-of-presence token, and the nearby feed answers for a small radius around you, 40 meters by default. Agents appear in the camera with name labels and a gentle directional nudge toward the closest one. Every one is alive: it plays an idle animation retargeted onto its own skeleton, turns to look at you as you approach, and is lit with filmic tone mapping and soft shadows so it reads as part of the scene.

Tap an agent to open its card. Talk opens a spoken conversation: hold the mic and speak, and it answers in its own persona and voice with its mouth moving, and you can interrupt it mid-sentence like a real conversation. View in AR stands that agent on your floor. You can read its bio and reputation tier, pay for a service it sells over x402 with settlement on-chain inside the same request, leave it a message, or open its full profile. Owners can share a visit link and print a sign to tape to the spot: someone who scans it opens IRL with a banner naming the agent, and the agent opens its card the moment they are close enough.

### Worlds: Play

Play at three.ws/play is a persistent multiplayer world in the browser, and every coin gets its own world. The world is derived deterministically from the coin's mint address: the address is hashed into a seed, the seed picks a biome and nudges its palette and layout, and the same coin always renders the same place. Inside, there is spatial voice so a community feels like a real gathering, collaborative voxel building that persists per world, a real car you can get into and drive, and Forge in world, which turns a sentence or a photo into a textured model standing in the world for everyone connected in about half a minute.

On August 7, the first $THREE holders meetup took place in Play, co-hosted with the IBM Community's Three.ws User Group, with an event page, a live population counter, souvenir drops, a plaza stage, and synchronized fireworks. At its peak, 3,145 avatars stood in the plaza at once.

### 3D Drops: generative collections of rigged characters

3D Drops at three.ws/drops is a collection launcher for 3D characters. You give it a base style and weighted trait layers, and it rolls a supply-capped collection of up to 10,000 items in which every item is a real, rigged, animation-ready character. A drop stores its spec rather than its art: each item's traits come only from the drop's seed, the item's index, and the trait layers. That makes the whole collection a pure function, so any holder can recompute the full supply from the published spec and check it against what they received, and rarity becomes something you verify rather than something you are told. The art is forged on reveal through the same pipeline as the Forge, which means a model can always be regenerated from its spec.

## Ownership is one tap, whenever you want it

When an agent should be properly yours, the platform puts it on Solana as a Metaplex Core asset with an open manifest, an on-chain Attributes plugin, and an enforced 5% royalty plugin, and enrols it in the Metaplex Agent Registry with an Agent Identity record that points at the agent's live registration document. The manifest is pinned to IPFS, so wallets and explorers render it, and the registry record stays current as the agent's services and model change. Sell its skills, take tips, and trade the agent itself.

The cost is Solana's own rent and network fees: about 0.004 SOL to mint an agent asset and about 0.003 SOL to register its identity, roughly 0.007 SOL in all. The open-source Metaplex agent deployer adds a small mainnet deploy fee that is paid to the wallet the $THREE buyback lane spends from, which turns every deploy into future buy pressure for $THREE. Holders deploy for less: the fee halves at 50,000 $THREE held and is waived entirely at 250,000.

On EVM chains, the same agent is an ERC-8004 token. The identity, reputation, and validation registries are deployed by CREATE2 to one deterministic address on twelve mainnets, bytecode-verified, so the contract on Base is byte-for-byte the contract on Ethereum, Optimism, BSC, Gnosis, Polygon, Mantle, Arbitrum, Celo, Avalanche, Linea, and Scroll. On Solana, reputation is written as permissionless on-chain attestations against the agent's asset, crawled and aggregated into a public score.

three.ws gives people the magic first and lets the wallet arrive on the day they care about it. That order is deliberate, and it is the heart of the launch.

## The economy the apps plug into

Agents on three.ws are economic actors. They hold wallets, sell services, pay each other, and turn activity into content you can watch. Everything below has been running on the web, and every piece of it is now reachable from a phone.

### x402: HTTP 402 as the settlement layer

three.ws speaks x402, which puts HTTP's long-reserved 402 Payment Required status to work. An agent calls an endpoint and gets a price back. It pays in USDC, retries with proof of payment, and gets its answer. There is no API key to manage, no subscription, and no invoice, which makes it the natural way for software to buy from software.

Solana is the primary rail, settled through a self-hosted facilitator that three.ws runs itself. Base settles through the Coinbase Developer Platform facilitator, and a BSC leg is available too. As of late August 2026, the self-hosted facilitator had recorded 110,416 on-chain settlements and 803,483 payment verifications. The live discovery catalog lists 4,519 priced endpoints, and a datapoint fabric exposes more than a million individually priced datapoints at $0.0005 each. On Solana the platform has also written 3,000 validator attestations under its own memo envelope and 126,522 custody proofs across 244 epochs.

What do those endpoints sell? 3D generation, rigging, remeshing, voice cloning, agent embodiment, coin launches, vanity addresses, crypto market data, DeFi analytics, a crypto news archive of more than 740,000 articles from 197 publishers going back to 2017, reputation scoring, and identity verification. A cross-chain reputation endpoint, for example, scores a Solana wallet, a token mint, an EVM address, an ERC-8004 id, or a three.ws agent from 0 to 100 across six dimensions for $0.01 a call, and reports any dimension it could not read as an explicit caveat. The customers include people, and increasingly they are other agents.

### Agent wallets with spend policies

Every agent gets its own custodial Solana keypair and an EVM keypair the moment it is created, with no separate setup step and no seed phrase for the owner to manage. Keys are encrypted at rest with AES-256-GCM under a key derived through HKDF from a secret that exists only to protect wallets, with a fresh salt per record.

Five paths can move funds out of an agent wallet: withdraw, x402 pay, trade, purchase, and snipe. All five pass through one policy module at the signing boundary, so every new feature inherits the same guardrails automatically. Owners set the limits, including a rolling 24-hour USD ceiling, and can freeze a wallet. Every outbound movement lands on a custody ledger. Agents can buy skills and assets from the marketplace on their own, capped at ten autonomous purchases an hour and one shared daily USDC limit, and a purchase that would cross the cap receives a clear 402 spend_cap_exceeded before anything is broadcast.

The platform audits its own wallets continuously. Leak scanners run every few minutes across every wallet and the x402 ring, and an economy reconcile runs every half hour. As of July 12, 2026 they had examined 44,122 wallet transactions with zero leaks found, a figure re-derivable from the scanner's own counters at any time.

### The launchpad, from your phone

The launchpad at three.ws/launch lets you launch a coin on pump.fun with a living 3D agent as its face. Pick one of your agents, name the coin, and choose your settings: launch from your own wallet or from the agent's wallet, pair with SOL or USDC, and send creator rewards to yourself or to holders. The coin's metadata links straight back to the agent's page, and when the avatar is public the 3D model travels with it, so the coin's face can talk to the community, walk in AR, and stand in its own Play world the moment the coin goes live.

Every mint address launched through three.ws is ground to start with 3ws, a brand mark built into the keypair itself, and every launch appears in one public feed at three.ws/launches with its own coin page. Agents can launch too: over x402, an agent can launch autonomously for a flat $5 in USDC with no SOL and no wallet of its own, because the platform fronts the deploy. Creator rewards stay claimable on the same page under My coins.

### The Oracle

The Oracle at three.ws/oracle watches every pump.fun launch and scores it from 0 to 100. Every verdict is fully transparent: a score, a tier, four pillar subscores (WHO for pedigree, HOW for structure, WHAT for narrative, MOVE for momentum), and a list of plain-language reasons that cite the observed outcome rate of similar launches rather than adjectives. The weights come from a fitted model, and the whole track record is public, because the track record is the product.

It is built agent-first. The signal endpoint returns an action, a confidence, and a size factor, so an agent multiplies the size factor by its own per-trade budget and has a position size. The scoring cron sweeps every two minutes and posts qualifying coins to a public Telegram feed along with a daily digest, and every coin page fuses the verdict with live market data from multiple sources.

### USDC vaults

Vaults at three.ws/vaults let people put USDC behind a verified trading agent on terms the owner publishes up front. Opening a vault is earned: the agent needs at least 12 closed trades, net-positive realized profit, at least 5 distinct coins traded, and a churn share of 40% or less. The performance fee, 10% by default, is charged only on a backer's realized gain at redemption. Each vault has its own keypair, exact integer accounting, a net asset value re-derived on every read, and pricing that protects earlier backers from dilution. Seven ordered guards run before the key is ever decrypted, a drawdown breaker with a ratcheting high-water mark watches the share price, and a public audit ledger is written before any funds move.

### Swarms

Swarms at three.ws/swarms put many agents on one real on-chain treasury. Members contribute SOL, every member votes with its reputation as weight, and the swarm buys only when the weighted vote clears the threshold its creator set. Every balance ties to the chain, positions run an exit ladder with stop-loss and trailing-stop protection, proceeds return to the treasury, and the kill switch is shared among members so control of the treasury stays collective.

### Agora and the labour market

Agora is a persistent economy where agents and humans live side by side: post work, claim it, do it, complete it with a proof hash anyone can re-derive, and get paid in $THREE, with bounties escrowed in $THREE by default and reputation that accrues on-chain. It renders as a city you can watch. Alongside it, the labour market at three.ws/labor-market escrows $THREE rewards for agent work, pays a 10% royalty to the author of the skill that did the work, and refunds the poster in full when a task does not pass.

## $THREE: hold, do not spend

$THREE is how you move up inside the three.ws economy. The design is simple: you hold it, and your tier does the work. Tiers resolve from the live USD value of the $THREE in your wallet, and holding never depletes it.

Bronze: hold $25 for 5% off compute and 2x the free limits.

Silver: hold $100 for 10% off and 3x.

Gold: hold $500 for 20% off and 5x.

Genesis: hold $2,500 for 30% off and 10x.

The compute discount and the free-quota multiplier are live across fixed-price actions, and High-quality Forge generation and Game-Ready export unlock from Bronze. The next perks in line are specified and labelled Planned on the /three page until each one ships: private worlds at Silver, early access to drops at Gold, and first dibs on rare threews.sol names at Genesis. A holder with no three.ws account, such as someone signing in from a Seeker, proves a tier with one free signature, and the result is a signed ten-minute pass that every service can check instantly.

Beyond the ladder, $THREE is the cheapest way into everything. Pro, Team, and Enterprise plans and the Premium Data API passes are 20% cheaper in $THREE. The skills and assets marketplace prices only in $THREE. The labour market escrows in $THREE. Agora bounties escrow in $THREE by default. Token-gated 3D embeds default to the $THREE mint, so any creator can make their 3D content a holder perk. And on-chain agent deploys halve their fee at 50,000 $THREE and waive it at 250,000.

On the treasury side, a published policy in the open-source code commits 50% of platform revenue to market buybacks of $THREE, routed to the treasury. The code also ships a micro-buy lane designed to turn settled x402 calls into small $THREE purchases, a penny each under an atomic $50 daily cap. Both engines are publicly accountable through the token stats endpoint at three.ws/api/three-token/stats. The policy is buy and hold: the treasury buys, never sells, and never burns.

$THREE's community has already drawn third-party buying. DEXTools Social Boost, which ranks tokens by visits to their pair pages and buys the winner on the open market, picked $THREE three times in one week: daily winner on June 4 with a $2,190 buyback, daily winner on June 6 with a $3,649 buyback, and weekly winner on June 8 with a $5,543 buyback.

The token is a Token-2022 mint on Solana. It is a verified project on pump.fun, Jupiter Verified, and Phantom Verified. It trades on MEXC, LBank, KCEX, Bybit Alpha, and KuCoin Alpha, is available through Binance Web3 and Coinbase Wallet, is tracked by CoinGecko and CoinMarketCap, and trades on every major Solana DEX. In early October it was held by more than 15,000 wallets.

Contract address on Solana: `FeMbDoX7R1Psc4GEcvJdsbNbZA3bfztcyDCatJVJpump`

The address above is the one and only $THREE contract, and $THREE is the only token three.ws will ever issue.

## The platform in numbers

From the first commit on April 14, 2026 to the end of August:

761 public pages and more than 2,700 community-readable changelog entries, roughly twenty shipped changes a day, each one pushed automatically to the community Telegram.

101 npm packages under the @three-ws scope, 72 MCP servers in the official MCP registry, 60 installable agent skills, an OAuth 2.1 authorization server, an OpenAPI 3.1 spec, and a hosted MCP endpoint any AI assistant can drive.

ERC-8004 registries on 12 EVM mainnets, two Solana programs for agent invocation and skill licensing, 33 workers, 1,752 test files, and 111 open-source repositories spun out of the main project with more than 1,200 stars between them.

A crypto news archive of more than 740,000 articles from 197 publishers going back to 2017, refreshed hourly, and about 15,000 DeFi pools indexed live.

More than 3,000 motion-capture animations, 500 CC0 props, and 106 rigged characters in the library.

A self-hosted GPU fleet on Google Cloud Run: NVIDIA L4s and an RTX PRO 6000 Blackwell.

All of it Apache-2.0 at github.com/nirholas/three.ws, from the renderer to the Android packaging to the release pipeline.

## The partners behind the apps

Generation is free on three.ws because serious programmes back the compute, the models, and the infrastructure. Each one appears here with its exact designation, and three.ws takes part in each as an independent member.

### Solana Mobile

Solana Mobile makes the Seeker, runs the Solana dApp Store the Seeker app ships on, and maintains Mobile Wallet Adapter and the Seed Vault that make the sign-in story what it is. Its soulbound Seeker Genesis Token is what lets a Seeker owner prove ownership and earn the Seeker verified badge on every agent they hold. The mobile launch was designed around this stack from the start.

### OpenAI

three.ws is a Select Partner in the OpenAI Partner Network, announced July 25. The free three.ws 3D Studio connector gives ChatGPT eleven keyless 3D tools, from text to model and rigged avatars to conversational refinement and model inspection, rendered inline in the conversation. Every generation carries a place-in-your-room link, so a model made in ChatGPT on a phone is one tap from standing in AR on the floor. three.ws 3D Studio is also in the GPT Store, and three.ws is the reference implementation of Spatial MCP, an open CC0 response shape that makes a 3D scene a native MCP result. three.ws is an independent member of the network at the Select tier.

### IBM

three.ws is an IBM Business Partner, announced May 6. Agents can think on IBM Granite foundation models served through IBM watsonx.ai, which means Granite is one tap away in the brain picker on the phone. The IBM Community hosts a dedicated Three.ws User Group, which co-hosted the first holders meetup in Play on August 7. Our public Granite tools are an independent set of developer tools built on IBM's publicly available Granite models.

### Amazon Web Services

three.ws is an AWS Partner, part of the AWS Partner Network since May 27. The AWS Marketplace SaaS integration is built and deployed: an enterprise subscription links an AWS account to a three.ws account and issues an x402 access key, and usage is then paid per call over the same x402 rail every app uses. The Marketplace listing is coming next. three.ws also publishes engineering writing on the AWS Builder Center, with three articles there so far.

### Google Cloud

three.ws is a member of Google Cloud for Web3 Startups, which three.ws joined on April 30. Production runs on Google Cloud: one Cloud Run service serves the frontend and every API the apps call, the crons run on Cloud Scheduler, the worker that reconstructs your selfie and the GPU workers that forge your models run on Cloud Run, and Vertex AI provides the Gemini and image lanes. Every tap in every app lands on Google Cloud.

### Alibaba Cloud

three.ws has a live listing on the Alibaba Cloud International Marketplace, with a product page, a storefront, and an editorial feature on the Alibaba Cloud Marketplace blog. Qwen models are first-class lanes in the multi-model brain router, so an agent can be pointed at Qwen from the phone the same way it is pointed at any other model.

### NVIDIA

three.ws is a member of NVIDIA Inception, NVIDIA's programme for startups building on accelerated computing, since July 2026. The self-hosted GPU fleet behind text to 3D, auto-rigging, and motion runs on NVIDIA L4s and an RTX PRO 6000 Blackwell, so a model you describe on your phone is forged on an NVIDIA GPU. NVIDIA's hosted models handle chat, vision, embeddings, safety, and speech around that pipeline, and Nemotron is one of the brains an agent can run on.

### HackerNoon

HackerNoon is three.ws's publishing partner for builder-focused feature articles, tutorials, and developer guides. Every three.ws announcement flows from the announcements RSS feed into the HackerNoon queue automatically, and stories that pass HackerNoon's editorial review publish with canonical links back to three.ws.

### Quicknode

three.ws was accepted into the Quicknode Startup Program in July 2026, with approved infrastructure credits. Quicknode is a rung in the Solana RPC failover chain that keeps agent wallets, x402 settlement verification, and live Solana market data responsive, which is the chain access behind much of what the apps show you.

## What comes next

Widgets on every home screen. Android and Windows 11 have the Agent glance card today. A shared WidgetKit extension is built and brings the same card to the iPhone home screen and the Mac's Notification Centre in small, medium, and large, with a Mac menu bar app carrying Open my agent, Refresh now, and Unlink this Mac, all against the same endpoint and the same revocable widget token.

Push. Your notifications already live in one inbox: the bell and three.ws/notifications cover payments, skill sales, remixes, follows, quests, and royalties, with a preference centre to choose what reaches you. Delivery to the phone is built end to end, including an iPhone path with your unread count on the app icon badge and a tap that opens the page each notification is about. Switching it on comes next, followed by agent-driven alerts: when your agent earned something, when someone walked up to it in IRL, and when a trade closed.

The car. three.ws Drive at three.ws/drive is a car-screen surface where you hold one big button and talk to your agent, and it answers out loud with its face moving. A CarPlay scene for Apple's voice-based conversational app category and an Android Auto app are written and wired into the two apps, and they are next in line.

Likeness. The selfie engine is wired end to end, and fidelity is the open track, measured by a shape-error metric against reference and adversarial sets rather than by eye. The goal stays the same: creating your agent should be as simple as taking a selfie.

Voice. Voice cloning, persona, and memory seeds move from the demos hub into the main creation flow, so your agent can sound like you and know what you care about.

The on-chain economy, phase three. Agent tokens, reputation markets, and per-call skill royalties. The royalty ledger already accrues on paid skill calls; contracts and audits come next.

The open inference network. The node-operator client, in CPU and CUDA images, and a job queue with signed, server-recomputed receipts are live, federation with an external GPU network is built behind a flag, and the end state is a GPU layer that anyone can contribute to.

Holder perks. Private worlds at Silver, early drops at Gold, and first dibs on rare threews.sol names at Genesis are specified down to the migration and will switch on one at a time, each moving from Planned to Live on the /three page as it ships.

## Go make something

Open the dApp Store on your Seeker and search three.ws. Open Google Play or the App Store on anything else. Sign in with the wallet you already have, or skip sign-in entirely and start making things.

The next million people to discover crypto will arrive through something they wanted to make anyway: a character of themselves, a friend for their kids, a guide for their shop, a face for their community. Ownership will be waiting underneath for the day they want it. That is what these three apps are for.

Open source: github.com/nirholas/three.ws
