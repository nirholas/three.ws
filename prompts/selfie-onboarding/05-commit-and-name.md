# Task 05 — Commit the avatar: upload, name, create agent

## Why this exists

Task 04 hands off a GLB Blob in memory. This task turns it into a persistent, named, shareable agent row the rest of the app understands. It's the last 10% of onboarding and where users drop off if it feels bureaucratic.

## Files you own

- Edit: `src/onboarding/flow.js` (from task 04) — the `commit` state calls into this module.
- Create: `src/onboarding/commit.js` — client helper that uploads the GLB and creates the agent.
- Edit: `api/avatars/index.js` (or the existing avatar-create endpoint; locate it first) — accept a new `source` field `'selfie'` for analytics; do not change response shape.
- Do not create a new create-agent endpoint — reuse what exists.

## Deliverable

### Name prompt

Minimal: a single centered input pre-filled with a pronounceable auto-generated name (e.g. `"Oak Raven"`, `"Clay Lion"` — any small word-pair generator). Placeholder reads `"Name your agent"`. Character limits: 2–40. No duplicate names for the same owner (server enforces; client surfaces a friendly error).

Single primary button: `Create agent`.

### Flow inside `commit.js`

```js
export async function commitAvatar({ glbBlob, name, source = 'selfie' }) {
  // 1. Request upload URL or multipart POST, depending on the existing API.
  // 2. Upload the GLB.
  // 3. Create the avatar + agent rows.
  // 4. Return { agentId, slug, viewerUrl, editorUrl }.
}
```

If there is no existing "create agent" path (only "create avatar"), extend minimally — the agent record is just an identity wrapper around an avatar. Follow what `src/agent-identity.js` already does for bootstrapping an identity.

### Post-commit redirect

Redirect to `/agent/:slug` (or whatever the viewer route is). Pre-warm the image: fetch the GLB URL from the response and start loading it in the viewer immediately so the destination feels instant.

### Analytics

Emit a single event via the existing usage logger (`api/_lib/usage.js`) with `{ kind: 'agent_created', source: 'selfie', latencyMs }` where `latencyMs` is the full `capture → redirect` time.

## Constraints

- Do not require the user to confirm a pose, outfit, or body type here. That's the editor (band 3).
- Never lose the blob. If create fails, keep the blob in `sessionStorage` (small enough) or `IndexedDB` (if >5MB) so retry doesn't force a new selfie.
- Name collision must surface before the upload, not after — check with a lightweight `HEAD /api/agents/slug-exists/:slug` (or whatever the existing shape is).
- Generated-name pool must produce >10,000 combinations to keep collisions rare.

## Acceptance test

1. `node --check src/onboarding/commit.js` passes.
2. Happy path: typical run commits in <4 seconds after the name is submitted.
3. Duplicate name → error shown inline; user edits → works.
4. Server 500 during upload → retry button; retry succeeds without re-selfie.
5. `/agent/:slug` renders the avatar on arrival (no flash of missing model).
6. Usage event recorded with `source: 'selfie'`.

## Reporting

- Final generated-name wordlist size and example names.
- Exact API shapes used for upload + create (paste the request/response).
- How long "capture → redirect" takes end-to-end on a typical run.
