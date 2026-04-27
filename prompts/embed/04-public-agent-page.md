# 04 — Public `/agent/:id` page polish

## Why it matters

This is the canonical URL a user shares when they want the world to see their agent. It needs to load fast, render confidently, and expose "how to embed" without burying it.

## Context

- Current page: [public/agent/index.html](../../public/agent/index.html), [public/agent/embed.html](../../public/agent/embed.html).
- Metadata: [api/agent-og.js](../../api/agent-og.js), [api/agent-oembed.js](../../api/agent-oembed.js).
- URL scheme: `/agent/:id` → renders the agent. The id is a UUID owned by `agent_identities`.

## What to build

### Metadata

- `<title>` — "{{name}} · three.ws".
- `<meta name="description">` — agent's description or fallback.
- Open Graph + Twitter card: image (OG endpoint), URL, title, description. See existing `api/agent-og.js`.

### Above-the-fold

- Viewer canvas takes the full viewport on mobile, 70% on desktop.
- Below: the agent name + a 2-line description + three compact action buttons:
    - **Chat** — opens the Nich agent chat drawer.
    - **Embed** — opens a modal with an iframe snippet and `<agent-3d id="…">` snippet.
    - **Share** — uses `navigator.share` if available, else copies the page URL.
- Owner-only: a "Manage" button linking to the edit panel.

### Embed modal content

```html
<script src="https://three.ws/dist/lib.js" defer></script>
<agent-3d id="{{agentId}}" style="width:100%; height:500px"></agent-3d>
```

Plus iframe fallback:

```html
<iframe
	src="https://three.ws/agent/{{agentId}}?kiosk=1"
	width="100%"
	height="500"
	allow="accelerometer; gyroscope; camera"
	style="border:0"
></iframe>
```

Copy-to-clipboard buttons for each.

### Not-found

- Unknown `:id` → render "Agent not found" card with a link back to `/`. Do NOT serve default CZ avatar.

## Out of scope

- Comments / reactions.
- Follow system.
- Sharing to specific platforms (Twitter share link).
- Auth-gated views of private agents — all `/agent/:id` are public in v1.

## Acceptance

1. Open `/agent/<valid-id>` on mobile and desktop → loads within 2s, renders correctly.
2. Share modal copies the page URL.
3. Embed modal snippets paste + render correctly on a blank `.html` scratchpad.
4. Open graph meta renders in a Slack / Twitter preview (verify via Twitter card validator or visual paste).
5. `/agent/<unknown-id>` → not-found card.
6. `npx vite build` passes.
