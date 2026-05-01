# Fix `/api/skills` 500s and `category=[object Object]` client bug

## Symptom

```
GET https://three.ws/api/skills?sort=popular                              500
GET https://three.ws/api/skills?category=%5Bobject+Object%5D&sort=popular 500   (×7)
POST https://three.ws/api/skills                                          401
```

## Cause

Two separate bugs:

1. **Client** is passing a category *object* into the query string instead of a string id/slug. The result is the literal `[object Object]` getting URL-encoded as `%5Bobject+Object%5D`. Somewhere the code does roughly `?category=${category}` instead of `?category=${category.id}` (or `.slug`).
2. **Server** throws 500 on both the malformed category value AND on the well-formed `?sort=popular` request. The handler should validate inputs and return 4xx for bad input, never 500.

## Task

### Client
1. Find the call site that builds the `/api/skills` request. Likely in the marketplace / skills browse page — search for `api/skills` and `sort=popular`.
2. Pass the category's primitive id (string) rather than the object. Type the helper so this can't regress.
3. When no category is selected, omit the `category` param entirely (don't send `category=undefined` or `category=null`).

### Server
1. In the `/api/skills` route ([api/](../../api/) — search `skills`), wrap the handler so:
   - Invalid `category` returns 400 with `{ error: "..." }`.
   - Unknown `sort` falls back to a default with a warning, not a 500.
   - All thrown errors are caught and logged with the request context.
2. Fix whatever is throwing on the plain `?sort=popular` request — likely a missing column, missing index, or unhandled empty-result path. Reproduce locally before deploying.

### POST 401
The 401 on `POST /api/skills` is expected when logged out. No fix needed unless the UI is offering the action to anonymous users — if so, gate the button behind an auth check.

## Acceptance

- `GET /api/skills?sort=popular` returns 200 with the popular skills list.
- The client never sends `category=[object Object]`.
- Bad inputs return 4xx with a useful error body, not 500.
