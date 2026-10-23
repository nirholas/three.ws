// Pure logic for the revenue ledger and reinvest rules: source mapping, USD
// valuation, period bucketing, totals, CSV, the trailing-window projection and
// the reinvest split planner. No I/O lives here so every rule is unit-testable
// (tests/revenue-ledger.test.js); api/_lib/revenue-ledger.js does the database
// and chain work around it.

import { createHash } from 'node:crypto';

export const USDC_MINTS = Object.freeze({
	mainnet: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v',
	devnet: '4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU',
});
export const SOL_DECIMALS = 9;
export const USDC_DECIMALS = 6;

/** The six income sources, in the fixed order charts assign colour slots. */
export const SOURCES = Object.freeze([
	{ key: 'creator_fee_claim', kind: 'revenue', label: 'Creator fees', how: 'Pump.fun creator fees the agent claimed to its wallet. Counted when claimed (the claim is the transaction), valued in USD at the SOL price when the ledger first saw the claim.' },
	{ key: 'skill_sale', kind: 'revenue', label: 'Skill and API sales', how: 'x402 skill and agent-API sales, net of the platform fee, from agent_revenue_events. Valued in USD from the settled asset.' },
	{ key: 'hire', kind: 'revenue', label: 'Hires', how: 'Completed agent-to-agent hires paid to this agent, at the USD amount recorded when the hire settled.' },
	{ key: 'skill_royalty', kind: 'revenue', label: 'Skill royalties', how: 'The author share of marketplace skill calls (royalty_ledger, settled rows), at the USD amount recorded at settlement. Credited to the owner, not a specific agent.' },
	{ key: 'invoice', kind: 'revenue', label: 'Invoices', how: 'Agent invoices that reached paid, at the USD value fixed when the invoice was paid.' },
	{ key: 'trading_pnl', kind: 'pnl', label: 'Trading PnL (realised)', how: 'Realised profit or loss of closed sniper positions, in SOL at the exit, valued at the SOL price when the ledger first saw the close. Reported separately: it is not revenue and can be negative.' },
]);
export const SOURCE_KEYS = Object.freeze(SOURCES.map((s) => s.key));
export const SOURCE_BY_KEY = Object.freeze(Object.fromEntries(SOURCES.map((s) => [s.key, s])));

const PERIODS = new Set(['day', 'week', 'month']);

/** Decimal string for an atomic amount, without float drift. */
export function formatAtomics(atomics, decimals) {
	const neg = BigInt(atomics) < 0n;
	const abs = neg ? -BigInt(atomics) : BigInt(atomics);
	const base = 10n ** BigInt(decimals);
	const whole = abs / base;
	const frac = (abs % base).toString().padStart(decimals, '0').replace(/0+$/, '');
	return `${neg ? '-' : ''}${whole}${frac ? `.${frac}` : ''}`;
}

/** Convert a JS number of USD to 6-decimal atomics of USDC. */
export function usdToUsdcAtomics(usd) {
	return BigInt(Math.round(Number(usd) * 1e6));
}

