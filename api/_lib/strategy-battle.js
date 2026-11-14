// Backtest Battle: a public 24h paper forward test of Strategy Lab strategies.
//
// Every UTC day is one round. Users submit one declarative strategy (the
// examples/skills/pump-fun-strategy DSL) into the next round; at 00:00 UTC the
// round locks and every entry starts from the same 1 SOL paper bankroll. Each
// cron tick (api/cron/strategy-battle-tick.js) evaluates every entry's exit
// rules and entry filters against LIVE pump.fun data and fills paper trades on
// the real bonding curve: constant-product math on the curve's virtual
// reserves, so price impact is real, minus the curve fee. At 24:00 UTC every
// open position is marked to a simulated sell and the round is ranked by final
// equity.
//
// The DSL evaluator (compileStrategy / buildView) is the same one the Strategy
// Lab runner and backtester use, so a battle entry means exactly what it means
// in the lab. Battle-specific semantics, documented in docs/strategy-battle.md:
//   - Exits close the whole position (same as the lab runner and backtester).
//   - caps.sessionSpendCapSol caps capital deployed at once; a closed position
//     returns its proceeds to cash, so a strategy can trade all day.
//   - The current candidate list is re-evaluated every tick; a mint is entered
//     at most once per entry.
//
// Nothing here can move a token. There is no wallet, no signer, and no trade
// tool call: the only skill tools invoked are read-only pump-fun.* lookups.

import { createHash } from 'node:crypto';
import {
	compileStrategy,
	buildView,
	curvePriceSol,
	evalPredicate,
	strategyErrors,
} from '../../examples/skills/pump-fun-strategy/dsl.js';

export const BATTLE = Object.freeze({
	bankrollSol: 1,
	minTradeSol: 0.01,
	maxTradeSol: 0.25,
	defaultTradeSol: 0.05,
	maxOpenPositions: 10,
	defaultOpenPositions: 5,
	maxScanLimit: 30,
	defaultScanLimit: 20,
	maxMints: 20,
	maxEntriesPerRound: 100,
	// pump.fun's bonding-curve fee at low market caps: 0.95% protocol + 0.30%
	// creator, charged on each side of a trade.
	feeBps: 125,
});

const DAY_MS = 86_400_000;
const LAMPORTS_PER_SOL = 1e9;
const DEFAULT_DECIMALS = 6;

// ── Rounds ──────────────────────────────────────────────────────────────────

/** UTC day id ('YYYY-MM-DD') containing the instant `ms`. */
export function roundIdFor(ms) {
	return new Date(ms).toISOString().slice(0, 10);
}

/** The round that accepts new entries at instant `ms`: the next UTC day. */
export function nextRoundId(ms) {
	return roundIdFor(ms + DAY_MS);
}

export function isRoundId(id) {
	return typeof id === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(id) && roundIdFor(Date.parse(`${id}T00:00:00Z`)) === id;
}

export function roundWindow(id) {
	const start = Date.parse(`${id}T00:00:00Z`);
	return { startsAt: new Date(start), endsAt: new Date(start + DAY_MS) };
}

// ── Strategy normalization ─────────────────────────────────────────────────

const clamp = (n, lo, hi) => Math.min(hi, Math.max(lo, n));
const finite = (v) => (typeof v === 'number' ? v : Number(v));

/**
 * Validate a Strategy Lab spec and fit it to the battle's equal-footing rules.
 * Returns { ok: false, errors } for a spec the lab itself would refuse, else
 * { ok: true, strategy, adjustments } where `adjustments` lists every change
 * made so the UI can show the submitter exactly what will trade.
 */
