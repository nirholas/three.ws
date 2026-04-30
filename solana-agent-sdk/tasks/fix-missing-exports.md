# Fix: Missing exports from main index

## Context

`/workspaces/3D-Agent/solana-agent-sdk` is a TypeScript Solana agent SDK (`@three-ws/solana-agent`).
Build command: `cd /workspaces/3D-Agent/solana-agent-sdk && npm run build`
The build must pass with zero errors before this task is complete.

## The Problem

`src/tx/index.ts` exports four functions:
```ts
export { buildAndSend } from "./build.js";
export type { BuildAndSendOptions } from "./build.js";
export { estimatePriorityFee, estimateComputeUnits, priorityFeeIx, computeUnitIx } from "./fees.js";
```

But `src/index.ts` (the main package entry) only re-exports two of them:
```ts
export { buildAndSend, estimatePriorityFee, estimateComputeUnits } from "./tx/index.js";
```

`priorityFeeIx` and `computeUnitIx` are missing. These are useful for advanced consumers who want to build custom transactions with manual compute budget control.

## Fix

### `src/index.ts`

Change line 25 from:
```ts
export { buildAndSend, estimatePriorityFee, estimateComputeUnits } from "./tx/index.js";
```
To:
```ts
export { buildAndSend, estimatePriorityFee, estimateComputeUnits, priorityFeeIx, computeUnitIx } from "./tx/index.js";
```

That's the entire change.

## Verification

1. `npm run build` passes with zero errors
2. `priorityFeeIx` and `computeUnitIx` appear in `dist/index.d.ts` after build
3. A consumer can do: `import { priorityFeeIx, computeUnitIx } from "@three-ws/solana-agent"` without error
