# Solana program deployments

The source of truth for where three.ws's own Anchor programs are deployed. Production env vars must only point
at a cluster listed here with a recorded deploy. The runbook that fills this file is
[docs/ops/solana-programs-mainnet.md](../docs/ops/solana-programs-mainnet.md); `scripts/deploy-solana-programs.mjs`
prints the values to record after each deploy.

## Status

Verified 2026-11-06 with `getAccountInfo` against `api.devnet.solana.com` and `api.mainnet-beta.solana.com`:
every program id below returns no account on either cluster. Nothing is deployed yet, so every route that
depends on these programs runs its off-chain fallback (or reports `program_not_deployed`).

| Program | Program id (`declare_id!`) | Devnet | Mainnet-beta | Deploy signature | Upgrade authority |
| --- | --- | --- | --- | --- | --- |
| `skill_license` | `9rPHPFHmdek5WMH92HHtMuXsbeFBbvsetfbxuVZGsWoj` | not deployed | not deployed | none | none |
| `agent_invocation` | `FGFr3ueSCLjBTcqbXsvcuU6fihDEgNbUnmStCb2FtWPv` | not deployed | not deployed | none | none |
| `knock_escrow` | `ApwxLLTWiEsiv1z3wXjbsGimmyUdbMamR7eKM8rePQuj` | not deployed | not deployed | none | none |
| `event_markets_stake` | `6DsLYSQcYZSegSKgRkRMP93L7uHxvV1cQhm6YoXa9xXU` | not deployed | not deployed | none | none |

## Re-checking

```bash
for id in 9rPHPFHmdek5WMH92HHtMuXsbeFBbvsetfbxuVZGsWoj FGFr3ueSCLjBTcqbXsvcuU6fihDEgNbUnmStCb2FtWPv \
          ApwxLLTWiEsiv1z3wXjbsGimmyUdbMamR7eKM8rePQuj 6DsLYSQcYZSegSKgRkRMP93L7uHxvV1cQhm6YoXa9xXU; do
  for url in devnet mainnet-beta; do solana program show "$id" --url "$url"; done
done
```

## Recording a deploy

After `scripts/deploy-solana-programs.mjs --cluster <cluster> --yes` succeeds, replace the program's row: set the
cluster cell to `deployed YYYY-MM-DD`, add the deploy signature as an explorer link, and the upgrade authority
public key. When authority moves to a cold key or multisig with `set-upgrade-authority`, update that cell and
note the handover signature on a line below the table.
