# Task: Complete the encrypted-IPFS memory mode in src/memory/index.js

## Context

The project is three.ws — a platform for 3D AI agents.

The repo is at `/workspaces/3D-Agent`.

`src/memory/index.js` implements a file-based memory system for agents — human-readable `.md` files with YAML frontmatter, an auto-generated `MEMORY.md` index, and an append-only timeline. It supports four storage modes: `local`, `ipfs`, `encrypted-ipfs`, and `none`.

**Current state of the modes:**

- `local` — fully implemented: stores to `localStorage`, files are plain text
- `none` — fully implemented: noop
- `ipfs` — partially implemented: fetches memory files from an IPFS/Arweave gateway on load
- `encrypted-ipfs` — **stub only**: the `Memory.load()` method routes to `_loadIPFS()` for both `ipfs` and `encrypted-ipfs`, but the encrypted path does nothing different — it just loads plaintext files from IPFS same as the regular IPFS mode

The spec for `encrypted-ipfs` mode:
- Memory files are encrypted before being pinned to IPFS
- Only the agent's private key (or a derived key from the agent's wallet) can decrypt them
- This is the mode used for agents with on-chain identity (ERC-8004) who want private memory

**The goal:** Implement the `encrypted-ipfs` mode end-to-end:
1. Encrypt memory files before IPFS upload using AES-256-GCM with a key derived from the agent's wallet signature
2. Decrypt on load
3. Pin encrypted files to IPFS via the backend `/api/agents/:id/memory/pin` endpoint (to be created)

---

## Cryptography design

### Key derivation

The encryption key is derived deterministically from the agent's wallet:
```
key material = ECDH_sign(wallet, "three.ws:memory:v1:" + agentId)
```

In practice, using `ethers.js` Wallet (already a project dep):
```js
const signature = await signer.signMessage(`three.ws:memory:v1:${agentId}`);
// signature is 65 bytes (132 hex chars)
// Use first 32 bytes as AES key material
const keyBytes = ethers.getBytes(signature).slice(0, 32);
const cryptoKey = await crypto.subtle.importKey(
  'raw', keyBytes, { name: 'AES-GCM' }, false, ['encrypt', 'decrypt']
);
```

This key is deterministic: the same wallet + agentId always produces the same key. No key storage needed — re-derive on load.

### Encryption of a single file

```js
async function encryptFile(cryptoKey, plaintext) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const encoded = new TextEncoder().encode(plaintext);
  const ciphertext = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, cryptoKey, encoded);
  // Pack: [12 bytes iv][ciphertext]
  const out = new Uint8Array(12 + ciphertext.byteLength);
  out.set(iv, 0);
  out.set(new Uint8Array(ciphertext), 12);
  return out; // Uint8Array
}

async function decryptFile(cryptoKey, packed) {
  const iv = packed.slice(0, 12);
  const ciphertext = packed.slice(12);
  const plain = await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, cryptoKey, ciphertext);
  return new TextDecoder().decode(plain);
}
```

On IPFS, store the encrypted bytes as-is (binary). The CID then references a binary blob, not a text file.

---

## Backend endpoint

**Create `api/agents/[id]/memory/pin.js`:**

```
POST /api/agents/:id/memory/pin
Body: { filename: string, data: string }  (data is base64url-encoded encrypted bytes)
Returns: { cid: string }
```

This endpoint:
1. Authenticates the request (session or bearer, agent ownership check)
2. Decodes the base64url data
3. Pins to IPFS/Arweave via the existing `src/ipfs.js` gateway pattern — use the Cloudflare R2 + Pinata or Web3.Storage integration already in the project (check `api/_lib/r2.js` and any existing IPFS pinning code in `api/`)
4. Returns the CID

Also **create `api/agents/[id]/memory/[cid].js`:**

```
GET /api/agents/:id/memory/:cid
Returns: binary (encrypted bytes) with Content-Type: application/octet-stream
```

Fetches the encrypted blob from IPFS/R2 and streams it back. Requires agent ownership to prevent enumeration.

---

