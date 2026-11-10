# Button + Pill Migration Map (B04)

**Canonical system:** the `.btn` base + BEM modifiers live in `public/buttons.css` (B03, a portable partial that `public/style.css` `@import`s; any surface can also `<link>` it directly). The `.pill` base + semantic modifiers live in `public/style.css` (B04).
**Tokens:** B01 primitives in `public/tokens.css`, which also carries the `--focus-ring-*` and `--disabled-*` component tokens; `--btn-*` component tokens in `public/buttons.css`, `--badge-*` in `public/style.css`.

---

## Canonical classes

### Buttons

| Class | Description |
|---|---|
| `.btn` | Base (secondary): glass surface, border, white text |
| `.btn.btn--primary` | White fill, dark ink - main CTA |
| `.btn.btn--secondary` | Explicit secondary (same as base, for readability) |
| `.btn.btn--ghost` | Transparent, text-only |
| `.btn.btn--danger` | Red-tinted |
| `.btn.btn--forge` | Gradient-bordered forge CTA with a live pulse dot (`.btn-forge-dot`); dark surfaces only |
| `.btn.btn--sm` | Small size |
| `.btn.btn--lg` | Large size |
| `.btn.btn--block` | Full-width |
| `.btn.btn--icon` | Square icon-only |

States handled automatically: `:hover`, `:active`, `:focus-visible` (visible focus ring), `[disabled]` / `[aria-disabled]` (pointer-events:none, reduced opacity), `[aria-busy="true"]` (CSS spinner, no setTimeout).

### Pills / badges

| Class | Description |
|---|---|
| `.pill` | Base neutral badge |
| `.pill.pill--onchain` | Green - deployed on-chain |
| `.pill.pill--devnet` | Amber - testnet/devnet |
| `.pill.pill--success` | Green - success state |
| `.pill.pill--warn` | Amber - warning |
| `.pill.pill--danger` | Red - error/danger |
| `.pill.pill--new` | Neutral - "New" label |
| `.pill.pill--md` | Medium size |
| `.pill__dot` | Animated pulse status dot inside a pill |

Linked pills: use `<a class="pill pill--onchain">` - gets hover/focus states automatically.

---

## Migrated surfaces (done)

| Surface | Old classes | New classes added |
|---|---|---|
| `/deploy` (register-ui.js) | `erc8004-btn`, `erc8004-btn--primary`, `erc8004-btn--ghost`, `erc8004-btn--close`, `erc8004-btn--wallet`, `erc8004-btn--x` | Added `btn btn--primary/--ghost/--secondary/--icon` alongside |
| Pump launch modal (launch-token-modal.js) | `ltm-btn`, `ltm-btn-primary` | Added `btn btn--secondary/--primary` alongside |
| Homepage pump launcher (homepage-launcher.js) | `ltm-btn`, `ltm-btn-primary` | Added `btn btn--secondary/--primary` alongside |
| Nav drawer (public/nav.js renders it into the empty `nav-drawer` element in nav.html) | `btn primary` | Added `btn--primary` BEM modifier |
| Forge page and `src/forge-*.js` panels | inline `.btn` / `.btn-ghost`, `btn-sm` | `btn btn--primary/--ghost/--sm`; forge sizing lives in a scoped `.forge-stage .btn` block |
| Marketplace (`pages/marketplace.html`, `src/marketplace.js`, `public/marketplace.css`) | `btn-primary`, `btn-secondary`, `market-empty-cta-btn.primary` | `btn btn--primary/--secondary`; scoped overrides rewritten as `.btn.btn--primary/--secondary` |
| Dead families removed from `public/style.css` | `explore-btn*`, `explore-chain-badge*`, `erc8004-brand-badge` | none (no markup used them); `deploy-svc-pill` became `.pill` in `register-ui.js` |
| On-chain badge (onchain-badge.js) | `tws-ocb`, `tws-ocb--md`, `tws-ocb--devnet` | Added `pill pill--onchain/--devnet pill--md` |
| Forge, Explore and Marketplace pages | `explore-btn*`, `explore-chain-badge*`, `deploy-svc-pill`, `erc8004-brand-badge`, forge inline `.btn`/`.btn-ghost`, `market-empty-cta-btn.primary` | Canonical `btn`/`pill`; legacy rule blocks deleted |
| Brain (`/brain`) | Flow map and First Meet | `fm-btn`, `fm-btn-share`, `fm-btn-continue` | `btn btn--secondary` (flow map), `btn btn--primary/--secondary btn--lg` (First Meet); only `.btn[aria-pressed]` kept in `src/flow-map.css` |
| Home bento actions | Avatar Studio (+ rig and walk panels, studio demo) | Agent detail (v2, classic), agent-detail JS, sale panel, alpha-drip panel 
### Kept deliberately (guarded by `npm run audit:buttons`)

