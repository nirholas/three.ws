# evals/

Eval suites run by [scripts/evals.mjs](../scripts/evals.mjs).

- `suites/smoke.json`: quick agent sanity checks.
- `suites/trading.json`: trading-agent behavior checks.

Run reports are written to `evals/reports/`, which is git-ignored. Add a new suite by dropping a JSON file in `suites/` in the same shape as the existing ones.
