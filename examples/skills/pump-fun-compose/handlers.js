// pump-fun-compose — agent-level loops over the read + trade skills.
// All sibling-skill calls go through ctx.skills.invoke('skill.tool', args).

const _sessions = new Map();

function cfg(ctx, key, fallback) {
	return ctx?.skillConfig?.[key] ?? fallback;
}

async function call(ctx, tool, args) {
	const res = await ctx.skills.invoke(tool, args);
	if (!res?.ok) throw new Error(`${tool} failed: ${res?.error ?? 'unknown'}`);
	return res.data;
}

async function loadState(ctx, sessionId, init) {
	if (!sessionId) return { ...init };
	if (_sessions.has(sessionId)) return _sessions.get(sessionId);
	try {
		const recalled = await ctx?.memory?.recall?.({ key: `compose:${sessionId}` });
		const prior = recalled?.value ?? recalled?.[0]?.value ?? recalled;
		if (prior && typeof prior === 'object') {
			const restored = { ...init, ...prior, seen: new Set(prior.seen || []), mirrored: new Set(prior.mirrored || []), exited: new Set(prior.exited || []) };
			_sessions.set(sessionId, restored);
			return restored;
		}
	} catch {}
	const fresh = { ...init };
	_sessions.set(sessionId, fresh);
	return fresh;
}

async function saveState(ctx, sessionId, state) {
	if (!sessionId) return;
	_sessions.set(sessionId, state);
	const serializable = {
		...state,
		seen: state.seen ? [...state.seen] : undefined,
		mirrored: state.mirrored ? [...state.mirrored] : undefined,
		exited: state.exited ? [...state.exited] : undefined,
	};
	try {
		await ctx?.memory?.note?.({ key: `compose:${sessionId}`, value: serializable });
	} catch {}
}

async function maybeTrade(ctx, simulate, tool, args) {
	if (simulate) {
		await ctx?.memory?.note?.({ tag: 'simulate', tool, args });
		return { sig: `SIMULATED:${tool}:${args.mint}:${args.amountSol ?? args.percent ?? ''}`, simulated: true };
	}
	return call(ctx, tool, args);
}

function passesFilters(ctx, { creator, holders }) {
	const rugCount = creator?.rugCount ?? creator?.rugFlags?.length ?? 0;
	if (rugCount >= cfg(ctx, 'rejectIfCreatorRugCount', 1)) {
		return { ok: false, reason: `creator has ${rugCount} prior rug(s)` };
	}
	const holderCount = holders?.total ?? holders?.holders?.length ?? 0;
	if (holderCount < cfg(ctx, 'minHoldersForBuy', 30)) {
		return { ok: false, reason: `only ${holderCount} holders` };
	}
	const top = holders?.topHolderPct ?? holders?.holders?.[0]?.pct ?? 0;
	if (top > cfg(ctx, 'maxTopHolderPct', 25)) {
		return { ok: false, reason: `top holder owns ${top}%` };
	}
	return { ok: true };
}

async function vetMint(ctx, mint) {
	const [details, holders] = await Promise.all([
		call(ctx, 'pump-fun.getTokenDetails', { mint }),
		call(ctx, 'pump-fun.getTokenHolders', { mint, limit: 20 }),
	]);
	const creatorAddr = details?.creator ?? details?.token?.creator;
	const creator = creatorAddr
		? await call(ctx, 'pump-fun.getCreatorProfile', { creator: creatorAddr })
		: { rugCount: 0 };
	return { details, holders, creator, verdict: passesFilters(ctx, { creator, holders }) };
}

export async function researchAndBuy(args, ctx) {
	const simulate = !!args.simulate;
	const search = await call(ctx, 'pump-fun.searchTokens', { query: args.query, limit: 1 });
	const mint = search?.results?.[0]?.mint ?? search?.[0]?.mint ?? args.query;
	const vet = await vetMint(ctx, mint);
	if (!vet.verdict.ok) return { ok: true, data: { mint, decision: 'skip', reason: vet.verdict.reason, simulate } };

	const amountSol = args.amountSol ?? cfg(ctx, 'perTradeSol', 0.05);
	const quote = await call(ctx, 'pump-fun-trade.quoteTrade', { mint, side: 'buy', amountSol });
	const buy = await maybeTrade(ctx, simulate, 'pump-fun-trade.buyToken', { mint, amountSol });
	return { ok: true, data: { mint, decision: 'buy', quote, sig: buy.sig, simulate } };
}

