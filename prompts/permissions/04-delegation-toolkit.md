# Task 04 — `src/permissions/toolkit.js` wrapper over MetaMask Delegation Toolkit

## Why

Every UI + runtime path needs a single, well-typed (JSDoc) facade over the MetaMask Delegation Toolkit. Consumers should never import the toolkit directly — they import from `src/permissions/toolkit.js`. This keeps the toolkit version controlled, the scope-builder output consistent, and any future switch to another SDK (or a direct ethers implementation) isolated to this file.

## Read first

- [00-README.md](./00-README.md) — canonical `src/permissions/toolkit.js` exports
- MetaMask Delegation Toolkit docs (<https://docs.metamask.io/delegation-toolkit/>) — **authoritative source for package name and APIs**. If the package name is `@metamask/delegation-toolkit`, use exactly that. If the docs show a different package, use the one in the docs.
- [src/erc7710/abi.js](../../src/erc7710/abi.js) — constants you depend on (task 03 creates it; if missing at your start, you may inline the `DELEGATION_MANAGER_DEPLOYMENTS` map from `00-README.md` canonical shapes — they should match)
- [package.json](../../package.json) — add the toolkit as a runtime dep only after verifying license + size + maintenance

## Build this

1. **Add the dependency.** `npm install @metamask/delegation-toolkit` (or whatever the MetaMask docs specify). Commit the `package.json` + `package-lock.json` update together. If the toolkit pulls in >5 MB of transitive deps, stop and report — we may need to pick a leaner path (direct ethers).
2. **Create `src/permissions/toolkit.js`** with the canonical exports from `00-README.md`:

    - `encodeScopedDelegation({ delegator, delegate, caveats, expiry, chainId })` — returns an unsigned delegation object ready to sign. Build the caveats using `CAVEAT_ENFORCERS` from `src/erc7710/abi.js`. Enforce: `expiry > now + 60`, `caveats.length >= 1`, `delegate !== delegator`.
    - `signDelegation(delegation, signer)` — uses the toolkit's EIP-712 signing, or falls back to `signer.signTypedData(domain, types, value)` with `EIP712_DOMAIN` + `DELEGATION_TYPES` from `abi.js`. Returns `{ ...delegation, signature, hash }`.
    - `redeemDelegation({ delegation, calls, signer, chainId })` — builds the `redeemDelegations` call with the provided `calls` array (`{ to, value, data }`), submits it via `signer`, waits for receipt, returns `{ txHash, receipt }`. **Must verify on-chain** that `isDelegationDisabled(hash)` is false before submitting; throw `delegation_revoked` if true.
    - `isDelegationValid({ hash, chainId, rpcUrl? })` — read-only; returns `{ valid: boolean, reason?: string }`. Checks: not disabled on-chain, not expired (uses `caveats.expiry`), signature recovers to `delegator`.
    - `delegationToManifestEntry(signedDelegation)` — maps a signed delegation into the `permissions.delegations[]` shape from the manifest spec (task 02). Pure, no I/O.

3. **Error surface.** Throw typed errors matching canonical error codes (`delegation_expired`, `signature_invalid`, `chain_not_supported`, etc.). Use a small helper:

    ```js
    export class PermissionError extends Error {
    	constructor(code, message) {
    		super(message);
    		this.code = code;
    	}
    }
    ```

4. **No network I/O in pure helpers.** `encodeScopedDelegation`, `delegationToManifestEntry` are synchronous + pure. `isDelegationValid`, `redeemDelegation`, `signDelegation` do I/O.
5. **JSDoc everything exported.** Param types, return types, thrown codes.
6. **Self-check**: add `scripts/test-toolkit.js` — runs `encodeScopedDelegation` with fixture data, runs `delegationToManifestEntry` on a pre-signed fixture, asserts shapes. No network. `node scripts/test-toolkit.js` must exit 0.

## Don't do this

- Do not build a mock signer path. If the caller doesn't pass a signer, throw — don't silently no-op.
- Do not accept addresses that aren't checksummed. Validate and re-checksum on entry.
- Do not reimplement EIP-712 hashing by hand — use ethers or the toolkit.
- Do not import React / viewer modules. This file is pure library code usable in both browser and node.
- Do not log signed delegations or signatures. Log the `hash` only.

## Acceptance

- [ ] `src/permissions/toolkit.js` exports all five canonical functions + `PermissionError`.
- [ ] `scripts/test-toolkit.js` passes with fixture data.
- [ ] `node --check src/permissions/toolkit.js` passes.
- [ ] `npm run build` passes.
- [ ] Dependency added to `package.json`, lockfile updated.
- [ ] No direct imports of `@metamask/delegation-toolkit` outside this file (grep to confirm).

## Reporting

- `npm ls @metamask/delegation-toolkit` output.
- Bundle size delta from `npm run build` (`dist/` size before/after).
- Any toolkit API you could not use (with the error you got).
