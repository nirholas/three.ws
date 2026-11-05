#!/usr/bin/env node
// Builds a real lending deposit against live Solana mainnet state and SIMULATES
// it. Nothing is signed or sent. Prints the compute units, the wallet token and
// SOL movement, and the collateral the deposit would credit.
//
//   node scripts/lending-simulate-proof.mjs [--token USDC] [--amount 1] [--owner <address>]
//
// With no --owner it picks the largest holder of the token's mint, so the
// simulation has a funded wallet to draw from. The owner is only an address:
// the transaction is built with a no-op signer and simulated with sigVerify off.

import { PublicKey } from '@solana/web3.js';
import { getVenue } from '../api/_lib/lending/index.js';
import { lendingConnection } from '../api/_lib/lending/rpc.js';
import { parseAmount, formatRaw } from '../api/_lib/lending/math.js';
import { compile, lookupTables, simulateBounded, resolveToken } from '../api/_lib/lending/service.js';

function flag(name, fallback) {
	const i = process.argv.indexOf(`--${name}`);
	return i > -1 ? process.argv[i + 1] : fallback;
}

async function largestHolder(conn, mint) {
	const { value } = await conn.getTokenLargestAccounts(new PublicKey(mint));
	for (const acct of value.slice(0, 10)) {
		const info = await conn.getParsedAccountInfo(acct.address);
		const owner = info.value?.data?.parsed?.info?.owner;
		if (!owner) continue;
		const ownerInfo = await conn.getAccountInfo(new PublicKey(owner));
		// A system-owned account is a plain wallet; PDAs and program vaults are not.
		if (ownerInfo && ownerInfo.owner.toBase58() === '11111111111111111111111111111111') return { owner, balance: acct.uiAmountString };
	}
	throw new Error('No plain wallet among the largest holders; pass --owner.');
}

const venue = getVenue();
const conn = lendingConnection();
const row = await resolveToken(venue, flag('token', 'USDC'));
const amountRaw = parseAmount(flag('amount', '1'), row.decimals);
const picked = flag('owner') ? { owner: flag('owner'), balance: null } : await largestHolder(conn, row.mint);

console.log(`venue      ${venue.name}  market ${venue.market}`);
console.log(`token      ${row.symbol} (${row.mint}), supply APY ${(row.supply_apy * 100).toFixed(2)}%`);
console.log(`owner      ${picked.owner}${picked.balance ? `  (holds ${picked.balance} ${row.symbol})` : ''}`);
console.log(`deposit    ${formatRaw(amountRaw, row.decimals)} ${row.symbol}`);

const built = await venue.buildDeposit({ owner: picked.owner, reserve: row.reserve, amountRaw });
const tables = await lookupTables(conn, built.lookup_table_addresses);
const draft = await compile(conn, picked.owner, built.instructions, tables, 1_400_000);
const sim = await simulateBounded({ conn, vtx: draft.vtx, owner: picked.owner, mint: row.mint });

console.log(`obligation ${built.obligation}${built.first_deposit ? '  (first deposit: opens the account)' : ''}`);
console.log(`steps      ${built.labels.join(', ')}`);
console.log(`simulation ${sim.ok ? 'PASSED' : `FAILED ${JSON.stringify(sim.error)}`}`);
console.log(`compute    ${sim.units} units`);
console.log(`token out  ${formatRaw(sim.token_out_raw, row.decimals)} ${row.symbol}`);
console.log(`sol out    ${sim.lamports_out / 1e9} SOL (fees and one-time account rent)`);
const rate = await venue.collateralExchangeRate?.(row.reserve);
if (rate) console.log(`collateral ${(Number(formatRaw(amountRaw, row.decimals)) * rate).toFixed(6)} cTokens at ${rate.toFixed(6)} per ${row.symbol}`);
if (!sim.ok) {
	console.log(sim.logs.join('\n'));
	process.exit(1);
}
