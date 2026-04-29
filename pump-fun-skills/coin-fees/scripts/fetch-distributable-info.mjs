#!/usr/bin/env node
/**
 * Simulate getMinimumDistributableFee for a coin with a sharing config.
 * Returns vault balances, minimum required, distributable amount, and whether
 * distribution can proceed. Does NOT send a transaction.
 */
import { parseArgs } from "node:util";
import BN from "bn.js";
import {
  PUMP_SDK,
  OnlinePumpSdk,
  bondingCurvePda,
  canonicalPumpPoolPda,
  creatorVaultPda,
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
  AccountLayout,
  ASSOCIATED_TOKEN_PROGRAM_ID,
  createAssociatedTokenAccountIdempotentInstruction,
  NATIVE_MINT,
  TOKEN_PROGRAM_ID,
} from "@solana/spl-token";
import {
  PublicKey,
  TransactionMessage,
  VersionedTransaction,
} from "@solana/web3.js";
import { getConnection } from "./lib/env.mjs";
import {
  exitWithHelp,
  printJson,
  requirePublicKey,
} from "./lib/args.mjs";

const HELP = `Usage: node scripts/fetch-distributable-info.mjs --mint <MINT>

Simulate fee distribution to check vault balances, minimum threshold, and
whether distribution can proceed. Requires an active sharing config.

Required:
  --mint <PUBKEY>     Coin mint address

Optional:
  -h, --help          Show help

Environment:
  SOLANA_RPC_URL or NEXT_PUBLIC_SOLANA_RPC_URL`;

// Funded signer for simulation (must exist on both devnet and mainnet)
const SIMULATION_SIGNER = new PublicKey(
  "Gygj9QQby4j2jryqyqBHvLP7ctv2SaANgh4sCb69BUpA",
);

