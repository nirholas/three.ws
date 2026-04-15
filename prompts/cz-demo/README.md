# CZ demo — the ship target 🎯

Self-contained prompts for the **CZ demo**: a bespoke, demoable flow where CZ (or any notable guest) visits a link, sees the pre-registered [public/avatars/cz.glb](../../public/avatars/cz.glb) as an embodied onchain agent, claims it with their wallet, and can open the same agent embedded inside a host app (LobeHub / Claude). Everything in [wallet-auth/](../wallet-auth/), [onchain/](../onchain/), [lobehub-embed/](../lobehub-embed/), and [claude-artifact/](../claude-artifact/) rolls up here.

## The demo, in one paragraph

CZ opens a link. He sees a 3D CZ avatar standing in a scene — pre-registered onchain on Base Sepolia by us before the demo. A "This is your agent. Claim it." panel appears. He connects his wallet, signs a transaction, the agent's `owner` flips to his address. He opens his LobeHub fork, and the CZ-agent is in the chat sidebar — not as JSON, as a visible, emoting 3D body that reacts to his messages. Same agent as the `/cz` page, same onchain record. Portable.

## Scope & assumptions

- Pre-registration chain = **Base Sepolia (84532)**. Testnet avoids gas + paymaster decisions. Flip to mainnet only if explicitly asked.
- Demo route path = `/cz`. True route served out of `public/cz/`.
- Assume priorities 1–5 ([wallet-auth](../wallet-auth/), [selfie-agent](../selfie-agent/), [avatar-edit](../avatar-edit/), [embed](../embed/), [lobehub-embed](../lobehub-embed/) / [claude-artifact](../claude-artifact/)) are green. Where any is broken, the CZ path fails early with a visible error card or falls back to a cached static asset — **no silent hangs**.
- Demo route must render in under 2s on a warm cache.
- CZ's avatar is pre-baked. Do not regenerate. Do not remove.

## Execution order

| # | File | Ships |
|---|---|---|
| 01 | [01-preregister-cz-onchain.md](./01-preregister-cz-onchain.md) | Script + one-time action that mints the CZ agent onchain on Base Sepolia with known `agentId`, metadata on IPFS, `cz.glb` in the registration JSON. |
| 02 | [02-cz-landing-page.md](./02-cz-landing-page.md) | Bespoke `/cz` route — dark theme, spotlit CZ avatar, owner chip, one "Claim your agent" CTA, post-claim state. |
| 03 | [03-claim-transfer-flow.md](./03-claim-transfer-flow.md) | Onchain ownership flip from ops-owner (or `0x0`) to CZ's wallet via one user-signed tx. |
| 04 | [04-lobehub-embed-drop-in.md](./04-lobehub-embed-drop-in.md) | LobeHub-fork patch + fallback HTML that puts the agent embed inside the chat sidebar, hydrated from chain. |
| 05 | [05-demo-script-and-fallbacks.md](./05-demo-script-and-fallbacks.md) | Live-demo runbook, preflight script, kill-switch (`?rehearsal=1`), service-worker warm cache, offline demo mode. |

01 is the dependency root. 02 + 04 can run in parallel after 01. 03 depends on 01 + the wallet-auth / onchain tasks. 05 is written last, once the flow is green end-to-end.

## Rules for every task

- No new runtime dependencies unless the task says so.
- No new top-level CLAUDE.md / README.md files beyond those already in each prompt folder.
- `node --check` every modified JS file. `npx vite build` passes. Ignore the pre-existing `@avaturn/sdk` resolution warning.
- Use [public/avatars/cz.glb](../../public/avatars/cz.glb) as the canonical asset. Do not re-bake it.
- Favor static fallbacks over backend dependencies for the demo route — it must survive `/api/agents/me` being 500.
- Reuse existing modules (viewer, runtime, skills, Empathy Layer). Do not fork.

## Hard constraints for the live demo

- Must survive **≥ 5s of zero internet** after initial load. Service-worker cache (task 05) handles this.
- The claim tx uses user-pays gas on Base Sepolia. Pre-fund CZ's address with ~0.005 ETH testnet ETH if there's any doubt, or sponsor via paymaster. Task 03 decides.
- No secrets in prompt files. Deploy scripts read from env.

## Reporting

Each task ends with: files created, files edited, commands run, verification URLs, any surprises. Call out anything that depended on a backend feature that was broken during testing.