export function normalizeBattleStrategy(spec) {
	const errors = strategyErrors(spec);
	if (errors.length) return { ok: false, errors };

	const adjustments = [];
	const scan = spec.scan;
	const outScan = { kind: scan.kind };
	if (scan.kind === 'mintList') {
		const mints = [...new Set(scan.mints ?? [])];
		if (mints.length > BATTLE.maxMints) adjustments.push(`scan.mints trimmed to the first ${BATTLE.maxMints}`);
		outScan.mints = mints.slice(0, BATTLE.maxMints);
	} else {
		const want = Number.isFinite(finite(scan.limit)) ? Math.round(finite(scan.limit)) : BATTLE.defaultScanLimit;
		outScan.limit = clamp(want, 1, BATTLE.maxScanLimit);
		if (scan.limit != null && outScan.limit !== want) adjustments.push(`scan.limit set to ${outScan.limit} (battle range 1 to ${BATTLE.maxScanLimit})`);
	}

	const rawSize = finite(spec.entry?.amountSol ?? spec.caps?.perTradeSol);
	const size = Number.isFinite(rawSize) && rawSize > 0 ? rawSize : BATTLE.defaultTradeSol;
	const amountSol = clamp(size, BATTLE.minTradeSol, BATTLE.maxTradeSol);
	if (amountSol !== size) adjustments.push(`entry.amountSol set to ${amountSol} SOL (battle range ${BATTLE.minTradeSol} to ${BATTLE.maxTradeSol})`);

	const rawOpen = finite(spec.caps?.maxOpenPositions);
	const wantOpen = Number.isFinite(rawOpen) && rawOpen >= 1 ? Math.floor(rawOpen) : BATTLE.defaultOpenPositions;
	const maxOpenPositions = Math.min(wantOpen, BATTLE.maxOpenPositions);
	if (maxOpenPositions !== wantOpen) adjustments.push(`caps.maxOpenPositions set to ${maxOpenPositions}`);

	const rawCap = finite(spec.caps?.sessionSpendCapSol);
	const wantCap = Number.isFinite(rawCap) && rawCap > 0 ? rawCap : BATTLE.bankrollSol;
	const sessionSpendCapSol = Math.min(wantCap, BATTLE.bankrollSol);
	if (sessionSpendCapSol !== wantCap) adjustments.push(`caps.sessionSpendCapSol set to ${sessionSpendCapSol} SOL (the ${BATTLE.bankrollSol} SOL battle bankroll)`);
	if (sessionSpendCapSol < amountSol) {
		return { ok: false, errors: [{ field: 'caps.sessionSpendCapSol', code: 'cap_below_trade', message: `caps.sessionSpendCapSol (${sessionSpendCapSol}) is below one trade (${amountSol} SOL), so this strategy could never enter.` }] };
	}

	const partial = (spec.exit ?? []).some((r) => r?.do?.percent != null && Number(r.do.percent) < 100);
	if (partial) adjustments.push('partial sells close the whole position (same as Strategy Lab runs and backtests)');

	const strategy = {
		scan: outScan,
		filters: [...(spec.filters ?? [])],
		entry: { side: 'buy', amountSol },
		exit: (spec.exit ?? []).map((r) => ({ if: r.if, do: { side: 'sell', percent: 100 } })),
		caps: { sessionSpendCapSol, maxOpenPositions },
	};
	return { ok: true, strategy, adjustments };
}

function stableStringify(v) {
	if (Array.isArray(v)) return `[${v.map(stableStringify).join(',')}]`;
	if (v && typeof v === 'object') {
		return `{${Object.keys(v).sort().map((k) => `${JSON.stringify(k)}:${stableStringify(v[k])}`).join(',')}}`;
	}
	return JSON.stringify(v);
}

/** Content hash of a normalized strategy: identical rules hash identically. */
export function strategyHash(strategy) {
	return createHash('sha256').update(stableStringify(strategy)).digest('hex').slice(0, 16);
}

// ── Paper fills on the bonding curve ───────────────────────────────────────

const n = (v) => {
	const x = typeof v === 'number' ? v : Number(v);
	return Number.isFinite(x) ? x : undefined;
};

function curveReserves(curve) {
	const vSol = n(curve?.virtualSolReserves);
	const vTok = n(curve?.virtualTokenReserves);
	if (!(vSol > 0) || !(vTok > 0)) return null;
	return { vSol, vTok, realSol: n(curve?.solReserves), realTok: n(curve?.tokenReserves) };
}

/**
 * Paper buy of `amountSol` (gross, fee included) on a live bonding curve.
 * Returns { tokens, costSol, feeSol, priceSol } or null when the curve cannot
 * be traded (missing reserves, or the curve completed and migrated).
 */
