---
status: not-started
---

# Prompt 14: Backend - API Usage Tracking

## Objective
Implement a middleware to track API usage for each authenticated request, forming the basis for metered billing.

## Explanation
To bill developers for API consumption, we must first accurately measure it. This task involves creating a middleware that intercepts authenticated API requests, identifies the API key used, and increments a usage counter. This data is essential for enforcing rate limits and calculating monthly bills.

## Instructions
1.  **Choose a Storage Method for Counters:**
    *   For high-throughput APIs, a fast data store like Redis is ideal for usage counters to avoid overwhelming your primary database.
    *   Alternatively, for moderate traffic, you can use a dedicated `api_usage_logs` table in your SQL database.

2.  **Create an Authentication/Tracking Middleware:**
    *   This middleware will run before your main API logic on protected routes.
    *   It should extract the bearer token from the `Authorization` header.
    *   Authenticate the token (as implemented in `authenticateBearer`). This function should now be enhanced to check for API keys by looking up their hash in the `api_keys` table.
    *   If the key is valid, attach the `user_id` and `apiKeyId` to the request object (`req.auth`).

3.  **Increment the Usage Counter:**
    *   After successful authentication, the middleware should increment the usage counter for the `apiKeyId`.
    *   **If using Redis:** Use the `INCR` command on a key like `api_usage:{apiKeyId}:{yyyy-mm}`.
    *   **If using SQL:** Insert a row into `api_usage_logs` with `api_key_id` and the current timestamp. You would then aggregate these logs for billing.

4.  **Apply the Middleware:**
    *   Wrap your API endpoint handlers with this new middleware to protect them and track their usage.

## Middleware Example

```javascript
// In a file like /api/_lib/auth.js or a new middleware file

import { extractBearer, authenticateBearer } from './auth.js';

export function trackApiUsage(handler) {
  return async (req, res) => {
    const token = extractBearer(req);
    if (!token) {
      return error(res, 401, 'missing_token');
    }

    const authContext = await authenticateBearer(token); // This now handles both JWTs and API keys
    if (!authContext) {
      return error(res, 401, 'invalid_token');
    }

    // Attach auth info to the request for the handler to use
    req.auth = authContext;

    // If the request was via an API key, track usage
    if (authContext.source === 'apikey') {
      // Using Redis (example)
      const redis = getRedisClient();
      const period = new Date().toISOString().substring(0, 7); // YYYY-MM
      await redis.incr(`api_usage:${authContext.apiKeyId}:${period}`);
    }

    // Proceed to the actual API endpoint logic
    return handler(req, res);
  };
}

// In your API route file:
// export default wrap(trackApiUsage(async (req, res) => { ... your logic ... }));
```
