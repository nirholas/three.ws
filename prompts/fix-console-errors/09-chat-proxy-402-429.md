# Handle `/api/chat/proxy` 402 (Payment Required) and 429 (Rate Limited)

## Symptom

```
POST https://three.ws/api/chat/proxy 402  (initial load)
POST https://three.ws/api/chat/proxy 429  (Too Many Requests)
Fetch failed loading: POST "https://three.ws/api/chat/proxy".
```

The request is the chat send-message proxy. Two distinct failures stack:

- `402` — server rejecting because the caller has no funded plan / no credits / no payment method on file.
- `429` — server rejecting because the caller has exceeded a rate limit (per-IP, per-user, or per-agent).

## Cause

The client treats both as opaque network errors. The user just sees the message fail with no explanation, and the call may retry into a 429 storm.

## Task

### Server side

1. Find the proxy handler (search [api/](../../api/) for `chat/proxy` or the route that fronts the LLM provider).
2. Make sure 402 and 429 responses include a JSON body the client can render:
   - `402 { error: 'payment_required', reason: 'no_credits' | 'plan_required', upgradeUrl }`
   - `429 { error: 'rate_limited', retryAfter: <seconds>, scope: 'ip' | 'user' | 'agent' }`
3. Set the `Retry-After` header on 429 responses.

### Client side

1. Find the chat send call (search bundle source for `api/chat/proxy`).
2. Branch on status:
   - `402` → surface a clear "out of credits / upgrade" UI with the `upgradeUrl` from the body. Do not retry.
   - `429` → respect `Retry-After` (or body's `retryAfter`), debounce the next attempt, and show a "slow down" hint to the user. Do not retry in a tight loop.
   - Other 4xx → show the server's error message.
   - 5xx → retry with backoff (max 2 attempts), then surface a generic failure.
3. Disable the send button while a request is in flight so users can't queue duplicates that all hit the limiter.

## Acceptance

- A 402 from the proxy renders an actionable upgrade prompt, not a silent failure.
- A 429 produces at most one user-visible message and one queued retry after `Retry-After`.
- No uncaught promise rejection from `Fetch failed loading: POST .../api/chat/proxy`.
