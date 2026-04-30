# Task: Complete the Privy OAuth auth flow in element.js

## Context

The project is three.ws — a platform for 3D AI agents.

The repo is at `/workspaces/3D-Agent`.

**What exists:**

- `src/element.js` — The `<agent-3d>` custom element. On boot it:
  1. Loads the agent manifest
  2. Initializes the viewer (Three.js WebGL)
  3. Starts the agent runtime (LLM brain)
  
  It has an `auth` attribute (values: `"none"` | `"privy"` | `"siwe"`). When `auth="privy"` is set, there is a comment in the code indicating Privy should handle auth, but the flow is not implemented — it just skips auth.

- `src/erc8004/privy.js` — Privy integration hooks. Has functions for initializing the Privy client, handling the redirect callback, and getting the authenticated user. But these are not called from `element.js`.

- `api/auth/[action].js` — Backend auth. Handles `login` (email+password), `logout`, `me`. Has `createSession()` which writes `__Host-sid` cookie.

- `api/auth/privy-callback.js` — Likely exists or needs creation. Privy OAuth callback handler that exchanges a Privy JWT for a session cookie.

- `api/_lib/auth.js` — `createSession()`, `getSessionUser()`, `sessionCookie()`. The session model is solid.

**The problem:** `auth="privy"` on `<agent-3d>` does nothing. Privy is a Web3 auth platform that supports email, SMS, social (Google/Twitter/Discord), and wallet sign-in. The hooks exist (`src/erc8004/privy.js`) but aren't wired to the element's boot flow or the backend session.

**The goal:** When `auth="privy"` is set on the element:
1. On boot, check if there's an existing session (`GET /api/auth/me`)
2. If not authenticated, show a Privy login modal
3. After Privy login succeeds, exchange the Privy JWT for a backend session cookie (via `POST /api/auth/privy-callback`)
4. Proceed with normal element boot (manifest load, viewer, runtime)
5. On sign-out, destroy the session

This is distinct from the SIWE wallet auth task (`wallet-auth/` prompts) — Privy handles its own wallet auth internally. This task is specifically about using Privy as the auth provider for the `<agent-3d>` element.

---

## Privy integration pattern

Privy provides a JS SDK (`@privy-io/js-sdk-core` or `@privy-io/react-auth`). Since this project is vanilla JS (not React), use `@privy-io/js-sdk-core`.

Check `package.json` — if `@privy-io/js-sdk-core` or similar is already a dependency, use it. If not, add it.

```js
import { PrivyClient } from '@privy-io/js-sdk-core';

const privy = new PrivyClient(PRIVY_APP_ID, {
  // config options
});

// Login flow
const { user } = await privy.login();
// user.id is the Privy DID
// user.wallet?.address is the connected wallet (if any)

// Get JWT for backend verification
const token = await privy.getAccessToken();
// POST this token to /api/auth/privy-callback
```

`PRIVY_APP_ID` comes from `VITE_PRIVY_APP_ID` env var.

---

## Backend: privy-callback endpoint

**Create or update `api/auth/privy-callback.js`:**

```
POST /api/auth/privy-callback
Body: { token: string }  — Privy JWT (access token)
```

Verifies the Privy JWT using Privy's public JWKS endpoint, then:
1. Extracts the Privy user ID (`sub` claim) and optionally wallet address
2. Upserts a user record in the `users` table (create if first login, or find by privy_id)
3. Creates a session cookie via `createSession()`
4. Returns `{ user: { id, email, displayName } }`

Privy JWKS verification:
```js
import { createRemoteJWKSet, jwtVerify } from 'jose';
const JWKS = createRemoteJWKSet(new URL('https://auth.privy.io/api/v1/apps/{appId}/jwks.json'));
const { payload } = await jwtVerify(token, JWKS, { issuer: 'privy.io' });
// payload.sub = Privy user ID
```

The `users` table needs a `privy_id` column if it doesn't have one. Check `api/_lib/schema.sql`. If missing:
```sql
ALTER TABLE users ADD COLUMN IF NOT EXISTS privy_id text UNIQUE;
CREATE UNIQUE INDEX IF NOT EXISTS users_privy_id_unique ON users (privy_id) WHERE privy_id IS NOT NULL;
```

Add this migration to `api/_lib/schema.sql` AND create `specs/schema/NNN-privy-auth.sql` (use the next available number).

---

## Changes to element.js

In the element's `connectedCallback()` or `_boot()` method, add an auth gate before the manifest/viewer init:

```js
async _boot() {
  const authMode = this.getAttribute('auth') || 'none';
  
  if (authMode === 'privy') {
    const authed = await this._ensurePrivyAuth();
    if (!authed) return; // login modal shown, boot will resume after redirect
  }
  
  // ... existing boot: load manifest, init viewer, start runtime ...
}

async _ensurePrivyAuth() {
  // 1. Check existing session
  const me = await fetch('/api/auth/me', { credentials: 'include' });
  if (me.ok) return true; // already authed
  
  // 2. Init Privy and trigger login
  const { initPrivy, loginWithPrivy, exchangePrivyToken } = await import('./erc8004/privy.js');
  const appId = import.meta.env.VITE_PRIVY_APP_ID;
  if (!appId) {
    console.warn('[agent-3d] VITE_PRIVY_APP_ID not set — skipping Privy auth');
    return true; // degrade gracefully
  }
  
  const token = await loginWithPrivy(appId); // shows Privy modal, returns JWT
  if (!token) return false;
  
  // 3. Exchange for backend session
  const res = await fetch('/api/auth/privy-callback', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ token }),
    credentials: 'include',
  });
  
  return res.ok;
}
```

---

## Changes to src/erc8004/privy.js

Implement or complete `loginWithPrivy(appId)`:
- Initializes Privy SDK with `appId`
- Shows the login modal
- Returns the Privy access token JWT on success
- Returns null if the user cancels

---

## Files to create/edit

**Create:**
- `api/auth/privy-callback.js`
- `specs/schema/NNN-privy-auth.sql` (next available migration number)

**Edit:**
- `api/_lib/schema.sql` — add `privy_id` column to `users`
- `src/element.js` — add `_ensurePrivyAuth()`, call it in `_boot()` when `auth="privy"`
- `src/erc8004/privy.js` — implement `loginWithPrivy(appId)` returning a JWT or null

**Do not touch:**
- SIWE auth endpoints (`/api/auth/siwe/`)
- Email/password auth
- Session cookie format (`__Host-sid`)

---

## Acceptance criteria

1. Set `<agent-3d auth="privy" agent-id="...">` on a page. On load, the Privy login modal appears.
2. Log in with an email or Google account. The modal closes. The element boots normally (viewer loads, agent starts).
3. Refresh the page — still logged in (session cookie persists).
4. `GET /api/auth/me` returns the user record.
5. `<agent-3d auth="none">` — Privy is not loaded, no modal, element boots immediately.
6. `VITE_PRIVY_APP_ID` unset — element logs a warning and boots without auth (degrades gracefully).
7. `npx vite build` passes. `node --check api/auth/privy-callback.js` passes.

## Constraints

- ESM only in `src/`. API endpoints use CommonJS-style `export default wrap(...)` pattern from `api/CLAUDE.md`.
- Use `jose` for JWT verification (already a dep). Do not add `jsonwebtoken`.
- The Privy SDK (`@privy-io/js-sdk-core`) may be added as a new dep if not present.
- `src/element.js` must not break when `auth` attribute is absent or set to `"none"` or `"siwe"`.
- Don't hardcode the Privy app ID anywhere — always read from `VITE_PRIVY_APP_ID`.
