# 05-04 — Host embed: theme sync

**Branch:** `feat/host-theme`
**Stack layer:** 5 (Host embed)
**Depends on:** 05-03

## Why it matters

When our agent embeds in Lobehub or Claude Artifacts, a black background on a white host looks broken. The host already knows its color scheme; we just need to listen for it and adapt.

## Read these first

| File | Why |
|:---|:---|
| [src/host-bridge.js](../../src/host-bridge.js) | Bridge to extend. |
| [src/viewer.js](../../src/viewer.js) | `setBackgroundColor`, `setEnvironment`. |
| [src/agent-home.js](../../src/agent-home.js) | Renders the identity card — needs to honor theme. |
| [style.css](../../style.css) | CSS tokens — verify `--bg`, `--fg`, `--accent` exist. |

## Build this

1. Extend `host:set-context` to accept `theme: 'light' | 'dark' | 'auto'` (auto = follow `prefers-color-scheme`).
2. When theme changes:
   - Toggle a `data-theme="light|dark"` attribute on the embed root.
   - Switch viewer background: dark → `#0a0a0a`, light → `#f7f7f7`.
   - Switch HDR environment to `studio-soft` (light) vs `neutral` (dark) — only if the user hasn't pinned an env in the widget config.
3. Add CSS rules under `[data-theme="light"]` overriding the dark tokens (`--bg`, `--fg`, etc.) — keep it minimal, no new design system.
4. If the host doesn't send a theme, fall back to `prefers-color-scheme`.

## Out of scope

- Do not add a per-component theme prop. Only the root attribute.
- Do not add light-mode HDRs unless one already ships — reuse what's there.
- Do not animate the theme transition (CSS handles it).

## Acceptance

- [ ] `host:set-context { theme: 'light' }` flips the root attribute and updates background within one frame.
- [ ] No flash-of-wrong-theme on initial paint when host sends `host:hello` synchronously.
- [ ] Existing dark embeds with no host messages render unchanged.
- [ ] `npm run build` passes.

## Test plan

1. From the scratch host page, send `host:set-context { theme: 'light' }` after `agent:ready`. Verify swap.
2. Toggle back to `dark`. Verify swap.
3. Send `theme: 'auto'` and toggle the OS color scheme — verify the embed follows.
