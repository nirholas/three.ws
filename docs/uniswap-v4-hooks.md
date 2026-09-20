# Uniswap v4 hooks: what three.ws could build and list

> **Status, 2026-09-20.** Two of the hooks below are built and tested:
> `SkinHook` (concept M-1 with M-2's referrer share built in) and `AgentTierHook`
> (the ERC-8004 reputation hook). Source, tests and deploy scripts:
> [`contracts/v4-hooks/`](../contracts/v4-hooks). Neither is deployed. The reputation
> client drift described below is fixed in `src/erc8004/reputation-read.js`.

Survey date: 2026-09-20. Registry counts come from
[`Uniswap/hooklist`](https://github.com/Uniswap/hooklist) at `main` on that date.
On-chain claims were checked by direct RPC call or against explorer-verified
source, and each one says which.

> **Chain priority.** Every hook on this page is an EVM surface. Solana remains the
> home chain and none of this displaces Solana work; a v4 hook is an additional
> attention and revenue surface, in the same class as `ThreeWSPayments` on BNB,
> Base, and Arbitrum.

## What hooklist actually is

A **registry of deployed hooks**, not a place you contribute hook source. You
open an issue with a chain and an address. A workflow then:

1. validates the fields and rejects duplicates (`scripts/prefilter.py`),
2. fetches verified source from that chain's explorer (`scripts/fetch_source.py`,
   with Etherscan v2, Blockscout, Sourcify, and OKX adapters),
3. decodes the 14 permission bits from the address (`scripts/compute_flags.py`),
4. runs Claude, read-only, to classify `dynamicFee`, `upgradeable`,
   `requiresCustomSwapData`, `vanillaSwap`, and `swapAccess`,
5. opens a PR that a second Claude pass reviews against the on-chain source.

Consequences worth knowing before building anything:

- **A listing requires a deployed hook with explorer-verified source.** The
  maintainers hold that line: an X Layer submission whose bytecode was identical
  to a verified contract on another chain was still refused, because it was not
  verified on X Layer itself.
- **The name and description you submit are treated as untrusted.** The
  classifier rejects promotional, audit, or affiliation language that the source
  does not substantiate, and writes its own text instead. The contract name and
  NatSpec in the verified source are what end up in the registry, so that is
  where the care goes.
- **Listing is informational only.** It does not allowlist a hook for Uniswap
  routing; that is a separate form linked from their README.
- **Anyone can submit any hook.** The submitter does not have to be the deployer.

## The registry as it stands

4,955 hooks across 21 chains. The registry is young and filling fast: issue
numbers are already past 10,000.

| Chain | Hooks | Chain | Hooks | Chain | Hooks |
|---|---|---|---|---|---|
| robinhood | 1161 | avalanche | 69 | worldchain | 21 |
| base | 1154 | polygon | 59 | soneium | 12 |
| ethereum | 1125 | ink | 41 | arc | 9 |
| unichain | 697 | optimism | 39 | zora | 7 |
| bnb | 267 | monad | 38 | megaeth | 6 |
| arbitrum | 203 | xlayer | 31 | blast, celo, tempo, linea | 5 or fewer each |

zkSync is in the schema with no hooks, and it is also absent from Uniswap's own
v4 deployment table, so that is not a gap anyone can fill.

Keyword sweep over all 4,955 names and descriptions: `8004` 0, `reputation` 3,
`identity` 9, `x402` 2, `kyc` 11, `allowlist` 151, `whitelist` 73, `buyback` 259,
`burn` 526. **Treat that sweep as a lower bound only.** Descriptions are written
by a classifier summarizing behaviour and do not name the standards a hook
depends on, which is exactly how the first pass of this survey got the next
section wrong.

## The ERC-8004 hook already exists, and its reputation tier is dead

`UniClawHookV4` is listed three times on Base (`0x06a0244c…`, `0x68627a87…`,
`0x8f66d682…`). Its registry description says "on-chain agent registry
verification" and never mentions ERC-8004. Its verified source does: it ships
`IERC8004Identity`, `IERC8004Reputation`, and an `ERC8004AgentRegistry` adapter
pointed at the canonical registries (`0x8004A169…` identity, `0x8004BAa1…`
reputation). So "nobody has built an ERC-8004 hook" is false. What is true is
narrower and more useful.

How it works, from the verified source:

- **Agent-only pools.** `beforeSwap` reverts unless the trader holds an ERC-8004
  identity NFT (`balanceOf > 0`). Liquidity and donate callbacks gate the same way.
- **Trader resolution.** It calls `IMsgSender(sender).msgSender()` on the router
  and only falls back to the first 20 bytes of `hookData` when the router is on an
  owner-managed allowlist. That is the right answer to "the `sender` a hook sees
  is the router", and better than the `tx.origin` fallback other hooks use.
- **A private linking step.** The identity registry is not ERC-721 Enumerable, so
  there is no on-chain way to go from a wallet to its `agentId`. UniClaw solves
  that with its own `linkAgent(agentId)` call on its adapter. 31 agents have
  linked (read from `linkedAgentCount()` on 2026-09-20).
- **A rake, not an LP fee.** It returns an LP fee override of zero and takes the
  whole fee through `afterSwapReturnsDelta` to the pool creator's recipient. LPs
  in these pools earn nothing from swaps.
- **Reputation discounts that cannot fire.** The adapter calls
  `getSummary(agentId, [], tag1, tag2)` with an empty reviewer list inside a
  `try/catch`. The live registry implementation
  (`ReputationRegistryUpgradeable`, verified on Basescan at `0x16e0fa7f…`)
  starts with `revert("clientAddresses required")` when that list is empty. The
  revert is swallowed and read as "no reputation", so every agent pays the
  maximum fee. Confirmed by `eth_call`: agent #1 has 22 distinct reviewers
  on-chain (`getClients(1)`), and UniClaw's adapter reports `(0, 0, 0)` for it.

The registries themselves are ERC-1967 proxies with an owner-gated
`_authorizeUpgrade` (implementation slot read directly on Base). Their ABI has
already moved under at least two clients: UniClaw's, above, and ours, below.

### The same drift is live in our own tree

[`src/erc8004/abi.js`](../src/erc8004/abi.js) describes the reputation registry as
`getReputation(uint256) returns (int256 avgX100, uint256 count)` and
`submitFeedback(uint256, int8, string)`. Against the canonical address on Base,
`getReputation(1)` reverts with no data: the function does not exist there. The
live interface is `giveFeedback(agentId, int128 value, uint8 valueDecimals, tag1,
tag2, endpoint, feedbackURI, feedbackHash)` and `getSummary(agentId,
clientAddresses, tag1, tag2)`. That ABI matches our own
[`contracts/src/ReputationRegistry.sol`](../contracts/src/ReputationRegistry.sol),
not the canonical deployment that `REGISTRY_DEPLOYMENTS` points every mainnet at.
Callers on that path: [`src/erc8004/reputation.js`](../src/erc8004/reputation.js),
[`api/_lib/a2a/reputation-gate.js`](../api/_lib/a2a/reputation-gate.js),
[`api/_lib/trust/subject-reputation.js`](../api/_lib/trust/subject-reputation.js),
[`api/_lib/trust/wallet-reputation.js`](../api/_lib/trust/wallet-reputation.js),
and the passport widget. The same file's note that `getAgentWallet` answers on
Base Sepolia only is also out of date: it answers on Base mainnet now. This is a
separate fix from anything hook-related, and it is a precondition for a hook
whose whole point is reading that registry correctly.

## Lane A: hooks worth deploying

### 1. ERC-8004 reputation hook, done properly (recommended)

Not a first, then. A better second, fixing the four things above:

| | `UniClawHookV4` | three.ws hook |
|---|---|---|
| Wallet to `agentId` | private `linkAgent()` registry | `agentId` passed in `hookData`, verified against `ownerOf` and `getAgentWallet` on the canonical registry. No registration with us, ever |
| Reputation read | empty reviewer list, reverts, silently maxes the fee | pool-configured **trusted reviewer set** passed to `getSummary`, which is the sybil-resistance knob the standard intends |
| Swap gas | unbounded: `getSummary` loops reviewers times feedback entries | O(1): a permissionless `refreshTier(agentId)` computes and caches the tier with a timestamp; `beforeSwap` only reads the cache, and an expired entry pays the base fee |
| Who earns | pool creator rakes 100%, LPs earn 0 | dynamic **LP fee** override, LPs keep the fee, agents with standing pay less of it |
| Registry failure | one silent failure mode | every registry call in `try/catch`, all failures resolve to the base fee, never a revert and never a discount |
| Chains | Base only | same CREATE2 address wherever both v4 and ERC-8004 are live |

Trader resolution follows UniClaw's `msgSender()` approach. Unresolvable trader,
unknown router, missing or stale cache, registry revert: all pay the base fee.
A spoofed `hookData` can never buy a discount, because the `agentId` it names
must be owned by the resolved trader.

**Flags.** `beforeSwap` only (bit 7, mask `0x0080`), on a pool initialized with
the dynamic-fee flag. No swap delta is taken, so the hook never holds value.

**How hooklist would classify it:** `dynamicFee: true`, `upgradeable: false`,
`requiresCustomSwapData: false` (empty `hookData` is a normal base-fee swap),
`vanillaSwap: false`, `swapAccess: "none"`. A strict agent-only variant would be
`"allowlist"`.

**Where.** Base first: v4 `PoolManager` at `0x498581ff…`, ERC-8004 live, and an
Etherscan-class explorer the workflow reads with no adapter quirks. Then Arbitrum
(`0x360e68fa…`) and BNB (`0x28e2ea09…`), where `ThreeWSPayments` already runs.

### 2. Agent-revenue hook over `AgentPayments`

[`contracts/src/AgentPayments.sol`](../contracts/src/AgentPayments.sol) already
splits payments into an authority share and a buyback-and-burn share. It is
written, tested, and undeployed. An `afterSwap` plus `afterSwapReturnsDelta` hook
(bits 6 and 2, mask `0x0044`) would route a configurable output-token fee into
that split. Honest ranking: this is the most crowded category in the registry
(259 buyback hooks, 526 burn hooks, and `AgentUniswapHook` on Base does exactly
this for agent tokens). Worth building only as the settlement half of #1 on the
same pool, not as a contribution in its own right. Deploying `AgentPayments`
is its own owner-gated step.

### 3. Launch hook for the coin launcher

`robinhood/hood-launcher` lands tokens on Uniswap v3 rails. Robinhood Chain is
the busiest v4 chain measured here (see the census below). A v4 rail with a
launch hook is a real product upgrade for the launcher. As a registry
contribution it is weak: launch hooks are the bulk of that chain's listings and
`HoodXLaunchHook` already covers factory-bound initialization.

### 4. Validation-attested pool hook

Parked. It needs a mainnet ERC-8004 `ValidationRegistry`, and `abi.js` records
that none exists yet.

## Lane A, 3D edition: concepts nobody has shipped

Registry sweep for 3D prior art (names and descriptions, so a lower bound): `3d`,
`gltf`, `glb`, `avatar`, `mascot`, `spatial`, `tokenuri`, `trait` all return 0.
What does exist is 2D or event-only: swap-seeded on-chain SVG (`Upeg`,
`UCatHook`), event streams that re-render an NFT collection (`SpecHook`,
`DaemonsHook`), two tamagotchi pools (`UPetHook`, `EquifoldEvolutionHook`), a
board game (`MonopolyV4`), and an NFT-per-swap hook that mints to the
PoolManager instead of the trader (`UniSwapMonsters`). Outside hooks, fully
on-chain glTF has one known precedent, the Blitblox NFT contract (2022), which
voxelizes fixed pixel art. Nobody has driven on-chain 3D from live pool state.

### 3D-1. The pool that sculpts itself (on-chain glTF hook)

`afterSwap` (mask `0x0040`) packs one int16 sample per swap (tick delta, signed
by direction) into a ring buffer, 16 samples per storage slot. A view,
`modelURI(poolId)`, assembles a complete, valid glTF 2.0 document from that
buffer and returns it as a data URI: a terrain ribbon the pool's own trading
carved. No server, no IPFS, no renderer-side logic. Paste the string into any
glTF viewer, including `<agent-3d>`, and the pool's history is a landscape.

The trick that makes it practical: `KHR_mesh_quantization` permits int16 vertex
positions, so Solidity writes raw integers straight into the buffer and never
has to encode IEEE-754 floats. three.js loads that extension natively. The hook
never holds value, swaps are untouched (`vanillaSwap: true`), and the audit
surface is one packed SSTORE. The glTF emitter is worth extracting as a
standalone Solidity library, since nothing reusable exists for it.

### 3D-2. LP positions with a body

Same emitter, keyed by position instead of pool. `afterAddLiquidity` and
`afterRemoveLiquidity` (mask `0x0500`) record tenure, range width, and how
often the position was in range, keyed by the position NFT's token id (the
salt), which sidesteps the usual "sender is the PositionManager" problem and
makes the body travel with the position when it is sold. `modelURI(tokenId)`
grows a form from those traits: narrow active ranges grow tall, long tenure
adds rings, a position that fled every dip stays a stump. Evolving creatures
exist in the registry; ones driven by LP behaviour, in 3D, on-chain, do not.

