# Selfie -> agent (priority 2)

Self-contained prompt files for the "take a selfie, get an avatar agent in 30 seconds" flow. This is the magic moment that makes the platform feel alive — a photo becomes a 3D body that can speak, sign, and remember. Each file is designed to drop into a fresh Claude Code agent without extra context.

See [../README.md](../README.md) for where this series sits in the overall priority stack.

## State going in

- Layer 1 (wallet auth) is shipped. `/api/agents/me` returns a real user's default agent.
- Avaturn SDK is already a runtime dep (`@avaturn/sdk` in [package.json](../../package.json)) and wired via [src/avatar-creator.js](../../src/avatar-creator.js). The pre-existing Vite resolution warning for that package is unrelated to this series — ignore.
- R2 presign + avatar-register endpoints already exist: [api/avatars/presign.js](../../api/avatars/presign.js) + [api/avatars/index.js](../../api/avatars/index.js).
- [src/agent-identity.js](../../src/agent-identity.js) is the class each finalized avatar must end up attached to.
- The single "Create Avatar" button in [index.html](../../index.html) opens the current Avaturn flow via `setupAvatarCreator()` in [src/app.js](../../src/app.js) around line 402.

## Recommended execution order

| # | File | Ships |
|---|---|---|
| 01 | [01-camera-capture-ui.md](./01-camera-capture-ui.md) | `/create` route + `getUserMedia` capture, photo review, retry, upload fallback |
| 02 | [02-avaturn-session-bridge.md](./02-avaturn-session-bridge.md) | Hand the captured image to Avaturn SDK, await the generated GLB; error / quota / timeout handling |
| 03 | [03-glb-pin-and-store.md](./03-glb-pin-and-store.md) | Pin the finalized GLB to R2 via the existing presign flow + create an `agent_identities` row |
| 04 | [04-name-and-description.md](./04-name-and-description.md) | Claim a short name + one-line description with per-wallet uniqueness, slug reservation, denylist |
| 05 | [05-first-meet-moment.md](./05-first-meet-moment.md) | Post-creation scene renders, avatar waves, confetti, share CTA, redirect to `/agent/:id` |

### Sequencing

- 01 ships first — nothing else works without a captured image.
- 02 depends on 01 (needs the `Blob`).
- 03 depends on 02 (needs the GLB URL) and on wallet-auth layer 1 (needs a signed-in user / linked wallet).
- 04 can be built in parallel with 03 but must merge first — the `agent_identities` insert in 03 needs the chosen name + slug.
- 05 ships last — pure UX polish on top of 01-04.

## Rules that apply to every task

- **No new runtime dependencies.** `@avaturn/sdk`, `ethers`, `@aws-sdk/client-s3`, `zod`, and the in-tree three.js bundle are already available — use those. If a task thinks it needs a new dep, stop and escalate.
- **No TypeScript.** This codebase is vanilla JS (ESM). No `.ts` files, no `.d.ts`.
- **No new README / CLAUDE.md files** unless the task file explicitly allows them.
- **Every new or changed `.js` file must pass `node --check`** before reporting done.
- **Every change must be followed by `npx vite build`** and the result reported. The pre-existing `@avaturn/sdk` resolution warning is expected — ignore it. Any *new* error is yours.
- **Any new route must be added to [vercel.json](../../vercel.json)** in the same task that creates it.
- **Mobile matters.** The hero demo is "take a selfie on your phone". Anything gated behind desktop-only APIs (drag-drop, hover, large modals) must have a mobile-first fallback.
- **If you discover an unrelated bug,** note it in the reporting section. Do not fix it in the same change.

## Out of scope for the whole series

- Morph / outfit / accessory editing post-creation — that's layer 3 ([../avatar-edit/](../avatar-edit/)).
- Alternate avatar providers (Ready Player Me, etc.).
- ERC-8004 on-chain registration — that's layer 6 ([../onchain/](../onchain/)).
- Voice / persona training.
- LLM-generated names or descriptions — layer 04 is a plain input field + denylist only.
