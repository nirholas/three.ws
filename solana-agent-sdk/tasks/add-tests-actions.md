# Tests: Unit tests for action functions

## Context

`/workspaces/3D-Agent/solana-agent-sdk` is a TypeScript Solana agent SDK (`@three-ws/solana-agent`).
Package location: `/workspaces/3D-Agent/solana-agent-sdk/`

The existing `agent-payments-sdk` package uses Jest (`jest.config.ts`, `ts-jest`). This package has no tests yet. Use the same stack.

Install test dependencies:
```bash
cd /workspaces/3D-Agent/solana-agent-sdk
npm install --save-dev jest ts-jest @types/jest
```

Add to `package.json` scripts:
```json
"test": "node --experimental-vm-modules node_modules/.bin/jest"
```

Create `jest.config.ts`:
```ts
import type { Config } from "jest";

const config: Config = {
  preset: "ts-jest/presets/default-esm",
  testEnvironment: "node",
  extensionsToTreatAsEsm: [".ts"],
  moduleNameMapper: {
    "^(\\.{1,2}/.*)\\.js$": "$1",
  },
  transform: {
    "^.+\\.ts$": ["ts-jest", { useESM: true }],
  },
};

export default config;
```

## What to Test

Create `tests/actions/` directory with these test files. All tests must be fully self-contained — mock RPC calls, do not hit mainnet/devnet.

### `tests/actions/transfer-sol.test.ts`

Test `transferSol` from `src/actions/transfer-sol.ts`.

Mock `buildAndSend` to capture what it receives. The tests should verify:

1. **Correct lamport conversion**: `amount: 0.5` → `lamports = 500_000_000`
2. **Correct instruction**: `SystemProgram.transfer` instruction is built with correct `fromPubkey`, `toPubkey`, `lamports`
3. **Metadata is generated**: `opts.meta.label` contains the amount and "SOL"
4. **Metadata kind**: `opts.meta.kind === "transfer"`
5. **String address accepted**: passing `to` as a base58 string works the same as `PublicKey`
6. **Custom meta override**: if `opts.meta` is provided, it's used instead of auto-generated

Use a mock `WalletProvider` with a fixed public key.

### `tests/actions/transfer-spl.test.ts`

Test `transferSpl` from `src/actions/transfer-spl.ts`.

Mock `connection.getAccountInfo`, `connection.getMint` (via `getMint` from spl-token), and `buildAndSend`.

Tests:
1. **Receiver ATA creation**: when `getAccountInfo(receiverAta)` returns null, a `createAssociatedTokenAccountInstruction` is added
2. **No receiver ATA creation**: when receiver ATA exists, no creation instruction
3. **Sender ATA check**: when `getAccountInfo(senderAta)` returns null, throws an error containing "no token account"
4. **TransferChecked instruction**: correct `senderAta`, `mint`, `receiverAta`, `authority`, `amount`, `decimals`
5. **BigInt metadata**: `uiAmount` is correct string — no `Number(bigint)` precision loss

### `tests/actions/swap.test.ts`

Test `jupiterSwap` and `getSwapQuote` from `src/actions/swap.ts`.

Mock `global.fetch` to return controlled Jupiter API responses.

Tests:
1. **Quote fetch**: correct URL is constructed with `inputMint`, `outputMint`, `amount`, `slippageBps`
2. **Default slippage**: when not provided, defaults to 50 bps
3. **Swap request**: correct POST body `{ quoteResponse, userPublicKey, dynamicComputeUnitLimit: true, prioritizationFeeLamports: "auto" }`
4. **Quote error**: when quote API returns non-200, throws `Error` (or `SwapError` if custom errors task is done)
5. **Swap error**: when swap API returns non-200, throws `Error`
6. **Metadata on MetaAwareWallet**: when wallet implements `setNextMeta`, it's called with a swap metadata object including `kind: "swap"`, `amountIn`, `amountOut`
7. **Non-MetaAware wallet**: when wallet doesn't implement `setNextMeta`, no error is thrown

### `tests/actions/ata.test.ts`

Test `getOrCreateAta` from `src/actions/ata.ts`.

Tests:
1. **ATA already exists**: returns `{ ata, signature: undefined }` when `getAccountInfo` returns data
2. **ATA doesn't exist**: builds `createAssociatedTokenAccountInstruction`, calls `buildAndSend`, returns `{ ata, signature: "fakeSig" }`
3. **Default owner**: when `owner` not provided, uses `wallet.publicKey`
4. **Custom owner**: when `owner` is provided, uses that address

## Verification

1. `npm run build` passes with zero errors
2. `npm test` passes with all tests green
3. No test hits an external network (all RPC calls are mocked)
4. Test files are in `tests/` directory, not `src/`
