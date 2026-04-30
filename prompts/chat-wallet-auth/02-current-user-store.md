# Task: Add currentUser Svelte store to chat/src/stores.js

## Goal
Add a `currentUser` Svelte writable store and a `loadCurrentUser()` function to
`/workspaces/3D-Agent/chat/src/stores.js`. The store holds the authenticated user
object (or `null` when signed out) and is used by nav and auth UI components across
the chat app.

---

## Context

`/workspaces/3D-Agent/chat/src/stores.js` already contains all Svelte stores for the
chat app (API keys, config, route, etc.). It uses `writable` and `persisted` from
`./localstorage.js`.

The chat app and the main site share the same domain (`three.ws`), so the
`__Host-sid` session cookie set by backend sign-in is available here automatically.

The backend endpoint to check session state:
- `GET /api/auth/me` with `credentials: 'include'`
- Returns `{ user: { id, email, display_name, plan, avatar_url, ... } }` on success
- Returns 401 when not signed in

---

## What to add to stores.js

### 1. Import addition
Add `get` to the existing `svelte/store` import if not already there (it already is —
`stores.js` line 1: `import { writable, get } from 'svelte/store';`).

### 2. New store
```js
// Authenticated user — null when signed out, user object when signed in.
// Populated by loadCurrentUser(); do not persist (always re-check on mount).
export const currentUser = writable(null);
```

### 3. New function
```js
/**
 * Fetch the current session user from /api/auth/me and update the store.
 * Silently sets null on any error or 401.
 * @returns {Promise<object|null>}
 */
export async function loadCurrentUser() {
  try {
    const res = await fetch('/api/auth/me', { credentials: 'include' });
    if (!res.ok) { currentUser.set(null); return null; }
    const { user } = await res.json();
    currentUser.set(user ?? null);
    return user ?? null;
  } catch {
    currentUser.set(null);
    return null;
  }
}
```

---

## What NOT to change
- Do not modify any existing store definitions
- Do not add persistence (`persisted`) to `currentUser` — it must always be
  re-fetched from the server (session could have expired)
- Do not call `loadCurrentUser()` inside `stores.js` itself — callers (`App.svelte`,
  `TopNav.svelte`, etc.) will call it in their `onMount`

---

## Success criteria
- `currentUser` is exported from `stores.js` as a writable store with initial value `null`
- `loadCurrentUser` is exported from `stores.js`
- Calling `loadCurrentUser()` sets the store to the user object on 200, or `null` on any error
- No existing store or export is changed or removed
