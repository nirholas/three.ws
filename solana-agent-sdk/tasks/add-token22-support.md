# Feature: Token-2022 program support

## Context

`/workspaces/3D-Agent/solana-agent-sdk` is a TypeScript Solana agent SDK (`@three-ws/solana-agent`).
Build command: `cd /workspaces/3D-Agent/solana-agent-sdk && npm run build`
The build must pass with zero errors before this task is complete.

Token-2022 (also called Token Extensions) is Solana's newer token standard. Many modern tokens (including memecoins and DeFi tokens) use `TOKEN_2022_PROGRAM_ID` instead of the original `TOKEN_PROGRAM_ID`. Currently the SDK hardcodes `TOKEN_PROGRAM_ID` everywhere, causing silent failures for Token-2022 tokens.

## What to Build

### Detect the correct program ID for any mint

Create a utility function that fetches a mint's owner program from chain:

**`src/utils/token-program.ts`**:
```ts
import { Connection, PublicKey } from "@solana/web3.js";
import { TOKEN_PROGRAM_ID, TOKEN_2022_PROGRAM_ID } from "@solana/spl-token";

const programCache = new Map<string, PublicKey>();

/**
 * Returns the token program ID (TOKEN_PROGRAM_ID or TOKEN_2022_PROGRAM_ID)
 * for a given mint. Result is cached for the lifetime of the process.
 */
export async function getTokenProgramId(
  connection: Connection,
  mint: PublicKey,
): Promise<PublicKey> {
  const key = mint.toBase58();
  const cached = programCache.get(key);
  if (cached) return cached;

  const info = await connection.getAccountInfo(mint);
  if (!info) throw new Error(`Mint account not found: ${key}`);

  // TOKEN_2022 program is the owner of Token-2022 mints
  const programId = info.owner.equals(TOKEN_2022_PROGRAM_ID)
    ? TOKEN_2022_PROGRAM_ID
    : TOKEN_PROGRAM_ID;

  programCache.set(key, programId);
  return programId;
}
```

### Update `transferSpl`

`src/actions/transfer-spl.ts` currently hardcodes `TOKEN_PROGRAM_ID` in 4 places. Update it to detect the program:

1. After deriving `mint` as `PublicKey`, call `getTokenProgramId(connection, mint)` to get the correct program
2. Replace all hardcoded `TOKEN_PROGRAM_ID` references with the fetched `tokenProgram`
3. Pass `tokenProgram` to `getMint`, `getAssociatedTokenAddressSync`, `createAssociatedTokenAccountInstruction`, and `createTransferCheckedInstruction`

```ts
const mint = typeof params.mint === "string" ? new PublicKey(params.mint) : params.mint;
const to = typeof params.to === "string" ? new PublicKey(params.to) : params.to;

const tokenProgram = await getTokenProgramId(connection, mint);

const mintInfo = await getMint(connection, mint, "confirmed", tokenProgram);
const senderAta = getAssociatedTokenAddressSync(mint, wallet.publicKey, false, tokenProgram, ASSOCIATED_TOKEN_PROGRAM_ID);
const receiverAta = getAssociatedTokenAddressSync(mint, to, false, tokenProgram, ASSOCIATED_TOKEN_PROGRAM_ID);
// ... rest of function uses tokenProgram instead of TOKEN_PROGRAM_ID
```

### Update `getOrCreateAta`

`src/actions/ata.ts` similarly hardcodes `TOKEN_PROGRAM_ID`. Update using the same pattern:

1. Add `connection: Connection` — it's already a parameter
2. After resolving `mint` as `PublicKey`, call `getTokenProgramId(connection, mint)`
3. Replace hardcoded `TOKEN_PROGRAM_ID` with fetched value

### Do NOT update `x402-exact/client.ts` and `x402-exact/facilitator.ts`

The x402 exact scheme uses TransferChecked specifically for established payment tokens (USDC etc.) which are original SPL tokens. Keep those as-is to avoid scope creep.

### Export the utility

**`src/index.ts`** — add:
```ts
export { getTokenProgramId } from "./utils/token-program.js";
```

## Verification

1. `npm run build` passes with zero errors
2. `getTokenProgramId` is exported from the main index
3. `transferSpl` and `getOrCreateAta` use `getTokenProgramId` — no hardcoded `TOKEN_PROGRAM_ID`
4. The program cache means calling with the same mint multiple times only hits RPC once
5. `TOKEN_2022_PROGRAM_ID` is imported from `@solana/spl-token` (it's already a dep — no new deps needed)