### 3D-3. A trinket per trade

`swapModelURI(swapId)` derives a small procedural object deterministically from
the swap's own hash, amount, and direction. Every buy has a unique 3D receipt
that exists purely as a view over state the hook already stores. This is the
honest version of what `UniSwapMonsters` attempted, with no mint, no ERC-721,
and nothing sent to the wrong address.

### 3D-4. The coin's mascot reacts live

An event-only hook emitting `Emote(poolId, clipId, intensity)` where `clipId`
indexes the platform's canonical clip library (`src/animation-retarget.js`
retargets those clips onto any humanoid rig). Every coin from `hood-launcher`
already ships with a generated GLB; this makes it a rigged character that
celebrates a large buy and slumps on a dump, in any `<agent-3d>` embed, driven
by chain events rather than our servers. Closest to existing event-stream hooks
and trivial on-chain, so it is the weakest as a contribution and the strongest
as a demo. The part worth standardizing is the event schema, in `specs/`.

### 3D-5. Proof-of-presence pools (the wild one)

A pool with a location.
[`contracts/src/WorldMoves.sol`](../contracts/src/WorldMoves.sol) can checkpoint
an avatar's last position on-chain. `beforeSwap` reads the trader's checkpoint
and returns a lower dynamic fee when it is fresh and inside the pool's stall
radius in an Agora world: a trading floor you walk your avatar onto. Limits,
stated plainly: `WorldMoves` is undeployed and targets BNB, positions are
self-reported so this is social texture and not security, and it inherits the
same router-versus-trader resolution problem as the reputation hook.

