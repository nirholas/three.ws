# Task: Branded character customization side panel

## Context

Repo: `/workspaces/3D`. Task 03 vendored CharacterStudio's `CharacterManager`. This task builds the **UI** around it: a side panel for picking hair, clothing, body, skin tone, and face morphs. Fully branded, fully ours.

Depends on tasks 03, 17 (manifest / asset library).

## Goal

1. A side panel in the main app lets the user customize their avatar.
2. Every change is live-preview on the active VRM.
3. An "Apply to my avatar" button commits the change + stores it locally.
4. A "Revert" button restores the last committed state.
5. The panel matches the existing agent-panel aesthetic (dark, compact, clean).

## Deliverable

1. **New module** `src/character/editor-panel.js` exporting default class `CharacterEditorPanel`:
   - `constructor(container, characterManager)`.
   - `open()` / `close()` / `dispose()`.
2. **Sections**, rendered from the loaded manifest (task 17):
   - **Body** — body shape picker + proportion sliders (head, chest, arms — proxy to `CharacterManager.setBodyProportions`).
   - **Skin** — tone slider + swatch presets.
   - **Face** — morph-target sliders exposed by the current VRM.
   - **Hair** — grid of thumbnails; click to swap.
   - **Clothing** — top, bottom, footwear, accessories tabs.
   - **Expression test** — quick-fire buttons for `aa`, `happy`, `blink`, etc. to sanity-check expression bindings.
3. **Live preview** — every slider/click calls into `CharacterManager` synchronously; no "apply" needed for exploration.
4. **Commit + persist** — on "Save", serialize the current trait selections to IndexedDB keyed by `agentId` (task 15). On reload, the last saved state restores.
5. **Undo stack** — last 10 state changes; `cmd+Z` pops. `cmd+shift+Z` redoes.
6. **Styling** — `editor-*` CSS prefix. Collapsible side drawer; pinnable.
7. **Keyboard** — arrow keys nudge sliders; number keys 1–9 jump between sections.

## Audit checklist

- [ ] Every manifest trait group renders a section.
- [ ] Changing hair → avatar hair changes in < 200ms.
- [ ] Refresh page → saved traits reapply.
- [ ] Undo/redo works across all trait changes.
- [ ] Expression-test buttons correctly drive VRM expressions.
- [ ] Panel is keyboard-navigable end-to-end.
- [ ] `prefers-reduced-motion: reduce` → slider nudges animate instantly.
- [ ] `node --check` new files.

## Constraints

- No new frameworks (no React, Vue, Svelte). Vanilla JS, matching the rest of the codebase.
- No new design system dep (no Tailwind, no shadcn). Direct CSS only.
- Do not couple to the agent panel (task 01 rename); they should be independently usable.
- Do not ship icon packs as new deps. Inline SVG or reuse existing icons.
- Do not change `CharacterManager`'s public API — wrap, don't mutate.

## Verification

1. Full customization pass: pick hair, shirt, pants, skin tone, tweak proportions, test expression. All live-preview correctly.
2. Save, reload, state restores.
3. Undo 5 times, redo 3 times — final state consistent.
4. Open agent panel simultaneously — both panels usable without layout conflicts.
5. Small viewport (tablet size) — panel collapses into a tab bar gracefully.

## Scope boundaries — do NOT do these

- No asset uploads (user bringing their own hair mesh) — manifest-driven only.
- No marketplace / purchase UI.
- No sharing a configured avatar via URL (task 20 adds export).
- No NFT wallets.
- No server-side persistence.

## Reporting

- Screenshot or description of the final panel layout.
- Any `CharacterManager` API gaps you had to work around.
- IndexedDB schema for persisted trait state.
- Keyboard shortcut list.
- Accessibility audit (axe-core or manual): color contrast, focus order, aria labels.
