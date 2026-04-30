# Task 06 — UI: Skill Detail Panel & Ratings

## Goal
Add an expanded detail view inside the marketplace modal and a working star-rating widget.
When a user clicks a skill card, a side panel (or inline expansion) shows full details,
all tags, schema preview, author info, and lets the user leave a 1–5 star rating.

## Prerequisites
Tasks 01, 02, 03, 04, and 05 must be complete and building cleanly.

## Context
- File to edit: `/chat/src/SkillsMarketplaceModal.svelte`
- Read the entire current file before changing anything.
- API endpoints available (from Task 02):
  - `GET /api/skills/:id` — full skill including `schema_json`
  - `POST /api/skills/:id/rate` body `{ rating: 1-5 }` → `{ avg_rating, rating_count }`
- `currentUser` store from `./stores.js` — null if not signed in
- `notify` function from `./stores.js`

## Changes

### 1. SkillDetailPanel — inline expansion

When the user clicks anywhere on a skill card (not the Install/Remove button), toggle an
inline expansion directly below that card row. Only one card can be expanded at a time.

The expanded panel contains:

**Left column (60%)**
- Full description (no truncation)
- Tags as pills (styled with `bg-slate-100 text-slate-600 text-[11px] px-2 py-0.5 rounded-full`)
- Author section: "By {author.display_name}" or "By the 3D-Agent team" if system skill
- Install count + created date ("Published {relative date}")

**Right column (40%)**
- **Rating widget**: 5 stars, filled/empty based on `avg_rating`. If user is logged in and
  hasn't rated yet, the stars are interactive (hover highlights, click submits). Show current
  user's rating in a different colour if they've already rated.
  - On click: POST to `/api/skills/:id/rate`, update displayed avg/count on success.
  - If not logged in: stars are display-only with tooltip "Sign in to rate"
- Schema preview: a `<pre>` block showing the first tool's `function.name` and
  `function.description`, and a list of its parameter names. **Do not show the full schema JSON**
  (it can be large). Just a human-readable summary.
- If there are multiple tools in the schema, show "and N more tools" after the first.

**Action row** (below both columns)
- Same Install/Remove button as the card (redundant but more prominent)
- A "Copy slug" button that writes the skill slug to clipboard and shows a brief "Copied!" toast

### 2. Star rating component — extract as inline sub-component

Write the star rating logic as a `<StarRating>` component defined inline in the file using
Svelte's component syntax (not a separate file). Props:
```svelte
<!-- internal component -->
let { value, interactive, onRate } = ...
```

If Svelte 4 doesn't support `$props()`, use `export let` props.

Stars should animate on hover (scale 1.1 with CSS transition).

### 3. Relative date helper

Add a small helper function `relativeDate(isoString)` at the top of the `<script>` block:
```js
function relativeDate(iso) {
  const diff = Date.now() - new Date(iso).getTime();
  const days = Math.floor(diff / 86400000);
  if (days === 0) return 'today';
  if (days === 1) return 'yesterday';
  if (days < 30) return `${days} days ago`;
  if (days < 365) return `${Math.floor(days / 30)} months ago`;
  return `${Math.floor(days / 365)} years ago`;
}
```

### 4. Loading state for detail fetch

When a card is clicked, immediately show a skeleton loader in the expanded area while
`GET /api/skills/:id` loads. The skeleton should be a simple grey animated pulse div
(use `animate-pulse bg-slate-200 rounded` Tailwind classes).

### 5. Keyboard accessibility
- Pressing Escape while the detail panel is open should close it (not the whole modal).
- The expanded card should have `role="region"` and `aria-label="{skill.name} details"`.

## Constraints
- All changes go in `SkillsMarketplaceModal.svelte` only. No new files.
- Do not change any API files.
- Do not change `App.svelte`.

## Verification
1. Run `cd /workspaces/3D-Agent/chat && npm run build` — must pass with no errors.
2. Read back the changed file and confirm:
   - Only one card can be expanded at a time (clicking another card collapses the previous).
   - The rating POST is only triggered when the user is authenticated.
   - The "Copy slug" uses `navigator.clipboard.writeText` with a fallback.
   - The skeleton loader disappears once the detail fetch resolves.
