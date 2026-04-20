# Task 13 — Runtime delegation-redeem hook (`src/runtime/delegation-redeem.js`)

## Why

Skills are the primary consumer of delegations. A skill ("tip the creator", "subscribe", "execute DCA") calls a single runtime function to do an on-chain action, and the runtime figures out the right delegation, the right path (relayer or local signer), and the right error surfacing. Without this, every skill would have to reinvent the plumbing.

## Read first

- [00-README.md](./00-README.md) — canonical `src/runtime/delegation-redeem.js` exports
- [src/runtime/](../../src/runtime/) — the existing runtime module structure (scene controller, protocol bus)
- [src/agent-protocol.js](../../src/agent-protocol.js) — `ACTION_TYPES` and how the event bus is typed; we will emit new events from this module
- [src/permissions/toolkit.js](../../src/permissions/toolkit.js) — `redeemDelegation`, `isDelegationValid` (task 04)
- [src/agent-skills.js](../../src/agent-skills.js) — how skills are invoked today, to confirm the interface will fit

## Build this

Create `src/runtime/delegation-redeem.js` exporting:

1. **`async getActiveDelegation({ agentId, chainId, scopeHint? })`**

    - Fetches `/api/permissions/metadata?agentId=...&chainId=...`.
    - Filters to the delegation whose `scope` best matches `scopeHint` (if provided: prefer a scope with the right `token` and enough remaining `maxAmount`).
    - Returns the envelope or `null` if none match.
    - Caches the response in-memory for 60 seconds keyed by `{agentId, chainId}`. Cache is invalidated on a successful revoke event via the protocol bus.

2. **`async redeemFromSkill({ agentId, chainId, calls, skillId, mode? })`**

    - `mode` is `'client' | 'relayer' | 'auto'` (default `'auto'`).
    - `'client'`: get a signer from the host page's wallet helper (same one task 10 uses) and call `redeemDelegation` from the toolkit directly.
    - `'relayer'`: `POST /api/permissions/redeem` with a bearer token pulled from the agent's runtime config (the host is responsible for providing the bearer; if missing, throw `no_relayer_token`).
    - `'auto'`: prefer `'client'` if a wallet is connected, else `'relayer'` if a token is available, else throw `no_redemption_path`.
    - Pre-flight: call `getActiveDelegation`; throw `no_delegation` if none.
    - Pre-flight: validate each call against `scope.targets` and (rough) amount limits. Cheap, prevents wasted gas.
    - Emit `protocol.emit('permissions.redeem.start', {...})` before submission.
    - On success, emit `permissions.redeem.success` with `{ txHash, skillId, delegationHash }`.
    - On failure, emit `permissions.redeem.error` with `{ code, message, skillId }`.
    - Return `{ ok: true, txHash }` or `{ ok: false, code, message }`.

3. **`subscribeRedeemEvents(handler)`** — small helper that returns an `unsubscribe` for tests / UI surfaces that want to react to redemptions in the conversation stream.

4. **Rate limiting in the runtime itself**: a skill must not be able to trigger >5 redemption attempts per minute from a single tab. Use a simple token bucket. Exceeding it throws `rate_limited` without hitting the network. This protects against runaway skill loops (per `src/CLAUDE.md` warnings).

5. **Register new action types** in `src/agent-protocol.js` (append to `ACTION_TYPES`): `PERMISSIONS_REDEEM_START`, `PERMISSIONS_REDEEM_SUCCESS`, `PERMISSIONS_REDEEM_ERROR`. Touch this file minimally — just add the strings.

## Don't do this

- Do not hold a long-lived signer. Always fetch it lazily.
- Do not bypass the runtime rate limiter. It's the backstop for buggy skills.
- Do not import viewer modules (`SceneController`, three.js) — this is runtime-layer, not viewer-layer.
- Do not cache the signed envelope across tabs (localStorage). Memory only.
- Do not retry failed redemptions automatically — that's the skill's call.

## Acceptance

- [ ] `redeemFromSkill` works in `client` mode against Base Sepolia with a real delegation.
- [ ] `relayer` mode posts to `/api/permissions/redeem` and returns the tx hash.
- [ ] `auto` mode picks correctly when only one path is available.
- [ ] Runaway skill (6 calls in 10s) trips the internal rate limiter.
- [ ] Protocol events fire on the bus with correct payloads.
- [ ] `node --check` + `npm run build` pass.

## Reporting

- Transcript of a real redemption in `client` mode (tx hash on explorer).
- Transcript of a real redemption in `relayer` mode.
- The `ACTION_TYPES` diff on `src/agent-protocol.js`.
