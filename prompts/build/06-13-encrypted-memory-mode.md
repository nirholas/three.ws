# 06-13 — Onchain: encrypted-IPFS memory mode

**Branch:** `feat/encrypted-memory`
**Stack layer:** 6 (Onchain portability)
**Depends on:** 06-12 (pin fallback)

## Why it matters

[src/agent-memory.js](../../src/agent-memory.js) declares an `encrypted-ipfs` mode but it's a stub — memories are written plaintext and routed through the same path. Real encrypted memory means a user (or the agent's wallet) can publish memory state to IPFS without leaking it to anyone but key holders. This is what makes "agent memory portable across hosts" not a privacy disaster.

## Read these first

| File | Why |
|:---|:---|
| [src/agent-memory.js](../../src/agent-memory.js) | Memory store; mode dispatch. |
| [src/erc8004/agent-registry.js](../../src/erc8004/agent-registry.js) | Pinning helpers. |
| [src/ipfs.js](../../src/ipfs.js) | Fetch helpers (extended in 06-12). |

## Build this

1. Use `WebCrypto` only (no new dep). Implement `src/memory-encryption.js`:
   - `encryptMemory(plaintext, key)` → `{ iv, ciphertext }` (AES-GCM-256).
   - `decryptMemory(blob, key)` → plaintext.
   - `deriveKeyFromSignature(signature, salt)` → CryptoKey (HKDF). The signature is produced by signing a fixed challenge string with the agent's wallet — deterministic per wallet, no plaintext key on disk.
2. Wire into `agent-memory.js`:
   - On `add()` in `encrypted-ipfs` mode: encrypt, pin via dual provider (06-12), persist `{ cid, iv }` in localStorage and (if authed) in `agent_memories` server table.
   - On `recall()`: fetch CID, decrypt, return.
3. Add a key-rotation flow: `rotateKey()` re-encrypts the memory log under a new key, repins, updates pointers. Ship the function but no UI yet.
4. Surface mode in [src/agent-home.js](../../src/agent-home.js): show a tiny lock icon when memory is encrypted.

## Out of scope

- Do not introduce libsodium or a third-party crypto lib — WebCrypto is enough.
- Do not implement multi-key sharing yet (later: NaCl box for agent ↔ user).
- Do not migrate existing plaintext memories.

## Acceptance

- [ ] Memory written in encrypted mode is unreadable on the wire (curl the IPFS CID — gibberish).
- [ ] Reload restores memory by re-deriving key from wallet signature.
- [ ] Rotating key produces a new CID; old CID becomes undecryptable.
- [ ] No UI for picking the mode in this PR — set via `?memory=encrypted-ipfs` URL param.

## Test plan

1. Boot agent with `?memory=encrypted-ipfs`. Sign challenge with MetaMask.
2. Add a memory. Curl the resulting CID — confirm ciphertext.
3. Reload — memory restored.
4. Run `rotateKey()` from devtools — confirm new CID and successful re-decryption.
