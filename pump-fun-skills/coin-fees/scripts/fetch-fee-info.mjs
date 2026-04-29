#!/usr/bin/env node
/**
 * Resolve fee destination for a coin: cashback, sharing_config, or creator.
 * Reports vault balances, sharing config shareholders, and graduation status.
 */
import BN from "bn.js";
import {
  PUMP_SDK,
  OnlinePumpSdk,
  bondingCurvePda,
  canonicalPumpPoolPda,
  creatorVaultPda,
  feeSharingConfigPda,
  isCreatorUsingSharingConfig,
} from "@pump-fun/pump-sdk";
import {
  OnlinePumpAmmSdk,
  coinCreatorVaultAuthorityPda,
  coinCreatorVaultAtaPda,
} from "@pump-fun/pump-swap-sdk";
import {
  AccountLayout,
  NATIVE_MINT,
  TOKEN_PROGRAM_ID,
} from "@solana/spl-token";
import { PublicKey } from "@solana/web3.js";
import { getConnection } from "./lib/env.mjs";
import {
  exitWithHelp,
  printJson,
  requirePublicKey,
} from "./lib/args.mjs";
import { parseArgs } from "node:util";

const HELP = `Usage: node scripts/fetch-fee-info.mjs --mint <MINT>

Inspect fee destination, vault balances, and sharing config for a coin.

Required:
  --mint <PUBKEY>     Coin mint address

Optional:
  -h, --help          Show help

Environment:
  SOLANA_RPC_URL or NEXT_PUBLIC_SOLANA_RPC_URL`;

const MIN_RENT_EXEMPTION_LAMPORTS = new BN(890_880);

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

  if (values.help) exitWithHelp("fetch-fee-info.mjs", HELP);

  const mint = requirePublicKey("--mint", values.mint);
  const connection = getConnection();
  const onlineSdk = new OnlinePumpSdk(connection);

  const bondingCurveAddress = bondingCurvePda(mint);
  const bondingCurve = await onlineSdk.fetchBondingCurve(mint);

  let poolAddress = null;
  let poolCoinCreator = null;
  let isGraduated = false;
  let isCashbackCoin = false;

  const poolPda = canonicalPumpPoolPda(mint);
  const poolAccountInfo = await connection.getAccountInfo(poolPda);

  if (poolAccountInfo) {
    isGraduated = true;
    poolAddress = poolPda.toBase58();
    try {
      const onlineAmmSdk = new OnlinePumpAmmSdk(connection);
      const pool = await onlineAmmSdk.fetchPool(poolPda);
      poolCoinCreator = pool.coinCreator;

      const poolRaw = pool;
      isCashbackCoin =
        poolRaw.isCashbackCoin === true ||
        (typeof poolRaw.is_cashback_coin === "object" &&
          poolRaw.is_cashback_coin !== null &&
          poolRaw.is_cashback_coin[0] === true);
    } catch {
      // Pool exists but may not be fully initialized
    }
  } else {
    const bcRaw = bondingCurve;
    isCashbackCoin =
      bcRaw.isCashbackCoin === true ||
      (typeof bcRaw.is_cashback_coin === "object" &&
        bcRaw.is_cashback_coin !== null &&
        bcRaw.is_cashback_coin[0] === true);
  }

  const effectiveCreator = poolCoinCreator ?? new PublicKey(bondingCurve.creator);

  let hasSharingConfig = false;
  let sharingConfigInfo = null;

  if (!isCashbackCoin) {
    hasSharingConfig = isCreatorUsingSharingConfig({
      mint,
      creator: effectiveCreator,
    });

    if (hasSharingConfig) {
      const sharingConfigAddress = feeSharingConfigPda(mint);
      const sharingConfigAccountInfo =
        await connection.getAccountInfo(sharingConfigAddress);

      if (sharingConfigAccountInfo) {
        const sharingConfig = PUMP_SDK.decodeSharingConfig(sharingConfigAccountInfo);
        sharingConfigInfo = {
          address: sharingConfigAddress.toBase58(),
          admin: sharingConfig.admin.toBase58(),
          adminRevoked: sharingConfig.adminRevoked ?? false,
          shareholders: sharingConfig.shareholders.map((s) => ({
            address: s.address.toBase58(),
            bps: s.share,
          })),
        };
      } else {
        hasSharingConfig = false;
      }
    }
  }

  // Determine fee destination
  let feeDestination;
  if (isCashbackCoin) {
    feeDestination = "cashback";
  } else if (hasSharingConfig) {
    feeDestination = "sharing_config";
  } else {
    feeDestination = "creator";
  }

  // Fetch vault balances
  let creatorVaultLamports = "0";
  if (!isCashbackCoin) {
    try {
      const vaultCreator = hasSharingConfig
        ? feeSharingConfigPda(mint)
        : effectiveCreator;

      const creatorVault = creatorVaultPda(vaultCreator);
      const creatorVaultAccountInfo = await connection.getAccountInfo(creatorVault);

      const coinCreatorVaultAuthority = coinCreatorVaultAuthorityPda(vaultCreator);
      const coinCreatorVaultAta = coinCreatorVaultAtaPda(
        coinCreatorVaultAuthority,
        NATIVE_MINT,
        TOKEN_PROGRAM_ID,
      );
      const coinCreatorVaultAtaAccountInfo =
        await connection.getAccountInfo(coinCreatorVaultAta);

      let totalLamports = new BN(0);

      if (creatorVaultAccountInfo) {
        const rawLamports = new BN(creatorVaultAccountInfo.lamports);
        const adjusted = rawLamports.sub(MIN_RENT_EXEMPTION_LAMPORTS);
        totalLamports = totalLamports.add(adjusted.lt(new BN(0)) ? new BN(0) : adjusted);
      }

      if (coinCreatorVaultAtaAccountInfo) {
        const dataUint8Array = new Uint8Array(
          coinCreatorVaultAtaAccountInfo.data.buffer,
          coinCreatorVaultAtaAccountInfo.data.byteOffset,
          coinCreatorVaultAtaAccountInfo.data.byteLength,
        );
        const parsed = AccountLayout.decode(dataUint8Array);
        totalLamports = totalLamports.add(new BN(parsed.amount.toString()));
      }

      creatorVaultLamports = totalLamports.toString();
    } catch (err) {
      process.stderr.write(`Warning: failed to fetch vault balances: ${err?.message ?? err}\n`);
    }
  }

  printJson({
    mint: mint.toBase58(),
    bondingCurve: bondingCurveAddress.toBase58(),
    pool: poolAddress,
    isGraduated,
    isCashbackCoin,
    hasSharingConfig,
    creator: effectiveCreator.toBase58(),
    creatorVaultLamports,
    sharingConfig: sharingConfigInfo,
    feeDestination,
  });
}

main().catch((e) => {
  process.stderr.write(`${e?.message ?? e}\n`);
  process.exit(1);
});
