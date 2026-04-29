# pump-fun-strategy

Declarative strategies. One JSON spec → live run *or* backtest, sharing the
same evaluator so they cannot drift.

## Spec

```json
{
  "scan":   { "kind": "newTokens", "limit": 20 },
  "filters": [
    "holders.total > 50",
    "holders.topHolderPct < 20",
    "creator.rugCount == 0"
  ],
  "entry": { "side": "buy", "amountSol": 0.05 },
  "exit": [
    { "if": "position.pnlPct > 50",       "do": { "side": "sell", "percent": 50 } },
    { "if": "holders.topHolderPct > 40",  "do": { "side": "sell", "percent": 100 } },
    { "if": "position.ageSec > 1800",     "do": { "side": "sell", "percent": 100 } }
  ],
  "caps": { "sessionSpendCapSol": 0.5, "perTradeSol": 0.05, "maxOpenPositions": 5 }
}
```

### Predicate language

`<lhs> <op> <rhs>` where lhs is a dotted path into the runtime view, op is
one of `> >= < <= == !=`, and rhs is a number (trailing `%` allowed for
readability). The view exposes `holders.*`, `creator.*`, `curve.*`,
`token.*`, `position.*`, `trades.*` — see [dsl.js:buildView](dsl.js).

## Tools

| Tool | Use it for |
|---|---|
| `validateStrategy` | Parse + type-check before running |
| `runStrategy` | Live (with `simulate: true` for dry-run) |
| `backtestStrategy` | Replay against historical trades from `getTokenTrades` |

## Why this matters

Compose-skill loops are imperative and hard to share. The DSL turns a strategy
into a portable artifact you can:

- Backtest before risking SOL
- Hand to another agent to copy-trade
- Diff between versions ("v2 added the 30-min stop")
- Publish on the agent passport as a signed track record
