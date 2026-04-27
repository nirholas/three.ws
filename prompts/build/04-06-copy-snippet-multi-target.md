# 04-06 — Copy-snippet picker: iframe · web component · Claude · Lobehub

**Pillar 4 — View & embed.**

## Why it matters

The agent share panel currently offers iframe / link / `<agent-3d>` snippets. Pillar 5 adds Claude Artifact + Lobehub targets, and we'll keep adding hosts. Instead of growing a tab jungle, ship one snippet picker that switches targets and generates a ready-to-paste string for each, with size/theme presets from 04-05 composed in.

## What to build

A refactor of the share panel on [public/agent/index.html](../../public/agent/index.html) (owner view) into a **SnippetPicker** component:

- Target tabs: `iframe`, `web-component`, `claude-artifact`, `lobehub-plugin`, `link`.
- Size preset dropdown (from 04-05): bubble / card / banner / full.
- Theme dropdown: auto / dark / light.
- Transparent-bg toggle.
- Name-plate toggle.
- Output textarea with the generated snippet.
- [Copy] button with success state.
- [Open preview] button that opens a new tab with the rendered embed.

## Read these first

| File                                                     | Why                                                                                                                                                                                                     |
| :------------------------------------------------------- | :------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| [public/agent/index.html](../../public/agent/index.html) | Current share panel — replace.                                                                                                                                                                          |
| [public/agent/embed.html](../../public/agent/embed.html) | Target URL shape for the iframe snippet.                                                                                                                                                                |
| [src/element.js](../../src/element.js)                   | `<agent-3d>` attribute surface for the web-component snippet.                                                                                                                                           |
| `prompts/build/05-*.md`                                  | Drives the claude-artifact + lobehub-plugin snippet strings once that pillar ships. It's OK if those hosts' runtimes don't exist yet — the snippet picker still generates valid strings for future use. |

## Build this

### 1. Component

Create `src/components/snippet-picker.jsx` (vhtml). Signature:

```js
export function SnippetPicker({ agent, origin }) {
	// state: target, size, theme, bg, showName
	// derived: snippet string
	// returns: JSX block mountable into a container
}
```

### 2. Snippet generators

```js
function generate(target, opts) { ... }
```

| Target            | Output                                                                                                                                                                                                                                                          |
| :---------------- | :-------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `iframe`          | `<iframe src="https://<origin>/agent/<id>/embed?size=<s>&theme=<t>&bg=<bg>&name=<n>" width="<w>" height="<h>" style="border:0;background:transparent" loading="lazy"></iframe>`                                                                                 |
| `web-component`   | `<script type="module" src="https://<origin>/dist-lib/index.js"></script>\n<agent-three.ws-id="<id>" size="<s>" theme="<t>" bg="<bg>" name="<n>"></agent-3d>`                                                                                                   |
| `claude-artifact` | The single-file snippet from `05-01-claude-artifact-single-file-bundle` — refer to the target output there. If that pillar hasn't shipped, output a placeholder `<!-- Claude Artifact target not yet available -->` and disable the Copy button with a tooltip. |
| `lobehub-plugin`  | JSON plugin manifest snippet (from `05-03`). Same degrade-gracefully fallback.                                                                                                                                                                                  |
| `link`            | `https://<origin>/agent/<id>`                                                                                                                                                                                                                                   |

### 3. Preview modal

Clicking "Open preview" opens a new tab to the iframe URL with the chosen params applied. For web-component target, open `/preview/web-component?agent=<id>&...` — a tiny page in `public/preview/web-component.html` that just mounts the component at full viewport with the chosen attributes.

### 4. Copy + success state

Copy button uses `navigator.clipboard.writeText`. On success, flip label to "Copied ✓" for 2s.

Fallback if clipboard API blocked: select the textarea and show "Press ⌘/Ctrl+C".

### 5. Keep width/height editable for iframe

Iframe target shows two extra number inputs (width/height) pre-filled with size-preset defaults (96/96, 300/300, 600/600, 1000/1000). Changing them updates the generated snippet live.

## Out of scope

- Do not add target runtimes here (that's pillar 5).
- Do not add analytics on copy.
- Do not build a standalone `/share/:id` page.
- Do not change non-owner view of `/agent/:id` — this is the owner's share panel.

## Deliverables

**New:**

- `src/components/snippet-picker.jsx`
- `public/preview/web-component.html`

**Modified:**

- [public/agent/index.html](../../public/agent/index.html) — replace existing tabbed share panel with SnippetPicker.
- [public/agent/agent.js](../../public/agent/) (if present) — mount SnippetPicker.
- [style.css](../../style.css) — small additions for the picker; reuse token palette.

## Acceptance

- [ ] Share panel shows 5 target tabs (claude-artifact, lobehub-plugin may be placeholders).
- [ ] Switching targets regenerates the snippet correctly.
- [ ] Adjusting size/theme/bg updates the snippet live.
- [ ] Copy button copies exactly the visible string.
- [ ] Iframe snippet pasted into a blank HTML file at the given w/h works.
- [ ] Web-component snippet pasted into a blank HTML file (with CDN script tag) renders the agent.
- [ ] `npm run build` passes.

## Test plan

1. Owner opens their agent page → share panel → `iframe`. Paste into `test.html` → renders.
2. Switch to `web-component` → paste → renders.
3. Switch to `link` → copy → open in incognito → public agent page loads.
4. Switch to `claude-artifact` → output is either the real snippet or a clearly-disabled placeholder depending on pillar 5 status.
5. Change size to bubble → width/height shrink to 96/96 in the iframe snippet.
