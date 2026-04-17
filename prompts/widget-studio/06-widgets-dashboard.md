# Prompt 06 — My Widgets Dashboard

**Branch:** `feat/widgets-dashboard`
**Depends on:** Prompt 00 merged. Ideally at least Prompt 01 as well so there's a functioning widget type to list.
**Parallel with:** nothing — run after the widget prompts settle.

## Goal

Add a "Widgets" tab to the existing `/dashboard` so users can manage their saved widgets: list them with live thumbnails, edit, duplicate, delete, toggle public/private, see view counts, copy embed snippets, and see per-widget chat stats (for Talking Agent widgets from Prompt 03).

This is the admin UI that makes the Studio worth using repeatedly.

## Prerequisites

- Prompt 00 merged (provides `GET /api/widgets`).
- At least one widget type is functional.

## Read these first

| File                                                                 | Why                                                                     |
| :------------------------------------------------------------------- | :---------------------------------------------------------------------- |
| [public/dashboard/dashboard.js](../../public/dashboard/dashboard.js) | Existing dashboard code. Native DOM, no framework. Follow this pattern. |
| [public/dashboard/index.html](../../public/dashboard/index.html)     | Layout + CSS. You'll add a new sidebar entry.                           |
| `api/widgets/index.js` (from Prompt 00)                              | List/create endpoints.                                                  |
| `api/widgets/[id].js` (from Prompt 00)                               | Update/delete endpoints.                                                |
| Prompt 03's `api/widgets/[id]/chat.js` + telemetry (if shipped)      | Source for chat stats.                                                  |

## Build this

### 1. New tab registration

In `dashboard.js`:

```js
const tabs = {
	avatars: renderAvatars,
	upload: renderUpload,
	widgets: renderWidgets, // NEW
	keys: renderKeys,
	mcp: renderMcp,
	billing: renderBilling,
};
```

Add the sidebar link in `index.html` with appropriate label and matching `data-tab="widgets"`.

### 2. API client extensions

In the `api` object in `dashboard.js`:

```js
listWidgets: () => j('GET', '/api/widgets'),
getWidget:   (id) => j('GET', `/api/widgets/${id}`),
patchWidget: (id, patch) => j('PATCH', `/api/widgets/${id}`, patch),
deleteWidget:(id) => j('DELETE', `/api/widgets/${id}`),
duplicateWidget: (id) => j('POST', `/api/widgets/${id}/duplicate`),
widgetStats: (id) => j('GET', `/api/widgets/${id}/stats`),
```

Add the duplicate + stats endpoints on the server side:

- `POST /api/widgets/:id/duplicate` — copies the widget with `name = "${original.name} (copy)"`, returns the new widget.
- `GET /api/widgets/:id/stats` — returns `{ view_count, chat_count (if applicable), last_viewed_at, recent_views_7d }`. Chat stats come from Prompt 03's telemetry; view stats come from the `view_count` column and a log table (add a `widget_views` table if you want per-day granularity; otherwise show view_count only).

### 3. Widgets tab UI

```js
async function renderWidgets(root) {
	root.innerHTML = `
    <div class="widgets-header">
      <h1>Your widgets</h1>
      <p class="sub">Embeddable 3D experiences — each gets a stable URL.</p>
      <a class="btn-primary" href="/studio">+ New widget</a>
    </div>
    <div id="widget-list" class="cards"></div>
  `;
	// Fetch, render each as widgetCard().
	// Empty state: "No widgets yet. Create your first in the Studio."
}

function widgetCard(w) {
	// Each card:
	// - Live preview iframe (lazy-loaded on IntersectionObserver)
	//   src="/#widget=${w.id}&kiosk=true" — small fixed size, no controls.
	// - Title (editable inline — double-click to edit).
	// - Widget type pill with colored icon.
	// - Stats: view count, "updated X ago."
	// - Public/private toggle.
	// - Actions: Edit (→ /studio?edit=<id>), Duplicate, Copy URL, Copy iframe, Delete (with confirm).
	// - Expander: "Show embed code" reveals snippets.
}
```

### 4. Details drawer

Clicking a card opens a slide-in panel with:

- Larger preview.
- Full config JSON (read-only, collapsible).
- Stats: views over last 7 days (sparkline if possible), chat messages (for talking-agent).
- Embed snippets (iframe, one-line script, deep link).
- Danger zone: delete.

