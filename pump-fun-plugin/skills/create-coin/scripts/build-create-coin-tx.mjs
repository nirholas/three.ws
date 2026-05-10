#!/usr/bin/env node
/**
 * Only use this script when the user explicitly requests it. Default: POST https://fun-block.pump.fun/agents/create-coin
 *
 * Build create + initial buy transaction; write mint keypair to disk; partial-sign with mint.
 * User wallet must co-sign and send (never pass user secret key to this script).
 */
import { writeFileSync, mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { parseArgs } from "node:util";
import BN from "bn.js";
import { Keypair, PublicKey } from "@solana/web3.js";
import {
  PUMP_SDK,
  OnlinePumpSdk,
  getBuyTokenAmountFromSolAmount,
} from "@pump-fun/pump-sdk";
import { PumpAgentOffline } from "@pump-fun/agent-payments-sdk";
import { getConnection } from "./lib/env.mjs";
import {
  exitWithHelp,
  parsePositiveInt,
  printJson,
  requirePublicKey,
  requireString,
} from "./lib/args.mjs";
import {
  CREATE_AND_BUY_COMPUTE_UNITS,
  ALT_ADDRESS_MAINNET,
  ALT_ADDRESS_DEVNET,
} from "./lib/constants.mjs";
import { buildAndPartialSignTx, transactionToBase64 } from "./lib/tx-build.mjs";

const AGENT_INITIALIZE_DEFAULT_UNITS = 30_000;
const DEFAULT_BUYBACK_BPS = 5000;

const HELP = `Usage: node scripts/build-create-coin-tx.mjs [options]

Builds createV2AndBuyInstructions, partial-signs with generated mint keypair.

Required:
  --user <PUBKEY>           Creator / fee payer (wallet that will co-sign)
  --name <string>
  --symbol <string>
  --metadata-uri <url>      Token metadata JSON URI (see references/METADATA.md)
  --sol-lamports <int>      Initial buy size in lamports (> 0)
  --mint-keypair-out <path> Write mint secret key here as JSON byte array (never commit)

Optional:
  --mayhem-mode             Enable mayhem mode (default: off)
  --cashback                Enable cashback for this coin (default: off)
  --tokenized-agent         Enable tokenized agent (default: off; requires initial buy > 0)
  --buyback-bps <int>       Buyback basis points for tokenized agent (default: ${DEFAULT_BUYBACK_BPS} = 50%; requires --tokenized-agent)
  --alt-address <PUBKEY>    Address Lookup Table; defaults to mainnet/devnet built-in ALT if omitted
  --compute-units <int>     Default: ${CREATE_AND_BUY_COMPUTE_UNITS} (270k create + 120k buy per frontend constants)
  --priority-micro-lamports <int>  Fixed priority fee; omit to use getPriorityFeeEstimate RPC (floor 100k)
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
      name: { type: "string" },
      symbol: { type: "string" },
      "metadata-uri": { type: "string" },
      "sol-lamports": { type: "string" },
      "mint-keypair-out": { type: "string" },
      "mayhem-mode": { type: "boolean", default: false },
      cashback: { type: "boolean", default: false },
      "tokenized-agent": { type: "boolean", default: false },
      "buyback-bps": { type: "string" },
      "alt-address": { type: "string" },
      "compute-units": { type: "string" },
      "priority-micro-lamports": { type: "string" },
      "front-runner-protection": { type: "boolean", default: false },
      "tip-sol": { type: "string" },
      help: { type: "boolean", short: "h" },
    },
    strict: true,
    allowPositionals: false,
  });

  if (values.help) exitWithHelp("build-create-coin-tx.mjs", HELP);

  const user = requirePublicKey("--user", values.user);
  const name = requireString("--name", values.name);
  const symbol = requireString("--symbol", values.symbol);
  const metadataUri = requireString("--metadata-uri", values["metadata-uri"]);
  const solLamportsStr = requireString("--sol-lamports", values["sol-lamports"]);
  const solLamports = parsePositiveInt(solLamportsStr, 0);
  if (solLamports <= 0) throw new Error("--sol-lamports must be > 0");

  const outPath = requireString("--mint-keypair-out", values["mint-keypair-out"]);
  const resolvedOut = resolve(process.cwd(), outPath);
  const mayhemMode = Boolean(values["mayhem-mode"]);
  const cashback = Boolean(values.cashback);
  const tokenizedAgent = Boolean(values["tokenized-agent"]);
  const buybackBps = values["buyback-bps"] != null
    ? parsePositiveInt(values["buyback-bps"], DEFAULT_BUYBACK_BPS)
    : DEFAULT_BUYBACK_BPS;

  if (tokenizedAgent && solLamports <= 0) {
    throw new Error("--tokenized-agent requires --sol-lamports > 0 (tokenized agent coins cannot be free)");
  }

  const defaultComputeUnits = CREATE_AND_BUY_COMPUTE_UNITS
    + (tokenizedAgent ? AGENT_INITIALIZE_DEFAULT_UNITS : 0);
  const computeUnits = values["compute-units"]
    ? parsePositiveInt(values["compute-units"], defaultComputeUnits)
    : defaultComputeUnits;

  const priorityOverride =
    values["priority-micro-lamports"] != null &&
    values["priority-micro-lamports"] !== ""
      ? parsePositiveInt(values["priority-micro-lamports"], 1)
      : null;
  const frontRunnerProtection = Boolean(values["front-runner-protection"]);
  const tipSol = values["tip-sol"] != null ? Number.parseFloat(values["tip-sol"]) : undefined;
  if (tipSol != null && (Number.isNaN(tipSol) || tipSol < 0)) throw new Error("--tip-sol must be a non-negative number");

  const connection = getConnection();

  const rpcUrl = connection.rpcEndpoint;
  const isDevnet = rpcUrl.includes("devnet");
  const defaultAlt = isDevnet ? ALT_ADDRESS_DEVNET : ALT_ADDRESS_MAINNET;
  const altAddressStr =
    values["alt-address"]?.trim() ||
    process.env.NEXT_PUBLIC_SOLANA_ALT_ADDRESS?.trim() ||
    defaultAlt;

  const onlineSdk = new OnlinePumpSdk(connection);
  const [global, feeConfig] = await Promise.all([
    onlineSdk.fetchGlobal(),
    onlineSdk.fetchFeeConfig(),
  ]);

  let addressLookupTableAccounts = [];
  if (altAddressStr) {
    const altAccount = await connection.getAddressLookupTable(new PublicKey(altAddressStr));
    if (altAccount.value) {
      addressLookupTableAccounts = [altAccount.value];
    }
  }

  const mintKeypair = Keypair.generate();
  const mint = mintKeypair.publicKey;
  const solAmount = new BN(solLamports);

  const tokenAmount = getBuyTokenAmountFromSolAmount({
    global,
    feeConfig,
    mintSupply: null,
    bondingCurve: null,
    amount: solAmount,
  });

  const sdkInstructions = await PUMP_SDK.createV2AndBuyInstructions({
    global,
    mint,
    name,
    symbol,
    uri: metadataUri,
    creator: user,
    user,
    amount: tokenAmount,
    solAmount,
    mayhemMode,
    cashback,
  });

  if (tokenizedAgent) {
    const agentInitializeIx = await PumpAgentOffline.load(mint).create({
      authority: user,
      mint,
      agentAuthority: user,
      buybackBps,
    });
    sdkInstructions.push(agentInitializeIx);
  }

  const tx = await buildAndPartialSignTx({
    connection,
    payerKey: user,
    sdkInstructions,
    computeUnits,
    priorityFeeMicroLamports: priorityOverride,
    extraSigners: [mintKeypair],
    addressLookupTableAccounts,
    frontRunnerProtection,
    tipSol,
  });

  mkdirSync(dirname(resolvedOut), { recursive: true });
  writeFileSync(
    resolvedOut,
    `${JSON.stringify(Array.from(mintKeypair.secretKey))}\n`,
    { mode: 0o600 },
  );

  printJson({
    transaction: transactionToBase64(tx),
    mintPublicKey: mint.toBase58(),
    mintKeypairPath: resolvedOut,
    quoteTokenAmount: tokenAmount.toString(),
    solLamports,
    mayhemMode,
    cashback,
    tokenizedAgent,
    ...(tokenizedAgent ? { buybackBps } : {}),
    frontRunnerProtection,
  });
}

main().catch((e) => {
  process.stderr.write(`${e?.message ?? e}\n`);
  process.exit(1);
});
