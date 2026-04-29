#!/usr/bin/env node
/**
 * Fetch coin metadata and state flags from pump.fun HTTP API (no RPC).
 */
import { parseArgs } from "node:util";
import { fetchCoinV2 } from "./lib/coin-api.mjs";
import {
  exitWithHelp,
  printJson,
  requireString,
} from "./lib/args.mjs";

const HELP = `Usage: node scripts/fetch-coin.mjs --mint <MINT> [--subset]

GET https://frontend-api-v3.pump.fun/coins-v2/{mint}

Options:
  --mint       Coin mint (base58)
  --subset     Only print complete, pump_swap_pool, token_program, bonding_curve
  -h, --help   Show help

Environment:
  (none — uses public pump.fun API)`;

async function main() {
  const { values } = parseArgs({
    args: process.argv.slice(2),
    options: {
      mint: { type: "string" },
      subset: { type: "boolean", default: false },
      help: { type: "boolean", short: "h" },
    },
    strict: true,
    allowPositionals: false,
  });

  if (values.help) exitWithHelp("fetch-coin.mjs", HELP);

  const mint = requireString("--mint", values.mint);
  const coin = await fetchCoinV2(mint);

  if (values.subset) {
    printJson({
      complete: coin.complete,
      pump_swap_pool: coin.pump_swap_pool ?? null,
      token_program: coin.token_program ?? null,
      bonding_curve: coin.bonding_curve ?? null,
    });
    return;
  }

  printJson(coin);
}

main().catch((e) => {
  process.stderr.write(`${e?.message ?? e}\n`);
  process.exit(1);
});