The sparkline doesn't need to be fancy — a small inline SVG with data from `recent_views_7d`.

### 5. Inline rename

Double-click the title → converts to `<input>`. Blur or Enter saves via `patchWidget(id, { name })`. Escape cancels.

### 6. Bulk actions (stretch)

Multi-select via checkbox on each card. Actions bar appears at the top with "Delete selected", "Toggle public/private for selected." Skip this if it feels like scope creep — better to ship polished single-item actions than rushed bulk ones.

### 7. Sorting + filtering

- **Sort by:** Recently updated (default), Most viewed, Name A–Z.
- **Filter by type:** dropdown showing all widget types.
- **Search:** text box filters on name.

Persist sort/filter in localStorage.

### 8. Empty state

If `api.listWidgets()` returns `[]`:

```
┌────────────────────────────────────┐
│  No widgets yet.                   │
│                                    │
│  Your widgets are embeddable 3D    │
│  experiences — pick an avatar,     │
│  a type, and we handle the rest.   │
│                                    │
│  [+ Create your first widget]      │
└────────────────────────────────────┘
```

Button links to `/studio`.

### 9. Share modal

"Copy iframe" opens a small modal with:

- Size presets (small 320×320, medium 600×600, banner 1200×400, custom).
- Live iframe preview.
- Copy button.
- "Report this widget" link (mailto, low-effort — just so public embed consumers have a path).

### 10. Permissions / visibility

- Toggle `is_public` — a simple switch. Confirms on disabling if the widget is currently embedded somewhere (show a warning: "Making this private will break any existing embeds.")
- Non-public widgets can still be previewed in the dashboard because the owner is authenticated.

## Do not do this

- Do not introduce a new UI framework.
- Do not duplicate the Studio's editing UI in the dashboard — editing still happens in `/studio`.
- Do not build analytics beyond counts + sparkline. A full analytics page is a separate product.
- Do not support transferring a widget to another user in v1.
- Do not auto-delete widgets when the source avatar is deleted — the `on delete set null` FK lets the widget survive; show "Avatar unavailable" and let the owner pick a replacement via edit.

## Deliverables

**New (server):**

- `api/widgets/[id]/duplicate.js`
- `api/widgets/[id]/stats.js`
- Optional: `api/_lib/migrations/NNN_widget_views.sql` if you add per-day granularity.

**Modified:**

- `public/dashboard/dashboard.js` — new tab + API calls + UI.
- `public/dashboard/index.html` — sidebar link + any new CSS classes.
- `vercel.json` — new routes for duplicate and stats.

## Acceptance criteria

- [ ] Signed-in user sees "Widgets" tab in `/dashboard` sidebar.
- [ ] Clicking shows a grid of the user's widgets with live previews.
- [ ] Empty state renders when user has no widgets.
- [ ] Inline rename works (double-click, Enter saves).
- [ ] Public/private toggle persists and respects the warning.
- [ ] Duplicate creates a new widget; dashboard refreshes.
- [ ] Delete asks for confirmation; removes the widget.
- [ ] "Copy URL" and "Copy iframe" both populate the clipboard.
- [ ] Sort and filter persist across page reloads.
- [ ] Details drawer shows stats including sparkline.
- [ ] All actions work with keyboard only.
- [ ] Lighthouse accessibility ≥ 90.
- [ ] No console errors.

## Test plan

1. As a user with zero widgets → empty state renders.
2. Create a turntable in Studio → return to dashboard → card appears.
3. Rename inline. Refresh. Name persists.
4. Duplicate. Two cards show.
5. Toggle one to private. Open its URL in incognito → "Widget is private" error (this requires Prompt 00's auth check to be correct — verify).
6. Delete one. Confirm dialog. Card removes with fade.
7. Create 10 widgets. Sort by name, by views. Filter by type. Search.
8. Open details drawer. Sparkline renders with 7 days of data (even if 0 — show "No views yet").
9. Visit a Talking Agent widget 3 times, chat twice. Stats update (may lag on polling cadence).
10. Keyboard-only navigation — all actions reachable.
11. `npm run build` succeeds.

## When you finish

- PR with screenshots of: empty state, full grid, details drawer.
- Confirm the dashboard's other tabs (avatars, keys, mcp, billing) still work exactly as before.
