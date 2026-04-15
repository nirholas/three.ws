# Edit avatar (layer 3)

Post-creation avatar editing. Without this, selfie-creation feels one-shot: a user can only change their agent's face by deleting and starting over. This layer lets them swap appearance, rename, attach animations, and try outfits without losing their agentId, wallet link, or action history.

## State going in

- Layer 1 (wallet auth) is shipped — sessions exist, `/api/agents/me` works.
- Layer 2 (selfie-agent) is shipped — the user has a persistent `agent_identities` row with `avatar_id` pointing at an R2 object, wallet linkage is in place.
- [src/avatar-creator.js](../../src/avatar-creator.js) embeds the Avaturn SDK modal.
- [src/animation-manager.js](../../src/animation-manager.js) handles clip loading + crossfade.
- [api/avatars/[id].js](../../api/avatars/[id].js) supports GET / PATCH / DELETE. There is no "replace GLB bytes" endpoint yet — some tasks add one.
- [src/editor/](../../src/editor/) already ships scene-explorer, material-editor, texture-inspector, glb-export — reuse these for any mesh/material operation. Do not fork.
- Dashboard lives at [public/dashboard/](../../public/dashboard/) (`dashboard.js` + `index.html`). It is native-DOM, no framework. All edit UIs land here under `#edit/<id>` sub-routes.

## The non-negotiable invariant

**Every edit preserves stable agent identity.** Same `agent_identities.id` (agentId), same wallet link (`user_wallets`, `wallet_address` on the agent row), same ERC-8004 registration if present, same action history. Edits produce a new `avatars` row (or a new GLB version tagged against the existing one) — they never mint a new agent.

If a task would orphan or duplicate the agentId, stop and report. This is the whole point of the layer.

## Tasks

| # | File | Ships |
|---|---|---|
| 01 | [01-edit-appearance-flow.md](./01-edit-appearance-flow.md) | Re-enter Avaturn with current avatar loaded → save diff as new GLB version, keep prior as history |
| 02 | [02-replace-glb-upload.md](./02-replace-glb-upload.md) | Direct GLB upload replaces avatar bytes without going through Avaturn |
| 03 | [03-edit-identity-metadata.md](./03-edit-identity-metadata.md) | Edit name / bio / skills / service endpoints with debounced autosave + uniqueness checks |
| 04 | [04-animation-library.md](./04-animation-library.md) | List / attach / detach animation clips on an avatar, preview in dashboard |
| 05 | [05-outfits-and-accessories.md](./05-outfits-and-accessories.md) | Preset pack (hats, glasses, 2-3 outfits) swapped via morph / bone overlays in the same GLB |

## Sequencing

- 03 can ship first — pure metadata, lowest risk, immediate user value. No new storage flow.
- 01 and 02 are parallel tracks; 02 is smaller and can land first as an escape hatch while Avaturn re-entry is being figured out.
- 04 depends on a stable avatar record but is otherwise independent.
- 05 depends on 04's attach/detach plumbing for accessory loading.

## Dependencies on other series

- [selfie-agent/](../selfie-agent/) — all five tasks assume an avatar already exists. If a user lands on edit without an avatar, redirect to the selfie flow.
- [wallet-auth/](../wallet-auth/) — tasks 01/02/04/05 write to R2 and mutate `agent_identities`; require an authenticated session.

## Out of scope for the whole layer

- Multiplayer try-on, shared outfit inventories.
- Marketplace / purchasable cosmetics.
- Procedural body generation (height, weight sliders outside Avaturn's own controls).
- Voice cloning / speech editing — separate layer.
- On-chain metadata rewrites (layer 6, onchain).

## Rules that apply to every task

- No new runtime dependencies unless the task file explicitly allows them.
- `node --check` every modified JS file before reporting done.
- `npx vite build` and report the result. The pre-existing `@avaturn/sdk` resolution warning is unrelated — ignore.
- Preserve agentId, wallet link, and ERC-8004 record on every write path.
- Reuse [src/editor/](../../src/editor/) utilities for mesh/material/export. Do not build parallel implementations.
- Keep dashboard native-DOM — no React / Vue / Svelte.
