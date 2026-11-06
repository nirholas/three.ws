# The on-chain world — real-time presence on BNB Chain

`/agora`'s Play mode ("Enter the Commons") has an opt-in toggle — **"Record
on-chain (BNB testnet)"** — that writes your walk to a real BNB Chain smart
contract, gaslessly, and shows you every other on-chain player as a live
ghost marker. This page explains what it is, exactly why BNB Chain is the
only chain where this is practical today, how it's built, and how to
reproduce the proof yourself. Everything here is real code against real
endpoints; nothing is mocked.

---

## 1. Why this only works on BNB Chain

A real-time on-chain presence layer needs two things at once, and BNB Chain
is the only EVM chain (verified 2026-07-07) that has shipped both:

1. **Blocks fast enough that "on-chain" can mean "this frame."** BSC's Fermi
   hardfork (BEP-619/590, live 2026-01-14) produces a block roughly every
   **0.45 seconds** — live-measured via public RPC, not a roadmap number.
   Ethereum L1 is 12s, Base is 2s. At 0.45s, an on-chain move commits and
   becomes visible to every other client at a cadence a walking avatar
   actually needs — waiting 2-12 seconds to see someone else's step would
   make "on-chain presence" feel broken, not real-time.
2. **Gasless sends from a plain private-key wallet, with no smart-account
   setup.** BEP-414's paymaster API (`pm_isSponsorable` +
   `eth_sendRawTransaction`) lets an unmodified EOA sign a `gasPrice: 0`
   transaction that a sponsor pays for atomically (BEP-322 bundles).
   Production implementation: **MegaFuel** (NodeReal). This is mechanically
   impossible on Ethereum L1/Base today — EIP-1559 rejects a zero-fee tx
   outright, ERC-4337 needs a smart-contract account, EIP-7702 needs a
   delegation step. A visitor with a brand-new, empty wallet can start
   walking on-chain immediately; nobody has to fund gas first.

Neither fact alone is enough — a fast chain with normal gas costs still asks
every walking player to hold and spend real funds every ~0.45s; a gasless
chain with 12s blocks still feels laggy. BNB Chain is the only place we've
verified both are live simultaneously.

**What this is not:** a claim of "20,000 TPS" or an on-chain game engine —
those are refuted/roadmap claims. This is one, specific,
verifiable mechanism: an event-only move-commit contract, read back over a
public RPC, at a real sub-second cadence.

---

## 2. Architecture

```
Browser (src/agora/onchain-presence.js)
  │
  ├─ position/heading every frame ──► src/bnb/move-sender.js (MoveCoalescer)
  │                                       │
  │                                       ▼
  │                              api/_lib/bnb/world-moves.js (sendMove)
  │                                       │
  │                                       ▼
  │                              api/_lib/bnb/megafuel.js (sendGasless)
  │                              ── try pm_isSponsorable ──► MegaFuel paymaster
  │                              ── declined/failed ──► self-pay walletClient
  │                                       │
  │                                       ▼
  │                         WorldMoves.sol on BSC (move() emits Moved)
  │                                       │
  └─ src/bnb/world-presence-reader.js ◄───┘ (watchContractEvent / bounded backfill)
        │
        ▼
   src/bnb/onchain-ghosts.js (interpolate, drop on staleness)
        │
        ▼
   ghost octahedron markers rendered in the live THREE.js scene
```

**`WorldMoves.sol`** (`contracts/src/WorldMoves.sol`) is the whole on-chain
surface: `join(worldId)`, `leave(worldId)`, `move(worldId,x,y,z,facing)`, and
`checkpoint(worldId,x,y,z,facing)`. `move()` is **event-only — zero SSTORE**
(~4,800 gas of internal execution, `forge test`-measured), so a player
walking at the chain's own block cadence never accumulates state or rent;
`checkpoint()` is the one opt-in storage-writing call, for anything that
wants a queryable "last known position" instead of just the event log.
Coordinates are signed 24-bit integers in millimeters (an ~8.39km cube);
out-of-range coordinates **revert** rather than silently clamp, so a client
never drifts out of sync with what's actually on-chain.