export async function autoSnipe(args, ctx) {
	const simulate = !!args.simulate;
	const sessionId = args.sessionId;
	const deadline = Date.now() + args.durationSec * 1000;
	const perTrade = args.perTradeSol ?? cfg(ctx, 'perTradeSol', 0.05);
	const cap = cfg(ctx, 'sessionSpendCapSol', 1.0);

	const state = await loadState(ctx, sessionId, { seen: new Set(), spent: 0, log: [] });

	while (Date.now() < deadline && state.spent + perTrade <= cap) {
		const fresh = await call(ctx, 'pump-fun.getNewTokens', { limit: 20 });
		const items = fresh?.tokens ?? fresh ?? [];
		for (const t of items) {
			const mint = t.mint ?? t.address;
			if (!mint || state.seen.has(mint)) continue;
			state.seen.add(mint);
			const vet = await vetMint(ctx, mint).catch((e) => ({ verdict: { ok: false, reason: e.message } }));
			if (!vet.verdict.ok) {
				state.log.push({ mint, action: 'skip', reason: vet.verdict.reason });
				continue;
			}
			try {
				const buy = await maybeTrade(ctx, simulate, 'pump-fun-trade.buyToken', { mint, amountSol: perTrade });
				state.spent += perTrade;
				state.log.push({ mint, action: simulate ? 'simulate-buy' : 'buy', sig: buy.sig, spent: state.spent });
				await saveState(ctx, sessionId, state);
				if (state.spent + perTrade > cap) break;
			} catch (e) {
				state.log.push({ mint, action: 'error', reason: e.message });
			}
		}
		await saveState(ctx, sessionId, state);
		await new Promise((r) => setTimeout(r, cfg(ctx, 'pollMs', 5000)));
	}
	return { ok: true, data: { spent: state.spent, trades: state.log, simulate, sessionId } };
}

export async function copyTrade(args, ctx) {
	const simulate = !!args.simulate;
	const sessionId = args.sessionId;
	const deadline = Date.now() + args.durationSec * 1000;
	const mult = args.sizeMultiplier ?? 1;
	const cap = cfg(ctx, 'sessionSpendCapSol', 1.0);

	const state = await loadState(ctx, sessionId, { mirrored: new Set(), spent: 0, log: [] });

	while (Date.now() < deadline && state.spent < cap) {
		const profile = await call(ctx, 'pump-fun.getCreatorProfile', { creator: args.wallet });
		const recentMints = (profile?.tokens ?? []).map((t) => t.mint).filter(Boolean);
		for (const mint of recentMints) {
			const trades = await call(ctx, 'pump-fun.getTokenTrades', { mint, limit: 20 });
			const buys = (trades?.trades ?? trades ?? []).filter(
				(t) => t.side === 'buy' && t.wallet === args.wallet && !state.mirrored.has(t.sig),
			);
			for (const b of buys) {
				state.mirrored.add(b.sig);
				const amountSol = Math.min((b.solAmount ?? 0) * mult, cap - state.spent);
				if (amountSol <= 0) break;
				try {
					const r = await maybeTrade(ctx, simulate, 'pump-fun-trade.buyToken', { mint, amountSol });
					state.spent += amountSol;
					state.log.push({ mint, mirroredFrom: b.sig, sig: r.sig, amountSol, simulate });
					await saveState(ctx, sessionId, state);
				} catch (e) {
					state.log.push({ mint, error: e.message });
				}
			}
		}
		await saveState(ctx, sessionId, state);
		await new Promise((r) => setTimeout(r, cfg(ctx, 'pollMs', 5000)));
	}
	return { ok: true, data: { spent: state.spent, mirrors: state.log, simulate, sessionId } };
}

export async function rugExitWatch(args, ctx) {
	const simulate = !!args.simulate;
	const sessionId = args.sessionId;
	const deadline = Date.now() + args.durationSec * 1000;
	const concentrationLimit = cfg(ctx, 'exitOnConcentrationPct', 40);
	const devSellLimit = cfg(ctx, 'exitOnDevSellPct', 25);

	const state = await loadState(ctx, sessionId, { exited: new Set(), log: [] });

	while (Date.now() < deadline && state.exited.size < args.mints.length) {
		for (const mint of args.mints) {
			if (state.exited.has(mint)) continue;
			const [holders, trades, details] = await Promise.all([
				call(ctx, 'pump-fun.getTokenHolders', { mint, limit: 10 }),
				call(ctx, 'pump-fun.getTokenTrades', { mint, limit: 50 }),
				call(ctx, 'pump-fun.getTokenDetails', { mint }),
			]);
			const top = holders?.topHolderPct ?? holders?.holders?.[0]?.pct ?? 0;
			const dev = details?.creator ?? details?.token?.creator;
			const devSells = (trades?.trades ?? trades ?? []).filter(
				(t) => t.side === 'sell' && t.wallet === dev,
			);
			const devSellPct = devSells.reduce((s, t) => s + (t.pctOfSupply ?? 0), 0);

			let trigger = null;
			if (top >= concentrationLimit) trigger = `top holder ${top}%`;
			else if (devSellPct >= devSellLimit) trigger = `dev sold ${devSellPct}%`;
			if (!trigger) continue;

			try {
				const sell = await maybeTrade(ctx, simulate, 'pump-fun-trade.sellToken', { mint, percent: 100 });
				state.exited.add(mint);
				state.log.push({ mint, trigger, sig: sell.sig, simulate });
				await saveState(ctx, sessionId, state);
			} catch (e) {
				state.log.push({ mint, trigger, error: e.message });
			}
		}
		await saveState(ctx, sessionId, state);
		await new Promise((r) => setTimeout(r, cfg(ctx, 'pollMs', 5000)));
	}
	return { ok: true, data: { exited: [...state.exited], events: state.log, simulate, sessionId } };
}
