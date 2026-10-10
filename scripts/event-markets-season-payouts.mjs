#!/usr/bin/env node
// Event Markets season reward table. NEVER signs, sends or pays.
//
// The rollup cron proposes the reward list for every ended season
// (event_market_season_payouts, status 'proposed'). Paying $THREE is owner-gated:
// this script prints the table (recipient, amount, token, chain), then stops.
// The owner reads it, says yes, and the transfer is made through the money-moving
// skill (.agents/skills/send-usdc style confirmation, one row at a time). Only
// then is the ledger updated here.
//
// Usage:
//   node --env-file=.env scripts/event-markets-season-payouts.mjs --season 2026-Q4
//   node --env-file=.env scripts/event-markets-season-payouts.mjs --season 2026-Q4 --approve
//        (records the owner's yes in the ledger: proposed -> approved. No funds move.)
//   node --env-file=.env scripts/event-markets-season-payouts.mjs --season 2026-Q4 --paid <account_id> <tx_signature>
//        (after the owner-approved transfer lands: approved -> paid, with the signature.)
//   node --env-file=.env scripts/event-markets-season-payouts.mjs --season 2026-Q4 --skip <account_id> "reason"

import { sql } from '../api/_lib/db.js';
import { seasonById, CONFIG } from '../api/_lib/event-markets/scoring.js';

const args = process.argv.slice(2);
const flag = (name) => args.includes(`--${name}`);
const value = (name) => {
	const i = args.indexOf(`--${name}`);
	return i >= 0 ? args[i + 1] : null;
};

const season = seasonById(value('season'));
if (!season) {
	console.error('Pass --season 2026-Q4 (a season id: year, Q, quarter).');
	process.exit(2);
}
if (!season.ended) {
	console.error(`Season ${season.id} ends ${season.end}. Rewards are only proposed once it has ended.`);
	process.exit(2);
}

const fmt = (n) => Number(n).toLocaleString('en-US');
const pad = (s, w) => String(s).padEnd(w);

async function load() {
	return sql`
		select p.rank, p.account_id, p.wallet_address, p.amount, p.token, p.chain, p.perk, p.status, p.note, p.tx_signature,
		       coalesce(nullif(u.username, ''), 'account') as handle
		from event_market_season_payouts p join users u on u.id = p.account_id
		where p.season_id = ${season.id}
		order by p.rank, p.account_id`;
}

function print(rows) {
	console.log(`\nEvent Markets season ${season.id} (${season.label}) reward table, settlement: ${CONFIG.rewards.settlement}\n`);
	if (!rows.length) {
		console.log('No proposals. Either the rollup has not run since the season ended, or nobody ranked with a positive score.\n');
		return;
	}
	console.log(`${pad('rank', 5)}${pad('recipient (wallet)', 46)}${pad('amount', 12)}${pad('token', 8)}${pad('chain', 8)}status`);
	for (const r of rows) {
		console.log(`${pad(r.rank, 5)}${pad(r.wallet_address || `NO WALLET (${r.handle})`, 46)}${pad(fmt(r.amount), 12)}${pad(r.token, 8)}${pad(r.chain, 8)}${r.status}${r.tx_signature ? ` ${r.tx_signature}` : ''}`);
		if (r.note) console.log(`     note: ${r.note}`);
	}
	const payable = rows.filter((r) => r.wallet_address && ['proposed', 'approved'].includes(r.status));
	const total = payable.reduce((s, r) => s + Number(r.amount), 0);
	console.log(`\nPayable rows: ${payable.length}. Total: ${fmt(total)} ${CONFIG.rewards.token} on ${CONFIG.rewards.chain}.`);
	console.log('Perks (profile badges and plan credit) are applied separately and need no transfer.\n');
}

let rows = await load();

if (flag('approve')) {
	const done = await sql`
		update event_market_season_payouts set status = 'approved', updated_at = now()
		where season_id = ${season.id} and status = 'proposed' and wallet_address is not null returning account_id`;
	console.log(`Recorded the owner's approval for ${done.length} row(s). No funds moved.`);
	rows = await load();
} else if (flag('paid')) {
	const [account, signature] = [value('paid'), args[args.indexOf('--paid') + 2]];
	if (!account || !signature) {
		console.error('Usage: --paid <account_id> <tx_signature>');
		process.exit(2);
	}
	const done = await sql`
		update event_market_season_payouts set status = 'paid', tx_signature = ${signature}, updated_at = now()
		where season_id = ${season.id} and account_id = ${account} and status = 'approved' returning account_id`;
	if (!done.length) {
		console.error('That row is not approved yet (or does not exist). Approve the table first.');
		process.exit(1);
	}
	rows = await load();
} else if (flag('skip')) {
	const [account, reason] = [value('skip'), args[args.indexOf('--skip') + 2] || 'skipped by owner'];
	await sql`
		update event_market_season_payouts set status = 'skipped', note = ${reason}, updated_at = now()
		where season_id = ${season.id} and account_id = ${account} and status in ('proposed', 'approved')`;
	rows = await load();
}

print(rows);
if (rows.some((r) => r.status === 'proposed' && r.wallet_address)) {
	console.log('STOP: the owner must approve this table before any transfer. Nothing has been sent.');
}
process.exit(0);