**`src/bnb/move-sender.js`**'s `MoveCoalescer` is the client-side throttle: it
only launches a new `move()` send once the previous one's round trip has
resolved, so a 60fps position stream still produces roughly one on-chain move
per block, not one per frame, with zero timer/interval logic — congestion
control falls out of the "wait for the last one" rule alone.

**`api/_lib/bnb/megafuel.js`**'s `sendGasless()` always tries the sponsored
path first (`pm_isSponsorable`) and falls back to a normal gas-paying send if
MegaFuel declines, times out, or is down — the mandatory self-pay fallback
for every MegaFuel-dependent feature. The toggle labels
this honestly in the UI (`on` = sponsored, `on-selfpay` = self-pay with the
decline reason as a tooltip) rather than pretending every send is free.

**`src/bnb/world-presence-reader.js`**'s `watchWorldPresence()` does a bounded
backfill (~1,200 blocks ≈ ~9 minutes at 0.45s/block) on join so a new visitor
immediately sees players who were already there, then polls
`watchContractEvent` for live `Moved`/`Joined`/`Left` events — reads need no
API key or wallet, straight from the browser to a public RPC.

**`api/bnb/world-config.js`** exposes `{ address, deployed, chainId, explorer,
rpcs, worldId }` — a tiny public, non-secret GET — so the browser never needs
its own build-time copy of the deployed address, and flipping the
server-side env var the moment a public deploy lands activates every open
tab with zero rebuild.

---

## 3. Reproducible walkthrough

**Try it (once a public address exists):** open `/agora` → **Enter the
Commons** → click **Record on-chain (BNB testnet)** → confirm the one-time
local session-key prompt (a BSC-testnet-only key generated in your browser
and kept in `localStorage`; never sent anywhere, never funded, sponsored
sends need no balance) → walk with WASD. You'll see your own send status in
the toggle's label, and every other on-chain player nearby as a glowing
ghost marker with a nameplate.

**Reproduce the two-wallet proof locally** (the exact steps this doc's own
verification used; full output is in `contracts/DEPLOYMENTS.md`'s "Prompt 18"
subsection):

```bash
# 1. A local chain that reproduces BSC's live measured cadence exactly
anvil --chain-id 97 --block-time 0.45 --port 8555

# 2. Deploy the real, unmodified script (see contracts/DEPLOYMENTS.md)
cd contracts && forge script script/DeployWorldMoves.s.sol:DeployWorldMoves \
  --rpc-url http://127.0.0.1:8555 \
  --private-key <anvil-account-0-private-key> \
  --broadcast

# 3. Point a browser session at it without a public deploy or env change —
#    the same dev-override onchain-presence.js's turnOn() already supports:
#    http://localhost:PORT/agora?play=1
#      &bnbDevAddress=<deployed WorldMoves address>
#      &bnbDevRpc=http://127.0.0.1:8555
```

