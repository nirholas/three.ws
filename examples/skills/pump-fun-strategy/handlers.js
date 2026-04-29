// pump-fun-strategy — DSL runner + backtester. The `compileStrategy` evaluator
// in dsl.js is the single source of truth: live runs and backtests share it,
// so a backtest is a faithful preview of a live run.

import { compileStrategy, buildView, parsePredicate, evalPredicate } from './dsl.js';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function call(ctx, tool, args) {
	const res = await ctx.skills.invoke(tool, args);
	if (!res?.ok) throw new Error(`${tool}: ${res?.error ?? 'unknown'}`);
	return res.data;
}

export async function validateStrategy({ strategy }) {
	try {
		const compiled = compileStrategy(strategy);
		return {
			ok: true,
			data: {
				filterCount: compiled.filters.length,
				exitCount: compiled.exits.length,
				filters: compiled.filters.map((p) => p.src),
				exits: compiled.exits.map((e) => ({ if: e.when.src, do: e.action })),
			},
		};
	} catch (e) {
		return { ok: false, error: e.message };
	}
}

async function fetchCandidates(ctx, scan) {
	if (scan.kind === 'mintList') {
		return (scan.mints ?? []).map((mint) => ({ mint }));
	}
	if (scan.kind === 'trending') {
		const r = await call(ctx, 'pump-fun.getTrendingTokens', { limit: scan.limit ?? 20 });
		return r?.tokens ?? r ?? [];
	}
	const r = await call(ctx, 'pump-fun.getNewTokens', { limit: scan.limit ?? 20 });
	return r?.tokens ?? r ?? [];
}

async function snapshotMint(ctx, mint) {
	const [details, holders, curve] = await Promise.all([
		call(ctx, 'pump-fun.getTokenDetails', { mint }),
		call(ctx, 'pump-fun.getTokenHolders', { mint, limit: 20 }),
		call(ctx, 'pump-fun.getBondingCurve', { mint }).catch(() => null),
	]);
	const creatorAddr = details?.creator ?? details?.token?.creator;
	const creator = creatorAddr
		? await call(ctx, 'pump-fun.getCreatorProfile', { creator: creatorAddr }).catch(() => ({}))
		: {};
	return { details, holders, curve, creator };
}

async function maybeBuy(ctx, simulate, mint, amountSol) {
	if (simulate) return { sig: `SIMULATED:buy:${mint}:${amountSol}`, simulated: true };
	return call(ctx, 'pump-fun-trade.buyToken', { mint, amountSol });
}
async function maybeSell(ctx, simulate, args) {
	if (simulate) return { sig: `SIMULATED:sell:${args.mint}`, simulated: true };
	return call(ctx, 'pump-fun-trade.sellToken', args);
}

export async function runStrategy(args, ctx) {
	const compiled = compileStrategy(args.strategy);
	const simulate = !!args.simulate;
	const deadline = Date.now() + args.durationSec * 1000;
	const cap = compiled.caps.sessionSpendCapSol ?? ctx?.skillConfig?.defaultSessionSpendCapSol ?? 1.0;
	const perTrade = compiled.entry.amountSol ?? ctx?.skillConfig?.defaultPerTradeSol ?? 0.05;
	const pollMs = ctx?.skillConfig?.defaultPollMs ?? 5000;

	const seen = new Set();
	const positions = new Map();           // mint -> { amountTokens, entryPriceSol, openedAt }
	const log = [];
	let spent = 0;

	while (Date.now() < deadline) {
		// 1. Watch exits on open positions.
		for (const [mint, pos] of positions) {
			const snap = await snapshotMint(ctx, mint).catch(() => null);
			if (!snap) continue;
			const view = buildView({ ...snap, position: pos });
			const exit = compiled.shouldExit(view);
			if (exit) {
				try {
					const r = await maybeSell(ctx, simulate, {
						mint,
						percent: exit.percent,
						amountTokens: exit.amountTokens,
					});
					log.push({ mint, action: 'exit', rule: exit, sig: r.sig, view });
					positions.delete(mint);
				} catch (e) {
					log.push({ mint, action: 'exit-error', error: e.message });
				}
			}
		}

		// 2. Hunt for new entries while under cap.
		if (spent + perTrade <= cap && positions.size < (compiled.caps.maxOpenPositions ?? Infinity)) {
			const candidates = await fetchCandidates(ctx, compiled.scan);
			for (const t of candidates) {
				const mint = t.mint ?? t.address;
				if (!mint || seen.has(mint) || positions.has(mint)) continue;
				seen.add(mint);
				const snap = await snapshotMint(ctx, mint).catch(() => null);
				if (!snap) continue;
				const view = buildView(snap);
				if (!compiled.passes(view)) {
					log.push({ mint, action: 'skip', view });
					continue;
				}
				try {
					const buy = await maybeBuy(ctx, simulate, mint, perTrade);
					spent += perTrade;
					positions.set(mint, {
						amountTokens: buy.amountTokens ?? 0,
						entryPriceSol: snap.curve?.priceSol ?? 0,
						openedAt: Date.now(),
					});
					log.push({ mint, action: 'enter', sig: buy.sig, spent });
					if (spent + perTrade > cap) break;
				} catch (e) {
					log.push({ mint, action: 'enter-error', error: e.message });
				}
			}
		}

		await sleep(pollMs);
	}

	return {
		ok: true,
		data: {
			spent,
			openPositions: [...positions.entries()].map(([mint, p]) => ({ mint, ...p })),
			log,
			simulate,
		},
	};
}