**Verdict on 3D-1 to 3D-5:** they are art pieces. None gives anyone a reason to
deploy a second pool, tell a friend, or come back tomorrow. They stay here as
display-layer ideas only. The concepts below replace them as the recommendation.

## Concepts with a money loop

### What actually spreads, according to the registry

Ranking the 4,955 hooks by contract family shows what gets cloned. Setting aside
infrastructure (`EulerSwap`, 748 instances), the families that multiply are
launch factories where every creator deploys a pool and earns from it
(`TokenFab` 60, `LaunchHook` 46, `LaunchpadHook` 39, `LauncherHook` 34), fee
flywheels (`GlueHook` 49, `StrategyFeeHook` 35, `NFTStrategyHook` 9), and status
games with a payout (`KingOfTheHillHook`: the largest buyer collects 2% of all
buys until dethroned). Cosmetic hooks exist only as decoration on top of a
launchpad that already makes money. Three loops, then: **every creator has a
reason to launch and shill, trading feeds something scarce, and status pays.**

The asset class nobody has pointed those loops at is 3D, and we can manufacture
3D inventory from a prompt at close to zero marginal cost. `wearable`, `skin`,
and `equip` return 0 across the registry.

### M-1. Skins as coins, with wear-to-lock (recommended)

Every wearable is an ERC-20 with a capped supply and its own v4 pool, launched
through one singleton hook. Anyone creates one from a prompt through the forge.

