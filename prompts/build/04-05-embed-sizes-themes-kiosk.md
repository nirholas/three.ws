# 04-05 — Embed sizing, themes, and kiosk controls

**Pillar 4 — View & embed.**

## Why it matters

Hosts embedding an agent iframe have wildly different size constraints: a 96×96 message bubble in a chat app, a 600×600 banner on a blog, a full-screen takeover. Today `public/agent/embed.html` doesn't make these cases easy — users end up shipping broken embeds with scrollbars or giant avatars.

This prompt makes the embed URL self-adapt across sizes and themes via query params, without a redeploy.

## What to build

Extend [public/agent/embed.html](../../public/agent/embed.html) to honor a small, documented query-param API:

| Param | Values | Effect |
|:---|:---|:---|
| `bg` | `transparent` (default), `dark`, `light`, `#rrggbb` | Canvas background. Arbitrary hex too. |
| `theme` | `auto`, `dark`, `light` | UI chrome (name plate, error text). `auto` follows `prefers-color-scheme`. |
| `size` | `bubble`, `card`, `banner`, `full` | Presets that tune camera distance, name plate visibility, framing. |
| `name` | `0` / `1` | Show name plate. |
| `controls` | `0` / `1` | Show orbit controls (default 0 — kiosk). |
| `autorotate` | `0` / `1` | Default 1 for bubble/card/banner; 0 for full. |
| `speed` | number (0.1–3) | Autorotate speed. |
| `expression` | emotion name or `random` | Starting emotion blend seed. |
| `cta` | url | On click, open this URL in a new tab. If unset, click does nothing. |

## Read these first

| File | Why |
|:---|:---|
| [public/agent/embed.html](../../public/agent/embed.html) | The file you're extending. Keep it small; don't promote to a module if not needed. |
| [src/agent-avatar.js](../../src/agent-avatar.js) | `setExpression` / emotion API. |
| [src/viewer.js](../../src/viewer.js) | Camera framing. `kiosk` option already exists. |
| `src/components/wallet-chip.js` (if present) | Don't mount inside the iframe — the embed is chromeless by design. |

## Build this

### 1. Parse + apply params

Inside the existing `main()`, after loading the avatar:

- Apply `size` preset first. Presets tune `camera.position.z`, `name` default, framing padding.
- Apply theme to body class (`theme-dark`, `theme-light`).
- Apply `bg`. Arbitrary hex string → set `document.body.style.background`.
- If `controls=1`, don't pass `{ kiosk: true }` to Viewer.
- Apply `autorotate` / `speed` via `viewer.controls.autoRotate` + `autoRotateSpeed`.
- Apply `expression` via `protocol.emit('emote', { trigger, weight: 0.7 })`.
- If `cta` set, make the canvas clickable — `pointer: cursor; z-index above canvas`. On click: `window.open(cta, '_blank', 'noopener,noreferrer')`.

### 2. Preset tuning

| Preset | Camera z | Name plate | Framing | Notes |
|:---|:---|:---|:---|:---|
| `bubble` | tight head shot | hidden | chest-up | intended 96–160 px iframes |
| `card` | tighter than default | visible | upper body | ~300 px |
| `banner` | medium | visible | full body | 600×600+ |
| `full` | default | visible | scene fits | full page |

### 3. Responsive to iframe size

Use `ResizeObserver` on the iframe's body to re-frame when the embedder animates the iframe dimensions. Debounce 100ms.

### 4. Keep it small

This is an embed runtime — ship the minimum. No framework. No extra bundle splits. Inline CSS for `body.theme-*` + `body.has-cta` classes. If `embed.html` crosses ~400 lines, split the logic into `public/agent/embed.js` but keep the HTML otherwise static.

### 5. Update docs + example

Add a section to [public/agent/index.html](../../public/agent/index.html) share panel: preset picker that rewrites the embed URL live. Include a size slider showing how the avatar reframes.

## Out of scope

- Do not add analytics to the embed itself (that's 04-07 if needed later).
- Do not add cross-iframe messaging beyond what's there today (that's 05-05).
- Do not ship new fonts or a design system.
- Do not re-architect the embed to be a module / web component (it's a page + script; keep it flat).

## Deliverables

**Modified:**
- [public/agent/embed.html](../../public/agent/embed.html) — accept the new params.
- [public/agent/index.html](../../public/agent/index.html) — preset picker in share panel.

**New (if split needed):**
- `public/agent/embed.js`
- `public/agent/embed.css`

## Acceptance

- [ ] `/agent/<id>/embed?size=bubble&bg=transparent` renders cleanly at 96×96 with head-shot framing.
- [ ] `/agent/<id>/embed?size=banner&bg=%23000000&theme=dark` renders black-background banner.
- [ ] `/agent/<id>/embed?cta=https://example.com` makes the canvas clickable.
- [ ] Changing the iframe dimensions via JS at runtime re-frames the avatar.
- [ ] Share panel's preset picker generates correct URLs.
- [ ] `npm run build` passes.

## Test plan

1. Paste `<iframe src="/agent/<id>/embed?size=bubble" width="96" height="96" style="border:0">` into a blank HTML file and confirm head-shot framing, no name plate.
2. Swap `size=card` at 300×300 → shoulders + name plate.
3. Swap `size=banner` at 600×600 → full body + name plate.
4. Resize an iframe from 96 → 600 via animation → avatar smoothly reframes.
5. `expression=celebrate` → avatar boots with celebration weight.
