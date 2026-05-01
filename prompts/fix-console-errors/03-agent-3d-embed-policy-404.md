# Fix `/api/agents/:id/embed-policy` 404

## Symptom

```
agent-3d.js:68811  GET https://three.ws/api/agents/1930551f-a558-40df-bcb5-6f2e893b8786/embed-policy 404 (Not Found)
```

## Cause

`<agent-3d>` boot calls `GET /api/agents/:id/embed-policy` to determine which origins/features are allowed to embed the agent. Either the route is not implemented, or the agent id (`1930551f-a558-40df-bcb5-6f2e893b8786`) does not exist.

## Task

1. Confirm whether the route exists on the API (search [api/](../../api/) and [server.json](../../server.json)).
2. If missing — implement `GET /api/agents/:id/embed-policy` returning the policy shape the client expects (referrer allowlist, allowed features, default model, etc.). Default to a permissive-but-safe policy when the agent has not customized it.
3. If the agent id is simply absent — return `404` with a JSON body the client can act on, AND make the client treat 404 as "use default policy" rather than logging a hard failure.
4. On the client side ([src/element.js](../../src/element.js) `_boot`), when the policy fetch returns 404 or non-2xx, fall back to a default policy and continue boot instead of aborting.

## Acceptance

- For valid agent ids, the endpoint returns 200 with a policy.
- For unknown ids, boot continues with a default policy and no uncaught error.
- No 404 noise in console for the default deployment.