function toIso(v) {
	const d = v instanceof Date ? v : new Date(v);
	return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

function networkFromCaip(network) {
	const n = String(network || '').toLowerCase();
	if (n.startsWith('eip155') || n === 'base' || n === 'base-sepolia') return { chain: 'base', network: 'mainnet' };
	if (n.includes('devnet') || n.includes('etwtrabzayq6imfeykouru166vu2xqa1')) return { chain: 'solana', network: 'devnet' };
	return { chain: 'solana', network: 'mainnet' };
}

function base(row, o) {
	return {
		user_id: o.user_id,
		agent_id: o.agent_id ?? null,
		source: o.source,
		kind: SOURCE_BY_KEY[o.source].kind,
		source_ref: String(o.source_ref),
		occurred_at: toIso(o.occurred_at),
		asset: o.asset,
		amount_atomics: String(o.amount_atomics),
		decimals: o.decimals,
		usd: o.usd ?? null,
		usd_basis: o.usd_basis ?? 'unvalued',
		usd_price: o.usd_price ?? null,
		tx_signature: o.tx_signature || null,
		chain: o.chain || 'solana',
		network: o.network || 'mainnet',
		counterparty: o.counterparty || null,
		label: o.label || null,
		counted: o.counted !== false,
		exclusion_reason: o.exclusion_reason || null,
		meta: o.meta || {},
	};
}

/** launcher_claims row (joined to its agent owner) to a ledger entry. */
export function mapCreatorClaim(r) {
	const lamports = BigInt(r.claimed_lamports ?? 0);
	if (!r.user_id || !r.agent_id || lamports <= 0n || !r.claim_sig) return null;
	return base(r, {
		user_id: r.user_id,
		agent_id: r.agent_id,
		source: 'creator_fee_claim',
		source_ref: r.id,
		occurred_at: r.created_at,
		asset: 'SOL',
		amount_atomics: lamports,
		decimals: SOL_DECIMALS,
		tx_signature: r.claim_sig,
		network: r.network === 'devnet' ? 'devnet' : 'mainnet',
		label: 'Creator fee claim',
		counterparty: r.mint,
		meta: { mint: r.mint, buyback_sol: r.buyback_sol ?? 0, buyback_sig: r.buyback_sig || null },
	});
}

function mintAsset(mint) {
	if (mint === USDC_MINTS.mainnet) return { asset: 'USDC', decimals: USDC_DECIMALS, network: 'mainnet' };
	if (mint === USDC_MINTS.devnet) return { asset: 'USDC', decimals: USDC_DECIMALS, network: 'devnet' };
	return null;
}

/** agent_revenue_events row (joined to its agent) to a ledger entry. */
export function mapRevenueEvent(r, { threeMint = null, threeDecimals = 6 } = {}) {
	const net = BigInt(r.net_amount ?? 0);
	const userId = r.owner_user_id || r.user_id;
	if (!userId || net <= 0n) return null;
	let spec = mintAsset(r.currency_mint);
	if (!spec && threeMint && r.currency_mint === threeMint) spec = { asset: 'THREE', decimals: threeDecimals, network: 'mainnet' };
	const intent = String(r.intent_id || '');
	const m = /^x402:([1-9A-HJ-NP-Za-km-z]{60,100})$/.exec(intent);
	const isBase = r.chain && r.chain !== 'solana';
	return base(r, {
		user_id: userId,
		agent_id: r.agent_id,
		source: 'skill_sale',
		source_ref: r.id,
		occurred_at: r.created_at,
		asset: spec?.asset || 'UNKNOWN',
		amount_atomics: net,
		decimals: spec?.decimals ?? 0,
		usd: spec?.asset === 'USDC' ? Number(formatAtomics(net, spec.decimals)) : null,
		usd_basis: spec?.asset === 'USDC' ? 'exact' : 'unvalued',
		usd_price: spec?.asset === 'USDC' ? 1 : null,
		tx_signature: isBase ? null : m ? m[1] : null,
		chain: isBase ? 'base' : 'solana',
		network: spec?.network || 'mainnet',
		counterparty: r.payer_address,
		label: r.skill || 'Skill sale',
		counted: !isBase,
		exclusion_reason: isBase ? 'evm_not_included' : null,
		meta: { gross_amount: String(r.gross_amount ?? ''), fee_amount: String(r.fee_amount ?? ''), settled_to_wallet: r.settled_to_wallet ?? null, currency_mint: r.currency_mint },
	});
}

/** Completed agent_hires row to a ledger entry for the provider. */
export function mapHire(r) {
	if (r.status !== 'completed' || !r.provider_agent_id || !r.provider_user_id) return null;
	const atomics = BigInt(r.amount_atomics ?? 0);
	if (atomics <= 0n) return null;
	const usd = r.usd != null ? Number(r.usd) : null;
	return base(r, {
		user_id: r.provider_user_id,
		agent_id: r.provider_agent_id,
		source: 'hire',
		source_ref: r.id,
		occurred_at: r.completed_at || r.created_at,
		asset: String(r.currency || 'USDC').toUpperCase(),
		amount_atomics: atomics,
		decimals: USDC_DECIMALS,
		usd,
		usd_basis: usd != null ? 'recorded' : 'unvalued',
		tx_signature: r.payment_signature,
		counterparty: r.payer_address,
		label: r.skill_name || 'Hire',
		meta: { service_slug: r.service_slug || null, invocation_signature: r.invocation_signature || null },
	});
}

/** Settled royalty_ledger row to a ledger entry for the author. */
export function mapRoyalty(r) {
	if (r.status !== 'settled' || !r.author_user_id) return null;
	const usd = Number(r.price_usd);
	if (!Number.isFinite(usd) || usd <= 0) return null;
	const { chain, network } = networkFromCaip(r.network);
	return base(r, {
		user_id: r.author_user_id,
		agent_id: r.agent_id,
		source: 'skill_royalty',
		source_ref: r.id,
		occurred_at: r.settled_at || r.created_at,
		asset: 'USDC',
		amount_atomics: usdToUsdcAtomics(usd),
		decimals: USDC_DECIMALS,
		usd,
		usd_basis: 'recorded',
		tx_signature: chain === 'solana' ? r.tx_hash : null,
		chain,
		network,
		counterparty: r.payer,
		label: 'Skill royalty',
		counted: chain === 'solana',
		exclusion_reason: chain === 'solana' ? null : 'evm_not_included',
		meta: { skill_id: r.skill_id, source: r.source, platform_fee_usd: r.platform_fee_usd ?? null, tx_hash: r.tx_hash || null },
	});
}

/** Paid agent_commerce_invoices row (with its first counted payment) to an entry. */
export function mapInvoice(r) {
	if (r.status !== 'paid' || !r.user_id) return null;
	const atomics = BigInt(r.paid_atomics ?? 0);
	if (atomics <= 0n) return null;
	const usd = r.paid_usd != null ? Number(r.paid_usd) : null;
	return base(r, {
		user_id: r.user_id,
		agent_id: r.agent_id,
		source: 'invoice',
		source_ref: r.id,
		occurred_at: r.paid_at || r.updated_at,
		asset: r.asset,
		amount_atomics: atomics,
		decimals: r.decimals,
		usd,
		usd_basis: usd != null ? 'recorded' : 'unvalued',
		tx_signature: r.payment_signature || null,
		network: r.network === 'devnet' ? 'devnet' : 'mainnet',
		counterparty: r.paid_by || r.payer_address,
		label: `Invoice ${r.number}`,
		meta: { number: r.number, paid_late: Boolean(r.paid_late) },
	});
}

/** Closed agent_sniper_positions row to a realised-PnL entry. */
export function mapTradePnl(r) {
	if (r.status !== 'closed' || r.realized_pnl_lamports == null || !r.user_id) return null;
	const lamports = BigInt(String(r.realized_pnl_lamports).split('.')[0]);
	if (lamports === 0n) return null;
	// A simulated fill never touched the chain; its signature is synthetic.
	const simulated = r.exec_route === 'simulated' || r.sell_sig === 'SIMULATED';
	return base(r, {
		user_id: r.user_id,
		agent_id: r.agent_id,
		source: 'trading_pnl',
		source_ref: r.id,
		occurred_at: r.closed_at || r.opened_at,
		asset: 'SOL',
		amount_atomics: lamports,
		decimals: SOL_DECIMALS,
		tx_signature: r.sell_sig,
		network: r.network === 'devnet' ? 'devnet' : 'mainnet',
		label: r.symbol ? `${r.symbol} position` : 'Closed position',
		counterparty: r.mint,
		counted: !simulated,
		exclusion_reason: simulated ? 'simulated_fill' : null,
		meta: { mint: r.mint, exec_route: r.exec_route || null, exit_reason: r.exit_reason || null, pnl_pct: r.realized_pnl_pct ?? null },
	});
}

/**
 * Value an entry in USD. Entries that already carry a recorded or exact USD keep
 * it. SOL and $THREE entries take the sync-time price; with no price they stay
 * unvalued and are listed as such, never guessed.
 */
export function valueEntry(entry, prices = {}) {
	if (entry.usd != null) return entry;
	const price = prices[entry.asset];
	if (!(price > 0)) return entry;
	const units = Number(formatAtomics(entry.amount_atomics, entry.decimals));
	return { ...entry, usd: Math.round(units * price * 1e6) / 1e6, usd_basis: 'sync_price', usd_price: price };
}

/** Whether an entry belongs in totals: mainnet Solana, flagged counted. */
export function inTotals(e) {
	return e.counted !== false && e.chain === 'solana' && e.network === 'mainnet';
}

/** Start (UTC) of the day, ISO week (Monday) or month holding `date`. */
export function bucketStart(date, period) {
	if (!PERIODS.has(period)) throw new Error(`period must be one of ${[...PERIODS].join(', ')}`);
	const d = new Date(date);
	const day = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
	if (period === 'day') return day;
	if (period === 'week') {
		const dow = (day.getUTCDay() + 6) % 7;
		return new Date(day.getTime() - dow * 86400000);
	}
	return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1));
}

