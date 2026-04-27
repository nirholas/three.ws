# Task 04: Make `/agent/:id` the action hub

## Context

After a user creates an avatar (via task 02's `/create` picker), they should land on `/agent/:id` — a page that represents their agent and exposes every action they can take from here on out. This is the "hub" the rest of the product returns to.

Currently `/agent/:id` renders via [public/agent/index.html](../../public/agent/index.html) + [src/agent-home.js](../../src/agent-home.js) which draws an identity card + timeline. What's missing: clear action affordances for **Customize**, **Embed**, **Deploy on-chain**, **Edit avatar**.

**Depends on tasks 02 and 03** being merged first — this task is the destination users arrive at from the rewritten `/create` flow.

See [00-README.md](./00-README.md) for the overall plan.

## Goal

Add a primary actions row to the agent hub page with four CTAs. Each CTA either opens a modal, navigates to an editing surface, or kicks off the on-chain flow. Embed must work with no wallet / no on-chain deployment.

## The four actions

### 1. Customize

- **Label:** Customize
- **Icon:** gear / slider
- **Action:** navigate to `/app?agent=:id` (the authenticated editing surface — see task 05)
- **Always enabled** when user owns the agent

### 2. Embed

- **Label:** Embed
- **Icon:** code brackets `</>`
- **Action:** open an "Embed" modal with copy-to-clipboard for:
    - **iframe snippet** — `<iframe src="https://three.ws/agent/:id" width="400" height="600" frameborder="0"></iframe>`
    - **web component snippet** — `<agent-three.ws-id=":id"></agent-3d>` plus `<script src="https://three.ws/agent-3d.js"></script>`
- **Always enabled** — never gated behind on-chain or wallet
- Uses existing `<agent-3d>` component at [src/element.js:183](../../src/element.js#L183)

### 3. Deploy on-chain

- **Label:** Deploy on-chain · _Optional_
- **Icon:** chain link
- **Action:** open the existing ERC-8004 register flow at [src/erc8004/register-ui.js](../../src/erc8004/register-ui.js)
- **States:**
    - Not deployed → "Deploy on-chain"
    - Deploying → disabled spinner
    - Deployed → chip showing chain name + shortened address, clicking opens the registry record
- **Gated:** requires wallet connect; show "Connect wallet first" if no wallet session

### 4. Edit avatar

- **Label:** Edit avatar
- **Icon:** pencil
- **Action:** navigate to `/agent/:id/edit` (existing page at [public/agent-edit/](../../public/agent-edit/)) OR open the "swap GLB" flow re-using [src/avatar-creator.js](../../src/avatar-creator.js) — pick whichever matches the current state of that page. If `/agent/:id/edit` exists and loads cleanly, link there. Otherwise, open the material/texture editor from [src/editor/](../../src/editor/) in a modal.

## Deliverable

1. **Modify [src/agent-home.js](../../src/agent-home.js)** (or create [src/agent-hub-actions.js](../../src/agent-hub-actions.js) if cleaner):

    - Render a `<div class="agent-hub-actions">` row with the four CTAs above.
    - Place it above the timeline, below the identity card.
    - Each CTA is a `<button>` with icon + label. Use inline SVG for icons (consistent with the existing nav icons).

2. **Embed modal** — new component, likely [src/agent-embed-modal.js](../../src/agent-embed-modal.js):

    - Renders the two snippets with syntax highlighting (reuse the `code-block` pattern from [index.html:135-149](../../index.html#L135-L149) if possible).
    - Copy-to-clipboard buttons (use `navigator.clipboard.writeText`).
    - Close via backdrop click, Esc key, or explicit close button (mirror [src/avatar-creator.js:166-173](../../src/avatar-creator.js#L166-L173) pattern).

3. **On-chain state hydration:**

    - Check `agent_identities.chainId` + `chainAddress` columns via [api/agents.js](../../api/agents.js) GET response.
    - If present → render "Deployed" chip. If absent → render "Deploy on-chain" button.
    - Button click → existing flow at [src/erc8004/register-ui.js](../../src/erc8004/register-ui.js).

4. **Hide actions if viewer is not the owner** — check against `session.address` or `session.userId` vs agent.`ownerAddress` / `ownerUserId`. Non-owners see a read-only view (current behavior).

## Constraints

- **Do not** gate the Embed action behind on-chain or wallet. That's a core invariant (see [00-README.md](./00-README.md)).
- **Do not** add a persona/brain/skills UI here — that lives on `/agent/:id/edit` and is a separate task band.
- **Do not** change agent-identity data model or [api/agents.js](../../api/agents.js) schema.
- **Do not** add new deps.
- Prettier: tabs, 4-wide, single quotes.

## Verification

- [ ] `node --check` on all modified JS files
- [ ] `npm run build` passes
- [ ] Navigate to `/agent/:id` as the owner:
    - Four action buttons render above the timeline
    - Customize → `/app?agent=:id`
    - Embed → modal opens with two copy-able snippets; copy-to-clipboard works
    - Deploy on-chain → opens register UI if not deployed; shows chip if deployed
    - Edit avatar → navigates to `/agent/:id/edit` (or opens material editor modal)
- [ ] As a non-owner visitor, the action row is hidden but the identity card + timeline still render
- [ ] Embed works on a fresh agent that has never been deployed on-chain (prove the non-gating)

## Reporting

- Files created / modified
- Which edit-avatar destination you used (`/agent/:id/edit` page vs material editor modal) and why
- Whether you extended [src/agent-home.js](../../src/agent-home.js) or created a sibling file, and the rationale
- Any missing API fields you had to add to the agent GET response