export function simulateBuy(curve, amountSol, { feeBps = BATTLE.feeBps, decimals = DEFAULT_DECIMALS } = {}) {
	if (curve?.complete) return null;
	const r = curveReserves(curve);
	if (!r || !(amountSol > 0)) return null;
	const feeSol = (amountSol * feeBps) / 10_000;
	const inLamports = (amountSol - feeSol) * LAMPORTS_PER_SOL;
	let outRaw = r.vTok - (r.vSol * r.vTok) / (r.vSol + inLamports);
	if (r.realTok != null) outRaw = Math.min(outRaw, r.realTok);
	if (!(outRaw > 0)) return null;
	return {
		tokens: outRaw / 10 ** decimals,
		costSol: amountSol,
		feeSol,
		priceSol: curvePriceSol(curve, decimals),
	};
}

/**
 * Paper sell of `tokens` (whole units). On a live curve this is the
 * constant-product quote minus the fee. A completed curve has migrated to the
 * AMM, where the migration pool is deep relative to a paper position, so the
 * position is valued at its last spot price minus the fee.
 */
export function simulateSell(curve, tokens, { feeBps = BATTLE.feeBps, decimals = DEFAULT_DECIMALS, lastPriceSol } = {}) {
	if (!(tokens > 0)) return { proceedsSol: 0, feeSol: 0, priceSol: lastPriceSol ?? 0 };
	const r = curve?.complete ? null : curveReserves(curve);
	if (!r) {
		const price = lastPriceSol ?? 0;
		const gross = tokens * price;
		const feeSol = (gross * feeBps) / 10_000;
		return { proceedsSol: gross - feeSol, feeSol, priceSol: price };
	}
	const inRaw = tokens * 10 ** decimals;
	let outLamports = r.vSol - (r.vSol * r.vTok) / (r.vTok + inRaw);
	if (r.realSol != null) outLamports = Math.min(outLamports, r.realSol);
	const gross = Math.max(0, outLamports) / LAMPORTS_PER_SOL;
	const feeSol = (gross * feeBps) / 10_000;
	return { proceedsSol: gross - feeSol, feeSol, priceSol: curvePriceSol(curve, decimals) };
}

// ── Evaluation ──────────────────────────────────────────────────────────────

function getPath(view, path) {
	return path.split('.').reduce((o, k) => (o == null ? undefined : o[k]), view);
}

/**
 * Evaluate a compiled strategy's filters, reporting which metrics had no live
 * value. A filter on a missing metric fails closed (same as the lab), and the
 * caller counts it as "data unavailable" rather than "filtered out".
 */
export function evaluateFilters(compiled, view) {
	const missing = [];
	for (const p of compiled.filters) {
		const v = getPath(view, p.lhs);
		if (v == null || Number.isNaN(v)) missing.push(p.lhs);
	}
	if (missing.length) return { pass: false, missing };
	return { pass: compiled.passes(view), missing };
}

/** Which optional data sources a strategy's rules read. */
export function sourcesFor(strategy) {
	const preds = [...(strategy.filters ?? []), ...(strategy.exit ?? []).map((r) => r.if)];
	const uses = (prefix) => preds.some((p) => String(p).trim().startsWith(prefix));
	return { holders: uses('holders.'), creator: uses('creator.') };
}

/** Drawdown bookkeeping after an equity mark. */
export function markEquity({ peak, maxDrawdownPct }, equity) {
	const newPeak = Math.max(peak, equity);
	const dd = newPeak > 0 ? ((newPeak - equity) / newPeak) * 100 : 0;
	return { peak: newPeak, maxDrawdownPct: Math.max(maxDrawdownPct, dd) };
}

/**
 * Order entries for the leaderboard: entries that traded first, then by equity,
 * then the shallower drawdown, then the earlier submission. An entry that never
 * traded ranks below every entry that did, so sitting in cash cannot win.
 */
export function rankEntries(entries) {
	const sorted = [...entries].sort((a, b) => {
		const ta = Number(a.trade_count) > 0 ? 1 : 0;
		const tb = Number(b.trade_count) > 0 ? 1 : 0;
		if (ta !== tb) return tb - ta;
		const eq = Number(b.equity_sol) - Number(a.equity_sol);
		if (Math.abs(eq) > 1e-12) return eq;
		const dd = Number(a.max_drawdown_pct) - Number(b.max_drawdown_pct);
		if (Math.abs(dd) > 1e-9) return dd;
		return new Date(a.created_at).getTime() - new Date(b.created_at).getTime();
	});
	return sorted.map((e, i) => ({ ...e, rank: i + 1 }));
}

