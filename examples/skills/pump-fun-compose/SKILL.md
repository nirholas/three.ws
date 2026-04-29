# pump-fun-compose

Agent-level loops that compose `pump-fun` (read) and `pump-fun-trade` (sign).

| Tool | Loop |
|---|---|
| `researchAndBuy` | search → vet (curve, holders, creator) → quote → buy |
| `autoSnipe` | poll new tokens → vet → buy until session cap |
| `copyTrade` | watch a wallet's recent buys → mirror with size scaling |
| `rugExitWatch` | watch held mints → sell on concentration or dev-sell triggers |

## Filters (manifest.config)

- `minHoldersForBuy` — reject thin books
- `maxTopHolderPct` — reject whale-controlled supplies
- `rejectIfCreatorRugCount` — reject repeat ruggers
- `exitOnConcentrationPct` / `exitOnDevSellPct` — exit triggers
- `sessionSpendCapSol` / `perTradeSol` — hard spend caps

## Args supported by every loop

- `dryRun: true` — vet/quote runs, `buyToken` / `sellToken` are skipped and `sig: null` is returned. Spend cap still ticks so a dry-run terminates the same way a live one would. Use it to validate filters before going live.
- `sessionId: "<stable-string>"` — persists `seen` / `mirrored` / `spent` / `exited` to `ctx.memory` (in-process `Map` fallback). Reusing the same id resumes a prior session — preventing a crash mid-loop from re-spending up to the cap.
- `signal: AbortSignal` — every poll, sleep, inner-loop, and outer-loop checks `signal.aborted`. Stop is responsive (≤ ~1 RPC call) regardless of `pollMs`.
- `onProgress(evt)` — called on every state change with `{ type, mint?, sig?, spent?, reason? }`. Drive a live UI off it.

The result `data.reason` indicates why the loop exited: `'aborted' | 'duration' | 'cap' | 'all-exited'`.

## Wiring

The host runtime injects:

- `ctx.skills.invoke('skill.tool', args)` — sibling-skill calls
- `ctx.wallet` — used by the trade skill (this one never touches keys directly)
- `ctx.memory.note` — every action is auditable

## Composition example

```js
await ctx.skills.invoke('pump-fun-compose.autoSnipe', { durationSec: 600 });
// then babysit positions
await ctx.skills.invoke('pump-fun-compose.rugExitWatch', {
  mints: heldMints,
  durationSec: 3600,
});
```
