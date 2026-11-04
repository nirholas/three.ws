# Solana programs: devnet proof and mainnet runbook

Four Anchor programs are three.ws's own on-chain Solana surface:

| Program | Source | Role |
| --- | --- | --- |
| `skill_license` | [contracts/skill-license](../../contracts/skill-license) | 1-of-1 NFT access key per purchased skill |
| `agent_invocation` | [contracts/agent-invocation](../../contracts/agent-invocation) | verifiable agent-to-agent invocation events |
| `knock_escrow` | [contracts/knock-escrow](../../contracts/knock-escrow) | escrowed pay-per-reply knocks |
| `event_markets_stake` | [contracts/event-markets-stake](../../contracts/event-markets-stake) | parimutuel event stake pools |

Where each one is deployed, with signatures and the upgrade authority, is recorded in
[contracts/SOLANA_DEPLOYMENTS.md](../../contracts/SOLANA_DEPLOYMENTS.md). That file is the source of truth. Do
not point production env vars at a cluster that file does not list.

## Program keypairs

Each program id is the public key of a keypair kept at
`contracts/<program>/.deploy/<program_name>-program-keypair.json` (gitignored directory, mode 600). The same
file is copied to `contracts/<program>/target/deploy/<program_name>-keypair.json` so `cargo build-sbf` and
`solana-test-validator --bpf-program` use the declared id instead of generating a random one.

Back these four files up to Secret Manager before any mainnet deploy. Losing one means losing the ability to
create the program at that address; an already deployed program is unaffected, because after deployment only the
upgrade authority matters.

```bash
for p in skill_license agent_invocation knock_escrow event_markets_stake; do
  gcloud secrets create "SOLANA_PROGRAM_KEYPAIR_${p^^}" --data-file="contracts/${p//_/-}/.deploy/${p}-program-keypair.json" \
    --project aerial-vehicle-466722-p5
done
```

To rotate an id before anything is deployed anywhere real: generate a new keypair
(`solana-keygen new --no-bip39-passphrase -o <file>`), then change every spelling of the old id. The guard test
`tests/solana-program-ids.test.js` lists them: `declare_id!`, `Anchor.toml`, `contracts/idl/*.json`, the JS
constants, the LiteSVM harness, and the READMEs. The PDA fixtures in `tests/knock-escrow-*.test.js` and
`contracts/program-tests/tests/knock_escrow_pda.rs` also change, because every PDA derives from the program id.

## Build and test

```bash
export PATH="$HOME/.local/share/solana/install/active_release/bin:$HOME/.cargo/bin:$PATH"
for p in skill-license agent-invocation knock-escrow event-markets-stake; do (cd contracts/$p && cargo-build-sbf); done
(cd contracts/program-tests && cargo test)     # LiteSVM, real bytecode
npm run test:stake-program                      # event_markets_stake on a local validator
npx vitest run tests/solana-program-ids.test.js tests/solana-program-deploy-plan.test.js tests/agent-invocation-onchain.test.js
```

## Devnet

```bash
node scripts/deploy-solana-programs.mjs --cluster devnet                     # prints the plan
node scripts/deploy-solana-programs.mjs --cluster devnet --keypair <payer> --yes
node scripts/skill-license-smoke.mjs
node scripts/agent-invocation-smoke.mjs
node scripts/knock-escrow-smoke.mjs
node scripts/event-markets-stake-smoke.mjs
node scripts/onchain-smoke.mjs --only=solana-invoke
```

The smokes use synthetic wallets and a synthetic mint. Set `SMOKE_FUNDER_KEYPAIR` to a funded devnet keypair
file when the public faucet is rate limited.

`api/_lib/agent-invocation-onchain.js` targets devnet unless `AGENT_INVOCATION_NETWORK=mainnet`. It probes the
program account before sending and fails with `program_not_deployed` (HTTP 503) if the program is missing on the
selected cluster, instead of surfacing a raw cluster rejection.

## Mainnet (owner gate)

Deploying spends SOL as rent (the plan table prints the amount) and makes the payer the upgrade authority.
Run the plan first and read it:

```bash
node scripts/deploy-solana-programs.mjs --cluster mainnet-beta --keypair .deploy/mainnet-payer.json
```

That prints the table and exits without sending anything. To execute, the owner adds both flags:

```bash
node scripts/deploy-solana-programs.mjs --cluster mainnet-beta --keypair .deploy/mainnet-payer.json --yes --confirm-mainnet
```

Then hand the upgrade authority to a multisig so a single leaked key cannot replace the code:

```bash
node scripts/deploy-solana-programs.mjs set-upgrade-authority --cluster mainnet-beta \
  --keypair .deploy/mainnet-payer.json --new-authority <multisig-pubkey> --yes --confirm-mainnet
```

After mainnet lands: record signatures and the authority in `contracts/SOLANA_DEPLOYMENTS.md`, set
`AGENT_INVOCATION_NETWORK=mainnet` with `gcloud run services update three-ws-api --update-env-vars` (never
`--set-env-vars`), and update the status notes in the SDK README.
