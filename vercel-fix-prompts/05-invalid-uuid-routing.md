# Fix: Non-UUID Strings Passed to UUID-Expecting Endpoints

## Problem

963+ instances of this error across multiple endpoints:

```
[api] unhandled NeonDbError: invalid input syntax for type uuid: "index.html"
[api] unhandled NeonDbError: invalid input syntax for type uuid: "agent-home.html"
[api] unhandled NeonDbError: invalid input syntax for type uuid: "pumpfun"
[api] unhandled NeonDbError: invalid input syntax for type uuid: "pumpfun-feed"
```

Affected endpoints:
- `/api/agents/[id]`
- `/api/agent-page`
- `/api/permissions/list`

These endpoints receive URL segments like `index.html`, `pumpfun`, etc., and pass them directly to database UUID queries without validation, causing unhandled 500 errors.

## What to investigate

1. Find the route handlers for `/api/agents/[id]`, `/api/agent-page`, and `/api/permissions/list`.
2. Locate where the `id` or slug parameter is extracted and passed to a DB query.
3. Determine the source of these invalid requests — are these browser fetches of static assets being intercepted by a catch-all API route? Or are clients genuinely sending bad IDs?
4. Check the routing config (`vercel.json` rewrites, Next.js routes, Express routing) to see if static asset requests like `index.html` are accidentally matching dynamic API routes.

## Expected fix

Option A (routing fix): Ensure static asset paths (`*.html`, named slugs like `pumpfun`) are not matched by the `[id]` catch-all route. Add a UUID format check early in the route handler and return 400 if the value is not a valid UUID.

Option B (validation fix): At the top of each affected handler, validate the `id` param is a valid UUID format before querying the DB:
```js
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
if (!UUID_RE.test(id)) return res.status(400).json({ error: 'Invalid id' });
```

Both options should be applied. Fix the routing AND add input validation.