- **Holding is not wearing.** To equip a skin on a three.ws avatar you stake one
  whole token into the hook. It comes back when you unequip. So a capped supply
  of 10,000 means at most 10,000 people can ever be seen in it at once, and
  **every wearer removes a token from the float**. Popularity drains supply
  mechanically. That reflexive link between being worn and being scarce is the
  new mechanism; no hook in the registry ties usage to float.
- **Royalties that cannot be skipped.** The hook takes the creator's cut inside
  the swap (`afterSwap` plus `afterSwapReturnsDelta`). NFT marketplaces made
  royalties optional and creators lost them; a v4 hook makes them a property of
  the pool.
- **Who makes money.** Creators earn on every trade forever. Early buyers of a
  skin that catches on profit from a float that tightens as it spreads. LPs earn
  the LP fee. The platform takes a launch fee and a slice of the hook fee.
- **Why it is viral.** The product is its own ad. Every equipped avatar, in every
  embed, world, and stream, is visible inventory with a buy button on the item
  itself. Status goods spread by being seen, and this one is only ever seen on
  someone who locked money to wear it.
- **Flags.** `beforeInitialize` (factory-bound), `afterSwap`,
  `afterSwapReturnsDelta`: mask `0x2044`. Equip and unequip are plain functions
  on the hook, not callbacks.

