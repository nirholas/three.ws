#!/usr/bin/env node
/**
 * SOL balance via RPC; optional token ATA for a mint; optional pump profile HTTP API.
 */
import { parseArgs } from "node:util";
import {
  getAccount,
  getAssociatedTokenAddressSync,
} from "@solana/spl-token";
import { getConnection } from "./lib/env.mjs";
import { tokenProgramIdFromMint } from "./lib/coin-resolve.mjs";
import {
  exitWithHelp,
  printJson,
  requirePublicKey,
} from "./lib/args.mjs";

const HELP = `Usage: node scripts/print-balances.mjs [options]

Options:
  --wallet <PUBKEY>        Required
  --mint <PUBKEY>          If set, include on-chain token balance (ATA for mint)
  --use-profile-api        Also fetch profile-api.pump.fun summary + token list (HTTP)
  -h, --help

Environment:
  SOLANA_RPC_URL or NEXT_PUBLIC_SOLANA_RPC_URL (required for --mint and native balance)`;

async function fetchProfileSummary(wallet) {
  const r = await fetch(
    `https://profile-api.pump.fun/balance/summary/${wallet}`,
  );
  if (!r.ok) throw new Error(`profile summary HTTP ${r.status}`);
  return r.json();
}

async function fetchProfileTokens(wallet, page = 1, size = 50) {
  const r = await fetch(
    `https://profile-api.pump.fun/balance/tokens/${wallet}?page=${page}&size=${size}`,
  );
  if (!r.ok) throw new Error(`profile tokens HTTP ${r.status}`);
  return r.json();
}

async function main() {
  const { values } = parseArgs({
    args: process.argv.slice(2),
    options: {
      wallet: { type: "string" },
      mint: { type: "string" },
      "use-profile-api": { type: "boolean", default: false },
      help: { type: "boolean", short: "h" },
    },
    strict: true,
    allowPositionals: false,
  });

  if (values.help) exitWithHelp("print-balances.mjs", HELP);

  const wallet = requirePublicKey("--wallet", values.wallet);

  const out = { wallet: wallet.toBase58() };

  const needRpc = Boolean(values.mint) || !values["use-profile-api"];

  let connection;
  if (needRpc) {
    connection = getConnection();
    const lamports = await connection.getBalance(wallet);
    out.nativeLamports = lamports;
    out.nativeSol = lamports / 1e9;
  }

  if (values.mint) {
    const mint = requirePublicKey("--mint", values.mint);
    const tokenProgram = await tokenProgramIdFromMint(
      /** @type {import("@solana/web3.js").Connection} */ (connection),
      mint,
    );
    const ata = getAssociatedTokenAddressSync(
      mint,
      wallet,
      true,
      tokenProgram,
    );
    out.tokenMint = mint.toBase58();
    out.associatedTokenAccount = ata.toBase58();
    try {
      const acc = await getAccount(
        /** @type {import("@solana/web3.js").Connection} */ (connection),
        ata,
        "confirmed",
        tokenProgram,
      );
      out.tokenRawAmount = acc.amount.toString();
      out.tokenUiAmount = Number(acc.amount) / 1e6;
    } catch {
      out.tokenRawAmount = "0";
      out.tokenUiAmount = 0;
      out.tokenNote = "ATA missing or empty";
    }
  }

  if (values["use-profile-api"]) {
    const [summary, tokens] = await Promise.all([
      fetchProfileSummary(wallet.toBase58()),
      fetchProfileTokens(wallet.toBase58()),
    ]);
    out.profileSummary = summary;
    out.profileTokens = tokens;
  }

  printJson(out);
}

main().catch((e) => {
  process.stderr.write(`${e?.message ?? e}\n`);
  process.exit(1);
});
