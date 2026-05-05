# 05 — Vanity Address Generator: replace `Math.random()` simulation with real ed25519 keypairs

## Problem
[pump-dashboard.html](../../pump-dashboard.html) lines ~1849–1906 implement the Vanity Generator using `Math.random()` to pick base58 characters and produce an "address" string that is **not** a real keypair — it has no corresponding private key. The code itself even labels it a demo and tells the user to "use the Rust vanity generator for production keypairs". This is shipped to a production page and violates [CLAUDE.md](../../CLAUDE.md) rule #1 (no mocks/placeholders).

## Outcome
The Vanity Generator produces **real** Solana keypairs in a Web Worker until prefix/suffix match. On match, the panel renders the public address and offers a "Reveal Secret Key" toggle plus a "Download keypair JSON" button (Solana CLI `id.json` array format). The attempts/sec readout reflects real throughput from the worker, not a `requestAnimationFrame` smear.

## Use what already exists
- `@noble/curves` is already a project dependency (see [package.json](../../package.json)) — use `import { ed25519 } from '@noble/curves/ed25519'` for fast keypair generation in a worker.
- `bs58` is already a dependency — use it to base58-encode the 32-byte public key.
- `crypto.getRandomValues` for the 32-byte seed.

Do NOT introduce a server-side keygen endpoint — keys must never leave the user's browser.

## Implementation
1. Create `src/pump/vanity-worker.js` as an ES module Web Worker:
   - On `start` message → loop: generate a 32-byte seed via `crypto.getRandomValues`, derive `ed25519.getPublicKey(seed)`, base58-encode it, test prefix/suffix (case-sensitive — base58 is case-significant). Post `progress` messages with `{ attempts }` every ~250ms. On match, post `match` with `{ publicKey, secretKeyBytes: Array.from(64ByteSecretKey) }` where the 64-byte form is `[seed(32) || publicKey(32)]` (Solana CLI format). On `stop` message → break the loop.
2. In [pump-dashboard.html](../../pump-dashboard.html):
   - Replace the `generateBatch`/`startVanity`/`stopVanity` block with a real worker driver. Spawn the worker on Start, terminate on Stop or on match.
   - Show real attempts/sec computed from worker `progress` deltas.
   - On match, show the real public address and two real buttons:
     - **Reveal secret key** toggles a base58-encoded secret display with a copy-to-clipboard button.
     - **Download keypair JSON** triggers a download of the 64-byte secret as a JSON array (Solana `solana-keygen` import format).
   - Validate prefix/suffix inputs against the base58 alphabet (`123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz`); reject invalid characters with a real toast — do not silently strip.
3. Remove the line that says "This is a demo. Use the Rust vanity generator for production keypairs." and remove the `base58chars` lookup that sat alongside the simulation.

## Definition of done
- Open the panel, set prefix `pump` (4 chars), click Generate. After it matches, copy the address into `solana-keygen pubkey -` after pasting the downloaded JSON, and confirm the printed pubkey equals what the UI showed.
- Worker terminates on Stop and on match — no zombie workers (verify in DevTools → Application → Workers).
- The string `Math.random` no longer appears in the vanity code path.
- The string `"this is a demo"` no longer appears anywhere in the file.
- `npm test` green; **completionist** subagent run on changed files.