async function main() {
  const { values } = parseArgs({
    args: process.argv.slice(2),
    options: {
      mint: { type: "string" },
      help: { type: "boolean", short: "h" },
    },
    strict: true,
    allowPositionals: false,
  });

  if (values.help) exitWithHelp("fetch-distributable-info.mjs", HELP);

  const mint = requirePublicKey("--mint", values.mint);
  const connection = getConnection();
  const onlineSdk = new OnlinePumpSdk(connection);

  // Fetch bonding curve
  const bondingCurve = await onlineSdk.fetchBondingCurve(mint);

  // Check pool
  let poolCoinCreator = null;
  const poolPda = canonicalPumpPoolPda(mint);
  const poolAccountInfo = await connection.getAccountInfo(poolPda);
  const isGraduated = poolAccountInfo !== null;
  if (poolAccountInfo) {
    try {
      const onlineAmmSdk = new OnlinePumpAmmSdk(connection);
      const pool = await onlineAmmSdk.fetchPool(poolPda);
      poolCoinCreator = pool.coinCreator;
    } catch {
      // Pool not fully initialized
    }
  }

  const effectiveCreator = poolCoinCreator ?? new PublicKey(bondingCurve.creator);

  // Verify sharing config
  if (!isCreatorUsingSharingConfig({ mint, creator: effectiveCreator })) {
    throw new Error(
      "This coin does not use a fee sharing config. " +
      "Distributable info is only available for coins with sharing configs.",
    );
  }

  const sharingConfigAddress = feeSharingConfigPda(mint);
  const sharingConfigAccountInfo = await connection.getAccountInfo(sharingConfigAddress);
  if (!sharingConfigAccountInfo) {
    throw new Error("Sharing config account not found on-chain.");
  }

  const sharingConfig = PUMP_SDK.decodeSharingConfig(sharingConfigAccountInfo);

  // Read pump creator vault balance
  const pumpCreatorVault = creatorVaultPda(sharingConfigAddress);
  const pumpCreatorVaultInfo = await connection.getAccountInfo(pumpCreatorVault);
  const pumpCreatorVaultTotal = pumpCreatorVaultInfo?.lamports ?? 0;

  const rentExemption = pumpCreatorVaultInfo
    ? await connection.getMinimumBalanceForRentExemption(pumpCreatorVaultInfo.data.length)
    : 0;
  const pumpCreatorVaultBalance = new BN(Math.max(0, pumpCreatorVaultTotal - rentExemption));

  // Read AMM creator vault balance (WSOL ATA)
  let ammCreatorVaultBalance = new BN(0);
  if (isGraduated) {
    const coinCreatorVaultAuthority = coinCreatorVaultAuthorityPda(sharingConfigAddress);
    const ammVaultAta = coinCreatorVaultAtaPda(
      coinCreatorVaultAuthority,
      NATIVE_MINT,
      TOKEN_PROGRAM_ID,
    );
    const ammVaultAtaInfo = await connection.getAccountInfo(ammVaultAta);
    if (ammVaultAtaInfo) {
      const dataUint8Array = new Uint8Array(
        ammVaultAtaInfo.data.buffer,
        ammVaultAtaInfo.data.byteOffset,
        ammVaultAtaInfo.data.byteLength,
      );
      const parsed = AccountLayout.decode(dataUint8Array);
      ammCreatorVaultBalance = new BN(parsed.amount.toString());
    }
  }

  // Build simulation transaction
  const instructions = [];

  if (isGraduated) {
    const pumpAmmProgram = getPumpAmmProgram(connection);
    const coinCreatorVaultAuthority = coinCreatorVaultAuthorityPda(sharingConfigAddress);
    const ammVaultAta = coinCreatorVaultAtaPda(
      coinCreatorVaultAuthority,
      NATIVE_MINT,
      TOKEN_PROGRAM_ID,
    );

    const createAtaIx = createAssociatedTokenAccountIdempotentInstruction(
      SIMULATION_SIGNER,
      ammVaultAta,
      coinCreatorVaultAuthority,
      NATIVE_MINT,
      TOKEN_PROGRAM_ID,
      ASSOCIATED_TOKEN_PROGRAM_ID,
    );
    instructions.push(createAtaIx);

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

  const getMinFeeIx = await PUMP_SDK.getMinimumDistributableFee({
    mint,
    sharingConfig,
    sharingConfigAddress,
  });
  instructions.push(getMinFeeIx);

  const { blockhash } = await connection.getLatestBlockhash();
  const tx = new VersionedTransaction(
    new TransactionMessage({
      payerKey: SIMULATION_SIGNER,
      recentBlockhash: blockhash,
      instructions,
    }).compileToV0Message(),
  );

  const result = await connection.simulateTransaction(tx);

  let minimumRequired = new BN(0);
  let distributableFees = new BN(0);
  let canDistribute = false;

  if (!result.value.err) {
    const [data, encoding] = result.value.returnData?.data ?? [];
    if (data) {
      const buffer = Buffer.from(data, encoding);
      const returnData = PUMP_SDK.decodeMinimumDistributableFee(buffer);
      minimumRequired = returnData.minimumRequired;
      distributableFees = returnData.distributableFees;
      canDistribute = returnData.canDistribute;
    }
  } else {
    process.stderr.write(
      `Simulation failed: ${JSON.stringify(result.value.err)}\n`,
    );
  }

  const totalAvailableBalance = pumpCreatorVaultBalance.add(ammCreatorVaultBalance);

  printJson({
    mint: mint.toBase58(),
    sharingConfigAddress: sharingConfigAddress.toBase58(),
    isGraduated,
    pumpCreatorVaultBalance: pumpCreatorVaultBalance.toString(),
    ammCreatorVaultBalance: ammCreatorVaultBalance.toString(),
    totalAvailableBalance: totalAvailableBalance.toString(),
    minimumRequired: minimumRequired.toString(),
    distributableFees: distributableFees.toString(),
    canDistribute,
  });
}

main().catch((e) => {
  process.stderr.write(`${e?.message ?? e}\n`);
  process.exit(1);
});
