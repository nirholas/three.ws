# Pump Protocol IDLs

Vendored Anchor IDLs for the three on-chain Pump programs. Imported from the
[pump-fun/pump-public-docs](https://github.com/pump-fun/pump-public-docs)
repository (via [nirholas/pumpkit](https://github.com/nirholas/pumpkit)) and
checked in so the API + worker layers can decode instructions and events
without an extra HTTP fetch on cold start.

| File | Program | Program ID |
| --- | --- | --- |
| `pump.json` | Pump bonding-curve | `6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P` |
| `pump_amm.json` | PumpSwap AMM | `pAMMBay6oceH9fJKBRHGP5D4bD4sWpmSwMn52FMfXEA` |
| `pump_fees.json` | Pump fees / cashback | `pfeeUxB6jkeY1Hxd7CsFCAjcbHA9rWtchMGdZ6VojVZ` |

Constants are also exposed programmatically in
[`api/_lib/solana/programs.js`](../../../api/_lib/solana/programs.js).

To refresh, re-run:

```bash
for f in pump pump_amm pump_fees; do
  curl -sL "https://raw.githubusercontent.com/pump-fun/pump-public-docs/main/idl/$f.json" \
    -o "contracts/idl/pump/$f.json"
done
```
