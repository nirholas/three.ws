# Retire the legacy button and pill class families in favour of .btn and .pill

**How to run:** paste this entire file into a fresh Claude Code chat opened in the three.ws repository (`/home/user/three.ws`) and send it. Nothing else is needed: everything this order depends on is in this file, including a verbatim copy of the planning docs it came from. It is safe to run on its own, in any order, and at the same time as any other work order. Its path in the repo is `prompts/finish/784-plan-ui-button-pill-migration-long-tail.md`.

**Priority:** P3, polish, developer experience, or exploratory (score 24 of 100 inside the tier). **Area:** ui. **Written:** 2026-11-03, from a review of the planning corpus that read the source docs listed at the bottom and checked them against the code. Status claims rot, which is why Step 0 re-measures before you build anything.

## Operating clause (binding)

- Read `CLAUDE.md` at the repo root before anything else. It overrides this file wherever they disagree.
- Finish 100% in this session. Do not end the turn with a question, an option list, a plan, or "let me know". Make reasonable judgment calls, act on them, and note each in one line in the final report.
- The only permitted stops are the CLAUDE.md stop-and-ask gates: signing or sending a transaction, spending or moving funds, paying an x402 endpoint, minting or launching a coin; `git push`, production deploys, publishing or posting externally; committing content that references a crypto project other than $THREE; destroying data that cannot be regenerated. Do every other part of the work around a gate, and batch every such ask into one message at the end.
- Enterprise grade, no shortcuts. No mocks, no fake data, no placeholders, no sample arrays, no fake loading or progress, no unfinished-work markers, no stub functions, no commented-out code. Real APIs, real endpoints, real data. Errors are handled at the boundaries (network, user input) with a real recovery path.
- Bug fixes are test-first: write the test that reproduces the bug, watch it fail for the reported reason, fix the code, watch it pass, and commit the test with the fix.
- UI work meets the bar a senior design review would pass: hover, focus and active states on every interactive element, designed empty, error and loading (skeleton) states, keyboard accessible, works at phone width, and verified in a real browser.
- Solana is the home chain and leads every design. Robinhood means Robinhood Crypto only. $THREE (`FeMbDoX7R1Psc4GEcvJdsbNbZA3bfztcyDCatJVJpump`) is the only promoted coin; tests and fixtures use it or a clearly synthetic placeholder, never a real third-party mint.
- Never write the em-dash or en-dash characters anywhere (code, docs, UI copy, commit messages). Use a period, comma, colon, parentheses, or a plain hyphen.
- Before writing any non-trivial feature or UI, load `.claude/skills/engineering-standards/SKILL.md`. Before claiming done, load `.claude/skills/changelog-and-docs/SKILL.md`.

## Running alongside other sessions

Many sessions may be working in this same worktree at once. Stage explicit paths only (never `git add -A` or `git add .`), re-check `git status` and `git diff --staged` immediately before each commit, re-read a file right before editing it, and commit your own finished work promptly. Never stash, reset, revert or reformat files you did not change. Start dev servers on a free port (`npx vite --port <free port> --strictPort`), not the default 3000, so you do not collide with another session.

## Why this matters

The canonical `.btn` (`public/buttons.css`) and `.pill` (`public/style.css`) systems carry hover, active, focus-visible, disabled and aria-busy states for free. Five surfaces were migrated; dozens of per-page families (`explore-btn`, `ad-btn`, `as-btn`, `br-btn`, `ar-btn`, `fm-btn`, `anim-btn`, `bento-action-btn`, `market-empty-cta-btn`, `deploy-svc-pill`, `explore-chain-badge`, ...) each reimplement states, and the doc's own re-verification (2026-10-25) found every one still in use. The result is inconsistent focus rings and states across pages, and `pages/forge.html` and the marketplace page shadow the canonical classes outright.

## Current state (measured by the reviewer on 2026-11-03; re-verify)

- Files still using each legacy class (grep over `pages/`, `src/`, `public/`): `explore-btn` 1, `ad-btn` 6, `as-btn` 5, `br-btn` 3, `ar-btn` 8, `fm-btn` 5, `bento-action-btn` 2, `market-empty-cta-btn` 2, `anim-btn` 3, `ltm-toggle-btn` 2, `back-btn` 6, `pay-btn` 3, `explore-chain-badge` 1, `deploy-svc-pill` 2, `erc8004-brand-badge` 1, `price-badge` 8, `nav-pill-sm` 3, `btn-primary` 90, `btn-secondary` 10.
- `pages/forge.html` still defines its own inline `.btn` / `.btn-ghost` (21 uses of `btn-ghost`).
- `public/buttons.css` exists with `.btn--primary/--secondary/--ghost/--danger/--forge/--sm/--lg/--block/--icon`; `.pill` modifiers `--onchain/--devnet/--success/--warn/--danger/--new/--md` exist in `public/style.css`.
- Repo has `npm run audit:states` and `npm run audit:tokens` gates that this work must keep green.

