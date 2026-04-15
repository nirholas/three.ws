# Build prompts — the real stack

Prompts in this directory are scoped to the product priority stack. If a prompt isn't here, it's not on the critical path. Ignore `prompts/embed/`, `prompts/pretext/`, `prompts/scalability/`, and `prompts/widget-studio/` unless explicitly asked — they rat-hole on secondary concerns.

## Priority stack (build in this order)

1. **Wallet auth** — user can sign in with MetaMask and have a real backend session. Largely shipped (2026-04-15); gap-fills in `01-*`.
2. **Selfie → agent** — take a photo, get a 3D avatar. The magic moment. `02-*`.
3. **Edit avatar** — swap, regenerate, tweak without destroying identity. `03-*`.
4. **View & embed** — agent page polish and iframe/oEmbed so the avatar can be shared. `04-*`.
5. **Host embed** — avatar lives inside Claude.ai Artifacts and Lobehub chat (user has a Lobehub fork — primary integration target). `05-*`.
6. **Onchain portability** — the agent is pulled *from chain* into any host. The novel unlock. `06-*`.

## Prompt file format

Each prompt is self-contained. An agent should be able to implement it without reading the others. Every prompt declares:

- **Why it matters** (one paragraph, tied to the stack)
- **What to build** (concrete files and behaviors)
- **Out of scope** (to prevent drift)
- **Acceptance** (verifiable)

## Rules for agents executing these prompts

- Do **not** add features, refactors, or abstractions beyond what's specified.
- Do **not** write tests unless explicitly required.
- Do **not** create documentation files unless explicitly required.
- If the spec conflicts with reality (file moved, dep missing, API changed), stop and report — don't improvise.
- If you finish early, stop. Don't find extra work.

## Sequencing

Pillars 1–3 are mostly sequential (auth → selfie → edit). Pillars 4–6 can proceed in parallel once 1–3 are solid.

Within a pillar, suffix numbers indicate sequence: `02-01-*` before `02-02-*`.

## Prompts

**Stack-wide**
- [00-stack-e2e-smoke.md](./00-stack-e2e-smoke.md) — end-to-end smoke script

**Pillar 1 — Wallet auth**
- [01-01-wallet-auth-smoke-test.md](./01-01-wallet-auth-smoke-test.md) — e2e verification of SIWE login
- [01-01-wallet-auth-privy.md](./01-01-wallet-auth-privy.md) — Privy fallback provider
- [01-01-wallet-link-existing-account.md](./01-01-wallet-link-existing-account.md) — link without new account
- [01-02-email-password-parity.md](./01-02-email-password-parity.md) — password path parity audit
- [01-02-session-recovery-and-logout.md](./01-02-session-recovery-and-logout.md) — clean logout + recovery
- [01-02-wallet-account-section.md](./01-02-wallet-account-section.md) — account page wallet block
- [01-02-wallet-ens-display.md](./01-02-wallet-ens-display.md) — render ENS if resolvable
- [01-02-wallet-nav-indicator.md](./01-02-wallet-nav-indicator.md) — nav-bar wallet chip
- [01-03-link-wallet-to-existing-account.md](./01-03-link-wallet-to-existing-account.md) — `POST /verify` linked branch
- [01-03-primary-wallet-selection.md](./01-03-primary-wallet-selection.md) — promote/demote primary wallet
- [01-04-session-expiry-ux.md](./01-04-session-expiry-ux.md) — quiet 401 handling
- [01-04-siwe-hardening.md](./01-04-siwe-hardening.md) — nonce/domain/signature edge cases
- [01-04-wallet-chain-switch.md](./01-04-wallet-chain-switch.md) — chain switching prompt UX

**Pillar 2 — Selfie → agent**
- [02-01-selfie-capture-ui.md](./02-01-selfie-capture-ui.md) — camera capture page
- [02-02-selfie-upload-r2.md](./02-02-selfie-upload-r2.md) — presign + PUT to R2
- [02-02-image-to-3d-backend.md](./02-02-image-to-3d-backend.md) — backend pipeline scaffolding
- [02-02-avatar-generation-pipeline.md](./02-02-avatar-generation-pipeline.md) — worker job model
- [02-03-selfie-to-avatar-pipeline.md](./02-03-selfie-to-avatar-pipeline.md) — provider wire-up
- [02-03-generation-progress-ui.md](./02-03-generation-progress-ui.md) — polling + progress pill
- [02-03-avatar-to-agent-link.md](./02-03-avatar-to-agent-link.md) — bind new avatar to default agent
- [02-04-first-agent-landing.md](./02-04-first-agent-landing.md) — `?welcome=1` experience
- [02-05-avatar-og-share-image.md](./02-05-avatar-og-share-image.md) — rendered share image
- [02-05-selfie-consent-and-retry.md](./02-05-selfie-consent-and-retry.md) — consent copy + retry UX
- [02-06-no-wallet-guest-creation.md](./02-06-no-wallet-guest-creation.md) — guest path (no wallet required)