function nextBucket(d, period) {
	if (period === 'day') return new Date(d.getTime() + 86400000);
	if (period === 'week') return new Date(d.getTime() + 7 * 86400000);
	return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 1));
}

/**
 * Totals by source and a gap-free series by period. Only entries in totals are
 * summed; unvalued ones are counted and reported so the page can say so.
 * `revenue_usd` excludes trading PnL, which is reported on its own line.
 */
export function summarize(entries, { period = 'month', from = null, to = null } = {}) {
	const fromMs = from ? new Date(from).getTime() : -Infinity;
	const toMs = to ? new Date(to).getTime() : Infinity;
	const bySource = Object.fromEntries(SOURCE_KEYS.map((k) => [k, { usd: 0, count: 0, unvalued: 0 }]));
	const buckets = new Map();
	let unvaluedCount = 0;
	let excludedCount = 0;
	for (const e of entries) {
		const t = new Date(e.occurred_at).getTime();
		if (t < fromMs || t >= toMs) continue;
		if (!inTotals(e)) {
			excludedCount++;
			continue;
		}
		const s = bySource[e.source];
		if (!s) continue;
		s.count++;
		if (e.usd == null) {
			s.unvalued++;
			unvaluedCount++;
			continue;
		}
		const usd = Number(e.usd);
		s.usd += usd;
		const key = bucketStart(t, period).toISOString();
		const b = buckets.get(key) || Object.fromEntries(SOURCE_KEYS.map((k) => [k, 0]));
		b[e.source] += usd;
		buckets.set(key, b);
	}
	for (const s of Object.values(bySource)) s.usd = Math.round(s.usd * 1e6) / 1e6;
	const revenueUsd = SOURCES.filter((s) => s.kind === 'revenue').reduce((a, s) => a + bySource[s.key].usd, 0);
	const pnlUsd = bySource.trading_pnl.usd;

	const series = [];
	if (buckets.size) {
		const keys = [...buckets.keys()].sort();
		let cur = new Date(keys[0]);
		const last = new Date(keys[keys.length - 1]);
		while (cur <= last) {
			const b = buckets.get(cur.toISOString()) || Object.fromEntries(SOURCE_KEYS.map((k) => [k, 0]));
			series.push({ start: cur.toISOString(), ...Object.fromEntries(SOURCE_KEYS.map((k) => [k, Math.round(b[k] * 1e6) / 1e6])) });
			cur = nextBucket(cur, period);
		}
	}
	return {
		period,
		by_source: bySource,
		revenue_usd: Math.round(revenueUsd * 1e6) / 1e6,
		trading_pnl_usd: pnlUsd,
		net_usd: Math.round((revenueUsd + pnlUsd) * 1e6) / 1e6,
		unvalued_count: unvaluedCount,
		excluded_count: excludedCount,
		series,
	};
}

