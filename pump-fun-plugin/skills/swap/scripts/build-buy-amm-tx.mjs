#!/usr/bin/env node
/**
 * Only use this script when the user explicitly requests it. Default: POST https://fun-block.pump.fun/agents/swap
 * (inputMint = NATIVE_MINT for buy, outputMint = token mint)
 */
import { parseArgs } from "node:util";
import BN from "bn.js";
import {
  OnlinePumpAmmSdk,
  PUMP_AMM_SDK,
  canonicalPumpPoolPda,
} from "@pump-fun/pump-swap-sdk";
import { PUMP_SDK, bondingCurvePda } from "@pump-fun/pump-sdk";
import { getConnection } from "./lib/env.mjs";
import { AMM_BUY_SELL_DEFAULT_UNITS } from "./lib/constants.mjs";
import {
  exitWithHelp,
  parsePositiveInt,
  parseSlippagePercent,
  printJson,
  requirePublicKey,
  requireString,
} from "./lib/args.mjs";
import { buildAndPartialSignTx, transactionToBase64 } from "./lib/tx-build.mjs";

const HELP = `Usage: node scripts/build-buy-amm-tx.mjs [options]

Post-graduation AMM buy (coin must have complete === true).

Provide either --pool or --mint (mint derives pool on-chain via bonding curve).

Required:
  --user <PUBKEY>
  --amount <int>      lamports if mode=quote, token smallest units if mode=base

Optional:
  --mode <quote|base>   Default quote. quote = spend fixed lamports (buyQuoteInput); base = receive fixed token amount (buyBaseInput)
  --pool <PUBKEY>
  --mint <PUBKEY>
  --slippage <percent>  Default 5
  --compute-units <int> Default ${AMM_BUY_SELL_DEFAULT_UNITS}
  --priority-micro-lamports <int>
  --front-runner-protection   Add Jito tip; send ONLY to Jito endpoints
  --tip-sol <float>           Jito tip in SOL (default 0.0001; requires --front-runner-protection)
  -h, --help

Environment:
  SOLANA_RPC_URL or NEXT_PUBLIC_SOLANA_RPC_URL`;

async function main() {
  const { values } = parseArgs({
    args: process.argv.slice(2),
    options: {
      user: { type: "string" },
      mode: { type: "string" },
      amount: { type: "string" },
      pool: { type: "string" },
      mint: { type: "string" },
      slippage: { type: "string" },
      "compute-units": { type: "string" },
      "priority-micro-lamports": { type: "string" },
      "front-runner-protection": { type: "boolean", default: false },
      "tip-sol": { type: "string" },
      help: { type: "boolean", short: "h" },
    },
    strict: true,
    allowPositionals: false,
  });

  if (values.help) exitWithHelp("build-buy-amm-tx.mjs", HELP);

  const user = requirePublicKey("--user", values.user);
  const mode = (values.mode ?? "quote").toLowerCase();
  if (mode !== "quote" && mode !== "base") {
    throw new Error('--mode must be "quote" or "base"');
  }

  const amountRaw = requireString("--amount", values.amount);
  const amountBn = new BN(amountRaw, 10);
  if (amountBn.lte(new BN(0))) throw new Error("--amount must be > 0");

  const poolStr = values.pool;
  const mintStr = values.mint;
  if (!poolStr && !mintStr) {
    throw new Error("Provide --pool or --mint");
  }
  if (poolStr && mintStr) {
    throw new Error("Use only one of --pool or --mint");
  }

  const connection = getConnection();

  let poolKey;
  if (poolStr) {
    poolKey = requirePublicKey("--pool", poolStr);
  } else {
    const mintPk = requirePublicKey("--mint", mintStr);
    const bcAddress = bondingCurvePda(mintPk);
    const [bcAccountInfo] = await connection.getMultipleAccountsInfo([bcAddress]);
    if (!bcAccountInfo) {
      throw new Error("Bonding curve account not found for this mint.");
    }
    const bondingCurve = PUMP_SDK.decodeBondingCurve(bcAccountInfo);
    if (!bondingCurve.complete) {
      throw new Error(
        "Coin is not graduated (bondingCurve.complete is false). Use build-buy-bonding-tx.mjs.",
      );
    }
    poolKey = canonicalPumpPoolPda(mintPk);
  }

  const slippage = parseSlippagePercent(values.slippage, 5);
  const computeUnits = values["compute-units"]
    ? parsePositiveInt(values["compute-units"], AMM_BUY_SELL_DEFAULT_UNITS)
    : AMM_BUY_SELL_DEFAULT_UNITS;
  const priorityOverride =
    values["priority-micro-lamports"] != null &&
    values["priority-micro-lamports"] !== ""
      ? parsePositiveInt(values["priority-micro-lamports"], 1)
      : null;
  const frontRunnerProtection = Boolean(values["front-runner-protection"]);
  const tipSol = values["tip-sol"] != null ? Number.parseFloat(values["tip-sol"]) : undefined;
  if (tipSol != null && (Number.isNaN(tipSol) || tipSol < 0)) throw new Error("--tip-sol must be a non-negative number");

  const onlineAmmSdk = new OnlinePumpAmmSdk(connection);
  const swapState = await onlineAmmSdk.swapSolanaState(poolKey, user);

  let sdkInstructions;
  if (mode === "quote") {
    sdkInstructions = await PUMP_AMM_SDK.buyQuoteInput(
      swapState,
      amountBn,
      slippage,
    );
  } else {
    sdkInstructions = await PUMP_AMM_SDK.buyBaseInput(
      swapState,
      amountBn,
      slippage,
    );
  }

  const tx = await buildAndPartialSignTx({
    connection,
    payerKey: user,
    sdkInstructions,
    computeUnits,
    priorityFeeMicroLamports: priorityOverride,
    frontRunnerProtection,
    tipSol,
  });

  printJson({
    transaction: transactionToBase64(tx),
    pool: poolKey.toBase58(),
    mode,
    amount: amountBn.toString(),
    slippagePercent: slippage,
    frontRunnerProtection,
  });
}

main().catch((e) => {
  process.stderr.write(`${e?.message ?? e}\n`);
  process.exit(1);
});
