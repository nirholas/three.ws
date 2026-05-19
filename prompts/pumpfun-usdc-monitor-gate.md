# Task: Monitor the pump.fun USDC quote-mint whitelist gate

## Project overview

This is the **three.ws** workspace at `/workspaces/three.ws`. Pump.fun announced that on **Thursday, 2026-05-21**, USDC (`EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v`) will be added as an accepted quote mint on their v2 bonding-curve program. Until that flip, any `buy_v2` / `sell_v2` / `create_v2` instruction with `quoteMint = USDC` is rejected by the program.

The exact moment of the flip isn't published. The gate is observable on-chain via `Global.whitelistedQuoteMints` (read from the pump.fun Global PDA). Today that list contains only the System Program ID (placeholder for native SOL).

## Goal

Detect when USDC is added to `Global.whitelistedQuoteMints` and hand off to the deploy task. This prompt should be runnable at any time — it self-discovers state from the chain.

## Execute

Run the status probe (already in repo):

```bash
cd /workspaces/three.ws
SOLANA_RPC_URL="${SOLANA_RPC_URL:-https://api.mainnet-beta.solana.com}" node scripts/pump-usdc-status.mjs
```

The script reads `Global.whitelistedQuoteMints` directly and additionally simulates a real `buyV2Instructions(quoteMint=USDC)` against mainnet to confirm the program would accept it. It exits 0 either way; parse the output:

- If output contains `USDC whitelisted: YES` → **the gate is open**. Proceed.
- Otherwise → still closed.

## When the gate is open

1. Verify funding for the deploy wallet `4dERfsqLVcqBuULpXYTpBtgZB9X62LfowfxqVL4aAPsH`:

   ```bash
   node -e "const {Connection,PublicKey}=require('@solana/web3.js');const c=new Connection(process.env.SOLANA_RPC_URL||'https://api.mainnet-beta.solana.com');c.getBalance(new PublicKey('4dERfsqLVcqBuULpXYTpBtgZB9X62LfowfxqVL4aAPsH')).then(b=>console.log((b/1e9).toFixed(6),'SOL'));"
   ```

2. If `prompts/pumpfun-usdc-deploy.md` still exists, run that prompt — it has the full launch instructions.
3. If the deploy prompt is gone (already executed and removed), no action; the coin already launched (check `~/.claude/pump-deploy/launch-result.json` for the mint).

## When the gate is still closed

1. Print the current whitelist contents and `createV2Enabled` value to the user.
2. **Do not delete this prompt.** It remains valid until the flip happens.
3. Schedule the next check via `/loop 30m /run-prompt pumpfun-usdc-monitor-gate.md` or have the user re-trigger it.

## Success criteria

- The gate flip is detected within a reasonable window of pump.fun's actual rollout.
- The deploy script runs immediately afterward and either succeeds or surfaces a clear error.

## On completion

When the gate has flipped AND the deploy task has completed successfully (`~/.claude/pump-deploy/launch-result.json` shows `ok: true`):

1. Delete this prompt: `rm /workspaces/three.ws/prompts/pumpfun-usdc-monitor-gate.md`
2. Commit the deletion as `nirholas <nirholas@users.noreply.github.com>`, push to both `origin` and `threews`.

## Notes

- `scripts/pump-usdc-status.mjs` makes 2 mainnet RPC calls (fetchGlobal + fetchBuyState + 1 simulateTransaction). Public RPC is fine but rate-limited; set `SOLANA_RPC_URL=…helius…` for production polling.
- The whitelist flip is the authoritative signal. Marketing dates can slip — only trust the on-chain state.
