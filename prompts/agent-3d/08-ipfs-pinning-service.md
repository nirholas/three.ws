# Task 08 — Pluggable IPFS pinning service

## Context

[src/erc8004/agent-registry.js](../../src/erc8004/agent-registry.js) hard-codes web3.storage as the only pinning backend (`IPFS_UPLOAD_URL`). The new encrypted memory mode ([04-encrypted-memory.md](./04-encrypted-memory.md)) and manifest builder ([07-manifest-builder-ui.md](./07-manifest-builder-ui.md)) both need pinning.

We should have a single pluggable pinner abstraction that can be swapped at runtime — web3.storage, Filebase, Pinata, a self-hosted IPFS node via the Kubo RPC API, or a local dev pinner that just returns fake CIDs.

## Goal

Ship `src/pinning/` with a `Pinner` interface, three implementations (web3.storage, Filebase, Pinata), and a null-dev pinner. All existing pinning call sites switch to the interface.

## Deliverable

1. **`src/pinning/index.js`** — exports `Pinner` (type/interface comment), `createPinner(config)` factory, `getPinner()` / `setPinner()` for process-wide default.
2. **`src/pinning/web3-storage.js`** — adapted from current [src/erc8004/agent-registry.js](../../src/erc8004/agent-registry.js) `pinToIPFS`.
3. **`src/pinning/filebase.js`** — S3-compatible multipart upload via the existing `@aws-sdk/client-s3` dep. Returns the CID from the bucket's IPFS metadata.
4. **`src/pinning/pinata.js`** — `POST /pinning/pinFileToIPFS` with JWT auth.
5. **`src/pinning/null-dev.js`** — hashes the blob with SHA-256, returns a fake `bafkdev-...` CID, stores content in a local `Map` so fetches by that CID resolve during dev.
6. **Pinner interface contract**:
	 - `async pinBlob(blob: Blob | Uint8Array, opts?: { name, wrapInDir? }): Promise<{ cid: string, size: number }>`
	 - `async pinDirectory(files: Array<{ path, data }>): Promise<{ cid, size }>` — required for bundle-based pins (manifest + body + skills).
	 - `async unpin(cid): Promise<void>` — optional; throw NotImplemented if unsupported.
7. **Refactor call sites**:
	 - [src/erc8004/agent-registry.js](../../src/erc8004/agent-registry.js) — replace `pinToIPFS` with `getPinner().pinBlob()`. Preserve the existing `pinToIPFS` export as a thin wrapper for backwards compat.
	 - Ensure the encrypted-memory task ([04](./04-encrypted-memory.md)) and manifest builder task ([07](./07-manifest-builder-ui.md)) wire to `getPinner()` — not to a specific backend.
8. **Config surface**:
	 - `window.__agent3dPinner` — if set (to a Pinner instance or a config object), initialize the process-wide pinner from it.
	 - Server-side config passthrough: the hosted editor can read env vars (separate task for the backend; this task just defines the shape).

## Audit checklist

- [ ] All four backends pass an integration test: `pinBlob(new Blob(["hello"]))` returns a CID; fetching that CID via a public gateway returns the content. (Null-dev returns a fake CID that resolves in-memory.)
- [ ] `pinDirectory` produces a directory-wrapped CID — fetching `{cid}/manifest.json` works via IPFS gateways.
- [ ] Retries with exponential backoff on 5xx errors (max 3 attempts). 4xx errors fail fast with the provider's error body preserved.
- [ ] Per-request progress events when uploading large blobs (>1MB) — emit via an `onProgress(pct)` option.
- [ ] Credentials are NEVER logged. DevTools network tab shows headers but console is silent.
- [ ] `createPinner({ provider: "unknown" })` throws a clear error listing supported providers.
- [ ] Unit test: all four backends implement the same method signatures.

## Constraints

- No new npm dependencies beyond what's already in package.json (`@aws-sdk/client-s3` is there).
- Do not introduce a backend / server component for pinning — all providers are called directly from the browser (or via the caller's proxy).
- Do not attempt to abstract the IPFS gateway layer here — that's [src/ipfs.js](../../src/ipfs.js)'s job. This task only adds pinning.
- Preserve the `web3.storage` default to avoid breaking existing registration flow.

## Verification

1. `node --check src/pinning/*.js`.
2. `npm run build:all` passes.
3. Manual smoke test per provider (against a real sandbox account or dev credentials from the developer's side). Record the CIDs and confirm gateway fetch.
4. Null-dev test: write a tiny script that pins, then fetches the CID via a small `nullDevFetch(cid)` helper; confirm round-trip.

## Scope boundaries — do NOT do these

- Do not add pinset listing or quota tracking — future task.
- Do not add a GC / unpin-old-versions policy.
- Do not persist pinner state to localStorage — it's session-scoped.
- Do not attempt Helia / js-ipfs embedded node — future-future task.

## Reporting

- Table of the four backends' `pinBlob` latency for a 100KB payload.
- Any provider whose error shape was wildly different; note in code comments.
- Whether the `@aws-sdk/client-s3` dep bloated the bundle — if so, propose dynamic import so Filebase users pay for it and others don't.
