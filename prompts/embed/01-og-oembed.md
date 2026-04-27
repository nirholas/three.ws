# Task 01 — Link unfurl: OG image + oEmbed for `/agent/:id`

## Why this exists

When anyone pastes an agent URL like `https://three.ws/agent/ab12cd` into Slack, X, Discord, iMessage, or Notion, it should unfurl into a rich card with a thumbnail of the avatar, the agent's name, and its description. Today it shows the generic site favicon. That is the single highest-leverage discovery surface for embodied agents — fix it.

## Shared context

- Routes already exist: `/agent/:id` (home card) and `/agent/:id/embed` (bare avatar). Do not change those.
- [public/agent/index.html](../../public/agent/index.html) is the HTML shell the home route renders. It currently has static `<title>Agent Home — three.ws</title>` and no OG / Twitter / oEmbed meta tags.
- The share panel on that page is already built and works. You only need to improve what link-previewers see — do not touch the share-panel UI.
- Agent records are fetched via `GET /api/agents/:id` → `{ agent: { id, name, description, avatar_id, ... } }` (see [api/agents/[id].js](../../api/agents/[id].js)).
- Avatar records: `GET /api/avatars/:id` → `{ avatar: { url, thumbnail_url, ... } }`. Use `thumbnail_url` if present; otherwise render the OG image from the GLB (see "OG image implementation" below).
- HTTP helpers: [api/\_lib/http.js](../../api/_lib/http.js) exports `cors`, `json`, `error`, `wrap`, `method`.
- Avatar helpers: [api/\_lib/avatars.js](../../api/_lib/avatars.js) exports `getAvatar`, `resolveAvatarUrl`.

## What to build

### 1. `GET /api/agent/:id/og` → PNG (1200×630)

New file: `api/agent-og.js`.

- If the avatar record has a `thumbnail_url`, 302 redirect to it with `Cache-Control: public, max-age=3600`. Done — that's the happy path.
- If no thumbnail exists, respond with a minimal SVG-as-PNG card rendered server-side: dark background (`#0b0d10`), agent name large, description small, a small `◎` glyph. Use `Content-Type: image/svg+xml` (Slack/X/Discord accept SVG for OG images) — **do not** pull in a canvas or image-processing dependency. Wrap in `wrap()` and support `OPTIONS` via `cors()`.
- If the agent doesn't exist, return 404 with a placeholder SVG that says "Agent not found".
- Cache header: `public, max-age=3600, s-maxage=86400`.

### 2. `GET /api/oembed?url=<agent-url>[&format=json]` → oEmbed JSON

New file: `api/agent-oembed.js`.

- Spec: https://oembed.com/ — type `rich` with an HTML payload that is a sandboxed iframe pointing at `/agent/:id/embed`.
- Required fields: `type`, `version: "1.0"`, `provider_name: "three.ws"`, `provider_url`, `title`, `html`, `width`, `height`, `thumbnail_url`, `thumbnail_width`, `thumbnail_height`, `author_name` (agent name).
- Validate `url` is on the same origin and matches `/agent/[A-Za-z0-9_-]+` — reject otherwise with 404.
- If `format=xml`, return oEmbed XML. Otherwise JSON. Default JSON.
- Cache header: `public, max-age=900`.

### 3. Head-tag injection on `/agent/:id`

Edit [public/agent/index.html](../../public/agent/index.html) — **only inside `<head>`**, do not touch `<body>` or scripts.

Add these tags. Use placeholder `__AGENT__` tokens for any per-agent values — then in the existing `<script type="module">` block's `main()` function, after `identity.load()`, write a helper that mutates the relevant `<meta>` / `<link>` elements from `identity.name`, `identity.description`, and the known agent id. **Scope your edit to adding a single helper call at the end of the existing `main()` function plus the new `<head>` tags. Do not refactor the surrounding script.**

```html
<!-- unfurl (populated at runtime from identity) -->
<meta property="og:type" content="website" />
<meta property="og:title" content="Agent" id="og-title" />
<meta property="og:description" content="An embodied three.ws." id="og-description" />
<meta property="og:image" content="" id="og-image" />
<meta property="og:url" content="" id="og-url" />
<meta name="twitter:card" content="summary_large_image" />
<meta name="twitter:title" content="Agent" id="tw-title" />
<meta name="twitter:description" content="" id="tw-description" />
<meta name="twitter:image" content="" id="tw-image" />
<link
	rel="alternate"
	type="application/json+oembed"
	href=""
	id="oembed-link"
	title="Agent oEmbed"
/>
```

In the runtime helper, populate every `id` above once identity loads. `og:image` and `twitter:image` → `/api/agent/{id}/og`. `og:url` → `location.href`. `oembed-link.href` → `/api/oembed?url=<encoded agent url>`.

### 4. Route wiring

Edit [vercel.json](../../vercel.json). Add these two lines **immediately after** the `"src": "/api/agent-memory"` line (line ~27), so they live with the other `/api/agent-*` routes:

```json
{ "src": "/api/agent/([^/]+)/og", "dest": "/api/agent-og?id=$1" },
{ "src": "/api/oembed",           "dest": "/api/agent-oembed" },
```

Do not touch any other route.

## Files you own (create / edit)

- Create: `api/agent-og.js`, `api/agent-oembed.js`
- Edit: `public/agent/index.html` (`<head>` + one helper added to `main()`), `vercel.json` (two route adds)

## Files off-limits (other tasks are editing these)

- `src/element.js`, `src/agent-resolver.js` — owned by task 02
- `public/agent/embed.html`, `api/agents/[id]/embed-policy.js`, anything under `public/dashboard/` — owned by task 03
- The `<body>` of `public/agent/index.html` (share panel) — already built, do not edit

## Acceptance test

1. `node --check api/agent-og.js api/agent-oembed.js` passes.
2. `npx vite build` — note result.
3. Manual URL checks (report the response shape):
    - `GET /api/agent/SOMEID/og` → 200 image or 302 to thumbnail.
    - `GET /api/oembed?url=http://localhost:3000/agent/SOMEID` → 200 JSON with `html` containing an iframe pointing at `/agent/SOMEID/embed`.
    - `GET /agent/SOMEID` → `<head>` contains populated `og:image` with `/api/agent/SOMEID/og`.
4. Paste a real agent URL into https://www.opengraph.xyz/ or Slack's link-preview debugger and confirm the card renders (manual — flag if you can't test this).

## Reporting

Report:

- Files created and line counts
- Files edited with which sections touched
- `node --check` / `vite build` results
- Any unrelated bugs noticed
- Any deviation from the spec above, with reasoning