## Step 0: re-derive the current state

Run these first. Skip any task whose outcome already exists, and say so in the report.

```
for c in explore-btn ad-btn as-btn br-btn ar-btn fm-btn bento-action-btn market-empty-cta-btn anim-btn ltm-toggle-btn back-btn pay-btn explore-chain-badge deploy-svc-pill erc8004-brand-badge price-badge nav-pill-sm; do
  printf "%s " $c; grep -rlE "(^|[^a-zA-Z0-9_-])$c([^a-zA-Z0-9_-]|$)" pages src public --include=*.html --include=*.js --include=*.css | wc -l; done
grep -n "btn-ghost\|^\s*\.btn" pages/forge.html | head -30
npm run audit:states 2>&1 | tail -5; npm run audit:tokens 2>&1 | tail -5
```

Before changing anything, also record the baseline so you can prove you broke nothing:

    git status --short | head -20
    git log --oneline -5
    npx vitest run 2>&1 | tail -8    # note the failing-file count; it is your baseline, not your job unless this order says so

## Tasks

1. Build a repeatable inventory: a script `scripts/audit-button-families.mjs` that lists every legacy class from the doc's two tables with file and line counts and exits non-zero when a class marked "migrated" reappears. Add it to `package.json` as `audit:buttons` (do not add it to `gate` until the count is zero).
2. Migrate in small topical batches (one commit each, explicit paths): add the canonical classes to the markup, translate the scoped CSS overrides to be written against `.btn` / `.pill` (keep a thin scoped override only for real sizing or colour differences), then delete the dead legacy rule blocks. Follow the doc's tables for the target mapping, including `anim-btn--loading` to `[aria-busy="true"]`, `nav-pill-sm` to `.pill.pill--new`, and `explore-chain-badge--testnet` to `.pill.pill--devnet`.
3. `pages/forge.html`: remove the inline `.btn` / `.btn-ghost` definitions, change markup to `btn btn--primary` / `btn btn--ghost`, keep sizing overrides in a scoped `.forge-stage .btn` block.
4. Marketplace page and `public/marketplace.css`: replace `btn-primary` / `btn-secondary` / `market-empty-cta-btn.primary` in markup with the canonical classes and rewrite the two scoped override blocks and the detail-panel rules against `.btn`.
5. For each touched page, load it in a real browser (`npm run dev`, port 3000) and check hover, active, focus-visible, disabled and loading states, an empty state, and no console errors. Take before/after screenshots of each page to confirm no visual regression beyond the intended unification.
6. Update `docs/btn-pill-migration.md`: move finished rows from the long-tail tables into "Migrated surfaces", and record any class deliberately kept with the reason. Add a `data/changelog.json` entry.

## Definition of done

Every line must be verified with the actual command output or browser observation in front of you. Never claim a line you did not verify.

- [ ] `node scripts/audit-button-families.mjs` exits 0 and reports zero remaining legacy classes outside the documented keep-list.
- [ ] `npm run audit:states` and `npm run audit:tokens` pass.
- [ ] `pages/forge.html` has no inline `.btn` or `.btn-ghost` definition (`grep -n "^\s*\.btn" pages/forge.html` is empty).
- [ ] Each migrated page was exercised in a browser with hover, focus-visible, disabled and loading states observed.
- [ ] Every test you wrote or touched passes (`npx vitest run <those files>`; Playwright specs with `npx playwright test <spec>`). Bug fixes landed test-first: the new test failed before the fix for the reason the bug describes, and passes after.
- [ ] `npx vitest run` shows no new failing files compared with the Step 0 baseline.
- [ ] Any UI you changed was exercised in a real browser on a dev server (`npx vite --port <free port> --strictPort`): no console errors or warnings from your code, real network calls returning real data, and hover, focus, active, empty, error and loading (skeleton) states all designed and observed.
- [ ] `npm run check:rules -- --paths <every file you touched>` exits 0.
- [ ] Documentation is true: the feature doc or README describes what now exists, `STRUCTURE.md` has a row for any new surface or directory, a new page is in `data/pages.json`, and any user-visible change has a `data/changelog.json` entry followed by `npm run build:pages`. `npm run audit:docs` reports nothing new.
- [ ] You reviewed `git diff --staged` line by line before committing, and every changed line is justified.

## Never blocked

