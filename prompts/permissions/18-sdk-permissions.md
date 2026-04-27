# Task 18 — `@3dagent/sdk` permissions module

## Why

Third-party developers integrating agents into their own apps need a typed SDK entry point for listing, granting, and redeeming delegations. The raw REST endpoints are fine but a typed SDK is what unlocks partner integrations.

## Read first

- [sdk/](../../sdk/) — layout, tsconfig, existing module style (TS is OK here — the SDK is a separate package)
- [sdk/package.json](../../sdk/package.json) — deps, scripts
- [00-README.md](./00-README.md) — canonical API surface
- [src/permissions/toolkit.js](../../src/permissions/toolkit.js) — task 04; the SDK may re-export selected helpers
- [specs/PERMISSIONS_SPEC.md](../../specs/PERMISSIONS_SPEC.md) — task 01; SDK JSDoc must match types here

## Build this

1. **New module** `sdk/src/permissions.ts` (TS if the SDK is TS; match local convention — check sibling files).
2. **Exports**:

    ```ts
    export interface DelegationPublic {
    	/* ... matches metadata endpoint shape ... */
    }
    export interface ScopePreset {
    	token: string;
    	maxAmount: string;
    	period: 'once' | 'daily' | 'weekly';
    	targets: string[];
    	expiryDays: number;
    }
    export class PermissionsClient {
    	constructor(opts: { baseUrl?: string; bearer?: string });

    	listDelegations(params: {
    		agentId?: string;
    		delegator?: string;
    		status?: string;
    	}): Promise<DelegationPublic[]>;

    	getMetadata(agentId: string): Promise<{ spec: string; delegations: DelegationPublic[] }>;

    	// Browser only — throws in Node
    	async grant(params: {
    		agentId: string;
    		chainId: number;
    		preset: ScopePreset;
    		signer: ethers.Signer;
    	}): Promise<{ id: string; delegationHash: string }>;

    	async redeem(params: {
    		id: string;
    		calls: Array<{ to: string; value?: string; data: string }>;
    	}): Promise<{
    		txHash: string;
    	}>;

    	async revoke(params: {
    		id: string;
    		signer: ethers.Signer;
    	}): Promise<{ status: 'revoked'; txHash: string }>;

    	async verify(hash: string, chainId: number): Promise<{ valid: boolean; reason?: string }>;
    }
    ```

    - `grant` wraps: encode → sign via the toolkit → POST `/api/permissions/grant`.
    - `redeem` POSTs `/api/permissions/redeem` (requires bearer).
    - `revoke` builds and sends `DelegationManager.disableDelegation(hash)` via the signer, then POSTs `/api/permissions/revoke` with the resulting tx hash.
    - `verify` hits `/api/permissions/verify`.

3. **Re-export** selected toolkit helpers (`encodeScopedDelegation`, `isDelegationValid`, `delegationToManifestEntry`) from `sdk/src/permissions.ts` for advanced users — but behind `sdk/src/permissions/advanced.ts` sub-entry so tree-shaking works.

4. **Types**: every field documented with JSDoc. Error types mirror canonical error codes.

5. **`sdk/README.md`** — add a **Permissions** section with a 10-line example:

    ```ts
    const client = new AgentSdk({ baseUrl: 'https://three.ws/' }).permissions;
    const metadata = await client.getMetadata(agentId);
    // ...
    ```

6. **Tests**: add `sdk/test/permissions.test.ts` (or `.js` matching convention) covering:

    - URL construction for each method
    - Bearer header is sent when set
    - Error surface: a 403 from the server becomes a thrown `PermissionError` with the right code

    Use `fetch` mocking (`undici` MockAgent or an inline `global.fetch` mock). No network calls in tests.

7. **Build + publish dry run**: `npm pack --dry-run` from the `sdk/` folder; the module must include `permissions.d.ts` in the output. Paste the manifest in the reporting block.

## Don't do this

- Do not duplicate the toolkit implementation in the SDK — import from `src/permissions/toolkit.js` via a relative path or via a `paths` alias if TS. If it's awkward, copy the _types_ but not the implementation.
- Do not bundle ethers into the SDK. Mark it a peer dep.
- Do not add a `broadcastDelegation` / `createAccount` convenience. Those are host concerns.
- Do not inline private keys in the test fixtures.

## Acceptance

- [ ] `PermissionsClient` exported from the SDK's main entry.
- [ ] All five methods have types + docstrings + tests.
- [ ] `npm test` in `sdk/` passes.
- [ ] `npm pack --dry-run` shows `permissions.js`, `permissions.d.ts`, `permissions/advanced.*`.
- [ ] `npm run build:lib` (root) still passes if the SDK is referenced from there.

## Reporting

- `npm pack --dry-run` output.
- Test run transcript.
- Example code diff in the README.
