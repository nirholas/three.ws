# Prompt 00 — Widget Studio Foundation

**Branch:** `feat/studio-foundation`
**Depends on:** nothing — run this first.
**Blocks:** every other widget prompt (01–07).

## Goal

Build the foundation of the Widget Studio: a new authenticated route `/studio`, a widget-type picker, a live preview panel that reuses the existing viewer, a persistence API (Neon-backed) for saving widget configs, and a public `#widget=<id>` URL-param resolver that loads a saved widget inside the existing viewer.

After this prompt ships, **no widget actually functions yet** — that is correct. This is the scaffolding the five widget prompts (01–05) will plug into.

## What you are building (one paragraph)

A signed-in user visits `/studio`. They pick one of their saved avatars (from their R2-backed avatar list) and a widget type from a grid of five cards (Turntable, Animation Gallery, Talking Agent, Passport, Hotspot Tour — only Turntable will be functional after this prompt; others render a "coming soon" placeholder). They get a live preview using the existing `Viewer` class, a shared brand-config panel (background color, accent color, caption text, kiosk controls toggle), and a "Generate Embed" button that persists config to Neon and returns a stable widget ID. A public URL like `https://3d.irish/#widget=wdgt_abc123` loads that saved config back into the viewer with no login required.

## Prerequisites

None. This prompt assumes the current codebase state as of commit `ef3b0d4`. Read the files below before writing any code.

## Read these first (do not skip)

| File | Why |
|:---|:---|
| [src/app.js](../../src/app.js) — lines 36–100, 270–340 | Understand the existing App boot sequence, URL hash parsing, `view()` method signature, and how `protocol`/`identity`/`avatar`/`runtime` are wired. You will add `hash.widget` parsing here. |
| [src/viewer.js](../../src/viewer.js) — constructor + `load()` + `setCamera()` | The `Viewer` class is what you'll render inside the Studio preview iframe. It already supports `cameraPosition`, background color, HDR environments, animations. |
| [src/account.js](../../src/account.js) | Existing client for avatar CRUD against `/api/avatars`. Mirror this pattern for widgets. |
| [api/avatars/index.js](../../api/avatars/index.js) and [api/avatars/presign.js](../../api/avatars/presign.js) | Reference implementation for an authenticated Vercel serverless CRUD endpoint backed by Neon. Follow the same auth + error conventions. |
| [api/_lib/](../../api/_lib/) | Shared helpers: auth middleware, Neon client, response helpers. Use these — do not create duplicates. |
| [public/dashboard/dashboard.js](../../public/dashboard/dashboard.js) — lines 1–90 | Dashboard's native-DOM rendering pattern. The Studio UI should follow the same style (no framework, no JSX runtime on the client — use `vhtml` if you want JSX, same as the validator components). |
| [vercel.json](../../vercel.json) | Route table. You will add `/studio` and `/api/widgets/*` routes here. |
| [style.css](../../style.css) | Existing dark theme tokens. Reuse the CSS variables and classes; do not introduce a new design system. |
| [index.html](../../index.html) | The SPA shell. You need to understand how hash params are consumed so `#widget=<id>` can hook in without breaking existing `#model=` behavior. |

Also run `ls api/_lib` and open every file in there — one of them almost certainly has `requireAuth()` or equivalent. Use it. Do not hand-roll auth.

## Build this

### 1. Database schema (Neon)

Add a new table `widgets`. Write a migration file at `api/_lib/migrations/002_widgets.sql` (match the existing naming convention — verify by running `ls api/_lib/migrations/` first and copy the numbering).

```sql
create table if not exists widgets (
  id            text primary key,                 -- wdgt_<12char>
  user_id       text not null references users(id) on delete cascade,
  avatar_id     text references avatars(id) on delete set null,
  type          text not null,                    -- turntable | animation-gallery | talking-agent | passport | hotspot-tour
  config        jsonb not null default '{}'::jsonb,
  name          text not null,                    -- user-friendly label
  is_public     boolean not null default true,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  view_count    bigint not null default 0
);

create index if not exists widgets_user_id_idx on widgets(user_id);
create index if not exists widgets_type_idx on widgets(type);
```