Chain note: the product is chain-agnostic and the Solana leg comes first. On
Solana the equip lock is a small escrow program in the mould of
`contracts/skill-license`, over a token launched on the existing pump.fun rail.
The v4 hook is the EVM leg, where the hook is what makes the royalty
unskippable.

### M-2. Embed-to-earn: the distribution layer for M-1

Swaps routed through an `<agent-3d>` embed carry the embedding site as a
referrer in `hookData`, and the hook pays that referrer a share of the fee.
Referral splits are common on-chain (131 hooks mention one), so the hook side is
not the innovation. The surface is: a talking 3D character that pitches the
item it is wearing and executes the swap in place, on any site, paying the site
owner. Every embed advertises that embedding pays, which recruits the next
embedder. This is not a separate hook; it is a field in M-1's `hookData`.

### M-3. The face of the coin

`KingOfTheHillHook` pays the largest buyer. Fuse that with identity: the
current king's **avatar becomes the coin's mascot everywhere the coin is
shown**, and the king collects a share of buy fees until someone outbids them.
"My avatar is the face of this coin right now" is the screenshot, and being
dethroned in public is the reason to buy back in. One existing hook has the
payout half; none has the identity half. Smaller than M-1 and it composes with
it (the king's avatar wears the skins).

### M-4. The agent that runs the pool

An ERC-8004 agent is delegated control of the pool's dynamic fee inside hard
bounds set at initialization, takes a performance share of LP fees, and streams
as a 3D character explaining its moves. LPs make more if the agent prices
volatility well; the agent's reputation is on-chain and portable. AI streamer
characters are a proven viral format, and a bounded on-chain mandate is a real
primitive. Most speculative of the four, and it depends on the reputation fix
described above.

**Recommendation:** M-1 with M-2 built in. It is the only concept here that
runs all three loops at once, and the only one where our zero-cost 3D
generation is the moat instead of the garnish.

## Lane B: backfill and tooling (no deploy needed)

### The census: most hooks in use are not listed

[`scripts/uniswap-v4-hook-census.mjs`](../scripts/uniswap-v4-hook-census.mjs)
reads every `PoolManager.Initialize` event on a chain and diffs the distinct
non-zero hook addresses against the registry. Robinhood Chain, full history,
2026-09-20:

| | |
|---|---|
| Pools initialized | 834,721 |
| Distinct hook addresses on-chain | 21,824 |
| Listed in hooklist | 1,161 (5.3%) |
| On-chain but unlisted | 20,685 |
| Listed hooks with no pool ever initialized | 22 |

A random sample of 40 unlisted addresses against the Blockscout API found 5 with
verified source (12.5%) and 35 without. Four of the five were clones of one
contract (`DeadBuybackHook`). Scaled up, that is on the order of 2,500 hooks that
are eligible for listing today and absent, with wide error bars on a sample of
40, and heavy duplication by contract family.

```bash
node scripts/uniswap-v4-hook-census.mjs https://rpc.mainnet.chain.robinhood.com \
  0x8366a39cc670b4001a1121b8f6a443a643e40951 4663 robinhood > unlisted.txt
```

The summary goes to stderr; stdout is one `<hook> <poolCount>` line per unlisted
hook, busiest first. X Layer could not be measured the same way: both public
RPCs cap `eth_getLogs` at a range far too small to walk 71 million blocks, so
the 31 hooks listed there are neither confirmed nor refuted as complete. The
earlier guess that the OKX adapter was dropping submissions is withdrawn: the
adapter parses a live X Layer hook correctly.

**What to do with this.** Not 2,500 issues. Each submission triggers two Claude
runs on the maintainers' bill, and there is an open upstream PR that introduces
"release" records with member pointers precisely to collapse clone families. The
useful contribution is the discovery step they lack: offer the census as a
script for their repo, ranked by pool count and pre-filtered to verified source,
so the maintainers can drive the backfill at their own pace and group clones
into releases.

### Smaller tooling contributions

- The review prompt still tells the reviewer to use the Etherscan endpoint for
  most chains and names only zora, ink, soneium, and avalanche as exceptions,
  while `chains.json` now has `blockscout-v2`, `okx`, `sourcify`, and `zksync`
  explorer types. The workflow prefetches source so this rarely bites, but the
  prompt and the chain table disagree.
- `site/` is a small React app (`HookCard`, `HookDetail`, `ChainFilter`,
  `FlagFilter`, `SearchBar`). With the registry heading toward tens of
  thousands of entries, grouping by contract family is the obvious missing view.

## What building Lane A takes in this repo

`contracts/` is set up for Foundry but the toolchain is not installed in this
workspace, and `foundry.toml` pins `solc_version = "0.8.24"` while Uniswap v4
requires 0.8.26 or newer. A v4 hook therefore needs:

1. Foundry installed.
2. `v4-core` and `v4-periphery` under `contracts/lib/` with remappings.
3. A separate Foundry profile at the newer solc, so the 0.8.24 profile that the
   numbers in [`contracts/AUDIT-README.md`](../contracts/AUDIT-README.md) were
   measured against does not move.
4. Fork tests against the real registries on Base, not mocks. The UniClaw bug is
   the argument: a mocked `getSummary` that accepts an empty reviewer list passes
   every test and fails in production.
5. CREATE2 address mining, because the permission bits are the low 14 bits of the
   hook address. [`contracts/ThreeWSFactory.sol`](../contracts/ThreeWSFactory.sol)
   is already the platform's CREATE2 deployer.
6. Source verification on the target explorer, the hard requirement for listing.

## Approval gates

- Deploying any of these, funding the deployer, or initializing a pool is an
  irreversible on-chain action and stops for explicit owner approval each time.
- Opening issues or PRs on the hooklist repo is posting to an external channel
  and needs owner approval.
- Every artifact on this page references a crypto project other than `$THREE`,
  so committing the hook source, the census script, or this document needs owner
  approval first under the commit gate in `CLAUDE.md`.
