# Tests: Unit tests for wallet providers

## Context

`/workspaces/3D-Agent/solana-agent-sdk` is a TypeScript Solana agent SDK (`@three-ws/solana-agent`).
Package location: `/workspaces/3D-Agent/solana-agent-sdk/`

If Jest is not yet set up, install it:
```bash
cd /workspaces/3D-Agent/solana-agent-sdk
npm install --save-dev jest ts-jest @types/jest
```

`jest.config.ts` (create if missing):
```ts
import type { Config } from "jest";
const config: Config = {
  preset: "ts-jest/presets/default-esm",
  testEnvironment: "node",
  extensionsToTreatAsEsm: [".ts"],
  moduleNameMapper: { "^(\\.{1,2}/.*)\\.js$": "$1" },
  transform: { "^.+\\.ts$": ["ts-jest", { useESM: true }] },
};
export default config;
```

`package.json` scripts: `"test": "node --experimental-vm-modules node_modules/.bin/jest"`

The wallet provider source files are in `src/wallet/`:
- `keypair.ts` — `KeypairWalletProvider`
- `browser-server.ts` — `BrowserWalletProvider`
- `browser-client.ts` — `BrowserWalletClient`

## What to Test

Create `tests/wallet/` directory.

### `tests/wallet/keypair.test.ts`

Test `KeypairWalletProvider`.

Generate a test keypair using `Keypair.generate()` from `@solana/web3.js`.

Tests:
1. **Base58 string constructor**: `new KeypairWalletProvider(bs58EncodedKey)` sets correct `publicKey`
2. **Uint8Array constructor**: `new KeypairWalletProvider(keypair.secretKey)` sets correct `publicKey`
3. **Array constructor**: `new KeypairWalletProvider(Array.from(keypair.secretKey))` sets correct `publicKey`
4. **signTransaction (legacy)**: signs a `Transaction`, result has a signature for the keypair's public key
5. **signTransaction (versioned)**: signs a `VersionedTransaction`, result `signatures` array is non-empty
6. **signAndSendTransaction**: mocks `sendAndConfirmTransaction` to return `"fakeSig"`, verifies it's called with the keypair

For test 6, mock the module:
```ts
jest.mock("@solana/web3.js", () => ({
  ...jest.requireActual("@solana/web3.js"),
  sendAndConfirmTransaction: jest.fn().mockResolvedValue("fakeSig"),
}));
```

### `tests/wallet/browser-server.test.ts`

Test `BrowserWalletProvider`.

Tests:
1. **Constructor defaults**: `sessionId` is a UUID string, `publicKey` is set from options
2. **String publicKey**: constructor accepts base58 string, converts to `PublicKey`
3. **setNextMeta**: calling `setNextMeta(meta)` then `signTransaction` attaches `meta` to the pending tx
4. **signTransaction creates pending entry**: after calling `signTransaction`, `getPending()` has one entry
5. **signTransaction pending has correct fields**: `id`, `transaction` (base64), `versioned`, `createdAt`, `meta`
6. **submitSigned resolves the promise**: calling `submitSigned(id, signedBase64)` resolves the pending `signTransaction` promise
7. **submitRejected rejects the promise**: calling `submitRejected(id)` rejects with an error containing "rejected"
8. **timeout**: if neither `submitSigned` nor `submitRejected` is called within `timeoutMs`, the promise rejects with "timed out"
9. **meta consumed once**: after one `signTransaction` call, `nextMeta` is cleared; a second call has `meta: undefined`

For test 8, use a short `timeoutMs` (e.g. 50ms) and `jest.useFakeTimers()`.

For test 6, build a valid signed transaction:
```ts
const tx = new Transaction();
tx.recentBlockhash = "11111111111111111111111111111111";
tx.feePayer = Keypair.generate().publicKey;
const signed = Buffer.from(tx.serialize({ requireAllSignatures: false })).toString("base64");
```

### `tests/wallet/browser-client.test.ts`

Test `BrowserWalletClient`. This file runs in Node.js but `BrowserWalletClient` uses `EventSource` and browser globals (`fetch`, `atob`, `btoa`). Mock them.

Setup:
```ts
global.fetch = jest.fn();
global.EventSource = jest.fn().mockImplementation((url: string) => ({
  onmessage: null,
  onerror: null,
  close: jest.fn(),
})) as any;
```

Tests:
1. **connect() opens EventSource**: after `client.connect()`, `EventSource` constructor was called with `baseUrl + "/stream"`
2. **disconnect() closes EventSource**: after connect then disconnect, `close()` is called
3. **onmessage triggers signing**: simulate a message event with a pending tx; verify `signer` is called
4. **auto-sign without onApproval**: signer is called immediately when a message arrives (no approval step)
5. **onApproval blocks signing**: when `onApproval` is provided, signer is NOT called until `approve()` is invoked
6. **onApproval reject path**: calling `reject()` in handler calls `fetch` to the `/reject/:id` endpoint, signer is NOT called
7. **onConfirmed fires**: when the sign POST returns `{ ok: true, signature: "abc" }`, `onConfirmed` is called with the pending tx and `"abc"`
8. **reconnect on error**: simulate `onerror`, verify a new `EventSource` is created after `reconnectMs`

Use `jest.useFakeTimers()` for test 8.

## Verification

1. `npm run build` passes
2. `npm test` passes — all tests green
3. No test uses real network connections
4. `tests/wallet/` contains three test files
