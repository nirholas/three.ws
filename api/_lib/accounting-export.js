/**
 * Accounting export: one flat, bookkeeper-ready ledger across the money the
 * platform moves, built from Postgres only.
 *
 *   withdrawal      agent_withdrawals           what owners pulled out
 *   platform_fee    agent_revenue_events        gross / platform fee / net per paid skill call
 *   bounty_escrow   vanity_bounties             USDC escrowed by a requester
 *   bounty_payout   vanity_bounties             winner payout
 *   bounty_refund   vanity_bounties             expiry refund to the requester
 *
 * Columns are fixed and ordered (COLUMNS), timestamps are UTC ISO-8601, amounts
 * are integer atomics in the asset's smallest unit, and every row that touched a
 * chain carries its tx signature and an explorer link.
 */

import { sql } from './db.js';

export const COLUMNS = Object.freeze([
	'kind', 'id', 'occurred_at', 'agent_id', 'user_id', 'chain', 'asset',
	'amount_atomics', 'fee_atomics', 'net_atomics', 'counterparty', 'status',
	'tx_signature', 'tx_url', 'note',
]);

export const MAX_RANGE_DAYS = 366;
const DAY_MS = 86_400_000;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Parse an inclusive UTC date range. Throws {status:400, code} on bad input.
 * @returns {{ fromMs: number, toMs: number, from: string, to: string }} toMs is exclusive (start of the day after `to`).
 */
export function parseRange(from, to) {
	const bad = (code, message) => Object.assign(new Error(message), { status: 400, code });
	if (!DATE_RE.test(from || '') || !DATE_RE.test(to || '')) {
		throw bad('invalid_range', 'from and to must be YYYY-MM-DD dates');
	}
	const fromMs = Date.parse(`${from}T00:00:00.000Z`);
	const toStart = Date.parse(`${to}T00:00:00.000Z`);
	if (!Number.isFinite(fromMs) || !Number.isFinite(toStart)) throw bad('invalid_range', 'from and to must be real dates');
	if (toStart < fromMs) throw bad('invalid_range', 'to must not be before from');
	if ((toStart - fromMs) / DAY_MS + 1 > MAX_RANGE_DAYS) {
		throw bad('range_too_large', `range is limited to ${MAX_RANGE_DAYS} days`);
	}
	return { fromMs, toMs: toStart + DAY_MS, from, to };
}

export function explorerUrl(chain, signature) {
	if (!signature) return '';
	const sig = encodeURIComponent(signature);
	switch (String(chain || '').toLowerCase()) {
		case 'solana':
			return `https://solscan.io/tx/${sig}`;
		case 'base':
			return `https://basescan.org/tx/${sig}`;
		case 'ethereum':
			return `https://etherscan.io/tx/${sig}`;
		default:
			return '';
	}
}

const iso = (ms) => new Date(Number(ms)).toISOString();
const text = (v) => (v == null ? '' : String(v));
const atomics = (v) => (v == null ? '' : String(v));

function row(fields) {
	const out = {};
	for (const c of COLUMNS) out[c] = fields[c] == null ? '' : fields[c];
	return out;
}

