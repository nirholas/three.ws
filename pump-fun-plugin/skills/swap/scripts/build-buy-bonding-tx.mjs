#!/usr/bin/env node
/**
 * Only use this script when the user explicitly requests it. Default: POST https://fun-block.pump.fun/agents/swap
 * (inputMint = NATIVE_MINT for buy, outputMint = token mint)
 */
import { parseArgs } from "node:util";
import BN from "bn.js";
import {
  PUMP_SDK,
  OnlinePumpSdk,
  getBuyTokenAmountFromSolAmount,
  getBuySolAmountFromTokenAmount,
  bondingCurvePda,
} from "@pump-fun/pump-sdk";
import { getAssociatedTokenAddressSync } from "@solana/spl-token";
import { getConnection } from "./lib/env.mjs";
import { tokenProgramIdFromMint } from "./lib/coin-resolve.mjs";
import { BUY_SELL_DEFAULT_UNITS } from "./lib/constants.mjs";
import {
  exitWithHelp,
  parsePositiveInt,
  parseSlippagePercent,
  printJson,
  requirePublicKey,
  requireString,
} from "./lib/args.mjs";
import { buildAndPartialSignTx, transactionToBase64 } from "./lib/tx-build.mjs";

const HELP = `Usage: node scripts/build-buy-bonding-tx.mjs [options]

Bonding-curve buy (coin must have complete === false).

Required:
  --mint <PUBKEY>
  --user <PUBKEY>
  --amount <int>         SOL to spend (lamports)

Optional:
  --slippage <percent>   Default 5 (percent, NOT basis points — matches @pump-fun/pump-sdk)
  --compute-units <int>  Default ${BUY_SELL_DEFAULT_UNITS}
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
      mint: { type: "string" },
      user: { type: "string" },
      amount: { type: "string" },
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

  if (values.help) exitWithHelp("build-buy-bonding-tx.mjs", HELP);

  const mint = requirePublicKey("--mint", values.mint);
  const user = requirePublicKey("--user", values.user);
  const solLamports = parsePositiveInt(
    requireString("--amount", values.amount),
    0,
  );
  if (solLamports <= 0) throw new Error("--amount must be > 0");

  const slippage = parseSlippagePercent(values.slippage, 5);
  const computeUnits = values["compute-units"]
    ? parsePositiveInt(values["compute-units"], BUY_SELL_DEFAULT_UNITS)
    : BUY_SELL_DEFAULT_UNITS;
  const priorityOverride =
    values["priority-micro-lamports"] != null &&
    values["priority-micro-lamports"] !== ""
      ? parsePositiveInt(values["priority-micro-lamports"], 1)
      : null;
  const frontRunnerProtection = Boolean(values["front-runner-protection"]);
  const tipSol = values["tip-sol"] != null ? Number.parseFloat(values["tip-sol"]) : undefined;
  if (tipSol != null && (Number.isNaN(tipSol) || tipSol < 0)) throw new Error("--tip-sol must be a non-negative number");

  const connection = getConnection();
  const tokenProgram = await tokenProgramIdFromMint(connection, mint);
  const onlineSdk = new OnlinePumpSdk(connection);
  const [global, feeConfig] = await Promise.all([
    onlineSdk.fetchGlobal(),
    onlineSdk.fetchFeeConfig(),
  ]);

  const bondingCurveAddress = bondingCurvePda(mint);
  const userAta = getAssociatedTokenAddressSync(
    mint,
    user,
    true,
    tokenProgram,
  );

  const [bondingCurveAccountInfo, associatedUserAccountInfo] =
    await connection.getMultipleAccountsInfo([
      bondingCurveAddress,
      userAta,
    ]);

  if (!bondingCurveAccountInfo) {
    throw new Error("Bonding curve account not found for this mint.");
  }

  const bondingCurve = PUMP_SDK.decodeBondingCurve(bondingCurveAccountInfo);
  if (bondingCurve.complete) {
    throw new Error(
      "On-chain bonding curve is complete. Use AMM script instead.",
    );
  }

  const inputSolAmount = new BN(solLamports);
  const mintSupply = bondingCurve.tokenTotalSupply;

  // Two-step calculation matching the frontend (blockchainStore getSwapTx):
  // 1. SOL -> expected token amount
  const tokenAmount = getBuyTokenAmountFromSolAmount({
    global,
    feeConfig,
    mintSupply,
    bondingCurve,
    amount: inputSolAmount,
  });

  // 2. Token amount -> precise SOL cost (accounts for rounding in bonding curve math)
  const solAmount = getBuySolAmountFromTokenAmount({
    global,
    feeConfig,
    mintSupply,
    bondingCurve,
    amount: tokenAmount,
  });

  const sdkInstructions = await PUMP_SDK.buyInstructions({
    global,
    bondingCurveAccountInfo,
    bondingCurve,
    associatedUserAccountInfo,
    mint,
    user,
    amount: tokenAmount,
    solAmount,
    slippage,
    tokenProgram,
  });

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
    quoteTokenAmount: tokenAmount.toString(),
    solLamports: solAmount.toString(),
    inputSolLamports: solLamports,
    slippagePercent: slippage,
    frontRunnerProtection,
  });
}

main().catch((e) => {
  process.stderr.write(`${e?.message ?? e}\n`);
  process.exit(1);
});