| Blocker | Resolution (act, do not ask) |
|---|---|
| A legacy class carries behaviour (JS selector) not just style | Keep the class as a JS hook alongside the canonical class and say so in the audit keep-list. |
| `btn-primary` appears in 90 files | Many are third-party-style or unrelated systems. Audit each; migrate only the ones that mean the site button, record the rest in the keep-list with the reason. |
| Missing credential or env var | Read it from the live Cloud Run service: `node scripts/read-service-env.mjs` (or `gcloud run services describe three-ws-api --region us-central1`). Never trust `vercel env pull`; it returns empty secrets. To set one key, use `gcloud run services update --update-env-vars`, never `--set-env-vars` (that replaces the whole set). Load `.claude/skills/self-unblock-playbook/SKILL.md` for the full table. |
| Database schema needed | Write the migration beside the existing ones, read `npm run db:status` first, and remember `npm run db:migrate` applies immediately with no dry run. |
| GCP resource, GPU, or quota | GCP spend for quality and reliability is pre-approved (project `aerial-vehicle-466722-p5`). Create what you need; never downgrade quality to save credits. Do not onboard a new paid third-party API without the owner. |
| Tests failing that you did not touch | Compare with your Step 0 baseline. Pre-existing failures are not yours to fix unless this order says so; report them in one line. Never delete or skip a test to get green. |
| A file changed under you | Another session edited it. Re-read it, keep their change, and apply yours on top. Never `git stash`, `git reset`, `git checkout -- <path>`, or revert work you did not write. |
| Upstream API down or rate-limited | Find the root cause, add a real fallback or retry with backoff, and keep going. Never ship fake data in its place. |

## Close out (required)

1. Verify every Definition of done line with real output in front of you.
2. Commit with explicit paths and a message that describes the diff: `type(scope): what changed and why a reader would care`. Split unrelated changes into separate commits. If the diff references a crypto project other than $THREE, stop and ask the owner before that commit (CLAUDE.md commit gate).
3. If every Definition of done line passes, delete this work order in your final commit (`git rm prompts/finish/784-plan-ui-button-pill-migration-long-tail.md`) and append one dated line to `prompts/finish/_context/plan-PROGRESS.md` (create it if missing): the date, `784-plan-ui-button-pill-migration-long-tail.md`, the commit SHAs, and one sentence on what shipped.
4. If the last step belongs to the owner or an outside party, finish everything else, keep this file, add a dated "Status" paragraph directly under its title saying exactly what remains and who owns it, and append the same to `prompts/finish/_context/plan-PROGRESS.md`.
5. Never push or deploy unless the owner's message that started this session explicitly told you to. Leave the ship as one command (`git push threews main`, then `npm run deploy:gcp:full` per `.claude/skills/deploy-runbook/SKILL.md`) and name it in the report.

## Final report

Reply with, in this order and nothing else: what Step 0 measured; what you changed (files and commit SHAs); evidence for each Definition of done line; the one batched owner message, if any gate was hit; one line per judgment call. No trailing questions.

## Source material (verbatim)

The planning docs this order was derived from, copied on 2026-11-03 so this order stands alone even if they move or are deleted. Typography was normalized to the house style (dashes become hyphens, uppercase unfinished-work markers are lowercased, and a code comment that reads like a statement gets a trailing period so the repo lint does not mistake it for commented-out code); nothing else was changed. Where a source still exists, the live file may be newer: re-read it, and trust the code over both.

### `docs/btn-pill-migration.md` (whole file)

~~~~markdown
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
| On-chain badge (onchain-badge.js) | `tws-ocb`, `tws-ocb--md`, `tws-ocb--devnet` | Added `pill pill--onchain/--devnet pill--md` |

---

## Remaining long tail - classes → canonical equivalent

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

## Forge page note

`pages/forge.html` defines its own inline `.btn` and `.btn-ghost` styles that shadow the canonical system within that page. To fully migrate:

1. Remove the inline `.btn` / `.btn-ghost` definitions from forge.html's `<style>` block.
2. Update forge buttons: `class="btn"` → `class="btn btn--primary"`, `class="btn btn-ghost"` → `class="btn btn--ghost"`.
3. Retain any forge-specific sizing overrides in a scoped `.forge-stage .btn { ... }` block.

## Marketplace page note

The page's bare inline `.btn-primary` / `.btn-secondary` definitions are gone; what remains are two scoped overrides in its `<style>` block (`.avatar-modal-actions .btn-primary/.btn-secondary` and `.payment-modal-success .ps-actions .btn-primary/.btn-secondary`) plus the detail-panel rules in `public/marketplace.css` (`.market-avatar-detail .btn-secondary`, `.market-tool-detail .btn-secondary`). The markup still uses the old names throughout. Migration:

1. Replace `btn-primary` → `btn btn--primary`, `btn-secondary` → `btn btn--secondary` in the markup.
2. Retain the scoped sizing/colour overrides, rewritten against the canonical classes (`.avatar-modal-actions .btn { ... }`).
3. Replace `market-empty-cta-btn.primary` → `btn btn--primary`.
~~~~

