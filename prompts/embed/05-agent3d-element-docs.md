# 05 — `<agent-3d>` element attribute docs + defaults audit

## Why it matters

`<agent-3d>` is the public embed primitive. A partner (Lobehub, Claude artifact) needs to be able to paste it with zero ceremony and have it just work. Today the attribute surface is scattered across [src/element.js](../../src/element.js) and implicit defaults — making integration error-prone.

## Context

- Element source: [src/element.js](../../src/element.js).
- Spec doc: [specs/EMBED_SPEC.md](../../specs/EMBED_SPEC.md) (already exists — update, don't replace).
- Existing attributes include: `agent-id`, `model`, `eager`, `kiosk`, `brain`, `proxy-url`, likely others.

## What to build

### Attribute audit

Read [src/element.js](../../src/element.js) + [specs/EMBED_SPEC.md](../../specs/EMBED_SPEC.md). List every attribute the element reads. For each:
- Name (kebab-case as attribute, camelCase as property).
- Accepted values + type.
- Default when absent.
- Whether it can change after mount (`attributeChangedCallback`).

### Spec update

Rewrite the attribute table in [specs/EMBED_SPEC.md](../../specs/EMBED_SPEC.md). Add these sections if missing:
- **Loading** — `eager` vs IntersectionObserver lazy-load.
- **Kiosk vs interactive** — `kiosk` hides all chrome.
- **Brain** — `brain="none"` (pattern match) vs `brain="anthropic"` + `proxy-url`.
- **Sizing** — must set `width`/`height` via CSS; the element does not size itself.
- **CSP** — required `connect-src` entries when the host enforces CSP.

### Defaults alignment

Check that `element.js` defaults match the spec. Fix mismatches by updating the code to match the spec (the spec is the contract). Do NOT fix the spec to match the code unless the code's default is obviously more correct — flag it in your report if you do.

### Example gallery

Add two new worked examples to [specs/EMBED_SPEC.md](../../specs/EMBED_SPEC.md):
- Minimum embed (just `agent-id`).
- Kiosk with a custom brain proxy.

## Out of scope

- New attributes (those need a separate spec change).
- Runtime changes to the brain/runtime loop.
- React/Vue wrappers.

## Acceptance

- Every attribute in the code is documented in the spec and vice versa.
- Spec's default values match the code.
- The two new examples paste + work on a blank HTML scratchpad.
- `node --check src/element.js` passes. `npx vite build` passes.