// ── Backtester ──────────────────────────────────────────────────────────────
// Replays a strategy against historical trade arrays. No RPC, no signing.

function priceFromTrade(t) {
	// Best-effort across pump-fun shapes.
	if (t.priceSol != null) return t.priceSol;
	if (t.solAmount && t.tokenAmount) return t.solAmount / t.tokenAmount;
	return null;
}

export async function backtestStrategy(args, ctx) {
	const compiled = compileStrategy(args.strategy);
	const mints = args.mints ?? args.strategy?.scan?.mints ?? [];
	if (!mints.length) return { ok: false, error: 'backtest requires mints (in args or strategy.scan.mints)' };
	const sinceMs = args.sinceMs ?? 0;

	const perTrade = compiled.entry.amountSol ?? 0.05;
	const cap = compiled.caps.sessionSpendCapSol ?? Infinity;

	const trades = [];
	let spent = 0;
	let realized = 0;

	for (const mint of mints) {
		if (spent + perTrade > cap) break;

		const [details, holders, curve, history] = await Promise.all([
			call(ctx, 'pump-fun.getTokenDetails', { mint }).catch(() => ({})),
			call(ctx, 'pump-fun.getTokenHolders', { mint, limit: 20 }).catch(() => ({})),
			call(ctx, 'pump-fun.getBondingCurve', { mint }).catch(() => null),
			call(ctx, 'pump-fun.getTokenTrades', { mint, limit: 200 }).catch(() => ({ trades: [] })),
		]);
		const creatorAddr = details?.creator ?? details?.token?.creator;
		const creator = creatorAddr
			? await call(ctx, 'pump-fun.getCreatorProfile', { creator: creatorAddr }).catch(() => ({}))
			: {};

		// Entry view = state at the *first* trade after sinceMs.
		const tradeList = (history?.trades ?? history ?? [])
			.filter((t) => (t.timestamp ?? 0) >= sinceMs)
			.sort((a, b) => (a.timestamp ?? 0) - (b.timestamp ?? 0));
		if (!tradeList.length) continue;

		const entryView = buildView({ details, holders, creator, curve });
		if (!compiled.passes(entryView)) {
			trades.push({ mint, action: 'skip', view: entryView });
			continue;
		}

		const entryPrice = priceFromTrade(tradeList[0]);
		if (!entryPrice) {
			trades.push({ mint, action: 'skip', reason: 'no entry price' });
			continue;
		}

		const tokens = perTrade / entryPrice;
		spent += perTrade;

		// Walk forward, evaluating exit predicates at each tick.
		let exitedAt = null;
		let exitReason = 'eod';
		let exitPrice = priceFromTrade(tradeList[tradeList.length - 1]) ?? entryPrice;

		const openedAt = tradeList[0].timestamp ?? Date.now();
		for (const t of tradeList) {
			const px = priceFromTrade(t);
			if (!px) continue;
			const view = buildView({
				details, holders, creator,
				curve: { ...curve, priceSol: px },
				position: { entryPriceSol: entryPrice, amountTokens: tokens, openedAt },
			});
			const exit = compiled.shouldExit(view);
			if (exit) {
				exitPrice = px;
				exitedAt = t.timestamp ?? Date.now();
				exitReason = exit;
				break;
			}
		}

		const proceeds = tokens * exitPrice;
		const pnl = proceeds - perTrade;
		realized += pnl;

		trades.push({
			mint,
			action: 'trade',
			entryPrice,
			exitPrice,
			pnlSol: pnl,
			pnlPct: ((exitPrice - entryPrice) / entryPrice) * 100,
			heldSec: exitedAt ? (exitedAt - openedAt) / 1000 : null,
			exitReason,
		});
	}

	const completed = trades.filter((t) => t.action === 'trade');
	const wins = completed.filter((t) => t.pnlSol > 0).length;
	let peak = 0, trough = 0, runningPnl = 0, maxDrawdown = 0;
	for (const t of completed) {
		runningPnl += t.pnlSol;
		if (runningPnl > peak) peak = runningPnl;
		const dd = peak - runningPnl;
		if (dd > maxDrawdown) { maxDrawdown = dd; trough = runningPnl; }
	}

	return {
		ok: true,
		data: {
			spent,
			realizedPnlSol: realized,
			roiPct: spent > 0 ? (realized / spent) * 100 : 0,
			tradeCount: completed.length,
			winRate: completed.length ? wins / completed.length : 0,
			maxDrawdownSol: maxDrawdown,
			trades,
		},
	};
}

// Re-exported for tests.
export { parsePredicate, evalPredicate, buildView, compileStrategy };
