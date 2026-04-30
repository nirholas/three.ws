# Fix: BigInt precision loss in swap metadata display

## Context

`/workspaces/3D-Agent/solana-agent-sdk` is a TypeScript Solana agent SDK (`@three-ws/solana-agent`).
Build command: `cd /workspaces/3D-Agent/solana-agent-sdk && npm run build`
The build must pass with zero errors before this task is complete.

## The Bug

`src/actions/swap.ts` converts Jupiter quote amounts to JavaScript `Number` for display:

```ts
// lines 59-60
const inUi = (Number(quote.inAmount) / 10 ** inDecimals).toFixed(4);
const outUi = (Number(quote.outAmount) / 10 ** outDecimals).toFixed(4);
```

`quote.inAmount` and `quote.outAmount` are strings from Jupiter's API. They can represent amounts larger than `Number.MAX_SAFE_INTEGER` (9,007,199,254,740,991). For tokens with low decimals (e.g. USDC at 6 decimals) and large amounts (e.g. $10 million = 10,000,000,000,000 base units), this silently produces wrong display values.

Example: `Number("10000000000000")` = `10000000000000` (ok), but `Number("9007199254740993")` = `9007199254740992` (wrong — off by 1, silently).

This only affects the **display strings in `TxMetadata`** — the actual transaction amounts are passed as strings to Jupiter and are not affected.

## Fix

### `src/actions/swap.ts`

Replace the `Number()` conversion with a BigInt-safe division helper:

```ts
function toUiAmount(amountStr: string, decimals: number): string {
  if (decimals === 0) return amountStr;
  const amount = BigInt(amountStr);
  const divisor = 10n ** BigInt(decimals);
  const whole = amount / divisor;
  const frac = amount % divisor;
  const fracStr = frac.toString().padStart(decimals, "0").replace(/0+$/, "");
  return fracStr ? `${whole}.${fracStr}` : whole.toString();
}
```

Replace lines 59-60 with:
```ts
const inUi = toUiAmount(quote.inAmount, inDecimals);
const outUi = toUiAmount(quote.outAmount, outDecimals);
```

Place the helper function at the bottom of the file alongside `shortMint` and `guessDecimals`.

**Also fix the same issue in `src/actions/transfer-spl.ts` line 58:**
```ts
const uiAmount = (Number(params.amount) / 10 ** mintInfo.decimals).toString();
```
Replace with the same `toUiAmount` helper. Either copy the function into `transfer-spl.ts` or extract it to a shared utility.

**Recommended:** Create `src/utils/format.ts` with the `toUiAmount` function and import it in both files. Export it from the main `src/index.ts` as a named export so consumers can use it too.

## Verification

1. `npm run build` passes with zero errors
2. No `Number(bigint)` or `Number(string_that_could_be_large)` calls in `swap.ts` or `transfer-spl.ts`
3. `toUiAmount("9007199254740993", 6)` returns `"9007199254.740993"` (correct)
4. `toUiAmount("1000000", 6)` returns `"1"` (correct for 1 USDC)
5. `toUiAmount("1500000", 6)` returns `"1.5"` (correct)
6. `toUiAmount("100", 0)` returns `"100"` (handles zero decimals)