| Class | Why it stays |
|---|---|
| `anim-btn` | Bespoke animation tile layout (key hint, icon, label), not a plain button |
| `ltm-toggle-btn` | Segmented mainnet/devnet toggle; the group border is the affordance |
| `nav-pill-sm` | Nav badge with live/new tones and mono type owned by `nav.css` |
| `price-badge` | Marketplace price tag with per-card positioning |
| `market-empty-cta-btn` | Rides on `.btn`; thin sizing hook for the empty-state row |
| `ar-btn` | Viewer toolbar AR toggle with BEM label and an active state toggled from `viewer.js` (other hits are element ids) |
| `pay-btn` | Brand-gradient (Solana purple / orange) and theme-inverting checkout CTA with its own `.spin`/`.busy` payment state |
| `back-btn` | Per-flow wizard back link whose JS selectors depend on it |

---

## Remaining long tail - classes → canonical equivalent

These classes are defined across the codebase. Follow-up agents should replace them with canonical classes (keep old class as needed for scoped CSS overrides). Re-verified 2026-11-10 with `npm run audit:buttons`: every family that was open is now either migrated (zero files) or in the kept list above. The rows below are the mapping that was applied, plus classes outside the audit's scope.

### Button class names → canonical

| Old class(es) | Canonical equivalent |
|---|---|
| `erc8004-quickstart-btn` | `.btn.btn--primary` |
| `deploy-wallet-btn` | `.btn.btn--secondary` (already has `btn` class) |
| `ch-btn-primary` | `.btn.btn--primary` |
| `ae-btn`, `ame-btn`, `ame-console-btn` | `.btn.btn--secondary` |
| `market-empty-cta-btn`, `market-empty-cta-btn.primary` | `.btn` / `.btn.btn--primary` |
| `btn-primary`, `btn-secondary` | `.btn.btn--primary` / `.btn.btn--secondary` |
| `anim-btn`, `anim-btn--active`, `anim-btn--loading` | `.btn` + `[aria-busy]` for loading |
| `ltm-toggle-btn` | `.btn.btn--ghost` |
| `back-btn` | `.btn.btn--secondary` |
| `abort-btn`, `add-btn`, `assign-btn` | `.btn.btn--secondary` / `.btn.btn--danger` |
| `d-model-btn` (marketplace detail), `anim-upload-btn`, `anim-repin-btn`, `anim-stop-btn` | `.btn.btn--ghost` |

### Pill/badge class names → canonical

| Old class(es) | Canonical equivalent |
|---|---|
| `explore-card-3dpill` | `.pill` (with custom color overrides) |
| `tws-ocb` (onchain-badge) | `.pill.pill--onchain` (already generalized in B04) |
| `.price-badge` | `.pill` |
| `nav-pill-sm` | `.pill.pill--new` (the default pill size is already small; no `--sm` modifier exists) |

---

## Audit and keep-list

`npm run audit:buttons` (`scripts/audit-button-families.mjs`; add `-- --strict` to fail while any open family remains) prints every family with file counts and exits 1 if a migrated family reappears. Kept on purpose: see the table above. No family is open, so `--strict` exits 0 and `audit:buttons` can join `gate`.

## Forge page note (done)

`pages/forge.html` defines its own inline `.btn` and `.btn-ghost` styles that shadow the canonical system within that page. To fully migrate:

1. Remove the inline `.btn` / `.btn-ghost` definitions from forge.html's `<style>` block.
2. Update forge buttons: `class="btn"` → `class="btn btn--primary"`, `class="btn btn-ghost"` → `class="btn btn--ghost"`.
3. Retain any forge-specific sizing overrides in a scoped `.forge-stage .btn { ... }` block.

## Marketplace page note (done)

The marketplace markup (`pages/marketplace.html`, `src/marketplace.js`) now uses `btn btn--primary` / `btn btn--secondary`, and the old bare inline `.btn-primary` / `.btn-secondary` definitions are gone. The empty-state buttons ride on `.btn` and keep `market-empty-cta-btn` only as a sizing hook. The plugin modals still use their own `plugin-modal-btn` family, which is outside this migration map. Scoped sizing and colour overrides, where they remain, are written against the canonical classes (`.avatar-modal-actions .btn`).