export function roiPct(equity, bankroll = BATTLE.bankrollSol) {
	return bankroll > 0 ? ((Number(equity) - bankroll) / bankroll) * 100 : 0;
}

// ── Live data with a per-tick cache ─────────────────────────────────────────

async function mapLimit(items, limit, fn) {
	const out = new Array(items.length);
	let i = 0;
	const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
		while (i < items.length) {
			const idx = i++;
			out[idx] = await fn(items[idx], idx);
		}
	});
	await Promise.all(workers);
	return out;
}

/**
 * Read-only pump.fun lookups, memoized for one tick so a hundred entries
 * watching the same mint cost one RPC call. Failures resolve to null.
 */
export function makeTickData(invoke) {
	const cache = new Map();
	const once = (key, fn) => {
		if (!cache.has(key)) cache.set(key, fn().catch(() => null));
		return cache.get(key);
	};
	const call = async (tool, args) => {
		const r = await invoke(tool, args);
		if (!r?.ok) throw new Error(`${tool}: ${r?.error ?? 'unavailable'}`);
		return r.data;
	};
	return {
		candidates: (scan) => once(`scan:${scan.kind}:${scan.limit ?? ''}:${(scan.mints ?? []).join(',')}`, async () => {
			if (scan.kind === 'mintList') return (scan.mints ?? []).map((mint) => ({ mint }));
			const tool = scan.kind === 'trending' ? 'pump-fun.getTrendingTokens' : 'pump-fun.getNewTokens';
			const d = await call(tool, { limit: scan.limit ?? BATTLE.defaultScanLimit });
			return d?.tokens ?? d ?? [];
		}),
		curve: (mint) => once(`curve:${mint}`, () => call('pump-fun.getBondingCurve', { mint })),
		details: (mint) => once(`details:${mint}`, () => call('pump-fun.getTokenDetails', { mint })),
		holders: (mint) => once(`holders:${mint}`, () => call('pump-fun.getTokenHolders', { mint, limit: 20 })),
		creator: (addr) => once(`creator:${addr}`, () => call('pump-fun.getCreatorProfile', { creator: addr })),
	};
}

// ── The tick ────────────────────────────────────────────────────────────────

const MISSING_TABLE = '42P01';

/** Make sure today's round and tomorrow's open round exist. */
async function ensureRounds(sql, nowMs) {
	for (const id of [roundIdFor(nowMs), nextRoundId(nowMs)]) {
		const { startsAt, endsAt } = roundWindow(id);
		await sql`
			insert into strategy_battle_rounds (id, starts_at, ends_at, status)
			values (${id}, ${startsAt.toISOString()}, ${endsAt.toISOString()}, 'open')
			on conflict (id) do nothing
		`;
	}
}

async function claimRound(sql, roundId, leaseSec) {
	const rows = await sql`
		update strategy_battle_rounds
		set tick_lease_until = now() + make_interval(secs => ${leaseSec})
		where id = ${roundId}
		  and (tick_lease_until is null or tick_lease_until < now())
		returning id
	`;
	return rows.length > 0;
}

async function releaseRound(sql, roundId, stats) {
	await sql`
		update strategy_battle_rounds
		set tick_lease_until = null, last_tick_at = now(), last_tick_stats = ${JSON.stringify(stats)}::jsonb
		where id = ${roundId}
	`;
}

function positionView(pos, curve, holders = null, creator = null) {
	return buildView({
		details: {
			decimals: pos.token_decimals ?? DEFAULT_DECIMALS,
			supply: pos.token_supply ?? undefined,
			created_at: pos.launched_at ? new Date(pos.launched_at).getTime() : undefined,
		},
		curve,
		holders,
		creator,
		position: {
			entryPriceSol: Number(pos.entry_price_sol),
			lastPriceSol: pos.last_price_sol != null ? Number(pos.last_price_sol) : undefined,
			amountTokens: Number(pos.amount_tokens),
			openedAt: new Date(pos.opened_at).getTime(),
		},
	});
}

/** The first exit rule whose predicate holds, as its source text, else null. */
export function firedExitRule(compiled, view) {
	const hit = compiled.exits.find((e) => evalPredicate(e.when, view));
	return hit ? hit.when.src : null;
}

const symbolOf = (...c) => {
	const s = c.find((x) => typeof x === 'string' && x.trim());
	return s ? s.trim().slice(0, 32) : null;
};

