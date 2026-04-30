# Task: Create walletAuth.js utility module in the chat app

## Goal
Create `/workspaces/3D-Agent/chat/src/walletAuth.js` — a self-contained ES module that
implements EVM (SIWE) and Solana (SIWS) sign-in flows for the chat app, plus
`getCurrentUser()` and `signOut()`. This module only uses browser `fetch`; it has
zero npm dependencies and does not import anything from outside `chat/src/`.

---

## Context

The chat app lives at `/workspaces/3D-Agent/chat/` (Svelte + Vite, no wallet libs).
It shares the same domain as the main site (`three.ws`), so the `__Host-sid` session
cookie set by the backend auth endpoints is automatically available to the chat app.

The backend already has fully working endpoints:

| Endpoint | Method | Purpose |
|---|---|---|
| `/api/auth/me` | GET | Returns `{ user }` if session valid, 401 otherwise |
| `/api/auth/logout` | POST | Destroys the session cookie |
| `/api/auth/siwe/nonce` | GET | Returns `{ nonce, csrf, issuedAt, expiresAt }`, sets `__Host-csrf-siwe` cookie |
| `/api/auth/siwe/verify` | POST | Verifies EIP-4361 message+sig, creates session |
| `/api/auth/siws/nonce` | GET | Returns `{ nonce, csrf, issuedAt, expiresAt }`, sets `__Host-csrf-siws` cookie |
| `/api/auth/siws/verify` | POST | Verifies SIWS message+sig, creates session |

All fetch calls must include `credentials: 'include'` so cookies are sent.

### EVM (SIWE) flow
1. `GET /api/auth/siwe/nonce` → `{ nonce, csrf }`
2. Build EIP-4361 message (plain text, see format below)
3. Call `window.ethereum.request({ method: 'personal_sign', params: [message, address] })`
4. `POST /api/auth/siwe/verify` with `{ message, signature }` and header `x-csrf-token: csrf`

EIP-4361 message format:
```
{host} wants you to sign in with your Ethereum account:
{address}

Sign in to three.ws.

URI: {origin}
Version: 1
Chain ID: {chainId}
Nonce: {nonce}
Issued At: {issuedAt}
```

Getting the EVM address and chainId:
```js
const accounts = await window.ethereum.request({ method: 'eth_requestAccounts' });
const address = accounts[0];
const chainIdHex = await window.ethereum.request({ method: 'eth_chainId' });
const chainId = parseInt(chainIdHex, 16);
```

### Solana (SIWS) flow
1. `GET /api/auth/siws/nonce` → `{ nonce, csrf }`
2. Build SIWS message (CAIP-122 / SIP-0 format, see below)
3. Encode message as UTF-8 bytes, sign with `window.solana.signMessage(bytes)`
4. Base58-encode the 64-byte signature (implement a minimal base58 encoder inline)
5. `POST /api/auth/siws/verify` with `{ message, signature }` and header `x-csrf-token: csrf`

SIWS message format:
```
{host} wants you to sign in with your Solana account:
{address}

Sign in to three.ws.

URI: {origin}
Version: 1
Chain ID: mainnet
Nonce: {nonce}
Issued At: {issuedAt}
```

Getting Solana address:
```js
await window.solana.connect();
const address = window.solana.publicKey.toString();
```

---

## What to implement

```js
// chat/src/walletAuth.js

/**
 * Returns the current user if a valid session exists, otherwise null.
 * @returns {Promise<object|null>}
 */
export async function getCurrentUser() { ... }

/**
 * Destroys the session cookie.
 * @returns {Promise<void>}
 */
export async function signOut() { ... }

/**
 * Sign in with an EVM wallet via EIP-4361 (SIWE).
 * Requires window.ethereum (MetaMask, injected wallet).
 * @returns {Promise<{user: object, wallet: object}>}
 * @throws {Error} if no wallet, user rejects, or server rejects
 */
export async function signInWithEVM() { ... }

/**
 * Sign in with a Solana wallet via SIWS (CAIP-122).
 * Requires window.solana (Phantom or compatible).
 * @returns {Promise<{user: object, wallet: object}>}
 * @throws {Error} if no wallet, user rejects, or server rejects
 */
export async function signInWithSolana() { ... }
```

### Base58 for Solana signatures
The backend accepts base58-encoded signatures. Implement a minimal inline encoder:

```js
const BASE58_ALPHABET = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';
function toBase58(bytes) {
  // BigInt-based encoding
  let n = BigInt('0x' + Array.from(bytes).map(b => b.toString(16).padStart(2, '0')).join(''));
  let result = '';
  const base = BigInt(58);
  while (n > 0n) {
    result = BASE58_ALPHABET[Number(n % base)] + result;
    n /= base;
  }
  for (const byte of bytes) {
    if (byte !== 0) break;
    result = '1' + result;
  }
  return result;
}
```

---

## Success criteria
- File exists at `chat/src/walletAuth.js`
- All four functions are exported
- No imports from outside `chat/src/`
- No npm packages imported (pure browser fetch + window.ethereum/window.solana)
- `getCurrentUser()` returns null (not throws) on 401
- `signOut()` is fire-and-forget (swallows errors)
- Both sign-in functions throw descriptive Errors on failure
