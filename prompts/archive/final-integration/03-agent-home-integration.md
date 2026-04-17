# 03 — Mount Share Panel + Deploy Button on Agent Home

## Context

[agent-home.html](../../agent-home.html) is the public landing page for any agent (route: `/agent/:id`). It is the single most-seen surface the product has — every shared link, every social preview, every embed lands visitors here first.

Two major modules shipped but never got mounted on this page:

1. **[src/share-panel.js](../../src/share-panel.js)** (215 LOC, production-ready) — one-click share modal with link, iframe snippet, web-component snippet, OG preview, and QR code. Class `SharePanel` is exported but **zero import sites** in the codebase.
2. **[src/erc8004/deploy-button.js](../../src/erc8004/deploy-button.js)** (282 LOC, production-ready) — minimal drop-in "Deploy on-chain" chip. Shows a deploy button if the agent is not yet ERC-8004 registered; shows a success chip with tx link if it is. Also orphan.

Both classes are complete. Your job is UX plumbing: mount them on `agent-home.html` such that a visiting user can (a) share the agent, and (b) the _owner_ of the agent can deploy it on-chain without leaving the page.

## Goal

A polished agent landing page where:

- A **Share** button sits in a predictable top-right corner. Click → `SharePanel.open()`.
- A **Deploy on-chain** chip appears next to the agent name, but **only if the signed-in user is the agent owner** AND the agent is not yet registered on-chain. If already registered, the chip shows the chain + tx link instead. If the viewer is not the owner, nothing on-chain-related is visible.
- Both controls are keyboard accessible (tab-reachable, Enter/Space activates) and work on mobile (tap targets ≥ 44×44 px).

## Files you own

Edit (inside uniquely-named anchor only):

- `agent-home.html` — add anchor blocks:
    - `<!-- BEGIN:AGENT_HOME_ORPHANS_HEAD --> ... <!-- END:AGENT_HOME_ORPHANS_HEAD -->` in `<head>` for any CSS links.
    - `<!-- BEGIN:AGENT_HOME_ORPHANS_DOM --> ... <!-- END:AGENT_HOME_ORPHANS_DOM -->` in the body for the share button markup (put next to the page chrome, typically top-right).
    - `<!-- BEGIN:AGENT_HOME_ORPHANS_SCRIPT --> ... <!-- END:AGENT_HOME_ORPHANS_SCRIPT -->` near existing scripts at end of body for the module-script wiring.
- (Optional new file if needed) `src/agent-home-orphans.js` — the glue module that imports `SharePanel` + `DeployButton`, resolves current user + agent ownership, and mounts both. Create this file if keeping wiring out of inline HTML feels cleaner (recommended).

## Files read-only

- `src/share-panel.js` — API: `new SharePanel({ agent, container, embedOrigin }).open()`.
- `src/erc8004/deploy-button.js` — API: `new DeployButton({ agent, owner, container, onDeployed })`. Read the exported class carefully — note the agent shape it expects.
- `api/_lib/auth.js` — `getSessionUser` is server-side; use the client-side session helpers instead.
- `src/wallet-auth.js` — helpers like `getCurrentUser()` / `getCurrentWallet()` for ownership resolution.
- `src/app.js` — understand how the agent record is currently hydrated on this page; reuse that data (do not refetch).
- `api/agents/[id].js` — the shape of the agent record.

## UX requirements

**Share button:**

- Button label: `Share` with an outline share icon (use an inline SVG; do not import an icon library).
- Placement: top-right of the main content area, aligned with the agent name/avatar thumbnail.
- Click: instantiate `SharePanel` once (cache the instance), call `.open()`. Reuse on subsequent clicks; never instantiate twice.
- Visible to ALL visitors (not gated).

**Deploy chip:**

- Render container: inline with the agent name, separated by a 12px gap.
- States:
    - Not on-chain + viewer is owner → `<DeployButton>` primary CTA.
    - On-chain → small pill showing chain name + shortened tx hash, linking out to the block explorer. Use `txExplorerUrl` from `src/erc8004/chain-meta.js` (read-only).
    - Not on-chain + viewer is NOT owner → render nothing.
    - User not signed in → render nothing (do not render a "sign in to deploy" prompt here; that's homepage's job).
- On successful deploy (via `onDeployed` callback): refresh the local agent record in place (do not hard-reload the page) and transition the chip to the on-chain success state. A brief toast `Agent registered on <chain>` is acceptable but not required.

**Ownership resolution rules:**

- The agent record has an `owner_user_id` field (or equivalent — verify against `api/agents/[id].js`). Match against the signed-in user's id.
- If the agent has a wallet-based owner (`owner_wallet`), match against the user's linked wallets via whichever helper `src/wallet-auth.js` exposes.
- **Do not** call `eth_accounts` from this module — that's a wallet connection, not an identity check. Ownership is a server-known fact.
- If ownership cannot be determined (no session, no wallet, API failure), treat as not-owner. Never show deploy UI on uncertainty.

**Accessibility:**

- `aria-label="Share agent"` on the share button; `aria-haspopup="dialog"`.
- Deploy chip: button semantics when actionable, link semantics when pointing to explorer.
- Focus trap inside share panel is already handled by `SharePanel` — do not duplicate.

**No layout regressions:**

- Before committing, open `agent-home.html` in the dev server and verify the existing page layout is unchanged at common viewport widths (360, 768, 1280, 1920). Screenshot in the report if possible.

## Deliverables checklist

- [ ] `agent-home.html` has the three anchor blocks, correctly named.
- [ ] Share button mounts and opens the existing `SharePanel` without modification to `share-panel.js`.
- [ ] Deploy chip mounts conditionally per the state machine above.
- [ ] Ownership check works against the real session + wallet link state (verify by signing in and out).
- [ ] `onDeployed` callback transitions the chip without page reload.
- [ ] If you created `src/agent-home-orphans.js`, it's ESM, ~80–160 LOC, JSDoc typed.
- [ ] Prettier pass on all touched files.
- [ ] No new runtime deps.

## Acceptance

- `node --check` passes on every JS file touched.
- `npm run build` succeeds with no new warnings.
- `git grep -n "AGENT_HOME_ORPHANS" agent-home.html` shows exactly three BEGIN/END pairs.
- Manual smoke: in dev, load `/agent/<known-id>` → Share button visible, opens panel, QR + snippets populate. As agent owner, deploy chip visible; as anonymous, chip absent.

## Report + archive

Post the report block from `00-README.md`, then:

```bash
git mv prompts/final-integration/03-agent-home-integration.md prompts/archive/final-integration/03-agent-home-integration.md
```

Commit: `feat(agent-home): mount share panel + deploy chip`.
