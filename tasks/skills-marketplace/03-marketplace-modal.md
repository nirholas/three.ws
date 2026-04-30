# Task 03 — UI: SkillsMarketplaceModal.svelte

## Goal
Build a Svelte modal component for the skills marketplace. It lives at
`/chat/src/SkillsMarketplaceModal.svelte`. When done, users can browse community skills,
search/filter by category, install/uninstall, rate, and publish their own skills — all from
within the chat UI.

## Prerequisites
Tasks 01 and 02 must be complete (DB + API exist and are functional).

## Context
- Framework: Svelte 4 (not SvelteKit — plain Svelte components)
- Styling: Tailwind CSS utility classes (same as the rest of the chat UI)
- Existing components to study and reuse:
  - `/chat/src/Modal.svelte` — base modal wrapper, `export let open = false`
  - `/chat/src/ToolPackModal.svelte` — current (simple) tool pack modal — read it fully; the
    new component replaces the behaviour but not the file
  - `/chat/src/Button.svelte` — read it
  - `/chat/src/stores.js` — `toolSchema` (persisted writable of tool group array), `currentUser`,
    `notify()` — read the full file
- The `toolSchema` store shape: an array of `{ name: string, schema: ToolDef[] }`.
  Each `ToolDef` matches the shape in `/chat/src/tools.js`.
- API base: `/api/skills/` (built in Task 02).
- This component does NOT import from `tools.js` — it fetches from the API instead.

## Component spec

### Props
```svelte
export let open = false; // bind:open from parent
```

### State (internal)
- `view`: `'browse' | 'publish'` — tabs at the top
- `skills`: array of skill objects from the API
- `loading`: boolean
- `searchQuery`: string (debounced, 300ms)
- `selectedCategory`: string | null
- `categories`: string[] derived from loaded skills
- `page`: cursor string for pagination
- `hasMore`: boolean
- `publishForm`: `{ name, slug, description, category, tags, schemaText, isPublic }`
- `publishError`: string | null
- `publishLoading`: boolean

### Layout

#### Header
- Tab bar: "Browse" | "Publish" — switching sets `view`
- Close button (calls `open = false`)

#### Browse view
Left sidebar (~180px wide on desktop, collapsible to icons on narrow):
- "All" category + dynamic list of categories from loaded skills
- Show install count next to each category

Main panel:
- Search input at top (debounced)
- Sort dropdown: Popular | Newest | A–Z
- Skill card grid (2 cols desktop, 1 col mobile). Each card:
  - Name + category badge
  - Description (truncated at 2 lines)
  - Install count + avg rating (⭐ n.n, or "No ratings yet")
  - Author name (or "System" if null)
  - **Install / Remove button** — calls `/api/skills/:id/install` (POST) or DELETE
    - Optimistically toggles, rolls back on error
    - On install: appends the skill's `schema_json` to `toolSchema` store as `{ name, schema }`
    - On uninstall: removes from `toolSchema` by name match
  - Clicking anywhere else on the card opens an inline expanded view (below the card row)
    showing full description, tags, and a 1–5 star rating widget.

Load more: "Load more" button at bottom (fetches next page using cursor).

#### Publish view
A form to publish a new skill:
- Name input
- Slug input (auto-derived from name, editable, shows live preview: `/skills/{slug}`)
- Description textarea
- Category input (text, with datalist suggestions from existing categories)
- Tags input (comma-separated, shown as pills)
- Schema editor: a `<textarea>` pre-filled with a JSON starter template
  (one tool entry matching the ToolDef shape). Monospace font.
  Below it, a "Validate JSON" button that parses and shows a green checkmark or red error.
- Public/Private toggle
- Submit button — POST to `/api/skills`

On success: switch to Browse view, show a success notification via `notify()`, scroll to
the new skill.

### Error handling
- API errors: show inline error message (not modal) next to the failing action
- Auth required: if `$currentUser` is null, show "Sign in to install skills" inline — no redirect

### No external dependencies
Do not import any library not already in `/chat/package.json`. Use native `fetch`.

## File to create
`/chat/src/SkillsMarketplaceModal.svelte`

## Verification
1. Read back the file and confirm it is valid Svelte 4 syntax.
2. Confirm `toolSchema` is correctly imported from `./stores.js` and updated on install/uninstall.
3. Confirm the Publish form auto-derives slug from name (lowercase, replace spaces with `-`,
   strip non-alphanumeric except `-`).
4. Confirm no hardcoded skills — all data comes from the `/api/skills` fetch.
5. Confirm the component compiles (run `cd /workspaces/3D-Agent/chat && npm run build` and fix
   any errors before declaring done).
