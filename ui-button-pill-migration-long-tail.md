---
slug: ui-button-pill-migration-long-tail
title: Retire the legacy button and pill class families in favour of .btn and .pill
tier: P3
score: 24
area: ui
sources: docs/btn-pill-migration.md
---

## Why this matters

The canonical `.btn` (`public/buttons.css`) and `.pill` (`public/style.css`) systems carry hover, active, focus-visible, disabled and aria-busy states for free. Five surfaces were migrated; dozens of per-page families (`explore-btn`, `ad-btn`, `as-btn`, `br-btn`, `ar-btn`, `fm-btn`, `anim-btn`, `bento-action-btn`, `market-empty-cta-btn`, `deploy-svc-pill`, `explore-chain-badge`, ...) each reimplement states, and the doc's own re-verification (2026-10-25) found every one still in use. The result is inconsistent focus rings and states across pages, and `pages/forge.html` and the marketplace page shadow the canonical classes outright.

## Current state (measured by the reviewer on 2026-11-03)

- Files still using each legacy class (grep over `pages/`, `src/`, `public/`): `explore-btn` 1, `ad-btn` 6, `as-btn` 5, `br-btn` 3, `ar-btn` 8, `fm-btn` 5, `bento-action-btn` 2, `market-empty-cta-btn` 2, `anim-btn` 3, `ltm-toggle-btn` 2, `back-btn` 6, `pay-btn` 3, `explore-chain-badge` 1, `deploy-svc-pill` 2, `erc8004-brand-badge` 1, `price-badge` 8, `nav-pill-sm` 3, `btn-primary` 90, `btn-secondary` 10.
- `pages/forge.html` still defines its own inline `.btn` / `.btn-ghost` (21 uses of `btn-ghost`).
- `public/buttons.css` exists with `.btn--primary/--secondary/--ghost/--danger/--forge/--sm/--lg/--block/--icon`; `.pill` modifiers `--onchain/--devnet/--success/--warn/--danger/--new/--md` exist in `public/style.css`.
- Repo has `npm run audit:states` and `npm run audit:tokens` gates that this work must keep green.

## Step 0: re-derive the current state

```
for c in explore-btn ad-btn as-btn br-btn ar-btn fm-btn bento-action-btn market-empty-cta-btn anim-btn ltm-toggle-btn back-btn pay-btn explore-chain-badge deploy-svc-pill erc8004-brand-badge price-badge nav-pill-sm; do
  printf "%s " $c; grep -rlE "(^|[^a-zA-Z0-9_-])$c([^a-zA-Z0-9_-]|$)" pages src public --include=*.html --include=*.js --include=*.css | wc -l; done
grep -n "btn-ghost\|^\s*\.btn" pages/forge.html | head -30
npm run audit:states 2>&1 | tail -5; npm run audit:tokens 2>&1 | tail -5
```

## Tasks

1. Build a repeatable inventory: a script `scripts/audit-button-families.mjs` that lists every legacy class from the doc's two tables with file and line counts and exits non-zero when a class marked "migrated" reappears. Add it to `package.json` as `audit:buttons` (do not add it to `gate` until the count is zero).
2. Migrate in small topical batches (one commit each, explicit paths): add the canonical classes to the markup, translate the scoped CSS overrides to be written against `.btn` / `.pill` (keep a thin scoped override only for real sizing or colour differences), then delete the dead legacy rule blocks. Follow the doc's tables for the target mapping, including `anim-btn--loading` to `[aria-busy="true"]`, `nav-pill-sm` to `.pill.pill--new`, and `explore-chain-badge--testnet` to `.pill.pill--devnet`.
3. `pages/forge.html`: remove the inline `.btn` / `.btn-ghost` definitions, change markup to `btn btn--primary` / `btn btn--ghost`, keep sizing overrides in a scoped `.forge-stage .btn` block.
4. Marketplace page and `public/marketplace.css`: replace `btn-primary` / `btn-secondary` / `market-empty-cta-btn.primary` in markup with the canonical classes and rewrite the two scoped override blocks and the detail-panel rules against `.btn`.
5. For each touched page, load it in a real browser (`npm run dev`, port 3000) and check hover, active, focus-visible, disabled and loading states, an empty state, and no console errors. Take before/after screenshots of each page to confirm no visual regression beyond the intended unification.
6. Update `docs/btn-pill-migration.md`: move finished rows from the long-tail tables into "Migrated surfaces", and record any class deliberately kept with the reason. Add a `data/changelog.json` entry.

## Definition of done

- [ ] `node scripts/audit-button-families.mjs` exits 0 and reports zero remaining legacy classes outside the documented keep-list.
- [ ] `npm run audit:states` and `npm run audit:tokens` pass.
- [ ] `pages/forge.html` has no inline `.btn` or `.btn-ghost` definition (`grep -n "^\s*\.btn" pages/forge.html` is empty).
- [ ] Each migrated page was exercised in a browser with hover, focus-visible, disabled and loading states observed.

## Never blocked

| Blocker | Resolution (act, do not ask) |
|---|---|
| A legacy class carries behaviour (JS selector) not just style | Keep the class as a JS hook alongside the canonical class and say so in the audit keep-list. |
| `btn-primary` appears in 90 files | Many are third-party-style or unrelated systems. Audit each; migrate only the ones that mean the site button, record the rest in the keep-list with the reason. |
