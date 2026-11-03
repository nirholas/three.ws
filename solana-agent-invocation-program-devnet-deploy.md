---
slug: solana-agent-invocation-program-devnet-deploy
title: agent_invocation Solana program deployed on devnet with a passing live smoke and a mainnet-ready runbook
tier: GATED
score: 58
area: solana
sources: contracts/agent-invocation/README.md, contracts/agent-invocation/Anchor.toml, agent-protocol-sdk/README.md, scripts/agent-invocation-smoke.mjs, api/_lib/agent-invocation-onchain.js
---

## Why this matters

The agent-to-agent invocation primitive (`invoke_skill` emitting a verifiable `SkillInvoked` event) is fully written: Anchor program, TypeScript SDK, API helper and a smoke script. None of it can work because program id `AgEntJDMi1A7UadCoYcx6Fm3gusNk8SHLCi7vSUa4Zfo` is not deployed on devnet or mainnet, and the deploy authority secret named in the README does not exist in Secret Manager. Every on-chain A2A claim on the platform therefore rests on a program that cannot be called. Solana is the home chain, so this is the first on-chain A2A surface to light up.

## Current state (measured by the reviewer on 2026-11-03)

- Program source in `contracts/agent-invocation/src`, tests in `contracts/agent-invocation/tests/agent-invocation.ts`, `Anchor.toml` and `Cargo.toml` present.
- `solana program show AgEntJDMi1A7UadCoYcx6Fm3gusNk8SHLCi7vSUa4Zfo` returns "not found" on devnet and mainnet-beta (the SDK README confirms the same as of 2026-08-11).
- `scripts/agent-invocation-smoke.mjs` drives the published SDK against the live program; it has never had a program to run against. `api/_lib/agent-invocation-onchain.js` defaults `AGENT_INVOCATION_NETWORK` to `mainnet`.
- The README says the deploy authority is kept in Secret Manager as `AGENT_INVOCATION_DEPLOY_AUTHORITY`; `gcloud secrets list` does not contain it. The program id has a vanity `AgEnt` prefix, so the matching program keypair must exist somewhere or be regenerated (`workers/vanity-grinder` exists for exactly this).
- `anchor`, `solana` and `cargo` toolchains may not be installed in the working environment.

## Step 0: re-derive the current state

```bash
cd /home/user/three.ws
for c in devnet mainnet-beta; do echo "== $c"; solana program show AgEntJDMi1A7UadCoYcx6Fm3gusNk8SHLCi7vSUa4Zfo --url $c 2>&1 | head -3; done
gcloud secrets list --project aerial-vehicle-466722-p5 --format='value(name)' | grep -i -E 'invocation|vanity|program' || echo "no program secrets"
which anchor solana cargo; anchor --version 2>&1 | head -1
grep -n declare_id contracts/agent-invocation/src/lib.rs
node scripts/onchain-smoke.mjs --only=solana-invoke 2>&1 | tail -5
```

## Tasks

1. Toolchain: if `anchor`, `solana` or `cargo` are missing, install the versions pinned in `contracts/agent-invocation/Anchor.toml` and `Cargo.toml` (anchor-cli, solana-cli via the official installer, rustup). Run `anchor build` and `anchor test` in `contracts/agent-invocation` and fix any failure test-first. Commit nothing from `target/`.
2. Program keypair: determine whether the keypair for `AgEntJDMi1A7UadCoYcx6Fm3gusNk8SHLCi7vSUa4Zfo` exists (Secret Manager, the vanity-grinder worker output, local `~/.config/solana`). If it exists, record only the secret name. If it does not, grind a replacement `AgEnt` prefix key with `workers/vanity-grinder` (CPU only, no spend), then update `declare_id!` in the program, `Anchor.toml` (all clusters), the SDK constant in `agent-protocol-sdk/src`, the default in `api/_lib/agent-invocation-onchain.js`, the IDL, the READMEs, and the tests that hard-code the id (`grep -rn AgEntJDMi1A7UadCoYcx6Fm3gusNk8SHLCi7vSUa4Zfo`). Store the new keypair in Secret Manager as `agent-invocation-program-keypair` (create with `gcloud secrets create`; the value never touches the repo or logs).
3. Deploy authority: create a dedicated devnet-only deploy keypair, store it as the secret the README names (`AGENT_INVOCATION_DEPLOY_AUTHORITY`), fund it with a devnet airdrop (faucet, no real value), and reconcile the README wording with reality.
4. Devnet deploy (free): `anchor deploy --provider.cluster devnet` using the secrets above fetched into a temp file with mode 600 and deleted afterwards. Then run `SOLANA_RPC_URL_DEVNET=... node scripts/agent-invocation-smoke.mjs` and `node scripts/onchain-smoke.mjs --only=solana-invoke`; both must pass against the live devnet program. Record the deploy signature and program data address.
5. Make the API honest: in `api/_lib/agent-invocation-onchain.js` add a cached `isProgramDeployed(network)` probe (executable account check) and have the invocation route report a clear `program_not_deployed` error for the configured network instead of a raw cluster rejection. Write `tests/agent-invocation-onchain.test.js` covering instruction building and PDA derivation against fixed vectors, and the deployed-probe branches.
6. Add `contracts/agent-invocation/DEPLOYMENT.md`: the exact mainnet runbook (rent estimate from `solana program show` size, buffer write, `solana program deploy`, upgrade-authority handover to the team multisig, verifiable build with `solana-verify`), with a confirmation table (cluster, program id, SOL cost, authority) that the owner approves before the mainnet step. Mainnet is not executed here.
7. Add `AGENT_INVOCATION_NETWORK` documentation and set the default to `devnet` until a mainnet deploy is recorded, so nothing silently targets an undeployed mainnet program. Update `agent-protocol-sdk/README.md` status note with today's date and the devnet explorer link.
8. Changelog entry (developer-facing) and `npm run audit:docs`.

## Definition of done

- [ ] `solana program show <id> --url devnet` shows an executable program owned by the BPF upgradeable loader.
- [ ] `node scripts/agent-invocation-smoke.mjs` exits 0 against devnet and prints the decoded `SkillInvoked` event.
- [ ] `anchor test` passes in `contracts/agent-invocation`.
- [ ] `npx vitest run tests/agent-invocation-onchain.test.js` passes.
- [ ] `grep -rn "not yet deployed" agent-protocol-sdk/README.md contracts/agent-invocation/README.md` finds nothing stale; both state the devnet deployment and that mainnet awaits owner approval.
- [ ] No keypair material in `git diff` (`git diff | grep -E '\[[0-9]+,[0-9]+,[0-9]+'` is empty).

## Never blocked

| Blocker | Resolution (act, do not ask) |
|---|---|
| Devnet faucet rate-limited | Retry with backoff, try the alternate RPC faucets, or fund from another devnet wallet; the smoke script already retries |
| Original `AgEnt` program keypair is lost | Grind a new `AgEnt` prefix with `workers/vanity-grinder` and update every reference (Task 2) |
| anchor/solana not installable in the sandbox | Run the build and deploy as a Cloud Build step on the `three-ws-build@` account with a throwaway builder image |
| Anchor version mismatch with the lockfile | Use the versions pinned in Anchor.toml via `avm install` |

## Gates

The mainnet deploy of the program is a real SOL spend and an on-chain write: stop before it, render cluster, program id, rent in SOL and upgrade authority, and ask for the explicit yes/no. All such asks are batched into one message at the end. Everything above (devnet deploy, smoke, runbook) is free and proceeds without asking.
