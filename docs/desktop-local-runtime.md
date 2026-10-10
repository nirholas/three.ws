# Local agent runtime (three.ws desktop app)

The desktop app can run your trading agents on your own machine. Signing keys
live in the operating system keychain and never leave it. Paper-mode strategies
keep running with no account and no cloud connection at all.

## What runs locally

- **Agents.** Each agent has a name, a mode (`paper` or `live`) and a strategy
  validated by the same schema the cloud uses (`apps/desktop/src/runtime/strategy-schema.js`).
- **Strategies.** The scheduler scans the pump.fun launch feed every minute,
  applies the entry rules, and manages exits (take profit, stop loss).
- **Orders.** Limit orders fire when a coin's price crosses `price_sol_below` or
  `price_sol_above`.
- **Automations.** Interval jobs (`sweep`, `expire_sweep`).
- **Receipts.** Every fill is recorded with the approval hash it ran under.

Prices come from the coin's bonding-curve account read over Solana RPC, so a
paper fill reflects real on-chain reserves (constant product, 1% fee). Nothing
in paper mode signs or sends.

## Keys and custody

Live agents get a keypair generated on your machine and stored in
`userData/runtime/keys.bin`, encrypted with Electron `safeStorage` (macOS
Keychain, Windows DPAPI, Linux Secret Service). If the OS reports that no
keychain is available, live agents are refused (`keychain_unavailable`); paper
agents still work. Keys are never logged: `runtime.log` is redacted (secret
fields, byte arrays, base58 keys, bearer tokens) and crash dumps stay on disk
(`crashReporter` has uploading off).

## Approvals

A live agent in `ask` mode files an approval instead of signing. The approval
shows the same four-row table as the web flow (Recipient, Amount, Asset, Chain)
and carries a sha256 of the canonical JSON of the action, byte-identical to
`api/_lib/approvals.js` (a test compares both implementations).

- The decision happens in a **native dialog** opened by the main process, from
  the tray or from the notification's Review action. The hash is held by the
  runtime and checked again at decide time, so what you approve is exactly what
  was shown. If the stored action changed, nothing runs (`payload_changed`).
- The renderer window can review or deny but has **no approve channel**.
- An approval expires after 15 minutes and runs nothing.
- Killing an agent denies its pending approvals.

## The tray and the mascot

The tray lists each agent with its status (idle, working, waiting for approval,
paused, error, killed) and offers Pause or Resume, Kill (with a confirmation)
and Review for pending approvals. The mascot is the agent's face: a ring around
it shows working, waiting (with a periodic wave) and error (with a jump). The
most urgent state across all agents wins.

## Security model

Context isolation is on, the renderer has no Node access, and every IPC channel
is an explicit allowlist in `src/console-preload.cjs`. Updates come from the
signed release feed configured in `electron-builder.config.cjs` (see
[the desktop release runbook](./ops/forge-desktop-release.md) for the signing
pattern; Companion signing certificates are an owner action).

## Run it headless

```bash
cd apps/desktop
npm install
npm run smoke:runtime
```

The smoke test starts the runtime in a temporary directory, creates a paper
agent, runs the scheduler against the live launch feed and Solana RPC, and
checks the fill, position, receipts, pause, kill and log redaction. It prints
`smoke passed` on success. Unit tests: `npx vitest run tests/desktop-runtime.test.js`.

## Live trades without the cloud

A live buy or sell needs an unsigned transaction. The runtime asks
`/api/pump/buy-prep` (or `sell-prep`) with your session token, signs locally,
sends through RPC, then reports `buy-confirm` or `sell-confirm`. So live mode
needs the cloud reachable for preparation; paper mode needs neither the cloud
nor an account. Syncing configuration and receipts to the cloud account is not
part of this release.

Related: [Companion](./companion.md), [approvals](./api-reference.md), `apps/desktop/README.md`.