**Pillar 3 — Edit avatar**
- [03-01-avatar-swap.md](./03-01-avatar-swap.md) — swap GLB on existing agent
- [03-01-dashboard-edit-tab.md](./03-01-dashboard-edit-tab.md) — edit tab on dashboard
- [03-01-regenerate-from-new-selfie.md](./03-01-regenerate-from-new-selfie.md) — retake + regenerate
- [03-02-avatar-regenerate.md](./03-02-avatar-regenerate.md) — reuse stored selfie
- [03-02-avatar-regenerate-and-swap.md](./03-02-avatar-regenerate-and-swap.md) — combined flow
- [03-02-swap-avatar-on-agent.md](./03-02-swap-avatar-on-agent.md) — swap from library
- [03-03-edit-agent-metadata.md](./03-03-edit-agent-metadata.md) — name/desc/skills editor
- [03-04-animation-set-per-agent.md](./03-04-animation-set-per-agent.md) — per-agent animation list
- [03-04-skill-install-from-registry.md](./03-04-skill-install-from-registry.md) — add skills from registry
- [03-05-avatar-version-history.md](./03-05-avatar-version-history.md) — rollback previous avatars
- [03-05-memory-review-and-edit.md](./03-05-memory-review-and-edit.md) — inspect and edit memories

**Pillar 4 — View & embed**
- [04-01-agent-public-page-polish.md](./04-01-agent-public-page-polish.md) — mobile-first polish
- [04-01-agent-page-polish.md](./04-01-agent-page-polish.md) — desktop-side polish
- [04-01-agent-og-image.md](./04-01-agent-og-image.md) — dedicated OG endpoint
- [04-02-og-oembed.md](./04-02-og-oembed.md) — unfurl verification
- [04-02-agent-web-component.md](./04-02-agent-web-component.md) — `<agent-3d>` hardening
- [04-02-embed-policy-crud.md](./04-02-embed-policy-crud.md) — per-agent embed policy API
- [04-03-embed-reliability.md](./04-03-embed-reliability.md) — headers, kiosk, transparent bg
- [04-03-public-agent-decorate.md](./04-03-public-agent-decorate.md) — public-only decoration
- [04-04-agent-card-json.md](./04-04-agent-card-json.md) — A2A discovery card

**Pillar 5 — Host embed**
- [05-01-claude-artifact-embed.md](./05-01-claude-artifact-embed.md) — Claude iframe snippet
- [05-01-claude-artifact-build.md](./05-01-claude-artifact-build.md) — artifact builder tooling
- [05-01-claude-artifact-export.md](./05-01-claude-artifact-export.md) — export-as-artifact flow
- [05-01-claude-artifacts-shim.md](./05-01-claude-artifacts-shim.md) — compatibility shim
- [05-02-lobehub-plugin.md](./05-02-lobehub-plugin.md) — Lobehub plugin endpoints
- [05-02-lobehub-plugin-manifest.md](./05-02-lobehub-plugin-manifest.md) — manifest shape
- [05-03-mcp-spawn-agent-tool.md](./05-03-mcp-spawn-agent-tool.md) — `render_agent` MCP tool
- [05-03-postmessage-event-bridge.md](./05-03-postmessage-event-bridge.md) — host→iframe event forward
- [05-04-postmessage-bridge-spec.md](./05-04-postmessage-bridge-spec.md) — bridge v1 contract + SDK
- [05-04-host-theme-sync.md](./05-04-host-theme-sync.md) — dark/light sync with host
- [05-05-host-resize-and-mode.md](./05-05-host-resize-and-mode.md) — auto-resize + kiosk modes

**Pillar 6 — Onchain portability**
- [06-01-erc8004-mint-from-ui.md](./06-01-erc8004-mint-from-ui.md) — mint wizard
- [06-02-pin-card-to-ipfs.md](./06-02-pin-card-to-ipfs.md) — pin card, store CID
- [06-03-resolve-agent-from-chain.md](./06-03-resolve-agent-from-chain.md) — chain → body resolver
- [06-04-lobehub-onchain-import.md](./06-04-lobehub-onchain-import.md) — Lobehub onchain import demo
- [06-05-signed-action-log.md](./06-05-signed-action-log.md) — wallet-signed action log