Open that URL in two separate browser profiles (or two Playwright contexts,
each with a different funded local test key seeded into
`localStorage['three.ws:bnb-presence-key']`), turn the toggle on in both,
and walk. Each browser's console logs `[onchain-presence] move sent
hash=... mode=...` for its own sends and `[onchain-presence] ghost joined
player=...` the moment it picks up the other's.

---

## 4. Real proof (2026-07-08)

Deployed WorldMoves (anvil-local, `--block-time 0.45`, per the "not yet a
public deploy" state below): `0x5FbDB2315678afecb367f032d93F642f64180aa3`.
Deploy tx `0xab86fb5937e655dd1e64d8e45118ca5624d20f9b4bd213704067f5dc7ae8b65a`,
block 18, status success.

Two real, independent headless-Chromium sessions (Playwright), each with a
distinct funded wallet, drove real WASD movement concurrently for 60 seconds
against the on-chain toggle described above:

| wallet | tx hash | block | status | mode |
|---|---|---|---|---|
| A (`0x7099…dc79C8`) | `0xd1b5188c…9d7` | 1849 | success | self-pay |
| A | `0xb63fdb5b…997` | 1880 | success | self-pay |
| A | `0x5f772762…f61` | 1927 | success | self-pay |
| A | `0x11dd19f4…b32` | 1986 | success | self-pay |
| B (`0x3C44…4293BC`) | `0x945ce448…715` | 1863 | success | self-pay |
| B | `0x317554f6…b20` | 1916 | success | self-pay |
| B | `0x3d378b15…c78` | 1963 | success | self-pay |

**Block cadence:** block 1849 → block 1986 is 137 blocks across 61 real
seconds — a **0.445s average inter-block time**, matching the live BSC
testnet's measured ~0.45s Fermi cadence to within 1% (anvil's `--block-time
0.45` deliberately reproduces the live-measured rate, rather than the
wall-clock-paced local blocks earlier prompts in this campaign used).

**Cross-visibility, both directions, live:** wallet A's browser logged
`ghost joined player=0x3C44…4293BC` the moment wallet B's first move landed;
wallet B's browser independently logged `ghost joined player=0x7099…dc79C8`
for wallet A — two fully separate browser processes, no shared state beyond
the chain itself.

**Mode:** every send resolved `self-pay` — MegaFuel's real testnet
`pm_isSponsorable` was probed for real on every send (no mock); it declined
because no NodeReal sponsor policy has been provisioned for these throwaway
addresses. This is the expected, documented outcome (see §5) and the
self-pay fallback is proven working, not a no-op — every tx above actually
landed and paid its own gas.

Full receipts, the finer-grained per-block timestamp sampling, and the exact
reproduction commands are recorded in `contracts/DEPLOYMENTS.md`'s "Prompt
18" subsection.

---

## 5. Honest caveats

- **Not yet on the public BSC testnet.** Every proof above (this doc and
  prompts 14/15/16/18) ran against a local `anvil` instance because a real
  public deploy needs a funded deployer key
  (`BNB_TESTNET_DEPLOYER_KEY`/`DEPLOYER_PK`) that this environment doesn't
  have, and the public tBNB faucet is reCAPTCHA-gated with no programmatic
  path. The deploy script, bytecode, and dry-run against the live public RPC
  are all already verified (`contracts/DEPLOYMENTS.md`) — the only missing
  piece is a funded owner-controlled key. The moment
  `WORLD_MOVES_ADDRESS_TESTNET` is set, `/api/bnb/world-config` starts
  returning a real address for every visitor with zero further code changes.
- **MegaFuel is one operator.** NodeReal runs the only production MegaFuel
  paymaster today; BEP-414 itself is still a Draft BSC Improvement Proposal.
  Sponsor policies are allowlisted per address/contract — a policy has to be
  explicitly provisioned (dashboard.nodereal.io) before sends from a given
  address are ever sponsored. That's why every real run in this doc shows
  `self-pay`, not `sponsored` — it's a policy-provisioning gap, not a code
  gap; `sendGasless()`'s branch on the probe result is already correct and
  tested either way.
- **Self-pay always works, and is the honest default.** The toggle never
  hides which mode a send used — `on` (sponsored) vs. `on-selfpay` (self-pay,
  tooltip shows the decline reason) are both real, both wired, both tested.
- **`move()`'s coordinates are not the same as your world position.** The
  contract's 24-bit millimeter space (`±8,388.6m` per axis) is far larger
  than any three.ws scene needs; `toContractPos`/`fromContractPos`
  (`src/bnb/move-sender.js`, `src/agora/onchain-presence.js`) do the unit
  conversion. Coordinates outside that range simply never fire an on-chain
  write (checked client-side before the call, so no doomed on-chain revert).

---

## Related

- [BNB Chain payments](./bnb-payments.md) — the MPP/x402 payment rail this
  campaign also shipped, same `api/_lib/bnb/` namespace.
- `contracts/src/WorldMoves.sol` — the contract itself, full NatSpec.
- `contracts/DEPLOYMENTS.md` — deploy status, bytecode, and every real
  broadcast proof for every BNB Chain contract in this repo.
- `STRUCTURE.md`'s Agora row — the full on-chain-presence file map.
