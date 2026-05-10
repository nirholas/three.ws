#!/usr/bin/env node
/**
 * Only use this script when the user explicitly requests it. Default: POST https://fun-block.pump.fun/agents/sharing-config
 *
 * Build a transaction to create or update a fee sharing config.
 *
 * - CREATE: sets up a new sharing config for a coin (creator must sign).
 * - UPDATE: changes shareholders on an existing config (admin must sign).
 *
 * Auto-detects mode based on whether a sharing config already exists on-chain.
 * Use --mode create|update to force a specific mode.
 */
import { parseArgs } from "node:util";
import {
  PUMP_SDK,
  OnlinePumpSdk,
  bondingCurvePda,
  canonicalPumpPoolPda,
  feeSharingConfigPda,
  isCreatorUsingSharingConfig,
  isSharingConfigEditable,
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

const DEFAULT_COMPUTE_UNITS = 200_000;

const HELP = `Usage: node scripts/build-sharing-config-tx.mjs [options]

Build a transaction to create or update a fee sharing config for a coin.
Auto-detects whether to create or update based on on-chain state.

Required:
  --mint <PUBKEY>                  Coin mint address
  --user <PUBKEY>                  Transaction fee payer (creator for create, admin for update)
  --shareholders <JSON>            JSON array of shareholders:
                                   [{"address":"<PUBKEY>","bps":5000},{"address":"<PUBKEY>","bps":5000}]
                                   bps = basis points (1 bps = 0.01%, total must = 10000)

Optional:
  --mode <create|update>           Force create or update (auto-detected if omitted)
  --compute-units <int>            Default ${DEFAULT_COMPUTE_UNITS}
  --priority-micro-lamports <int>
  --front-runner-protection        Add Jito tip; send ONLY to Jito endpoints
  --tip-sol <float>                Jito tip in SOL (default 0.0001)
  -h, --help

Environment:
  SOLANA_RPC_URL or NEXT_PUBLIC_SOLANA_RPC_URL

Examples:
  # Create a sharing config (50/50 split between two wallets):
  node scripts/build-sharing-config-tx.mjs \\
    --mint <MINT> --user <CREATOR_PUBKEY> \\
    --shareholders '[{"address":"Wa11et1...","bps":5000},{"address":"Wa11et2...","bps":5000}]'

  # Update shareholders on an existing config:
  node scripts/build-sharing-config-tx.mjs \\
    --mint <MINT> --user <ADMIN_PUBKEY> --mode update \\
    --shareholders '[{"address":"Wa11et1...","bps":7000},{"address":"Wa11et3...","bps":3000}]'`;

/**
 * Parse and validate the --shareholders JSON argument.
 * @param {string} raw
 * @returns {{ address: PublicKey, shareBps: number }[]}
 */
function parseShareholders(raw) {
  let arr;
  try {
    arr = JSON.parse(raw);
  } catch {
    throw new Error("--shareholders must be valid JSON");
  }

  if (!Array.isArray(arr) || arr.length === 0) {
    throw new Error("--shareholders must be a non-empty JSON array");
  }
  if (arr.length > 10) {
    throw new Error("Maximum 10 shareholders allowed");
  }

  let totalBps = 0;
  const seen = new Set();
  const shareholders = arr.map((item, i) => {
    if (!item.address) {
      throw new Error(`Shareholder ${i}: missing "address"`);
    }
    const bps = Number(item.bps);
    if (!Number.isFinite(bps) || bps <= 0) {
      throw new Error(`Shareholder ${i}: "bps" must be a positive number`);
    }

    let pubkey;
    try {
      pubkey = new PublicKey(item.address);
    } catch {
      throw new Error(`Shareholder ${i}: invalid public key "${item.address}"`);
    }

    const key = pubkey.toBase58();
    if (seen.has(key)) {
      throw new Error(`Shareholder ${i}: duplicate address "${key}"`);
    }
    seen.add(key);

    totalBps += bps;
    return { address: pubkey, shareBps: bps };
  });

  if (totalBps !== 10_000) {
    throw new Error(
      `Shareholder bps must total exactly 10000 (100%), got ${totalBps}`,
    );
  }

  return shareholders;
}

async function main() {
  const { values } = parseArgs({
    args: process.argv.slice(2),
    options: {
      mint: { type: "string" },
      user: { type: "string" },
      shareholders: { type: "string" },
      mode: { type: "string" },
      "compute-units": { type: "string" },
      "priority-micro-lamports": { type: "string" },
      "front-runner-protection": { type: "boolean", default: false },
      "tip-sol": { type: "string" },
      help: { type: "boolean", short: "h" },
    },
    strict: true,
    allowPositionals: false,
  });

  if (values.help) exitWithHelp("build-sharing-config-tx.mjs", HELP);

  const mint = requirePublicKey("--mint", values.mint);
  const user = requirePublicKey("--user", values.user);

  if (!values.shareholders) {
    throw new Error("--shareholders is required (JSON array)");
  }
  const newShareholders = parseShareholders(values.shareholders);

  const computeUnits = values["compute-units"]
    ? parsePositiveInt(values["compute-units"], DEFAULT_COMPUTE_UNITS)
    : DEFAULT_COMPUTE_UNITS;
  const priorityOverride =
    values["priority-micro-lamports"] != null &&
    values["priority-micro-lamports"] !== ""
      ? parsePositiveInt(values["priority-micro-lamports"], 1)
      : null;
  const frontRunnerProtection = Boolean(values["front-runner-protection"]);
  const tipSol = values["tip-sol"] != null ? Number.parseFloat(values["tip-sol"]) : undefined;
  if (tipSol != null && (Number.isNaN(tipSol) || tipSol < 0)) throw new Error("--tip-sol must be a non-negative number");

  if (values.mode && values.mode !== "create" && values.mode !== "update") {
    throw new Error('--mode must be "create" or "update"');
  }

  const connection = getConnection();
  const onlineSdk = new OnlinePumpSdk(connection);

  // Fetch bonding curve
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

  // Check for cashback coin
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
    const bcRaw = bondingCurve;
    isCashbackCoin =
      bcRaw.isCashbackCoin === true ||
      (typeof bcRaw.is_cashback_coin === "object" &&
        bcRaw.is_cashback_coin !== null &&
        bcRaw.is_cashback_coin[0] === true);
  }

  if (isCashbackCoin) {
    throw new Error(
      "This is a cashback coin — creator fees are returned to traders. " +
      "Fee sharing config cannot be created for cashback coins.",
    );
  }

  // Detect mode
  const configExists = isCreatorUsingSharingConfig({ mint, creator: effectiveCreator });
  let mode = values.mode ?? (configExists ? "update" : "create");

  if (mode === "create" && configExists) {
    throw new Error(
      "A sharing config already exists for this coin. Use --mode update to modify shareholders.",
    );
  }
  if (mode === "update" && !configExists) {
    throw new Error(
      "No sharing config exists for this coin. Use --mode create (or omit --mode) to create one.",
    );
  }

  const instructions = [];

  if (mode === "create") {
    // Create sharing config — creator must sign
    const createIx = await PUMP_SDK.createFeeSharingConfig({
      creator: effectiveCreator,
      mint,
      pool: isGraduated ? poolPda : null,
    });
    instructions.push(createIx);

    // Immediately update fee shares to set shareholders
    // After creation, the only shareholder is the creator with 100%.
    // We need to update to the desired split.
    const updateIx = await PUMP_SDK.updateFeeShares({
      authority: effectiveCreator,
      mint,
      currentShareholders: [effectiveCreator],
      newShareholders,
    });
    instructions.push(updateIx);
  } else {
    // Update existing config
    const sharingConfigAddress = feeSharingConfigPda(mint);
    const sharingConfigAccountInfo = await connection.getAccountInfo(sharingConfigAddress);
    if (!sharingConfigAccountInfo) {
      throw new Error("Sharing config account not found on-chain.");
    }

    const sharingConfig = PUMP_SDK.decodeSharingConfig(sharingConfigAccountInfo);

    if (!isSharingConfigEditable({ sharingConfig })) {
      throw new Error(
        "This sharing config is no longer editable (admin revoked or already updated).",
      );
    }

    const currentShareholders = sharingConfig.shareholders.map((s) => s.address);

    const updateIx = await PUMP_SDK.updateFeeShares({
      authority: user,
      mint,
      currentShareholders,
      newShareholders,
    });
    instructions.push(updateIx);
  }

  const tx = await buildAndPartialSignTx({
    connection,
    payerKey: user,
    sdkInstructions: instructions,
    computeUnits,
    priorityFeeMicroLamports: priorityOverride,
    frontRunnerProtection,
    tipSol,
  });

  const sharingConfigAddress = feeSharingConfigPda(mint);

  printJson({
    transaction: transactionToBase64(tx),
    mode,
    sharingConfigAddress: sharingConfigAddress.toBase58(),
    shareholderCount: newShareholders.length,
    shareholders: newShareholders.map((s) => ({
      address: s.address.toBase58(),
      bps: s.shareBps,
      percent: `${(s.shareBps / 100).toFixed(2)}%`,
    })),
    isGraduated,
    frontRunnerProtection,
  });
}

main().catch((e) => {
  process.stderr.write(`${e?.message ?? e}\n`);
  process.exit(1);
});
