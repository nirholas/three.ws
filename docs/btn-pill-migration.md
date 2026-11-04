# Button + Pill Migration Map (B04)

**Canonical system:** the `.btn` base + BEM modifiers live in `public/buttons.css` (B03, a portable partial that `public/style.css` `@import`s; any surface can also `<link>` it directly). The `.pill` base + semantic modifiers live in `public/style.css` (B04).
**Tokens:** B01 primitives in `public/tokens.css`, which also carries the `--focus-ring-*` and `--disabled-*` component tokens; `--btn-*` component tokens in `public/buttons.css`, `--badge-*` in `public/style.css`.

---

## Canonical classes

### Buttons

| Class | Description |
|---|---|
| `.btn` | Base (secondary): glass surface, border, white text |
| `.btn.btn--primary` | White fill, dark ink — main CTA |
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
| `.pill.pill--onchain` | Green — deployed on-chain |
| `.pill.pill--devnet` | Amber — testnet/devnet |
| `.pill.pill--success` | Green — success state |
| `.pill.pill--warn` | Amber — warning |
| `.pill.pill--danger` | Red — error/danger |
| `.pill.pill--new` | Neutral — "New" label |
| `.pill.pill--md` | Medium size |
| `.pill__dot` | Animated pulse status dot inside a pill |

Linked pills: use `<a class="pill pill--onchain">` — gets hover/focus states automatically.

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

---

## Remaining long tail — classes → canonical equivalent

These classes are defined across the codebase. Follow-up agents should replace them with canonical classes (keep old class as needed for scoped CSS overrides). Re-verified 2026-10-25: every class in both tables below is still in use in `pages/`, `src/`, or `public/`, so every row remains open work.

### Button class names → canonical

| Old class(es) | Canonical equivalent |
|---|---|
| `explore-btn` | `.btn.btn--secondary` |
| `explore-btn--primary` | `.btn.btn--primary` |
| `explore-btn--ghost` | `.btn.btn--ghost` |
| `explore-btn--sm` | `.btn.btn--sm` |
| `erc8004-quickstart-btn` | `.btn.btn--primary` |
| `deploy-wallet-btn` | `.btn.btn--secondary` (already has `btn` class) |
| `ch-btn-primary` | `.btn.btn--primary` |
| `ad-btn`, `ad-btn-primary` | `.btn` / `.btn.btn--primary` |
| `as-btn`, `as-btn-primary`, `as-btn-ghost`, `as-btn-sm` | `.btn` + modifiers |
| `br-btn`, `br-btn-primary`, `br-btn-ghost`, `br-btn-secondary`, `br-btn-sm`, `br-btn-danger` | `.btn` + modifiers |
| `ae-btn`, `ame-btn`, `ame-console-btn` | `.btn.btn--secondary` |
| `ar-btn`, `ar-btn--active`, `ar-launch-btn`, `ar-share-btn` | `.btn` + modifiers |
| `fm-btn` | `.btn.btn--secondary` |
| `bento-action-btn`, `bento-pill-btn` | `.btn.btn--ghost` / `.pill` |
| `market-empty-cta-btn`, `market-empty-cta-btn.primary` | `.btn` / `.btn.btn--primary` |
| `btn-primary`, `btn-secondary` | `.btn.btn--primary` / `.btn.btn--secondary` |
| `anim-btn`, `anim-btn--active`, `anim-btn--loading` | `.btn` + `[aria-busy]` for loading |
| `ltm-toggle-btn` | `.btn.btn--ghost` |
| `back-btn` | `.btn.btn--secondary` |
| `abort-btn`, `add-btn`, `assign-btn` | `.btn.btn--secondary` / `.btn.btn--danger` |
| `pay-btn` | `.btn.btn--primary` |
| `d-model-btn` (marketplace detail), `anim-upload-btn`, `anim-repin-btn`, `anim-stop-btn` | `.btn.btn--ghost` |

### Pill/badge class names → canonical

| Old class(es) | Canonical equivalent |
|---|---|
| `explore-chain-badge` | `.pill` |
| `explore-chain-badge--testnet` | `.pill.pill--devnet` |
| `explore-card-3dpill` | `.pill` (with custom color overrides) |
| `deploy-svc-pill` | `.pill` |
| `erc8004-brand-badge` | `.pill.pill--onchain` |
| `tws-ocb` (onchain-badge) | `.pill.pill--onchain` (already generalized in B04) |
| `.price-badge` | `.pill` |
| `nav-pill-sm` | `.pill.pill--new` (the default pill size is already small; no `--sm` modifier exists) |

---

## Audit and keep-list

`npm run audit:buttons` (`scripts/audit-button-families.mjs`) prints every family with file counts and exits 1 if a migrated family reappears. Kept on purpose: `anim-btn` (bespoke animation tile), `ltm-toggle-btn` (segmented toggle), `nav-pill-sm` (nav badge tones), `price-badge`, `back-btn` (JS selectors), `market-empty-cta-btn` (sizing hook). Still open: `ad-btn`, `as-btn`, `br-btn`, `ar-btn`, `fm-btn`, `bento-action-btn`, `pay-btn`.

## Forge page note (done)

`pages/forge.html` defines its own inline `.btn` and `.btn-ghost` styles that shadow the canonical system within that page. To fully migrate:

1. Remove the inline `.btn` / `.btn-ghost` definitions from forge.html's `<style>` block.
2. Update forge buttons: `class="btn"` → `class="btn btn--primary"`, `class="btn btn-ghost"` → `class="btn btn--ghost"`.
3. Retain any forge-specific sizing overrides in a scoped `.forge-stage .btn { ... }` block.

## Marketplace page note (done)

The page's bare inline `.btn-primary` / `.btn-secondary` definitions are gone; what remains are two scoped overrides in its `<style>` block (`.avatar-modal-actions .btn-primary/.btn-secondary` and `.payment-modal-success .ps-actions .btn-primary/.btn-secondary`) plus the detail-panel rules in `public/marketplace.css` (`.market-avatar-detail .btn-secondary`, `.market-tool-detail .btn-secondary`). The markup still uses the old names throughout. Migration:

1. Replace `btn-primary` → `btn btn--primary`, `btn-secondary` → `btn btn--secondary` in the markup.
2. Retain the scoped sizing/colour overrides, rewritten against the canonical classes (`.avatar-modal-actions .btn { ... }`).
3. Replace `market-empty-cta-btn.primary` → `btn btn--primary`.
