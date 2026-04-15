---
mode: agent
description: "Handle expired sessions gracefully across the SPA and public pages"
---

# 01-04 · Session expiry UX

## Why it matters

Right now, when a session expires, the dashboard throws `401` noisily and the user is stuck on a broken page. For a product where users invest a selfie in creating an avatar, a lost session means lost trust. Quiet, reliable re-auth.

## Prerequisites

- 01-01 and 01-02.

## Read these first

- [src/account.js](../../src/account.js) — current authenticated fetch client.
- [public/dashboard/dashboard.js](../../public/dashboard/dashboard.js) — dashboard fetch usage.
- [api/_lib/auth.js](../../api/_lib/auth.js) — session TTL / revocation.

## Build this

1. **Central fetch wrapper** — if one doesn't exist, add a thin helper in `src/account.js` that wraps `fetch` and, on 401 with `{ error: 'unauthorized' }`, redirects to `/login?next={current}`.
2. **Soft vs hard 401** — `GET /api/agents/me` intentionally returns `{ agent: null }` for anonymous users. Make sure the client treats that as "anonymous" (allow rendering), not as "session expired" (redirect). Everything else that's 401 with a real error body is the redirect path.
3. **Hash-preserving redirect** — if the URL has a `#model=` / `#widget=` / `#agent=` fragment, preserve it through `/login` and back. SPAs lose the fragment on a plain `location.href = '/login'`.
4. **Logout flow** — after logout, visiting a protected page like `/dashboard/` should land on `/login?next=/dashboard/` cleanly.
5. **Embed iframe** — `/agent/:id/embed` must never redirect to `/login`. It's an anonymous resource. Make the embed's own fetches explicitly anonymous (no `credentials: 'include'` unless the owner is previewing).

## Out of scope

- Refresh-token rotation (sessions are long-lived cookies).
- Silent re-auth (we want the explicit redirect).
- Changing session TTL values.

## Deliverables

- Diff to `src/account.js` (central wrapper).
- Diff to `public/dashboard/dashboard.js` (use the wrapper).
- Diff to any embed-side fetch call to drop `credentials: 'include'`.

## Acceptance

- Expire a session manually (delete cookie or set `revoked_at`) → next API call triggers a clean redirect.
- Anonymous homepage hits `/api/agents/me` → no redirect, no console error.
- Embed iframe on a logged-out browser renders the public avatar fine.
- `node --check` + `npm run build` pass.
