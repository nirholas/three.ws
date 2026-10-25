# Repo → Coin Launcher

Launch one pump.fun coin per public GitHub repo, with **100% of creator rewards
routed to the repo owner's GitHub identity**. Ships as a visual control panel and
a CLI over one shared engine.

- Engine: [`scripts/lib/pump-launch-core.mjs`](../scripts/lib/pump-launch-core.mjs)
- CLI: [`scripts/pump-launch-repos.mjs`](../scripts/pump-launch-repos.mjs) — `npm run pump:launch`
- UI: [`scripts/pump-launch-server.mjs`](../scripts/pump-launch-server.mjs) + [`scripts/pump-launch-ui/`](../scripts/pump-launch-ui/) — `npm run pump:launch:ui`

## How the reward routing works

pump.fun keys a deterministic **social-fee escrow PDA** off the numeric GitHub
user id: `socialFeePda(id, 2)` (platform `2` = GitHub). Each coin is launched by
a throwaway repo wallet (the on-chain `creator` + payer). Immediately after
create, a fee-sharing config is opened and its **only shareholder is set to that
PDA at 10000 bps (100%)** — the launch wallet keeps the fee-sharing admin
authority but 0% of the fees. The GitHub owner claims from the escrow by linking
a Solana wallet (or, if already linked on three.ws, fees stream straight to it
via the permissionless distribute crank).

This is the same mechanism the studio uses in
[`api/pump/[action].js`](../api/pump/[action].js) (`resolve-github-shareholder`,
`fee-sharing-agent`). Nothing here hardcodes a third-party mint — the recipient
and mints are derived at runtime.

## Wallet model

One **master wallet** (you fund it once) → funds N throwaway **repo wallets** →
each repo wallet launches its own coin. Every private key is written **only**
under `.pump-launch-wallets/` (gitignored) and bundled into
`pump-launch-wallets.zip` for download. You own every launch key; nothing is
custodial or server-side.

## Quick start (UI)

```bash
npm run pump:launch:ui      # http://localhost:4599  (localhost only)
```

1. Enter a GitHub username → the panel resolves the id + escrow PDA and loads
   every public repo with covers, stars, language, and an auto-ticker.
2. Select repos (all preselected). Search `/`, filter forks/archived/starred,
   sort, `⌘A` to select all.
3. Set the dev buy and fund-per-wallet; the cost bar updates live.
4. **Generate wallets** → a fund modal shows the master address + QR, live
   balance gate, and the keys `.zip` download.
5. Fund the master; **Launch** streams per-repo progress (fund → create →
   fee-config → delegate) with explorer links. Resumable.

## Quick start (CLI)

```bash
node scripts/pump-launch-repos.mjs generate --github-user nirholas
node scripts/pump-launch-repos.mjs verify        # prove every launch key is yours
node scripts/pump-launch-repos.mjs preflight     # upload metadata + build ixs, no send
# fund the printed master wallet, then:
node scripts/pump-launch-repos.mjs run --rpc "<helius url>" --yes
node scripts/pump-launch-repos.mjs status
```

Flags: `--network mainnet|devnet` · `--rpc <url>` · `--github-user` ·
`--github-id` · `--dev-buy <sol>` · `--fund-per-wallet <sol>` · `--only <repo>` ·
`--limit <n>` · `--yes`.

## Cost

Per coin (SOL): create rent `~0.020` + fee-sharing config rent `~0.0025` + tx
fees `~0.0003` + your dev buy. Default fund-per-wallet ≈ `0.027`. For 146 repos
that's ≈ **3.9 SOL** to the master. The dev buy dominates nothing — a minimal or
zero buy is cheapest and cleanest (`--dev-buy 0` uses the plain create path).

For an exact figure, run one launch on `--network devnet` and read the measured
lamport delta before committing mainnet SOL.

## Safety

- **Meant for localhost only.** The UI is a local tool with no authentication and
  serves the key bundle download, and `server.listen` is called without a host, so
  Node accepts connections on every interface. Run it on a machine you trust and
  keep port `4599` firewalled; never forward or tunnel it. Keys never leave your
  machine through the app itself, and key files are written with mode `0600`.
- **Nothing is sent until you Launch** against a funded master. `generate`,
  `verify`, `preflight`, and repo browsing are all free and offline of on-chain
  spend.
- **`.pump-launch-wallets/` and `pump-launch-wallets.zip` are gitignored.** Keep
  the zip private — it contains spendable keys.
- Mainnet launches are irreversible. Launching many coins at once can read as
  spam; scope deliberately.

## RPC

Mainnet defaults to the `https://three.ws/api/solana-rpc` proxy, which
rate-limits under the ~450 txs a full run makes. Pass a dedicated `--rpc`
(Helius) or set `SOLANA_RPC_URL` for real runs.
