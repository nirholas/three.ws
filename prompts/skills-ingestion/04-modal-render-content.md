# Step 4 — Modal: render markdown content, install/uninstall content skills

Working directory: `/workspaces/3D-Agent`. Read `/workspaces/3D-Agent/CLAUDE.md` first.

## Prerequisites

Steps 1, 2, 3 applied. Verify a content skill is reachable via API:

```bash
curl -s 'http://localhost:3000/api/skills?category=defi&limit=1' | jq '.skills[0]'
```

Must show `has_content: true`.

## File to modify

`chat/src/SkillsMarketplaceModal.svelte` (~1014 lines). Read the whole file before editing — this modal is the production marketplace UI. The relevant areas:

- Line 10: `let skills = []` — listing state.
- Line 90-91: `isInstalled(skill)` — checks `$toolSchema` (works for tool-pack skills).
- Line 124-143: list fetch from `/api/skills`.
- Line 182-225: `toggleInstall(skill, e)` — POST/DELETE `/api/skills/<id>/install` and updates `$toolSchema`.
- Line 228+: `toggleExpand(skill)` — fetches detail.

## Task

Make the modal handle both kinds of skills:

### A. New store for installed content skills

Add a new persisted store in `chat/src/stores.js` next to `toolSchema` (line 63):

```js
// Installed content skills: [{ id, name, slug, content }]
export const knowledgeSkills = persisted('knowledgeSkills', []);
```

Do NOT remove or rename `toolSchema`.

### B. Update `isInstalled` in the modal

A skill is installed if it appears in `$toolSchema` (tool-pack) OR `$knowledgeSkills` (content). Distinguish by what the API returns:

- Tool-pack skill: `schema_json` is non-null array.
- Content skill: `content` is non-null string (and `schema_json` is null).

### C. Update `toggleInstall`

When installing:
- If detail (or list row) has tools → push to `$toolSchema` exactly as today.
- If detail has content → push `{ id, name, slug, content }` to `$knowledgeSkills`.
- The install API call (`POST /api/skills/<id>/install`) is unchanged. The response from step 2 now includes `content`; use it.

When uninstalling: remove from whichever store it's in.

The existing optimistic update + rollback pattern (lines 184-225) must be preserved. Both stores should be updated in the same optimistic/rollback flow.

### D. Render markdown in the detail view

The detail panel (search for `expandedSkillId` / `detail` rendering, roughly lines 600-900) currently shows description + tool schema. For content skills, render the markdown.

Use the existing markdown renderer in this codebase — look at `chat/src/MessageContent.svelte` and `chat/src/svelte-marked/` for the import. Do NOT add a new markdown library. Do NOT use `{@html}` without sanitization — reuse whatever sanitizer Message rendering uses.

Show a clear visual cue distinguishing tool-pack ("3 tools") vs content ("Knowledge skill") in both the list and detail views.

### E. Filtering / search

The existing category filter and search input must continue to work for both types. No changes needed if the API list already returns mixed results (it does after steps 2-3).

## Hard rules

- No mocks. Test against the real API.
- No new dependencies in `chat/package.json` beyond what's already there.
- Don't break the existing tool-pack install flow — verify it still works after your changes.
- Match Svelte 4 idioms used elsewhere in this file.

## Verification

1. Boot the dev server (whichever command this project uses — check `chat/package.json` scripts).
2. Open the skills marketplace modal in `/chat`.
3. List shows mixed tool-pack and content skills.
4. Click a content skill (e.g., `ethereum-gas-optimization`) — detail renders the full markdown.
5. Install it. Visual state updates to "Installed". `localStorage.knowledgeSkills` (DevTools → Application → Local Storage) contains the skill with full `content` field.
6. Uninstall. Removed from `knowledgeSkills`.
7. Install a tool-pack skill (any existing one). It still goes into `localStorage.toolSchemaGroups` exactly as before. Regression check: send a chat message that should trigger the tool — it works.
8. Refresh page. Both stores rehydrate from localStorage, install state persists.

## Done means

- Content skills can be installed/uninstalled; store updates correctly.
- Markdown renders cleanly in detail view.
- Tool-pack skills regression-tested and unchanged.
- No console errors.
