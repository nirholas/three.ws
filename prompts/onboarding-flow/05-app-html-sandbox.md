# Task 05: Position `/app` as anonymous sandbox + authenticated editor

## Context

[app.html](../../app.html) is currently an untracked (uncommitted) viewer page with drop-a-GLB, animation manager, agent presence, and "Make this a widget". It serves `/app`. In the new flow it plays two roles:

1. **Anonymous sandbox** — user drops a GLB, plays with it, no sign-in required. This is the top-of-funnel conversion surface.
2. **Authenticated editing surface** — accessed via `/app?agent=:id` from the agent hub ([task 04](./04-agent-page-hub.md)). Hydrates that user's saved GLB, enables save-back.

See [00-README.md](./00-README.md) for the overall plan.

## Goal

Make `/app` work seamlessly for both anonymous drop-a-GLB users and authenticated users editing a saved agent. Add a "Save to account" CTA that prompts sign-in mid-flow (preserving the current GLB via `sessionStorage`).

## Deliverable

1. **Edit [app.html](../../app.html):**
   - Remove the `/app#register` nav link ([app.html:45](../../app.html#L45)). On-chain deployment now lives on the agent hub page, not as a viewer nav item.
   - Add a persistent "Save to account" CTA in the header area, visible *only* when a GLB is loaded (anonymous or authed). Mirror the `.make-widget-btn` pattern at [app.html:46-49](../../app.html#L46-L49).

2. **Edit [src/app.js](../../src/app.js):**
   - Parse a new URL query/hash param: `agent=<id>`. Add to the list at [src/CLAUDE.md#L60](../../src/CLAUDE.md) (Agent URL hash keys).
   - When `agent=:id` is present: fetch `/api/agents/:id`, hydrate `manifest.body.uri` as the loaded GLB, and tag the session as "editing agent :id" (so save-back updates that agent, not creates a new one).
   - When absent: current anonymous behavior is preserved — drop GLB, play, no persistence.

3. **Save-to-account CTA behavior:**
   - **Anonymous user, clicks Save:**
     - Stash current GLB + config in `sessionStorage` under key `pending_save`:
       ```json
       { "glbUrl": "blob:...", "manifest": { ... }, "returnTo": "/app" }
       ```
     - Redirect to `/login?next=/app?pending=1`.
   - **Authenticated user with no `?agent`:**
     - Create new avatar + agent via `/api/avatars/presign` → PUT → `/api/agents/me` POST.
     - Redirect to `/agent/:id` (the hub).
   - **Authenticated user with `?agent=:id`:**
     - PATCH the existing agent's avatar (use the versioning endpoint if it exists; otherwise re-upload and PUT).
     - Redirect to `/agent/:id`.

4. **On `/app` boot, check `sessionStorage.pending_save`:**
   - If present AND user is now authenticated → re-hydrate the GLB + config, trigger the save flow, clear the stash.
   - If present but still unauthed → no-op (they cancelled auth).

5. **Keep the existing "Make this a widget" button** ([app.html:46-49](../../app.html#L46-L49)):
   - For anonymous users, it prompts sign-in (same `sessionStorage` pattern).
   - For authed users with `?agent=:id`, it creates a widget bound to that agent.

## Constraints

- **Do not** force sign-in before a GLB can be loaded. The whole point of `/app` is no-commitment play.
- **Do not** delete the `<agent-3d>` / animation / lighting / agent-presence code. All of that stays.
- **Do not** break the existing hash params (`model`, `widget`, `agent`, `kiosk`, `brain`, `proxyURL`, `preset`, `cameraPosition`, `register`) — extend, don't replace.
- **Do not** add new routes. `/app` keeps serving both modes; differentiation is by URL param.
- **Do not** introduce a client-side router. URL hash parsing in [src/app.js](../../src/app.js) is the convention.
- Prettier: tabs, 4-wide, single quotes.

## Verification

- [ ] `node --check src/app.js`
- [ ] `npm run build` passes
- [ ] **Anonymous flow:** `localhost:3000/app`, drop a GLB, model renders, "Save to account" CTA appears, clicking it redirects to `/login` and returns to `/app` after sign-in with the GLB still there.
- [ ] **New-save flow:** after sign-in + save, redirect to `/agent/:id` and the saved GLB loads on the hub.
- [ ] **Edit-existing flow:** `/app?agent=:id` loads the saved GLB; editing + save redirects back to `/agent/:id` with the updated avatar.
- [ ] **Widget flow:** "Make this a widget" works anonymously (prompts sign-in) and authed (creates widget bound to agent).
- [ ] `/app#register` link no longer appears in nav.

## Reporting

- Files modified
- Which endpoint you used for the update path (PATCH vs re-upload via presign + PUT) and why
- Any `sessionStorage` key collisions or pre-existing keys you had to coordinate with
- Whether save-back actually persisted on a round trip (`/app?agent=:id` → edit → save → reload → edits still there)