## Changes to src/memory/index.js

### Memory class constructor

Add `cryptoKey` field:
```js
constructor({ mode, namespace, index, files, timeline, cryptoKey } = {}) {
  ...
  this.cryptoKey = cryptoKey || null;
}
```

### Memory._loadIPFS (update)

```js
static async _loadIPFS({ mode, namespace, manifestURI, fetchFn, deriveKey }) {
  // For encrypted-ipfs: call deriveKey() to get the CryptoKey
  const cryptoKey = mode === 'encrypted-ipfs' ? await deriveKey() : null;

  const base = manifestURI.replace(/manifest\.json$/, '');
  const idxRes = await fetchFn(`${base}memory/MEMORY.md`);
  // ... existing fetch logic ...

  // For encrypted-ipfs: decrypt each file after fetching
  if (mode === 'encrypted-ipfs' && cryptoKey) {
    for (const [filename, content] of files) {
      // content is base64url-encoded encrypted bytes (from IPFS)
      const encrypted = base64urlDecode(content);
      const plain = await decryptFile(cryptoKey, encrypted);
      files.set(filename, plain);
    }
  }

  return new Memory({ mode, namespace, index: ..., files: ..., timeline: ..., cryptoKey });
}
```

### Memory.save (update)

When `mode === 'encrypted-ipfs'`:
1. For each dirty file, encrypt it using `this.cryptoKey`
2. POST the encrypted bytes (base64url) to `/api/agents/${namespace}/memory/pin`
3. Get back a CID
4. Update the `MEMORY.md` index with `ipfs://<cid>` links instead of relative paths

### Memory.load static method (update)

Pass `deriveKey` function through when `mode === 'encrypted-ipfs'`:
```js
static async load({ mode, namespace, manifestURI, fetchFn, deriveKey }) {
  if (mode === 'encrypted-ipfs') {
    if (!deriveKey) throw new Error('encrypted-ipfs mode requires a deriveKey function');
    return Memory._loadIPFS({ mode, namespace, manifestURI, fetchFn, deriveKey });
  }
  // ...
}
```

### Caller update

`src/manifest.js` or wherever `Memory.load()` is called — pass a `deriveKey` function when mode is `encrypted-ipfs`. The `deriveKey` function calls `signer.signMessage(...)` as described above. The signer comes from the agent's wallet (already wired in `src/erc8004/agent-registry.js`).

---

## Files to create/edit

**Create:**
- `api/agents/[id]/memory/pin.js`
- `api/agents/[id]/memory/[cid].js`

**Edit:**
- `src/memory/index.js` — implement encrypt/decrypt in `_loadIPFS`, update `save()` for encrypted-ipfs

**Do not touch:**
- `local` mode behavior
- `ipfs` mode behavior (plaintext IPFS — unchanged)
- `src/agent-memory.js` (the in-memory store — separate)

---

## Acceptance criteria

1. Create a `Memory` instance with `mode: 'encrypted-ipfs'`, add some entries, call `save()`. The IPFS-pinned files are binary (not readable as text). The `MEMORY.md` index contains `ipfs://Qm...` CIDs.
2. Create a new `Memory` instance loading from the same manifest — all entries are recovered correctly.
3. Loading with a wrong key (different wallet signature) produces a `DOMException: The operation failed for an operation-specific reason` — not a crash.
4. `ipfs` mode (plaintext) is completely unaffected.
5. `local` mode is completely unaffected.
6. `POST /api/agents/:id/memory/pin` returns a CID. `GET /api/agents/:id/memory/:cid` returns the encrypted bytes.
7. `npx vite build` passes. `node --check src/memory/index.js` passes.

## Constraints

- ESM only. Tabs, 4-wide.
- Use `crypto.subtle` (Web Crypto API) — no third-party crypto library.
- `ethers` is already a project dep — use it for wallet signing. Don't add a new dep.
- The `deriveKey` function is provided by the caller — `memory/index.js` has no direct dependency on `ethers` or wallet code.
- API endpoints follow the pattern in `api/CLAUDE.md` exactly.
