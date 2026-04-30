# Fix: Compute unit fallback is too high for simple transfers

## Context

`/workspaces/3D-Agent/solana-agent-sdk` is a TypeScript Solana agent SDK (`@three-ws/solana-agent`).
Build command: `cd /workspaces/3D-Agent/solana-agent-sdk && npm run build`
The build must pass with zero errors before this task is complete.

## The Problem

`src/tx/fees.ts` line 35:
```ts
const units = sim.value.unitsConsumed;
if (!units) return 200_000;
return Math.ceil(units * 1.1);
```

When simulation returns 0 or `undefined` for `unitsConsumed`, the fallback is 200,000 CUs. This is roughly 40x too high for a simple SOL transfer (~5,000 CUs) and ~4x too high for a simple SPL transfer (~50,000 CUs). Users pay fees for CUs they don't use.

The `1.1x` multiplier is also applied on top of whatever the simulation returns, which is correct but the fallback itself needs to be smarter.

Additionally, `sim.value.err` is not checked — if simulation fails (e.g. insufficient funds), the function silently returns the fallback instead of throwing.

## Fix

### `src/tx/fees.ts`

**1. Check for simulation errors and throw:**
```ts
if (sim.value.err) {
  throw new Error(`Transaction simulation failed: ${JSON.stringify(sim.value.err)}`);
}
```

**2. Lower the fallback and make it instruction-count-aware:**
```ts
const units = sim.value.unitsConsumed;
if (!units) {
  // Rough heuristic: 10_000 base + 20_000 per instruction (conservative but not wasteful)
  const instructionCount = instructions.length;
  return Math.min(200_000, 10_000 + instructionCount * 20_000);
}
return Math.ceil(units * 1.1);
```

This gives:
- 1 instruction (SOL transfer): 30,000 CU fallback (vs 200,000 before)
- 2 instructions (SPL transfer + ATA create): 50,000 CU fallback
- Still caps at 200,000 for complex txs

**3. Full updated `estimateComputeUnits` function:**
```ts
export async function estimateComputeUnits(
  connection: Connection,
  instructions: TransactionInstruction[],
  payer: PublicKey,
): Promise<number> {
  const { blockhash } = await connection.getLatestBlockhash();
  const msg = new TransactionMessage({
    payerKey: payer,
    recentBlockhash: blockhash,
    instructions,
  }).compileToV0Message();

  const sim = await connection.simulateTransaction(
    new VersionedTransaction(msg),
    { sigVerify: false },
  );

  if (sim.value.err) {
    throw new Error(`Transaction simulation failed: ${JSON.stringify(sim.value.err)}`);
  }

  const units = sim.value.unitsConsumed;
  if (!units) {
    return Math.min(200_000, 10_000 + instructions.length * 20_000);
  }
  return Math.ceil(units * 1.1);
}
```

**Note:** The simulation error throw changes behaviour — previously a failed simulation would silently fall back to 200,000 CUs and the real transaction would also fail. Now it fails fast with a clear error. This is strictly better.

## Verification

1. `npm run build` passes with zero errors
2. `estimateComputeUnits` throws if `sim.value.err` is set
3. Fallback for 1 instruction is ≤ 30,000 (not 200,000)
4. Fallback still caps at 200,000
