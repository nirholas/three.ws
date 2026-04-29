// pump-fun-compose — agent-level loops over the read + trade skills.
// All sibling-skill calls go through ctx.skills.invoke('skill.tool', args).

function cfg(ctx, key, fallback) {
	return ctx?.skillConfig?.[key] ?? fallback;
}

async function call(ctx, tool, args) {
	const res = await ctx.skills.invoke(tool, args);
	if (!res?.ok) throw new Error(`${tool} failed: ${res?.error ?? 'unknown'}`);
	return res.data;
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
	const search = await call(ctx, 'pump-fun.searchTokens', { query: args.query, limit: 1 });
	const mint = search?.results?.[0]?.mint ?? search?.[0]?.mint ?? args.query;
	const vet = await vetMint(ctx, mint);
	if (!vet.verdict.ok) return { ok: true, data: { mint, decision: 'skip', reason: vet.verdict.reason } };

	const amountSol = args.amountSol ?? cfg(ctx, 'perTradeSol', 0.05);
	const quote = await call(ctx, 'pump-fun-trade.quoteTrade', { mint, side: 'buy', amountSol });
	const buy = await call(ctx, 'pump-fun-trade.buyToken', { mint, amountSol });
	return { ok: true, data: { mint, decision: 'buy', quote, sig: buy.sig } };
}

export async function autoSnipe(args, ctx) {
	const deadline = Date.now() + args.durationSec * 1000;
	const perTrade = args.perTradeSol ?? cfg(ctx, 'perTradeSol', 0.05);
	const cap = cfg(ctx, 'sessionSpendCapSol', 1.0);
	const seen = new Set();
	const log = [];
	let spent = 0;

	while (Date.now() < deadline && spent + perTrade <= cap) {
		const fresh = await call(ctx, 'pump-fun.getNewTokens', { limit: 20 });
		const items = fresh?.tokens ?? fresh ?? [];
		for (const t of items) {
			const mint = t.mint ?? t.address;
			if (!mint || seen.has(mint)) continue;
			seen.add(mint);
			const vet = await vetMint(ctx, mint).catch((e) => ({ verdict: { ok: false, reason: e.message } }));
			if (!vet.verdict.ok) {
				log.push({ mint, action: 'skip', reason: vet.verdict.reason });
				continue;
			}
			try {
				const buy = await call(ctx, 'pump-fun-trade.buyToken', { mint, amountSol: perTrade });
				spent += perTrade;
				log.push({ mint, action: 'buy', sig: buy.sig, spent });
				if (spent + perTrade > cap) break;
			} catch (e) {
				log.push({ mint, action: 'error', reason: e.message });
			}
		}
		await new Promise((r) => setTimeout(r, cfg(ctx, 'pollMs', 5000)));
	}
	return { ok: true, data: { spent, trades: log } };
}

export async function copyTrade(args, ctx) {
	const deadline = Date.now() + args.durationSec * 1000;
	const mult = args.sizeMultiplier ?? 1;
	const cap = cfg(ctx, 'sessionSpendCapSol', 1.0);
	const mirrored = new Set();
	const log = [];
	let spent = 0;

	while (Date.now() < deadline && spent < cap) {
		const profile = await call(ctx, 'pump-fun.getCreatorProfile', { creator: args.wallet });
		const recentMints = (profile?.tokens ?? []).map((t) => t.mint).filter(Boolean);
		for (const mint of recentMints) {
			const trades = await call(ctx, 'pump-fun.getTokenTrades', { mint, limit: 20 });
			const buys = (trades?.trades ?? trades ?? []).filter(
				(t) => t.side === 'buy' && t.wallet === args.wallet && !mirrored.has(t.sig),
			);
			for (const b of buys) {
				mirrored.add(b.sig);
				const amountSol = Math.min((b.solAmount ?? 0) * mult, cap - spent);
				if (amountSol <= 0) break;
				try {
					const r = await call(ctx, 'pump-fun-trade.buyToken', { mint, amountSol });
					spent += amountSol;
					log.push({ mint, mirroredFrom: b.sig, sig: r.sig, amountSol });
				} catch (e) {
					log.push({ mint, error: e.message });
				}
			}
		}
		await new Promise((r) => setTimeout(r, cfg(ctx, 'pollMs', 5000)));
	}
	return { ok: true, data: { spent, mirrors: log } };
}

export async function rugExitWatch(args, ctx) {
	const deadline = Date.now() + args.durationSec * 1000;
	const concentrationLimit = cfg(ctx, 'exitOnConcentrationPct', 40);
	const devSellLimit = cfg(ctx, 'exitOnDevSellPct', 25);
	const exited = new Set();
	const log = [];

	while (Date.now() < deadline && exited.size < args.mints.length) {
		for (const mint of args.mints) {
			if (exited.has(mint)) continue;
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
				const sell = await call(ctx, 'pump-fun-trade.sellToken', { mint, percent: 100 });
				exited.add(mint);
				log.push({ mint, trigger, sig: sell.sig });
			} catch (e) {
				log.push({ mint, trigger, error: e.message });
			}
		}
		await new Promise((r) => setTimeout(r, cfg(ctx, 'pollMs', 5000)));
	}
	return { ok: true, data: { exited: [...exited], events: log } };
}
