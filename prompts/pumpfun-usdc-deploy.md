# Task: Launch the inaugural USDC-paired pump.fun coin

## Project overview

This is the **three.ws** workspace at `/workspaces/three.ws` — a Three.js / Vite + Vercel-functions app for AI-agent tokenization on pump.fun. Pump.fun is enabling USDC as a quote mint on **Thursday, 2026-05-21** (the SDK and our backend wiring are already in place; this task is the first real on-chain USDC launch).

## Goal

Deploy a USDC-paired pump.fun coin via direct SDK call (bypassing the API auth flow), then write the result to `~/.claude/pump-deploy/launch-result.json`. Coin parameters:

- **name:** `USDC`
- **symbol:** `USDC`
- **description:** `testing 3D AI Agents with USDC on PumpFun`
- **initial buy:** 10 USDC
- **quote mint:** `EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v` (mainnet USDC)

## Preconditions (verify before doing anything)

Run these checks and abort with a clear message if any fail:

```bash
# 1. Deploy wallet keypair exists
test -f ~/.claude/pump-deploy/wallet.json || { echo "Missing wallet.json — generate via scripts/pump-vanity-grind.mjs"; exit 1; }

# 2. Vanity mint keypair exists
test -f ~/.claude/pump-deploy/mint-latest.json || { echo "Missing mint-latest.json — run: PREFIX=usdc node scripts/pump-vanity-grind.mjs"; exit 1; }

# 3. Wallet is funded with >= 0.03 SOL + >= 10 USDC
node -e "
const { Connection, Keypair, PublicKey } = require('@solana/web3.js');
const { getAssociatedTokenAddress, getAccount } = require('@solana/spl-token');
const fs = require('fs'), os = require('os'), path = require('path');
const w = Keypair.fromSecretKey(Uint8Array.from(JSON.parse(fs.readFileSync(path.join(os.homedir(), '.claude/pump-deploy/wallet.json')))));
const USDC = new PublicKey('EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v');
(async () => {
  const c = new Connection(process.env.SOLANA_RPC_URL || 'https://api.mainnet-beta.solana.com', 'confirmed');
  const sol = await c.getBalance(w.publicKey);
  let usdc = 0n;
  try {
    const ata = await getAssociatedTokenAddress(USDC, w.publicKey, false);
    const acc = await getAccount(c, ata);
    usdc = acc.amount;
  } catch {}
  console.log('SOL:', (sol/1e9).toFixed(6), 'USDC:', (Number(usdc)/1e6).toFixed(6));
  if (sol < 0.03e9 || usdc < 10_000_000n) { console.error('Underfunded'); process.exit(1); }
})();
"
```

The deploy wallet pubkey is `4dERfsqLVcqBuULpXYTpBtgZB9X62LfowfxqVL4aAPsH`. If the user hasn't funded it, surface the address and bail — don't try to deploy.

## Execute

The complete launch script is in this repo at `scripts/pump-launch-usdc.mjs`. It:

1. Loads the wallet + vanity mint keypairs from `~/.claude/pump-deploy/`
2. Verifies SOL + USDC balances on mainnet
3. Reads `Global.whitelistedQuoteMints` and reports whether the USDC gate is open
4. Uploads metadata (1×1 PNG + JSON descriptor) to `https://pump.fun/api/ipfs`
5. Calls `offline.createV2AndBuyV2Instructions({ quoteMint: USDC, … })`
6. Builds + signs a v0 versioned tx (wallet + mint as co-signers)
7. **Simulates against mainnet first**
   - If sim fails AND USDC gate is closed → records `{ ok: false, reason: 'usdc_gate_closed' }` and exits; **does not submit**
   - If sim fails for any other reason and not DRY_RUN → records the error and exits
   - If sim passes → proceeds
8. Submits, waits for confirmation
9. Writes `~/.claude/pump-deploy/launch-result.json` with the outcome

Run:

```bash
cd /workspaces/three.ws
node scripts/pump-launch-usdc.mjs
```

Optional env overrides:

- `SOLANA_RPC_URL=https://…helius…` (recommended — public RPC is rate-limited)
- `DRY_RUN=1` simulate only, never submit
- `USDC_BUY_IN_ATOMICS=5000000` override initial buy (default 10000000 = 10 USDC)

## Success criteria

`~/.claude/pump-deploy/launch-result.json` has `{ "ok": true, "tx_signature": "…", "mint": "…", "pump_url": "https://pump.fun/coin/…" }`.

If `ok: false` with `reason: "usdc_gate_closed"`: pump.fun's whitelist hasn't flipped yet. **Do not delete this prompt** — re-run after Thursday 2026-05-21 (see `prompts/pumpfun-usdc-monitor-gate.md` if it still exists).

If `ok: false` for any other reason: read the recorded error, fix the underlying issue (insufficient funds, RPC failure, etc.) and re-run.

## On completion

When `~/.claude/pump-deploy/launch-result.json` shows `ok: true`:

1. Print the mint, tx signature, and pump.fun URL to the user.
2. Delete this prompt file: `rm /workspaces/three.ws/prompts/pumpfun-usdc-deploy.md`
3. Commit the deletion + any related changes as `nirholas <nirholas@users.noreply.github.com>`, push to both `origin` and `threews`.
4. If the user wants the coin linked to a three.ws agent_identity, hand off to `prompts/pumpfun-usdc-link-agent.md`.

## Notes

- This bypasses the `/api/pump/launch-prep` flow because that path requires session-cookie auth that isn't available to a script. The coin lands on-chain regardless; database linking is a separate prompt.
- Do not commit anything under `~/.claude/pump-deploy/` — those files contain secret keys and live outside the repo for a reason.
- The vanity mint was ground for `usdc`-prefix; the public address starts with `USDC…`. Don't regenerate unless explicitly asked.