/** Collect every ledger row in [fromMs, toMs). */
export async function collectAccountingRows({ fromMs, toMs }) {
	const fromIso = new Date(fromMs).toISOString();
	const toIso = new Date(toMs).toISOString();

	const [withdrawals, fees, bounties] = await Promise.all([
		sql`
			select id, user_id, agent_id, amount::text as amount, currency_mint, chain, to_address, status,
				tx_signature, created_at
			from agent_withdrawals
			where created_at >= ${fromIso}::timestamptz and created_at < ${toIso}::timestamptz`,
		sql`
			select id, agent_id, intent_id, skill, gross_amount::text as gross, fee_amount::text as fee,
				net_amount::text as net, currency_mint, chain, payer_address, created_at
			from agent_revenue_events
			where created_at >= ${fromIso}::timestamptz and created_at < ${toIso}::timestamptz`,
		sql`
			select id, record from vanity_bounties
			where status not in ('escrow_pending', 'void')
				and (
					((record->>'escrowSettledAt')::bigint >= ${fromMs} and (record->>'escrowSettledAt')::bigint < ${toMs})
					or ((record->>'payoutAt')::bigint >= ${fromMs} and (record->>'payoutAt')::bigint < ${toMs})
					or ((record->>'refundAt')::bigint >= ${fromMs} and (record->>'refundAt')::bigint < ${toMs})
				)`,
	]);

	const rows = [];
	for (const w of withdrawals) {
		rows.push(row({
			kind: 'withdrawal', id: w.id, occurred_at: new Date(w.created_at).toISOString(),
			agent_id: w.agent_id, user_id: w.user_id, chain: w.chain, asset: w.currency_mint,
			amount_atomics: atomics(w.amount), counterparty: w.to_address, status: w.status,
			tx_signature: w.tx_signature, tx_url: explorerUrl(w.chain, w.tx_signature),
		}));
	}
	for (const f of fees) {
		rows.push(row({
			kind: 'platform_fee', id: f.id, occurred_at: new Date(f.created_at).toISOString(),
			agent_id: f.agent_id, chain: f.chain, asset: f.currency_mint,
			amount_atomics: atomics(f.gross), fee_atomics: atomics(f.fee), net_atomics: atomics(f.net),
			counterparty: f.payer_address, status: 'recorded', note: `intent ${f.intent_id}; skill ${f.skill}`,
		}));
	}
	const inRange = (ms) => ms != null && Number(ms) >= fromMs && Number(ms) < toMs;
	for (const b of bounties) {
		const r = typeof b.record === 'string' ? JSON.parse(b.record) : b.record;
		const chain = text(r.escrowNetwork || r.network).toLowerCase().startsWith('base') ? 'base' : 'solana';
		const asset = text(r.asset || 'USDC');
		if (inRange(r.escrowSettledAt)) {
			rows.push(row({
				kind: 'bounty_escrow', id: `${b.id}:escrow`, occurred_at: iso(r.escrowSettledAt), chain, asset,
				amount_atomics: atomics(r.amountAtomics), counterparty: r.refundAddress || '',
				status: 'escrowed', tx_signature: r.escrowTx, tx_url: explorerUrl(chain, r.escrowTx), note: `bounty ${b.id}`,
			}));
		}
		if (inRange(r.payoutAt)) {
			rows.push(row({
				kind: 'bounty_payout', id: `${b.id}:payout`, occurred_at: iso(r.payoutAt), chain, asset,
				amount_atomics: atomics(r.amountAtomics), counterparty: r.winnerAddress, status: 'paid',
				tx_signature: r.payoutTx, tx_url: explorerUrl('solana', r.payoutTx), note: `bounty ${b.id}`,
			}));
		}
		if (inRange(r.refundAt)) {
			rows.push(row({
				kind: 'bounty_refund', id: `${b.id}:refund`, occurred_at: iso(r.refundAt), chain, asset,
				amount_atomics: atomics(r.amountAtomics), counterparty: r.refundAddress || '',
				status: 'refunded', tx_signature: r.refundTx, tx_url: explorerUrl('solana', r.refundTx), note: `bounty ${b.id}`,
			}));
		}
	}

	rows.sort((a, b) => a.occurred_at.localeCompare(b.occurred_at) || a.kind.localeCompare(b.kind) || a.id.localeCompare(b.id));
	return rows;
}

function csvCell(v) {
	const s = String(v ?? '');
	// Neutralise spreadsheet formula injection from counterparty / note fields.
	const safe = /^[=+\-@\t\r]/.test(s) ? `'${s}` : s;
	return /[",\r\n]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
}

/** RFC 4180 CSV with the fixed header row. */
export function toCsv(rows) {
	const lines = [COLUMNS.join(',')];
	for (const r of rows) lines.push(COLUMNS.map((c) => csvCell(r[c])).join(','));
	return lines.join('\r\n') + '\r\n';
}
