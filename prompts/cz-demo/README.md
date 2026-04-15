# CZ demo — the ship target

The north star for the current build cycle: **CZ (or any notable guest) interacts with their own embodied 3D agent, and it's onchain, and it's embedded inside a host app they already use.** Everything in [wallet-auth/](../wallet-auth/), [selfie-agent/](../selfie-agent/), [onchain/](../onchain/), [lobehub-embed/](../lobehub-embed/), and [claude-artifact/](../claude-artifact/) rolls up here.

## The demo, in one paragraph

CZ opens a link. He sees a 3D CZ avatar standing in a scene — pre-registered onchain on Base Sepolia by us before the demo. A "This is your agent. Claim it." panel appears. He connects his wallet, signs a SIWE message, the agent's `owner` field flips to his address via a signed claim tx. He now opens his LobeHub fork (or a page we host that embeds LobeHub), and the CZ-agent is in the chat sidebar — not as JSON, as a visible, emoting 3D body that reacts to his messages. He types; the Empathy Layer responds. He speaks; it lip-syncs. It's the same agent from onchain. Portable.

## What's load-bearing for this demo

| Block | Must work | Nice-to-have |
|---|---|---|
| Wallet auth | SIWE login end-to-end, no 500s, session survives reload | Multi-chain, ENS display |
| Selfie → agent | Skip for CZ demo — `cz.glb` is pre-made | Generic users can do it post-demo |
| Edit avatar | Skip for CZ demo | Post-demo for users |
| Onchain | `cz.glb` registered on Base Sepolia before the event; "Claim" button flips owner via user-signed tx | ENS reverse resolution on-chain records |
| Embed in LobeHub | CZ agent renders inside a LobeHub chat message/sidebar, receives `speak` events from the chat, emits `skill-done` events back | Native LobeHub plugin (not just an iframe) |
| Empathy + voice | Avatar visibly reacts (smiles, nods, tilts) to his messages; optional TTS on agent responses | Lip sync |

## Prompts in this set

| # | File | Ships |
|---|---|---|
| 01 | [01-preregister-cz-onchain.md](./01-preregister-cz-onchain.md) | Script + one-time deploy action that mints the CZ agent onchain on Base Sepolia with a known `agentId`, metadata URI on IPFS, `cz.glb` in the registration JSON. |
| 02 | [02-cz-landing-page.md](./02-cz-landing-page.md) | Bespoke `/cz` route — dark theme, shows the pre-registered CZ agent, "Claim your agent" CTA, post-claim confetti state. |
| 03 | [03-claim-transfer-flow.md](./03-claim-transfer-flow.md) | Onchain ownership transfer: current owner (us) signs a pre-authorized transfer that CZ's wallet can consume in one click. Or pre-registered agent has `owner = 0x0` and CZ's claim is a first-time `setOwner` call. Task decides the pattern. |
| 04 | [04-lobehub-embed-drop-in.md](./04-lobehub-embed-drop-in.md) | Instructions + code for dropping the agent embed into your LobeHub fork's chat message renderer, hydrated from chain by `chainId + agentId`. |
| 05 | [05-demo-script-and-fallbacks.md](./05-demo-script-and-fallbacks.md) | Live-demo runbook: what to have loaded ahead of time, failure modes, kill-switch if the chain RPC flaps, air-gapped fallback. |

## Run order

01 is the dependency root — without the onchain record, nothing else renders "real." 02 + 04 can run in parallel after 01. 03 depends on 01 + the wallet-auth / onchain passport work. 05 is written last, once the flow is working end-to-end.

## Hard constraints

- Demo must survive **zero internet** for at least 5 seconds of the flow. Cache the avatar GLB and identity JSON in a service worker before the demo starts; read-on-chain should be resilient to RPC hiccups.
- The claim tx uses a user-pays gas model on Base Sepolia. Pre-fund CZ's address with ~0.005 ETH testnet ETH if there's any doubt he has it, or sponsor it via a paymaster. Task 03 covers this decision.
- No secrets in prompt files. The pre-register script reads from env.