**Confirm the `users` and `avatars` tables exist before adding FKs.** If column names differ (e.g. `user_id` vs `owner_id`), match the existing convention instead of mine.

### 2. API endpoints (Vercel serverless)

Create the following under `api/widgets/`:

| File | Method + Path | Auth | Purpose |
|:---|:---|:---|:---|
| `api/widgets/index.js` | `GET /api/widgets` | required | List current user's widgets. |
| `api/widgets/index.js` | `POST /api/widgets` | required | Create a widget. Returns `{ id, ... }`. |
| `api/widgets/[id].js` | `GET /api/widgets/:id` | **public** | Fetch a widget config by id. If `is_public=false`, require auth + ownership. Increment `view_count`. |
| `api/widgets/[id].js` | `PATCH /api/widgets/:id` | required + owner | Update config/name/is_public. |
| `api/widgets/[id].js` | `DELETE /api/widgets/:id` | required + owner | Delete. |

ID format: `wdgt_` + 12 URL-safe random chars (use `crypto.randomBytes(9).toString('base64url')` and verify the length — 9 bytes → 12 base64url chars).

Add matching entries to `vercel.json` (mirror how `/api/avatars` routes are wired).

Validation: use `zod` (already in deps) to validate request bodies. Reject unknown widget `type` values.

### 3. Client-side persistence helper

Create `src/widgets.js` — a small ESM module that mirrors `src/account.js`. Exports:

```js
export async function listWidgets();
export async function getWidget(id);              // public, no credentials
export async function createWidget({ type, name, avatar_id, config, is_public });
export async function updateWidget(id, patch);
export async function deleteWidget(id);
```

All write calls use `credentials: 'include'`. Error handling mirrors `account.js`.

### 4. Widget config schema

Create `src/widget-types.js`. Defines:

```js
export const WIDGET_TYPES = {
  'turntable':         { label: 'Turntable Showcase',  status: 'ready',   icon: '...', desc: '...' },
  'animation-gallery': { label: 'Animation Gallery',    status: 'pending', icon: '...', desc: '...' },
  'talking-agent':     { label: 'Talking Agent',        status: 'pending', icon: '...', desc: '...' },
  'passport':          { label: 'ERC-8004 Passport',    status: 'pending', icon: '...', desc: '...' },
  'hotspot-tour':      { label: 'Hotspot Tour',         status: 'pending', icon: '...', desc: '...' },
};

// Shared brand config present on every widget
export const BRAND_DEFAULTS = {
  background: '#0a0a0a',
  accent:     '#00e5a0',
  caption:    '',
  showControls: true,
  autoRotate:   true,
  envPreset:    'neutral',
  cameraPosition: null,  // [x, y, z] or null for auto-frame
};

export function defaultConfig(type) { /* returns { ...BRAND_DEFAULTS, ...typeSpecificDefaults[type] } */ }
export function validateConfig(type, config) { /* zod parse, throws on invalid */ }
```

`status: 'ready'` on type `turntable` only (per run order — the Turntable prompt will flip more to `ready` as they ship).

### 5. The `/studio` route

Create `public/studio/index.html` and `public/studio/studio.js` — mirror the layout of `public/dashboard/`. Add these rewrites to `vercel.json`:

```
{ "src": "/studio",       "dest": "/public/studio/index.html" },
{ "src": "/studio/",      "dest": "/public/studio/index.html" },
{ "src": "/studio/(.*)",  "dest": "/public/studio/$1" },
```

**Auth gate:** On page load, call `/api/auth/me`. If not signed in, redirect to `/login?return=/studio`.

**Layout (three-column):**

