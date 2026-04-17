# Task 03 — Per-agent embed referrer allowlist

## Why this exists

Right now `/agent/:id/embed` renders for anyone who iframes it. Agent owners may want to gate where their avatar appears — e.g. "only embed on my portfolio and my Substack, block everywhere else." This is the control surface that makes owners comfortable sharing the embed URL publicly.

## Shared context

- Embed page: [public/agent/embed.html](../../public/agent/embed.html) — loads the avatar, no chrome. You will add a **referrer check** that runs before the 3D scene mounts.
- Agent records are stored server-side; there is no `embed_policy` field yet — you add it.
- Auth helpers: [api/\_lib/auth.js](../../api/_lib/auth.js) exports `getSessionUser`, `authenticateBearer`, `extractBearer`, `hasScope`.
- HTTP helpers: [api/\_lib/http.js](../../api/_lib/http.js) exports `cors`, `json`, `error`, `wrap`, `method`, `readJson`.
- Existing agent endpoint: [api/agents/[id].js](../../api/agents/[id].js) — do **not** modify it. Add a sibling endpoint for policy (spec below).
- DB layer: agents are in table `agent_identities`. Find the current schema file (search for `CREATE TABLE agent_identities` in the repo) and extend it with your migration file. Do not modify existing migrations.

## What to build

### 1. Schema migration — add `embed_policy` column

- Add a migration file alongside existing ones (follow whatever naming pattern you find — e.g. `specs/schema/NNN-embed-policy.sql`, or wherever migrations live). If you cannot locate a migrations directory, create `specs/schema/embed-policy.sql` with just the `ALTER TABLE` and a comment explaining it needs to be applied manually.
- Column: `embed_policy JSONB` — nullable (null = "allow all embeds," the current behavior).
- Shape when non-null:
    ```json
    { "mode": "allowlist", "hosts": ["example.com", "*.substack.com"] }
    ```
    `mode` is `"allowlist"` or `"denylist"`. `hosts` supports exact matches and a single leading-wildcard segment (`*.foo.com`).

### 2. Server endpoint — `GET / PUT /api/agents/:id/embed-policy`

New file: `api/agents/[id]/embed-policy.js`.

- `GET` is **public** and returns `{ policy: <object or null> }`. No auth required — the embed page calls this.
- `PUT` requires session auth (the signed-in owner of the agent) via `getSessionUser()`. Validates body as `{ mode: "allowlist"|"denylist", hosts: string[] }`. Returns the updated policy. 403 if the caller isn't the agent's owner.
- `DELETE` clears the policy (back to "allow all"). Owner-only.
- Use `cors`, `method`, `wrap`, `readJson`, `error`, `json`. Follow the shape of [api/avatars/[id].js](../../api/avatars/[id].js) as a reference.
- Validate with `zod` (already a project dep — see how [api/avatars/[id].js](../../api/avatars/[id].js) uses it).

Route wiring in [vercel.json](../../vercel.json): add **immediately after** the `"src": "/api/agents/([^/]+)/wallet"` line (~line 22), so it lives with the other `/api/agents/:id/...` routes:

```json
{ "src": "/api/agents/([^/]+)/embed-policy", "dest": "/api/agents/[id]/embed-policy?id=$1" },
```

Do not touch any other route.

### 3. Referrer check in the embed page

Edit [public/agent/embed.html](../../public/agent/embed.html):

- Before creating the `Viewer`, fetch `GET /api/agents/${agentId}/embed-policy`.
- If `policy === null` → proceed (current behavior, allow all).
- Otherwise, derive the embedding host from `document.referrer` (top-level) or `window.location.ancestorOrigins?.[0]` when available. Parse the hostname.
    - Browser note: `ancestorOrigins` is Chromium/Safari only. `document.referrer` is the correct cross-browser signal for the parent origin of a first-party iframe. Prefer `ancestorOrigins` when present; fall back to `referrer`.
- Match the host against `policy.hosts` with leading-`*` wildcard support.
- On block: replace the stage with a small centered message — "This agent can only be embedded on approved sites." — style to match the existing `#error` div. Do not render the avatar.
- On allow: proceed as before.
- Add a query-string override `?preview=1` that skips the check — used by the owner's share-panel preview link and by the `/agent/:id` page when it links to `/embed` from the same origin.

Keep the edit scoped: add one `async checkPolicy()` helper and call it at the top of `main()`. Do not refactor the rest of the script.

### 4. Dashboard UI — owner-side allowlist editor

Create a new page (or panel, depending on the dashboard's structure — inspect [public/dashboard/index.html](../../public/dashboard/index.html) first):

- Preferred: new file `public/dashboard/embed-policy.html` reachable as `/dashboard/embed-policy?agent=ID`. Use the dashboard's existing CSS and header chrome.
- It lists the agent's current policy, lets the owner toggle mode (off / allowlist / denylist), edit the hosts list, and save. Use `fetch` against `/api/agents/:id/embed-policy` with `credentials: 'include'`.
- If you find the dashboard already uses a SPA pattern with a common shell, add a panel instead of a new page — whichever is less invasive. Document which pattern you followed in your report.

### 5. Wire a link from the agent page

In [public/agent/index.html](../../public/agent/index.html), near the existing "preview embed →" link (it already exists — grep for `agent-embed-preview`), add **one sibling link** right after it:

```html
<a class="agent-embed-preview-link" id="agent-embed-settings" href="" target="_blank" rel="noopener"
	>embed settings →</a
>
```

And in the existing script, set `.href = '/dashboard/embed-policy?agent=' + identity.id`. Only this link — do not touch anything else in the file.

## Files you own (create / edit)

- Create: `api/agents/[id]/embed-policy.js`, schema migration file, `public/dashboard/embed-policy.html` (or equivalent panel file)
- Edit: `public/agent/embed.html` (add `checkPolicy` helper + call), `vercel.json` (one route add), `public/agent/index.html` (exactly the one `<a>` + one js line described above)

## Files off-limits (other tasks are editing these)

- `src/element.js`, `src/agent-resolver.js` — owned by task 02
- The webcomponent snippet line in `public/agent/index.html` — owned by task 02
- `api/agent-og.js`, `api/agent-oembed.js`, `<head>` of `public/agent/index.html` — owned by task 01
- `api/agents/[id].js`, `api/avatars/[id].js` — do not modify

## Acceptance test

1. `node --check api/agents/[id]/embed-policy.js` passes.
2. `npx vite build` — note result.
3. Manual:
    - `GET /api/agents/SOMEID/embed-policy` → `{ policy: null }` when unset.
    - As owner, `PUT /api/agents/SOMEID/embed-policy` with `{ mode: "allowlist", hosts: ["example.com"] }` → returns the policy.
    - `GET` again returns it.
    - `DELETE` clears it.
    - Open `/agent/SOMEID/embed` from the project origin — still loads (same-origin implicit allow OR `?preview=1`).
    - Open an iframe of `/agent/SOMEID/embed` from a page on a disallowed host — confirm the block message renders instead of the avatar.
4. Dashboard page loads, shows current policy, saves a change, reload reflects it.

## Reporting

Report:

- All created files with line counts
- Files edited with which sections touched (keep edits narrowly scoped — call out if you had to go beyond the spec)
- Migration file path and exact SQL
- `node --check` / `vite build` results
- Manual curl commands you ran and their output (one-liners)
- Browser behavior of the referrer check — which signal you used (`ancestorOrigins` vs `referrer`) and known gaps
- Any unrelated bugs noticed