async function closePosition(sql, pos, sale, reason) {
	const proceeds = sale.proceedsSol;
	const pnl = proceeds - Number(pos.cost_sol);
	const rows = await sql`
		update strategy_battle_positions
		set status = 'closed', exit_price_sol = ${sale.priceSol ?? null}, proceeds_sol = ${proceeds},
		    pnl_sol = ${pnl}, exit_reason = ${reason}, closed_at = now(),
		    last_price_sol = coalesce(${sale.priceSol ?? null}, last_price_sol), last_value_sol = ${proceeds}
		where id = ${pos.id} and status = 'open'
		returning id
	`;
	return rows.length ? { proceeds, pnl, fee: sale.feeSol } : null;
}

/**
 * Advance one running entry by one tick: exits first, then entries.
 * Mutates and returns the entry's running totals.
 */
async function tickEntry(sql, data, entry, openPositions, { deadline }) {
	const compiled = compileStrategy(entry.strategy);
	const src = sourcesFor(entry.strategy);
	const t = {
		cash: Number(entry.cash_sol),
		realized: Number(entry.realized_pnl_sol),
		fees: Number(entry.fees_sol),
		trades: entry.trade_count,
		closed: entry.closed_count,
		wins: entry.win_count,
		evaluated: entry.evaluated_count,
		skippedData: entry.skipped_data,
		entered: 0,
		exited: 0,
	};
	const open = [];

	// 1. Exits on open positions. A position whose curve could not be read this
	// tick keeps its last mark: no exit and no re-valuation on missing data.
	for (const pos of openPositions) {
		const curve = await data.curve(pos.mint);
		if (!curve) {
			open.push(pos);
			continue;
		}
		const holders = src.holders ? await data.holders(pos.mint) : null;
		let creator = null;
		if (src.creator) {
			const details = await data.details(pos.mint);
			const addr = details?.creator ?? details?.token?.creator;
			if (addr) creator = await data.creator(addr);
		}
		const view = positionView(pos, curve, holders, creator);
		const decimals = pos.token_decimals ?? DEFAULT_DECIMALS;
		const lastPrice = view.curve.priceSol ?? Number(pos.last_price_sol ?? pos.entry_price_sol);
		const sale = simulateSell(curve, Number(pos.amount_tokens), { decimals, lastPriceSol: lastPrice });
		const rule = firedExitRule(compiled, view);
		if (rule) {
			const closed = await closePosition(sql, pos, sale, rule);
			if (closed) {
				t.cash += closed.proceeds;
				t.realized += closed.pnl;
				t.fees += closed.fee;
				t.closed += 1;
				if (closed.pnl > 0) t.wins += 1;
				t.exited += 1;
				continue;
			}
		}
		await sql`
			update strategy_battle_positions
			set last_price_sol = ${lastPrice}, last_value_sol = ${sale.proceedsSol}
			where id = ${pos.id} and status = 'open'
		`;
		open.push({ ...pos, last_value_sol: sale.proceedsSol });
	}

	// 2. Entries while there is room.
	const size = Number(entry.strategy.entry.amountSol);
	const maxOpen = Number(entry.strategy.caps.maxOpenPositions);
	const cap = Number(entry.strategy.caps.sessionSpendCapSol);
	const held = new Set((await sql`select mint from strategy_battle_positions where entry_id = ${entry.id}`).map((r) => r.mint));
	let deployed = open.reduce((s, p) => s + Number(p.cost_sol), 0);
	const hasRoom = () => open.length < maxOpen && t.cash + 1e-12 >= size && deployed + size <= cap + 1e-12;

	if (hasRoom() && Date.now() < deadline) {
		const candidates = (await data.candidates(entry.strategy.scan)) ?? [];
		for (const c of candidates) {
			if (!hasRoom() || Date.now() >= deadline) break;
			const mint = c.mint ?? c.address;
			if (!mint || held.has(mint)) continue;
			const [details, curve] = await Promise.all([data.details(mint), data.curve(mint)]);
			if (!details) continue;
			const holders = src.holders ? await data.holders(mint) : null;
			const addr = details?.creator ?? c.creator;
			const creator = src.creator && addr ? await data.creator(addr) : null;
			const createdAt = details.created_at ?? details.createdAt ?? c.created_at ?? c.createdAt ?? null;
			const view = buildView({ details: { ...details, created_at: createdAt }, curve, holders, creator });
			t.evaluated += 1;
			const verdict = evaluateFilters(compiled, view);
			if (!verdict.pass) {
				if (verdict.missing.length) t.skippedData += 1;
				continue;
			}
			const decimals = Number(details.decimals ?? DEFAULT_DECIMALS);
			const fill = simulateBuy(curve, size, { decimals });
			if (!fill) continue;
			const launched = createdAt != null ? new Date(typeof createdAt === 'number' && createdAt < 1e12 ? createdAt * 1000 : createdAt) : null;
			const inserted = await sql`
				insert into strategy_battle_positions
					(entry_id, mint, symbol, cost_sol, amount_tokens, entry_price_sol, token_supply,
					 token_decimals, launched_at, last_price_sol, last_value_sol)
				values (${entry.id}, ${mint}, ${symbolOf(c.symbol, details.symbol)},
					${fill.costSol}, ${fill.tokens}, ${fill.priceSol}, ${details.supply ?? null},
					${decimals}, ${launched && Number.isFinite(launched.getTime()) ? launched.toISOString() : null},
					${fill.priceSol}, ${simulateSell(curve, fill.tokens, { decimals }).proceedsSol})
				on conflict (entry_id, mint) do nothing
				returning id, cost_sol, last_value_sol
			`;
			held.add(mint);
			if (!inserted.length) continue;
			t.cash -= fill.costSol;
			t.fees += fill.feeSol;
			t.trades += 1;
			t.entered += 1;
			deployed += fill.costSol;
			open.push(inserted[0]);
		}
	}

	t.equity = t.cash + open.reduce((s, p) => s + Number(p.last_value_sol ?? 0), 0);
	return t;
}

