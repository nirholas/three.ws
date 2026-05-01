# Quiet `/api/auth/me` 401 for anonymous visitors

## Symptom

```
GET https://three.ws/api/auth/me 401 (Unauthorized)
```

…logged on every page load for unauthenticated users.

## Cause

`/api/auth/me` is a probe that asks "is there a session?" The natural answer for an anonymous visitor is "no," but the client surfaces it as a network error in the console.

## Task

1. Find the `/api/auth/me` call site (search the client bundle source).
2. Either:
   - Treat `401` as the documented "not signed in" response — no `console.error`, just resolve to `{ user: null }` and continue. OR
   - Change the server to return `200 { user: null }` for anonymous callers and reserve `401` for genuine token-validation failures.
3. Make sure the rest of the app's "am I logged in?" branches read from this normalized result.

## Acceptance

- Anonymous visitors see no `auth/me` 401 noise in the console.
- Logged-in users still get their user object back unchanged.
- A genuinely invalid/expired token still produces a distinguishable error path.
