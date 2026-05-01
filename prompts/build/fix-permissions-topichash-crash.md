---
mode: agent
description: 'Fix null topicHash crash on module load in api/permissions/[action].js — crashes entire permissions route'
---

# Fix: permissions route crashes at module load due to null topicHash

## Problem

Every request to `/api/permissions/*` (grant, list, redeem, revoke, verify) returns HTTP 500 with:

```
TypeError: Cannot read properties of null (reading 'topicHash')
    at file:///var/task/api/permissions/%5Baction%5D.js:912:66
    at ModuleJob.run
```

Note: this crashes at **module load time**, not at request time. That means the entire `/api/permissions` function fails to initialize — every action (grant, list, etc.) returns 500 until a new deployment.

## Root cause

In `api/permissions/[action].js`, near line 911–912:

```js
const revokeIface = new Interface(DELEGATION_MANAGER_ABI);
const DISABLED_TOPIC = revokeIface.getEvent('DisabledDelegation').topicHash;
```

`Interface.getEvent()` returns `null` when the event name doesn't match any fragment. In the original code the event was called `DelegationDisabled` in this call but `DisabledDelegation` in the ABI, causing the mismatch.

This is a top-level module statement (not inside a function), so when `getEvent` returns null, `.topicHash` throws immediately on import — before any request is handled.

## What to do

### 1. Verify the ABI event name

Read `src/erc7710/abi.js`. The `DELEGATION_MANAGER_ABI` array contains:

```js
'event DisabledDelegation(bytes32 indexed delegationHash, address indexed delegator, address indexed delegate, ...)'
```

The correct name is `DisabledDelegation` (not `DelegationDisabled`).

### 2. Fix the call

In `api/permissions/[action].js` around line 912, ensure:

```js
const revokeIface = new Interface(DELEGATION_MANAGER_ABI);
const DISABLED_TOPIC = revokeIface.getEvent('DisabledDelegation').topicHash;
```

### 3. Add a guard so it can never crash module load again

Wrap the top-level assignment to fail loudly at load time with a meaningful message instead of a cryptic null dereference:

```js
const revokeIface = new Interface(DELEGATION_MANAGER_ABI);
const _revokeEvent = revokeIface.getEvent('DisabledDelegation');
if (!_revokeEvent) throw new Error('DisabledDelegation event not found in DELEGATION_MANAGER_ABI — check src/erc7710/abi.js');
const DISABLED_TOPIC = _revokeEvent.topicHash;
```

This still fails at load time if there's ever a mismatch, but the error message is actionable.

### 4. Verify the topic hash matches

Run locally to confirm the event resolves:

```bash
node -e "
import('./src/erc7710/abi.js').then(({ DELEGATION_MANAGER_ABI }) => {
  const { Interface } = await import('ethers');  // use dynamic import
});
"
```

Or simpler:

```bash
node -e "
import { Interface } from 'ethers';
import { DELEGATION_MANAGER_ABI } from './src/erc7710/abi.js';
const iface = new Interface(DELEGATION_MANAGER_ABI);
console.log('topicHash:', iface.getEvent('DisabledDelegation').topicHash);
" --input-type=module
```

Should print a 0x-prefixed 32-byte hex hash without throwing.

### 5. Also check the revoke handler log decode

Downstream in `handleRevoke`, the log decode section should use:

```js
const loggedHash = disabledLog.topics[1]; // bytes32 — first indexed param
```

Not `topics[2]`. The event signature is:
```
DisabledDelegation(bytes32 indexed delegationHash, address indexed delegator, address indexed delegate, ...)
```
`topics[0]` = event sig hash, `topics[1]` = delegationHash, `topics[2]` = delegator, `topics[3]` = delegate.

## Files to change

- `api/permissions/[action].js` — the topicHash line and the guard; check the `loggedHash` index in `handleRevoke`
- No other files

## Verify locally

```bash
node -e "import('./api/permissions/[action].js').then(() => console.log('module loads OK')).catch(e => console.error('FAIL:', e.message))"
# Must print: module loads OK
```

## Acceptance

- `node -e "import('./api/permissions/[action].js')..."` loads without error
- After deploy, `curl https://three.ws/api/permissions/list` with a valid session cookie returns 200 or 401, not 500
- No `topicHash` errors in Vercel logs

## Out of scope

- Do not change the ABI in `src/erc7710/abi.js`
- Do not refactor the permissions handlers