async function saveEntry(sql, entry, t) {
	const dd = markEquity({ peak: Number(entry.peak_equity_sol), maxDrawdownPct: Number(entry.max_drawdown_pct) }, t.equity);
	await sql`
		update strategy_battle_entries
		set cash_sol = ${t.cash}, equity_sol = ${t.equity}, peak_equity_sol = ${dd.peak},
		    max_drawdown_pct = ${dd.maxDrawdownPct}, realized_pnl_sol = ${t.realized}, fees_sol = ${t.fees},
		    trade_count = ${t.trades}, closed_count = ${t.closed}, win_count = ${t.wins},
		    evaluated_count = ${t.evaluated}, skipped_data = ${t.skippedData},
		    last_tick_at = now(), updated_at = now()
		where id = ${entry.id}
	`;
}

/** Close every open position at a simulated sell, rank, and settle the round. */
async function settleRound(sql, data, round) {
	const entries = await sql`
		select * from strategy_battle_entries where round_id = ${round.id} and status = 'running'
	`;
	for (const entry of entries) {
		const open = await sql`select * from strategy_battle_positions where entry_id = ${entry.id} and status = 'open'`;
		let cash = Number(entry.cash_sol);
		let realized = Number(entry.realized_pnl_sol);
		let fees = Number(entry.fees_sol);
		let closedCount = entry.closed_count;
		let wins = entry.win_count;
		for (const pos of open) {
			const curve = await data.curve(pos.mint);
			const decimals = pos.token_decimals ?? DEFAULT_DECIMALS;
			const last = curvePriceSol(curve, decimals) ?? (pos.last_price_sol != null ? Number(pos.last_price_sol) : Number(pos.entry_price_sol));
			const sale = simulateSell(curve, Number(pos.amount_tokens), { decimals, lastPriceSol: last });
			const closed = await closePosition(sql, pos, sale, 'round_end');
			if (!closed) continue;
			cash += closed.proceeds;
			realized += closed.pnl;
			fees += closed.fee;
			closedCount += 1;
			if (closed.pnl > 0) wins += 1;
		}
		const dd = markEquity({ peak: Number(entry.peak_equity_sol), maxDrawdownPct: Number(entry.max_drawdown_pct) }, cash);
		await sql`
			update strategy_battle_entries
			set cash_sol = ${cash}, equity_sol = ${cash}, realized_pnl_sol = ${realized}, fees_sol = ${fees},
			    closed_count = ${closedCount}, win_count = ${wins}, peak_equity_sol = ${dd.peak},
			    max_drawdown_pct = ${dd.maxDrawdownPct}, last_tick_at = now(), updated_at = now()
			where id = ${entry.id}
		`;
	}
	const finals = await sql`
		select id, trade_count, equity_sol, max_drawdown_pct, created_at
		from strategy_battle_entries where round_id = ${round.id} and status = 'running'
	`;
	for (const e of rankEntries(finals)) {
		await sql`update strategy_battle_entries set status = 'settled', final_rank = ${e.rank}, updated_at = now() where id = ${e.id}`;
	}
	await sql`update strategy_battle_rounds set status = 'settled', settled_at = now() where id = ${round.id}`;
	return { round: round.id, entries: finals.length };
}

