# Task 04 — Encrypted IPFS memory mode

## Context

[src/memory/index.js](../../src/memory/index.js) currently supports `mode: "local"` and stubs `ipfs` / `encrypted-ipfs` (the spec describes them; the loader only implements local + a read-only IPFS variant).

When an agent's memory carries real user PII — preferences, confessions to a coach, references to personal goals — the memory bundle MUST be encrypted to the owner wallet. Only the owner can decrypt. Other devices (same wallet) can decrypt too, which is how the agent "follows" the user across devices. See [specs/MEMORY_SPEC.md](../../specs/MEMORY_SPEC.md) § Storage modes.

## Goal

Implement `encrypted-ipfs` memory mode: writes are encrypted to the agent's owner wallet pubkey via an ECIES / libsodium-sealed-box equivalent, pinned to IPFS, and only the owner can read them back.

## Deliverable

1. **Key derivation** in `src/memory/crypto.js` (new file):
	 - Export `deriveEncryptionKey(signer)` — signs a canonical message with the wallet (via `ethers`) and HKDFs a 32-byte key. Use `ethers.hashMessage` + `signer.signMessage` patterns already used in [src/erc8004/agent-registry.js](../../src/erc8004/agent-registry.js).
	 - Export `encryptBlob(plaintext: Uint8Array, key: Uint8Array)` → `{ nonce, ciphertext }` using `crypto.subtle` (`AES-GCM`, 12-byte nonce, authenticated).
	 - Export `decryptBlob({ nonce, ciphertext }, key)` → `Uint8Array` or throws on tamper.
2. **Extend `Memory` class** in [src/memory/index.js](../../src/memory/index.js):
	 - New static `Memory._loadEncryptedIPFS({ namespace, manifestURI, signer, pinner })` — fetch the encrypted blob from IPFS, decrypt with the derived key, parse JSON, hydrate state.
	 - New `_persistEncrypted()` method that serializes memory to JSON, encrypts, uploads via the provided `pinner`, and updates the stored CID (in localStorage for fast recovery AND optionally in `manifest.id.memoryCID` if a signer + registry write is authorized).
	 - Batch persistence: do NOT pin on every write — debounce by ~3s or a manual `flush()` call.
3. **Pinner abstraction** — accept `pinner: (blob) => Promise<{ cid }>` so this task does not bind to a specific pinning service (see [08-ipfs-pinning-service.md](./08-ipfs-pinning-service.md)).
4. **Element integration** — in [src/element.js](../../src/element.js)'s `_boot()`, when `manifest.memory.mode === "encrypted-ipfs"`:
	 - Require a connected signer (if none, surface `agent:error` with `{ phase: "memory", reason: "wallet-required" }`).
	 - Wire the pinner from whichever pinning service is configured (default to `window.__agent3dPinner` if present; otherwise no-op with a console warning).

## Audit checklist

- [ ] Encryption uses an AEAD (AES-GCM or equivalent) — no unauthenticated ciphertext.
- [ ] Key derivation is deterministic for the same wallet so memory follows the user across devices.
- [ ] The canonical signed message is versioned (`agent-3d:memory:v1:{agentId}`) — bump on breaking crypto changes.
- [ ] Tamper detection: modifying the ciphertext by one byte fails decryption with a clear error, not silent corruption.
- [ ] Debounce prevents thrashing pinning service on rapid writes.
- [ ] Offline writes buffer in localStorage and flush when the pinner comes back online.
- [ ] No plaintext memory ever leaves the browser — verify with a network-panel capture.
- [ ] Loading without a signer gracefully falls back to read-only cached state (or surfaces the wallet-required error cleanly).
- [ ] `flush()` resolves only after the CID is recorded — callers can await a durable save.

## Constraints

- Use `crypto.subtle` — no `node-crypto`, no polyfills, no bundle bloat.
- No new npm dependencies (ethers is already a dep).
- Do not commit changes to `manifest.id.memoryCID` on-chain unless the manifest explicitly opts in (`memory.onChainPointer: true`). Chain writes cost money.
- Do not touch [src/runtime/index.js](../../src/runtime/index.js) — the Memory API surface stays the same.

## Verification

1. `node --check src/memory/crypto.js src/memory/index.js`.
2. `npm run build:lib` passes.
3. Integration smoke test in a dev page with a local wallet (hardhat, or signed MetaMask on a testnet):
	 - Write memories, refresh, confirm they load and decrypt.
	 - Use a different wallet — decryption must fail with a clear error.
	 - Flush to IPFS, fetch the CID manually, confirm content is unreadable without the key.

## Scope boundaries — do NOT do these

- Do not introduce multi-signer / shared memory (two wallets unlocking the same bundle). That's a future feature.
- Do not attempt on-chain key registration — key derivation stays purely off-chain + deterministic from signatures.
- Do not re-encrypt every write with a new nonce *and* re-pin the whole bundle if the write is a single-line append — use an append-only blob format OR debounce aggressively (pick one and document).
- Do not mask or rotate nonces per entry — per-bundle nonce is fine given AEAD semantics.

## Reporting

- Chosen debounce interval + whether append-only vs full-rewrite was used.
- Measured round-trip (write → pin → fetch → decrypt) time on a test CID.
- Any UX friction where the user had to re-sign repeatedly; if yes, propose caching the derived key in-memory for the tab lifetime.
- Threat model notes: what this protects against (gateway snoopers, account compromise on other devices) and what it does NOT (compromise of the wallet itself).
