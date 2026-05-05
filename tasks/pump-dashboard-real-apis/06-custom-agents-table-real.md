# 06 — Custom Agents table: replace hardcoded "My Cool Agent" with real list

## Problem
[pump-dashboard.html](../../pump-dashboard.html) lines ~926–934 ship a hardcoded sample row into production:

```html
<tr>
  <td>My Cool Agent</td>
  <td>agent-xyz.vrm</td>
  <td>2024-07-29</td>
  <td><button class="btn btn-sm">Edit</button> <button class="btn btn-danger btn-sm">Delete</button></td>
</tr>
```

Plus a stub second row "No custom agents yet." that's always visible regardless of state. Buttons do nothing. This violates [CLAUDE.md](../../CLAUDE.md) rule #6 (no fallback sample arrays) and rule #4 (no stubs).

## Outcome
Navigating to **Animations** loads the real list of the signed-in user's agents from `GET /api/agents` and renders one row per agent: display name, model file basename, creation date, and working **Edit** + **Delete** buttons. Empty list = a single empty-state row with the real "No custom agents yet." message.

## Endpoints to use (already exist)
- List: `GET /api/agents` — see [api/agents.js](../../api/agents.js) (returns the user's agents).
- Delete: `DELETE /api/agents/:id` — see [api/agents/[id].js](../../api/agents/[id].js).
- Edit page: `/agent-edit.html?id=<id>` — already exists.

If `/api/agents` does not currently return a `model_url`/`model_filename` field, extend [api/agents.js](../../api/agents.js) to include it from `agent_identities.meta` — do not invent a synthetic filename in the frontend.

## Implementation
1. Delete the hardcoded `<tr>` and the duplicate empty row.
2. On nav into the Animations page (and once on initial DOMContentLoaded if Animations is the active page), call `apiFetch('/api/agents')`. Populate `#custom-agents-table` with one row per agent:
   - Name → `display_name`
   - Model → basename of `meta.model_url` or the stored filename; if none, render `—`.
   - Created → `new Date(created_at).toLocaleDateString()` — real date only.
   - Edit → anchor to `/agent-edit.html?id=<id>`.
   - Delete → calls `DELETE /api/agents/<id>`, on 200 re-runs the list fetch; on 4xx/5xx surfaces the upstream error string via `toast`.
3. Real states:
   - Loading: single row "Loading agents…" while the fetch is in flight.
   - Empty: single row "No custom agents yet." (only when the API returns `data: []`).
   - 401: single row with a real "Sign in to manage your agents" link to `/login.html`.
4. The "+ Add Agent" button (`onclick="addCustomAgent()"`) currently calls a non-existent function — wire it to `window.location.href = '/agent-edit.html?new=1'` (or the real create path used elsewhere in this codebase — verify by reading [agent-edit.html](../../agent-edit.html)).

## Definition of done
- Real network call to `/api/agents` populates the table; the row count matches what `GET /api/agents` returned.
- Deleting an agent removes its row and the next page reload still shows it gone (DB persistence verified).
- No string "My Cool Agent" or "agent-xyz.vrm" anywhere in the HTML.
- `npm test` green; **completionist** subagent run on changed files.