```
┌────────────────┬────────────────────────────┬────────────────┐
│ 1. Pick avatar │ 2. Live preview (iframe)   │ 3. Config      │
│    (list of    │    of existing viewer      │    (brand +    │
│    user's R2   │    with current config     │    type-specific│
│    avatars)    │                            │    fields)     │
│                │                            │                │
│ 2. Pick type   │                            │                │
│    (5 cards)   │                            │ [Save]         │
│                │                            │ [Generate]     │
└────────────────┴────────────────────────────┴────────────────┘
```

Column 1 calls `api.listAvatars()` (reuse `dashboard.js`'s `api`). Thumbnail cards — clicking sets `state.avatar_id`.

Column 2 is an `<iframe src="/?widget-preview=1#model=<model_url>&kiosk=true&...">` that reloads whenever config changes (debounce 200ms). **Do not build a second viewer.** Reuse the existing one via URL hash params. To apply brand colors, post a message to the iframe (next section).

Column 3 is a form. All changes update in-memory state and trigger the debounced preview reload. Fields:
- **Name** (text, required)
- **Background color** (color picker)
- **Accent color** (color picker)
- **Caption** (text, optional — rendered as overlay)
- **Show controls** (toggle)
- **Auto rotate** (toggle)
- **Environment** (select: none, neutral, venice-sunset, footprint-court)
- **Camera** — "Use current view" button that captures `viewer.activeCamera.position` and stores it. (Read from `window.VIEWER.viewer.activeCamera` via `iframe.contentWindow.VIEWER`.)
- **Type-specific fields** — for `turntable`, just rotation speed. For others, show a placeholder "Configured by Widget 0X — coming soon."

Below the form:
- **[Save Draft]** button → `createWidget()` or `updateWidget()` if editing.
- **[Generate Embed]** button → saves, then opens a modal with:
  - Live preview
  - Shareable URL: `https://<host>/#widget=<id>`
  - Iframe snippet (600x600 default, editable dimensions)
  - One-line script snippet: `<script async src="https://<host>/embed.js" data-widget="<id>"></script>` (stub script file — create `public/embed.js` that just creates an iframe for now)
  - "Show HTML" disclosure showing the raw snippet
  - Copy-to-clipboard buttons

### 6. `postMessage` bridge between Studio and preview iframe

The Studio parent sends live config updates to the preview iframe without a full reload. In `src/app.js`, add a message listener that accepts `{ type: 'widget:config', config }` and applies:
- Background color → `viewer.setBackgroundColor(config.background)` (add this method to `Viewer` if missing — it already supports background color via dat.gui, so the logic exists).
- Auto-rotate → `viewer.controls.autoRotate = config.autoRotate`.
- Env preset → `viewer.setEnvironment(preset)` (already exists).
- Controls visibility → toggle header/GUI via the existing `kiosk` pattern.

The Studio calls `iframe.contentWindow.postMessage({ type: 'widget:config', config }, location.origin)` on every debounced config change. Fall back to a full iframe reload if the bridge hasn't initialized yet.

**Security:** verify `event.origin === location.origin` in the listener.

### 7. Public widget resolver (the critical integration)

In `src/app.js`, after parsing the hash:

```js
if (hash.widget) {
  const widget = await getWidget(hash.widget);   // public endpoint
  // Apply widget.config to this.options before any viewer work:
  //   - model URL comes from widget.avatar.model_url (server-joined or second fetch)
  //   - cameraPosition, background, etc. from config
  // Then proceed with normal view() flow.
  // Also expose widget.type so later prompts can branch on it:
  window.VIEWER.widget = widget;
}
```

Extend the widget GET endpoint so it returns the joined avatar row (`model_url`, `name`, `thumbnail_url`) so the client only makes one round-trip.

If the widget id is unknown, show an in-page error: "Widget not found." Do not redirect.

### 8. Ship nothing else

- Do **not** implement the Turntable-specific runtime logic (that's Prompt 01).
- Do **not** build the Widgets dashboard tab (that's Prompt 06).
- Do **not** register anything on-chain. Do **not** touch the MCP server.
- Do **not** change the default behavior when no `#widget=` is present. Every existing URL pattern must still work.

## Do not do this

- Do not introduce React, Tailwind, or TypeScript.
- Do not rewrite `Viewer` or `App`. Extend them minimally.
- Do not duplicate auth logic — reuse the helper in `api/_lib/`.
- Do not create a mock mode. If the Neon connection fails locally, document how to run Neon in dev (probably via `DATABASE_URL` env var — check how `api/avatars` does it).
- Do not hardcode the production domain. Use `location.origin` client-side and `req.headers.host` (or Vercel env vars) server-side.
- Do not ship the widget type cards as unclickable placeholders. "Coming soon" types should be *clickable* and render a Studio form with a banner saying "This widget type isn't functional yet — you can save the config; the runtime will light up when its prompt ships." The config still saves and round-trips.

## Deliverables (exact file list)

**New:**
- `api/_lib/migrations/002_widgets.sql` (or next available number — verify first)
- `api/widgets/index.js`
- `api/widgets/[id].js`
- `src/widgets.js`
- `src/widget-types.js`
- `public/studio/index.html`
- `public/studio/studio.js`
- `public/studio/studio.css` (or extend `style.css` if it makes more sense)
- `public/embed.js` (stub iframe-injector script)

**Modified:**
- `src/app.js` — add `hash.widget` handling + postMessage listener
- `src/viewer.js` — add `setBackgroundColor()` if not already exposed as a public method
- `vercel.json` — add `/studio`, `/api/widgets`, `/api/widgets/*` routes
- `package.json` — no new deps should be needed; if you add one, justify it in the PR description

## Acceptance criteria

You are done when **all** of these are true:

- [ ] Signed-out user hitting `/studio` is redirected to `/login?return=/studio`.
- [ ] Signed-in user sees their R2 avatars in column 1 and five widget-type cards in column 2 picker.
- [ ] Selecting an avatar + `turntable` + adjusting brand fields updates the live preview in under 500ms of input idle.
- [ ] Clicking "Save Draft" persists the widget and shows a success toast. Reloading the page with `?edit=<id>` (or similar deep-link) loads the saved config back.
- [ ] Clicking "Generate Embed" opens a modal with a working `https://<host>/#widget=<id>` URL.
- [ ] Opening that URL in a **signed-out** private window loads the model with the saved camera, background, env, and caption applied. No errors in the console.
- [ ] `view_count` increments on each public load of the widget URL.
- [ ] Every existing URL (`#model=...`, bare `/`) still works unchanged.
- [ ] No new framework dependency appears in `package.json`.
- [ ] `npm run build` completes without errors.
- [ ] Lighthouse accessibility score on `/studio` ≥ 90. (Run it in Chrome devtools.)

## Test plan

1. `npm run dev`. Open `http://localhost:3000/studio` in a signed-out browser. Verify redirect to `/login`.
2. Sign in. Return to `/studio`. Verify your avatars load.
3. Pick an avatar, pick Turntable, change background to hot pink. Preview updates.
4. Click "Use current view" after orbiting — preview persists that camera.
5. Save draft. Refresh. Verify it re-loads the draft.
6. Generate embed. Copy the URL. Paste in a private window. Verify:
   - Model loads.
   - Background, camera, env are applied.
   - No dat.gui panel if `showControls=false`.
7. Deliberately break: visit `/#widget=wdgt_does_not_exist`. Verify graceful error, not a crash.
8. Open `public/embed.js` snippet in an HTML scratch file. Verify it injects an iframe.
9. `npm run build && npm run dev` — confirm production build works.

## When you finish

- Commit to `feat/studio-foundation`.
- Open a PR with a screenshot of the Studio UI and the public widget URL working in an incognito window.
- Ping: "Studio foundation shipped. 01–05 are unblocked."