/**
 * One cron tick. Settles rounds that ended, starts the round that began, and
 * paper-trades every running entry once. Overlapping ticks are excluded by a
 * per-round lease. Returns counters for the cron response and the page.
 */
export async function runBattleTick({ sql, invoke, now = Date.now(), budgetMs = 100_000 } = {}) {
	const deadline = now + budgetMs;
	try {
		await ensureRounds(sql, now);
	} catch (e) {
		if (e?.code === MISSING_TABLE) return { ok: true, skipped: 'missing_tables' };
		throw e;
	}
	const data = makeTickData(invoke);
	const out = { settled: [], started: null, round: null, entries: 0, entered: 0, exited: 0, errors: 0 };

	const due = await sql`
		select * from strategy_battle_rounds
		where status <> 'settled' and ends_at <= ${new Date(now).toISOString()}
		order by starts_at
	`;
	for (const round of due) {
		if (!(await claimRound(sql, round.id, 300))) continue;
		try {
			out.settled.push(await settleRound(sql, data, round));
		} finally {
			await sql`update strategy_battle_rounds set tick_lease_until = null where id = ${round.id}`;
		}
	}

	const id = roundIdFor(now);
	const [round] = await sql`select * from strategy_battle_rounds where id = ${id}`;
	if (!round || round.status === 'settled') return { ok: true, ...out };
	if (!(await claimRound(sql, id, Math.ceil(budgetMs / 1000) + 20))) return { ok: true, ...out, skipped: 'tick_in_progress' };

	try {
		if (round.status === 'open') {
			const started = await sql`
				update strategy_battle_entries
				set status = 'running', cash_sol = bankroll_sol, equity_sol = bankroll_sol,
				    peak_equity_sol = bankroll_sol, updated_at = now()
				where round_id = ${id} and status = 'queued'
				returning id
			`;
			await sql`update strategy_battle_rounds set status = 'running' where id = ${id}`;
			out.started = { round: id, entries: started.length };
		}
		out.round = id;
		const entries = await sql`
			select * from strategy_battle_entries
			where round_id = ${id} and status = 'running'
			order by last_tick_at asc nulls first, created_at asc
			limit ${BATTLE.maxEntriesPerRound}
		`;
		const openRows = await sql`
			select p.* from strategy_battle_positions p
			join strategy_battle_entries e on e.id = p.entry_id
			where e.round_id = ${id} and e.status = 'running' and p.status = 'open'
		`;
		const openByEntry = new Map();
		for (const p of openRows) {
			if (!openByEntry.has(p.entry_id)) openByEntry.set(p.entry_id, []);
			openByEntry.get(p.entry_id).push(p);
		}
		// Warm the shared lookups once, in parallel, before entries walk them.
		const scans = new Map(entries.map((e) => [JSON.stringify(e.strategy.scan), e.strategy.scan]));
		await mapLimit([...scans.values()], 3, (s) => data.candidates(s));
		await mapLimit([...new Set(openRows.map((p) => p.mint))], 6, (m) => data.curve(m));

		await mapLimit(entries, 4, async (entry) => {
			if (Date.now() >= deadline) return;
			try {
				const t = await tickEntry(sql, data, entry, openByEntry.get(entry.id) ?? [], { deadline });
				await saveEntry(sql, entry, t);
				out.entries += 1;
				out.entered += t.entered;
				out.exited += t.exited;
			} catch (e) {
				out.errors += 1;
				console.error('[strategy-battle] entry tick failed', entry.id, e?.message);
			}
		});
	} finally {
		await releaseRound(sql, id, { at: new Date().toISOString(), entries: out.entries, entered: out.entered, exited: out.exited, errors: out.errors });
	}
	return { ok: true, ...out };
}
