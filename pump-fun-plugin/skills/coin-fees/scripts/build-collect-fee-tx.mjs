#!/usr/bin/env node
/**
 * Only use this script when the user explicitly requests it. Default: POST https://fun-block.pump.fun/agents/collect-fees
 *
 * Build a transaction to collect creator fees (crank) for a coin with no sharing config.
 * Uses OnlinePumpSdk.collectCoinCreatorFeeInstructions — permissionless.
 */
import { parseArgs } from "node:util";
import {
  OnlinePumpSdk,
  bondingCurvePda,
  canonicalPumpPoolPda,
  feeSharingConfigPda,
  isCreatorUsingSharingConfig,
} from "@pump-fun/pump-sdk";
import { OnlinePumpAmmSdk } from "@pump-fun/pump-swap-sdk";
import { PublicKey } from "@solana/web3.js";
import { getConnection } from "./lib/env.mjs";
import {
  exitWithHelp,
  parsePositiveInt,
  printJson,
  requirePublicKey,
} from "./lib/args.mjs";
import { buildAndPartialSignTx, transactionToBase64 } from "./lib/tx-build.mjs";

const COLLECT_FEE_DEFAULT_UNITS = 200_000;

const HELP = `Usage: node scripts/build-collect-fee-tx.mjs [options]

Build a transaction to collect creator fees (direct creator, no sharing config).

Required:
  --mint <PUBKEY>
  --user <PUBKEY>                Fee payer / crank caller

Optional:
  --creator <PUBKEY>             Creator to collect for (auto-derived if omitted)
  --compute-units <int>          Default ${COLLECT_FEE_DEFAULT_UNITS}
  --priority-micro-lamports <int>
  --front-runner-protection      Add Jito tip; send ONLY to Jito endpoints
  --tip-sol <float>              Jito tip in SOL (default 0.0001)
  -h, --help

Environment:
  SOLANA_RPC_URL or NEXT_PUBLIC_SOLANA_RPC_URL`;

async function main() {
  const { values } = parseArgs({
    args: process.argv.slice(2),
    options: {
      mint: { type: "string" },
      user: { type: "string" },
      creator: { type: "string" },
      "compute-units": { type: "string" },
      "priority-micro-lamports": { type: "string" },
      "front-runner-protection": { type: "boolean", default: false },
      "tip-sol": { type: "string" },
      help: { type: "boolean", short: "h" },
    },
    strict: true,
    allowPositionals: false,
  });

  if (values.help) exitWithHelp("build-collect-fee-tx.mjs", HELP);

  const mint = requirePublicKey("--mint", values.mint);
  const user = requirePublicKey("--user", values.user);

  const computeUnits = values["compute-units"]
    ? parsePositiveInt(values["compute-units"], COLLECT_FEE_DEFAULT_UNITS)
    : COLLECT_FEE_DEFAULT_UNITS;
  const priorityOverride =
    values["priority-micro-lamports"] != null &&
    values["priority-micro-lamports"] !== ""
      ? parsePositiveInt(values["priority-micro-lamports"], 1)
      : null;
  const frontRunnerProtection = Boolean(values["front-runner-protection"]);
  const tipSol = values["tip-sol"] != null ? Number.parseFloat(values["tip-sol"]) : undefined;
  if (tipSol != null && (Number.isNaN(tipSol) || tipSol < 0)) throw new Error("--tip-sol must be a non-negative number");

  const connection = getConnection();
  const onlineSdk = new OnlinePumpSdk(connection);

  // Resolve creator from on-chain state if not provided
  let creator;
  if (values.creator) {
    creator = requirePublicKey("--creator", values.creator);
  } else {
    const bondingCurve = await onlineSdk.fetchBondingCurve(mint);
    let poolCoinCreator = null;

    const poolPda = canonicalPumpPoolPda(mint);
    const poolAccountInfo = await connection.getAccountInfo(poolPda);
    if (poolAccountInfo) {
      try {
        const onlineAmmSdk = new OnlinePumpAmmSdk(connection);
        const pool = await onlineAmmSdk.fetchPool(poolPda);
        poolCoinCreator = pool.coinCreator;
      } catch {
        // Pool not fully initialized
      }
    }

    creator = poolCoinCreator ?? new PublicKey(bondingCurve.creator);

    // Check for cashback
    const bcRaw = bondingCurve;
    const poolRaw = poolAccountInfo ? poolCoinCreator : null;
    let isCashbackCoin = false;
    if (poolAccountInfo && poolCoinCreator) {
      try {
        const onlineAmmSdk = new OnlinePumpAmmSdk(connection);
        const pool = await onlineAmmSdk.fetchPool(poolPda);
        isCashbackCoin =
          pool.isCashbackCoin === true ||
          (typeof pool.is_cashback_coin === "object" &&
            pool.is_cashback_coin !== null &&
            pool.is_cashback_coin[0] === true);
      } catch {
        // fallback to bonding curve
      }
    }
    if (!isCashbackCoin) {
      isCashbackCoin =
        bcRaw.isCashbackCoin === true ||
        (typeof bcRaw.is_cashback_coin === "object" &&
          bcRaw.is_cashback_coin !== null &&
          bcRaw.is_cashback_coin[0] === true);
    }

    if (isCashbackCoin) {
      throw new Error(
        "This is a cashback coin — creator fees are returned to traders. " +
        "There is no creator vault to collect from.",
      );
    }

    // Check for sharing config
    if (
      isCreatorUsingSharingConfig({ mint, creator })
    ) {
      throw new Error(
        "This coin uses a fee sharing config. Use build-distribute-fees-tx.mjs instead.",
      );
    }
  }

  const sdkInstructions = await onlineSdk.collectCoinCreatorFeeInstructions(
    creator,
    user,
  );

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
    creator: creator.toBase58(),
    frontRunnerProtection,
  });
}

main().catch((e) => {
  process.stderr.write(`${e?.message ?? e}\n`);
  process.exit(1);
});