const csvCell = (v) => {
	if (v == null) return '';
	let s = String(v);
	// Spreadsheet formula injection: a cell that starts with = + - @ is quoted as text.
	if (/^[=+\-@\t\r]/.test(s) && !/^-?\d+(\.\d+)?$/.test(s)) s = `'${s}`;
	return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

export const CSV_COLUMNS = Object.freeze([
	'occurred_at', 'source', 'kind', 'agent_id', 'asset', 'amount', 'usd', 'usd_basis', 'usd_price',
	'tx_signature', 'chain', 'network', 'counterparty', 'label', 'counted', 'exclusion_reason', 'chain_status', 'source_ref',
]);

export function toCsv(entries) {
	const lines = [CSV_COLUMNS.join(',')];
	for (const e of entries) {
		const row = { ...e, amount: formatAtomics(e.amount_atomics, e.decimals) };
		lines.push(CSV_COLUMNS.map((c) => csvCell(row[c])).join(','));
	}
	return `${lines.join('\n')}\n`;
}

/**
 * Forward projection from trailing real history only. The run rate is revenue
 * in the last `windowDays` divided by the days covered, carried flat. No growth
 * term is ever added. With under `minDays` of history or `minEntries` entries it
 * refuses rather than extrapolating from noise.
 */
export function project(entries, { now = Date.now(), windowDays = 30, horizonDays = 30, minDays = 7, minEntries = 3 } = {}) {
	const rev = entries.filter((e) => inTotals(e) && e.kind === 'revenue' && e.usd != null);
	const firstMs = rev.length ? Math.min(...rev.map((e) => new Date(e.occurred_at).getTime())) : null;
	const historyDays = firstMs == null ? 0 : (now - firstMs) / 86400000;
	const window_start = new Date(now - windowDays * 86400000).toISOString();
	const inWin = rev.filter((e) => new Date(e.occurred_at).getTime() >= now - windowDays * 86400000);
	const base = { window_days: windowDays, window_start, window_end: new Date(now).toISOString(), horizon_days: horizonDays, entries_in_window: inWin.length, history_days: Math.round(historyDays * 10) / 10 };
	if (historyDays < minDays || inWin.length < minEntries) {
		return { ...base, available: false, reason: `Needs at least ${minDays} days of history and ${minEntries} income entries in the trailing ${windowDays} days (has ${Math.floor(historyDays)} days, ${inWin.length} entries).` };
	}
	const covered = Math.min(windowDays, historyDays);
	const total = inWin.reduce((a, e) => a + Number(e.usd), 0);
	const perDay = total / covered;
	return {
		...base,
		available: true,
		trailing_revenue_usd: Math.round(total * 100) / 100,
		days_covered: Math.round(covered * 10) / 10,
		per_day_usd: Math.round(perDay * 100) / 100,
		projected_usd: Math.round(perDay * horizonDays * 100) / 100,
		method: `Trailing ${Math.round(covered)}-day revenue divided by days covered, held flat for ${horizonDays} days. No growth assumed.`,
	};
}

// ── reinvest rules ──────────────────────────────────────────────────────────

export const LEG_KINDS = Object.freeze(['model_credits', 'dca_own_coin', 'tools_budget']);
export const LEG_LABELS = Object.freeze({ model_credits: 'Model credits', dca_own_coin: "DCA into the agent's own coin", tools_budget: 'Tools budget' });
export const RULE_PERIODS = Object.freeze(['daily', 'weekly', 'monthly']);

export class RuleError extends Error {
	constructor(message) {
		super(message);
		this.code = 'invalid_rule';
		this.status = 400;
	}
}

/** Validate and normalise a rule body. Throws RuleError with a fixable message. */
export function normalizeRule(input) {
	const legsIn = Array.isArray(input?.legs) ? input.legs : [];
	if (!legsIn.length) throw new RuleError('Add at least one leg (model credits, own-coin DCA or tools budget).');
	const seen = new Set();
	let total = 0;
	const legs = legsIn.map((l) => {
		const kind = String(l?.kind || '');
		if (!LEG_KINDS.includes(kind)) throw new RuleError(`Unknown leg "${kind}". Use ${LEG_KINDS.join(', ')}.`);
		if (seen.has(kind)) throw new RuleError(`${LEG_LABELS[kind]} appears twice. Combine them into one leg.`);
		seen.add(kind);
		const pct = Number(l.pct);
		if (!Number.isFinite(pct) || pct <= 0 || pct > 100) throw new RuleError(`${LEG_LABELS[kind]} needs a percent between 0 and 100.`);
		total += pct;
		const out = { kind, pct: Math.round(pct * 100) / 100 };
		if (kind === 'tools_budget') {
			if (!/^[0-9a-f-]{36}$/i.test(String(l.session_id || ''))) throw new RuleError('The tools budget leg needs the payment session it tops up (session_id).');
			out.session_id = String(l.session_id);
		}
		return out;
	});
	if (total > 100 + 1e-9) throw new RuleError(`The legs add up to ${total}%, over 100%.`);
	const perRun = Number(input.per_run_cap_usd);
	const lifetime = Number(input.lifetime_cap_usd);
	if (!(perRun > 0)) throw new RuleError('Set a per-run cap in USD greater than 0.');
	if (!(lifetime > 0)) throw new RuleError('Set a lifetime cap in USD greater than 0.');
	if (lifetime < perRun) throw new RuleError('The lifetime cap cannot be below the per-run cap.');
	const period = RULE_PERIODS.includes(input.period) ? input.period : 'weekly';
	const basis = input.basis === 'revenue_and_trading_profit' ? 'revenue_and_trading_profit' : 'revenue';
	const minRun = input.min_run_usd == null ? 1 : Number(input.min_run_usd);
	if (!(minRun >= 0)) throw new RuleError('The minimum run size cannot be negative.');
	const network = input.network === 'devnet' ? 'devnet' : 'mainnet';
	return { name: String(input.name || 'Reinvest rule').trim().slice(0, 80) || 'Reinvest rule', network, period, basis, legs, per_run_cap_usd: perRun, lifetime_cap_usd: lifetime, min_run_usd: minRun };
}

/** Hash of everything the owner confirmed. Any edit changes it and clears the confirmation. */
export function ruleHash(rule) {
	const canon = {
		agent_id: rule.agent_id,
		network: rule.network,
		period: rule.period,
		basis: rule.basis,
		per_run_cap_usd: Number(rule.per_run_cap_usd),
		lifetime_cap_usd: Number(rule.lifetime_cap_usd),
		min_run_usd: Number(rule.min_run_usd),
		legs: [...rule.legs].sort((a, b) => a.kind.localeCompare(b.kind)).map((l) => ({ kind: l.kind, pct: Number(l.pct), session_id: l.session_id || null })),
	};
	return createHash('sha256').update(JSON.stringify(canon)).digest('hex');
}

/** The last complete [start, end) UTC period before `now`. */
export function lastPeriod(period, now = Date.now()) {
	const cur = bucketStart(now, period === 'daily' ? 'day' : period === 'weekly' ? 'week' : 'month');
	const unit = period === 'daily' ? 'day' : period === 'weekly' ? 'week' : 'month';
	let start;
	if (unit === 'day') start = new Date(cur.getTime() - 86400000);
	else if (unit === 'week') start = new Date(cur.getTime() - 7 * 86400000);
	else start = new Date(Date.UTC(cur.getUTCFullYear(), cur.getUTCMonth() - 1, 1));
	return { start, end: cur };
}

export const runKey = (ruleId, periodStart) => `revenue_reinvest:${ruleId}:${new Date(periodStart).toISOString()}`;
export const legKey = (ruleId, periodStart, kind) => `${runKey(ruleId, periodStart)}:${kind}`;

/**
 * Plan one run. Base is the period's income; each leg takes its percent. When
 * the legs together exceed the per-run cap or the lifetime headroom, every leg
 * is scaled down by the same factor, so the owner's split ratios survive the cap.
 * Below the minimum run size nothing executes.
 */
export function planRun({ baseUsd, legs, perRunCapUsd, lifetimeCapUsd, lifetimeSpentUsd = 0, minRunUsd = 0 }) {
	const base = Math.max(0, Number(baseUsd) || 0);
	const headroom = Math.max(0, Number(lifetimeCapUsd) - Number(lifetimeSpentUsd));
	const wanted = legs.map((l) => ({ ...l, planned_usd: Math.round(base * (l.pct / 100) * 1e6) / 1e6 }));
	const wantedTotal = wanted.reduce((a, l) => a + l.planned_usd, 0);
	const ceiling = Math.min(Number(perRunCapUsd), headroom);
	const factor = wantedTotal > ceiling && wantedTotal > 0 ? ceiling / wantedTotal : 1;
	const planned = wanted.map((l) => ({ ...l, capped_usd: Math.floor(l.planned_usd * factor * 1e6) / 1e6 }));
	const total = planned.reduce((a, l) => a + l.capped_usd, 0);
	let skip = null;
	if (base <= 0) skip = 'No income in this period.';
	else if (headroom <= 0) skip = 'The lifetime cap has been reached.';
	else if (total < Number(minRunUsd)) skip = `The split comes to $${total.toFixed(2)}, under the $${Number(minRunUsd).toFixed(2)} minimum run size.`;
	return {
		legs: planned.map((l) => ({ ...l, capped_usd: skip ? 0 : l.capped_usd })),
		planned_usd: Math.round(wantedTotal * 1e6) / 1e6,
		executable_usd: skip ? 0 : Math.round(total * 1e6) / 1e6,
		kept_usd: Math.round((base - (skip ? 0 : total)) * 1e6) / 1e6,
		scaled: factor < 1,
		skip,
	};
}

/** Milestones announced once per scope. */
export const MILESTONES_USD = Object.freeze([1, 10, 100, 1000, 10000, 100000]);
export function reachedMilestones(totalUsd) {
	return MILESTONES_USD.filter((m) => totalUsd >= m);
}
