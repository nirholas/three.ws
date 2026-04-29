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
