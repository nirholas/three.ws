#!/usr/bin/env node
/**
 * Only use this script when the user explicitly requests it. Default: POST https://fun-block.pump.fun/agents/collect-fees
 * (The API auto-detects sharing config vs direct collect.)
 *
 * Build a transaction to distribute creator fees when a sharing config exists.
 * If graduated: transferCreatorFeesToPump + distributeCreatorFees.
 * If not graduated: distributeCreatorFees only.
 */
import { parseArgs } from "node:util";
import {
  PUMP_SDK,
  OnlinePumpSdk,
  bondingCurvePda,
  canonicalPumpPoolPda,
  feeSharingConfigPda,
  isCreatorUsingSharingConfig,
  getPumpAmmProgram,
} from "@pump-fun/pump-sdk";
import {
  OnlinePumpAmmSdk,
  coinCreatorVaultAuthorityPda,
  coinCreatorVaultAtaPda,
} from "@pump-fun/pump-swap-sdk";
import {
  ASSOCIATED_TOKEN_PROGRAM_ID,
  createAssociatedTokenAccountIdempotentInstruction,
  NATIVE_MINT,
  TOKEN_PROGRAM_ID,
} from "@solana/spl-token";
import { PublicKey } from "@solana/web3.js";
import { getConnection } from "./lib/env.mjs";
import {
  exitWithHelp,
  parsePositiveInt,
  printJson,
  requirePublicKey,
} from "./lib/args.mjs";
import { buildAndPartialSignTx, transactionToBase64 } from "./lib/tx-build.mjs";

const DISTRIBUTE_FEE_DEFAULT_UNITS = 200_000;

const HELP = `Usage: node scripts/build-distribute-fees-tx.mjs [options]

Build a transaction to distribute shared creator fees to shareholders.
Requires the coin to have an active fee sharing config.

Required:
  --mint <PUBKEY>
  --user <PUBKEY>                Fee payer / crank caller

Optional:
  --compute-units <int>          Default ${DISTRIBUTE_FEE_DEFAULT_UNITS}
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
      "compute-units": { type: "string" },
      "priority-micro-lamports": { type: "string" },
      "front-runner-protection": { type: "boolean", default: false },
      "tip-sol": { type: "string" },
      help: { type: "boolean", short: "h" },
    },
    strict: true,
    allowPositionals: false,
  });

  if (values.help) exitWithHelp("build-distribute-fees-tx.mjs", HELP);

  const mint = requirePublicKey("--mint", values.mint);
  const user = requirePublicKey("--user", values.user);

  const computeUnits = values["compute-units"]
    ? parsePositiveInt(values["compute-units"], DISTRIBUTE_FEE_DEFAULT_UNITS)
    : DISTRIBUTE_FEE_DEFAULT_UNITS;
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

  // Fetch bonding curve to get creator
  const bondingCurve = await onlineSdk.fetchBondingCurve(mint);

  // Check pool (graduation status)
  let poolCoinCreator = null;
  let isGraduated = false;
  const poolPda = canonicalPumpPoolPda(mint);
  const poolAccountInfo = await connection.getAccountInfo(poolPda);
  if (poolAccountInfo) {
    isGraduated = true;
    try {
      const onlineAmmSdk = new OnlinePumpAmmSdk(connection);
      const pool = await onlineAmmSdk.fetchPool(poolPda);
      poolCoinCreator = pool.coinCreator;
    } catch {
      // Pool not fully initialized
    }
  }

  const effectiveCreator = poolCoinCreator ?? new PublicKey(bondingCurve.creator);

  // Verify sharing config exists
  if (!isCreatorUsingSharingConfig({ mint, creator: effectiveCreator })) {
    throw new Error(
      "This coin does not use a fee sharing config. Use build-collect-fee-tx.mjs instead.",
    );
  }

  const sharingConfigAddress = feeSharingConfigPda(mint);
  const sharingConfigAccountInfo = await connection.getAccountInfo(sharingConfigAddress);
  if (!sharingConfigAccountInfo) {
    throw new Error("Sharing config account not found on-chain.");
  }

  const sharingConfig = PUMP_SDK.decodeSharingConfig(sharingConfigAccountInfo);

  // Build instructions
  const instructions = [];

  if (isGraduated) {
    const pumpAmmProgram = getPumpAmmProgram(connection);

    const coinCreatorVaultAuthority = coinCreatorVaultAuthorityPda(sharingConfigAddress);
    const coinCreatorVaultAta = coinCreatorVaultAtaPda(
      coinCreatorVaultAuthority,
      NATIVE_MINT,
      TOKEN_PROGRAM_ID,
    );

    // Create WSOL ATA for sharing config authority if it doesn't exist
    const createAtaIx = createAssociatedTokenAccountIdempotentInstruction(
      user,
      coinCreatorVaultAta,
      coinCreatorVaultAuthority,
      NATIVE_MINT,
      TOKEN_PROGRAM_ID,
      ASSOCIATED_TOKEN_PROGRAM_ID,
    );
    instructions.push(createAtaIx);

    // Transfer AMM fees to pump creator vault
    const transferIx = await pumpAmmProgram.methods
      .transferCreatorFeesToPump()
      .accountsPartial({
        wsolMint: NATIVE_MINT,
        tokenProgram: TOKEN_PROGRAM_ID,
        coinCreator: sharingConfigAddress,
      })
      .instruction();
    instructions.push(transferIx);
  }

  // Distribute creator fees to shareholders
  const distributeIx = await PUMP_SDK.distributeCreatorFees({
    mint,
    sharingConfig,
    sharingConfigAddress,
  });
  instructions.push(distributeIx);

  const tx = await buildAndPartialSignTx({
    connection,
    payerKey: user,
    sdkInstructions: instructions,
    computeUnits,
    priorityFeeMicroLamports: priorityOverride,
    frontRunnerProtection,
    tipSol,
  });

  printJson({
    transaction: transactionToBase64(tx),
    sharingConfigAddress: sharingConfigAddress.toBase58(),
    shareholderCount: sharingConfig.shareholders.length,
    isGraduated,
    frontRunnerProtection,
  });
}

main().catch((e) => {
  process.stderr.write(`${e?.message ?? e}\n`);
  process.exit(1);
});
