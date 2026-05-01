# Fix unresolved `sync.three.ws` host and unhandled rejection

## Symptom

```
POST https://sync.three.ws/  net::ERR_NAME_NOT_RESOLVED
Uncaught (in promise) TypeError: Failed to fetch
    at index-DPO-3TaM.js:16330:3413
```

## Cause

The client posts to `https://sync.three.ws/` but DNS has no record for that subdomain. The fetch caller also lacks a `.catch()`, so the failure surfaces as an uncaught promise rejection.

## Task

1. Decide the intent:
   - If `sync.three.ws` is a real backend that hasn't shipped yet — provision DNS + the service, OR feature-flag the client call off until it's live.
   - If it was renamed/retired — point the client at the correct host or remove the call.
2. Whichever path: wrap the fetch in `try/catch` (or `.catch()`) so a network failure logs once at `warn` level and does not produce an uncaught rejection.
3. Add an exponential backoff or "give up after N attempts" so the client doesn't spam the host once it starts failing.
4. Search the bundle source for the call (look for `sync.three.ws` and the function `Nt` referenced in the stack).

## Acceptance

- No `ERR_NAME_NOT_RESOLVED` in console under normal operation, OR
- If the host is intentionally optional, failures are caught silently with at most one warning, and no uncaught promise rejection.
