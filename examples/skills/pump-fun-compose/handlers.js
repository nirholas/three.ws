// pump-fun-compose — agent-level loops over the read + trade skills.
// All sibling-skill calls go through ctx.skills.invoke('skill.tool', args).
//
// Args supported by every loop:
//   - sessionId       persists seen/mirrored/spent/exited via ctx.memory
//   - signal          AbortSignal — loops/sleeps/inner iterations bail promptly
//   - onProgress(evt) called on every state change for live UIs
//   - dryRun          control flow runs but trade-skill calls return null sigs

const _sessions = new Map();

function cfg(ctx, key, fallback) {
	return ctx?.skillConfig?.[key] ?? fallback;
}

async function call(ctx, tool, args) {
	const res = await ctx.skills.invoke(tool, args);
	if (!res?.ok) throw new Error(`${tool} failed: ${res?.error ?? 'unknown'}`);
	return res.data;
}

function abortableSleep(ms, signal) {
	return new Promise((resolve) => {
		if (signal?.aborted) return resolve();
		const t = setTimeout(resolve, ms);
		const onAbort = () => { clearTimeout(t); resolve(); };
		signal?.addEventListener?.('abort', onAbort, { once: true });
	});
}

function emit(progress, evt) {
	try { progress?.(evt); } catch {}
}

async function loadState(ctx, sessionId, init) {
	if (!sessionId) return { ...init };
	if (_sessions.has(sessionId)) return _sessions.get(sessionId);
	try {
		const recalled = await ctx?.memory?.recall?.({ key: `compose:${sessionId}` });
		const prior = recalled?.value ?? recalled?.[0]?.value ?? recalled;
		if (prior && typeof prior === 'object') {
			const restored = {
				...init,
				...prior,
				seen: new Set(prior.seen || []),
				mirrored: new Set(prior.mirrored || []),
				exited: new Set(prior.exited || []),
			};
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

async function doBuy(ctx, dryRun, mint, amountSol) {
	if (dryRun) return { sig: null, dryRun: true };
	return call(ctx, 'pump-fun-trade.buyToken', { mint, amountSol });
}

async function doSell(ctx, dryRun, mint) {
	const status = await call(ctx, 'pump-fun-trade.tokenBalance', { mint }).catch(() => null);
	const tokenAmount = status?.amount ?? status?.balance ?? '0';
	if (tokenAmount === '0') return { sig: null, skipped: 'no-balance', tokenAmount };
	if (dryRun) return { sig: null, dryRun: true, tokenAmount };
	const r = await call(ctx, 'pump-fun-trade.sellToken', { mint, percent: 100 });
	return { ...r, tokenAmount };
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
	const { dryRun = false, onProgress } = args;
	emit(onProgress, { type: 'search', query: args.query });
	const search = await call(ctx, 'pump-fun.searchTokens', { query: args.query, limit: 1 });
	const mint = search?.results?.[0]?.mint ?? search?.[0]?.mint ?? args.query;
	emit(onProgress, { type: 'vet', mint });
	const vet = await vetMint(ctx, mint);
	if (!vet.verdict.ok) {
		emit(onProgress, { type: 'skip', mint, reason: vet.verdict.reason });
		return { ok: true, data: { mint, decision: 'skip', reason: vet.verdict.reason, dryRun } };
	}

	const amountSol = args.amountSol ?? cfg(ctx, 'perTradeSol', 0.05);
	const quote = await call(ctx, 'pump-fun-trade.quoteTrade', { mint, side: 'buy', amountSol });
	const buy = await doBuy(ctx, dryRun, mint, amountSol);
	emit(onProgress, { type: dryRun ? 'dry-buy' : 'buy', mint, amountSol, sig: buy.sig });
	return { ok: true, data: { mint, decision: 'buy', quote, sig: buy.sig, dryRun } };
}

export async function autoSnipe(args, ctx) {
	const { dryRun = false, onProgress, signal, sessionId } = args;
	const deadline = Date.now() + args.durationSec * 1000;
	const perTrade = args.perTradeSol ?? cfg(ctx, 'perTradeSol', 0.05);
	const cap = cfg(ctx, 'sessionSpendCapSol', 1.0);
	const state = await loadState(ctx, sessionId, { seen: new Set(), spent: 0, log: [] });
	emit(onProgress, { type: 'start', mode: 'auto-snipe', spent: state.spent, cap });

	while (!signal?.aborted && Date.now() < deadline && state.spent + perTrade <= cap) {
		const fresh = await call(ctx, 'pump-fun.getNewTokens', { limit: 20 });
		const items = fresh?.tokens ?? fresh ?? [];
		for (const t of items) {
			if (signal?.aborted) break;
			const mint = t.mint ?? t.address;
			if (!mint || state.seen.has(mint)) continue;
			state.seen.add(mint);
			emit(onProgress, { type: 'vet', mint });
			const vet = await vetMint(ctx, mint).catch((e) => ({ verdict: { ok: false, reason: e.message } }));
			if (!vet.verdict.ok) {
				state.log.push({ mint, action: 'skip', reason: vet.verdict.reason });
				emit(onProgress, { type: 'skip', mint, reason: vet.verdict.reason, spent: state.spent });
				continue;
			}
			try {
				const buy = await doBuy(ctx, dryRun, mint, perTrade);
				state.spent += perTrade;
				state.log.push({ mint, action: dryRun ? 'dry-buy' : 'buy', sig: buy.sig, spent: state.spent });
				await saveState(ctx, sessionId, state);
				emit(onProgress, { type: dryRun ? 'dry-buy' : 'buy', mint, sig: buy.sig, spent: state.spent });
				if (state.spent + perTrade > cap) break;
			} catch (e) {
				state.log.push({ mint, action: 'error', reason: e.message });
				emit(onProgress, { type: 'error', mint, reason: e.message });
			}
		}
		await saveState(ctx, sessionId, state);
		if (signal?.aborted || Date.now() >= deadline || state.spent + perTrade > cap) break;
		emit(onProgress, { type: 'poll-sleep', ms: cfg(ctx, 'pollMs', 5000) });
		await abortableSleep(cfg(ctx, 'pollMs', 5000), signal);
	}
	const reason = signal?.aborted ? 'aborted' : Date.now() >= deadline ? 'duration' : 'cap';
	return { ok: true, data: { spent: state.spent, trades: state.log, dryRun, sessionId, reason } };
}

export async function copyTrade(args, ctx) {
	const { dryRun = false, onProgress, signal, sessionId } = args;
	const deadline = Date.now() + args.durationSec * 1000;
	const mult = args.sizeMultiplier ?? 1;
	const cap = cfg(ctx, 'sessionSpendCapSol', 1.0);
	const state = await loadState(ctx, sessionId, { mirrored: new Set(), spent: 0, log: [] });
	emit(onProgress, { type: 'start', mode: 'copy-trade', wallet: args.wallet, spent: state.spent, cap });

	while (!signal?.aborted && Date.now() < deadline && state.spent < cap) {
		const profile = await call(ctx, 'pump-fun.getCreatorProfile', { creator: args.wallet });
		const recentMints = (profile?.tokens ?? []).map((t) => t.mint).filter(Boolean);
		for (const mint of recentMints) {
			if (signal?.aborted) break;
			const trades = await call(ctx, 'pump-fun.getTokenTrades', { mint, limit: 20 });
			const buys = (trades?.trades ?? trades ?? []).filter(
				(t) => t.side === 'buy' && t.wallet === args.wallet && !state.mirrored.has(t.sig),
			);
			for (const b of buys) {
				if (signal?.aborted) break;
				state.mirrored.add(b.sig);
				const amountSol = Math.min((b.solAmount ?? 0) * mult, cap - state.spent);
				if (amountSol <= 0) break;
				try {
					const r = await doBuy(ctx, dryRun, mint, amountSol);
					state.spent += amountSol;
					state.log.push({ mint, mirroredFrom: b.sig, sig: r.sig, amountSol, dryRun });
					await saveState(ctx, sessionId, state);
					emit(onProgress, { type: dryRun ? 'dry-buy' : 'buy', mint, sig: r.sig, amountSol, spent: state.spent });
				} catch (e) {
					state.log.push({ mint, error: e.message });
					emit(onProgress, { type: 'error', mint, reason: e.message });
				}
			}
		}
		await saveState(ctx, sessionId, state);
		if (signal?.aborted || Date.now() >= deadline || state.spent >= cap) break;
		emit(onProgress, { type: 'poll-sleep', ms: cfg(ctx, 'pollMs', 5000) });
		await abortableSleep(cfg(ctx, 'pollMs', 5000), signal);
	}
	const reason = signal?.aborted ? 'aborted' : Date.now() >= deadline ? 'duration' : 'cap';
	return { ok: true, data: { spent: state.spent, mirrors: state.log, dryRun, sessionId, reason } };
}

export async function rugExitWatch(args, ctx) {
	const { dryRun = false, onProgress, signal, sessionId } = args;
	const deadline = Date.now() + args.durationSec * 1000;
	const concentrationLimit = cfg(ctx, 'exitOnConcentrationPct', 40);
	const devSellLimit = cfg(ctx, 'exitOnDevSellPct', 25);
	const state = await loadState(ctx, sessionId, { exited: new Set(), log: [] });
	emit(onProgress, { type: 'start', mode: 'rug-exit-watch', mints: args.mints });

	while (!signal?.aborted && Date.now() < deadline && state.exited.size < args.mints.length) {
		for (const mint of args.mints) {
			if (signal?.aborted) break;
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
			if (!trigger) {
				emit(onProgress, { type: 'tick', mint, top, devSellPct });
				continue;
			}

			try {
				const sell = await doSell(ctx, dryRun, mint);
				if (sell.skipped === 'no-balance') {
					state.log.push({ mint, trigger, action: 'skipped-no-balance' });
					emit(onProgress, { type: 'skip', mint, reason: 'no-balance' });
				} else {
					state.exited.add(mint);
					state.log.push({ mint, trigger, sig: sell.sig, tokenAmount: sell.tokenAmount, dryRun });
					emit(onProgress, { type: dryRun ? 'dry-sell' : 'sell', mint, sig: sell.sig, trigger });
				}
				await saveState(ctx, sessionId, state);
			} catch (e) {
				state.log.push({ mint, trigger, error: e.message });
				emit(onProgress, { type: 'error', mint, reason: e.message });
			}
		}
		await saveState(ctx, sessionId, state);
		if (signal?.aborted || Date.now() >= deadline || state.exited.size >= args.mints.length) break;
		emit(onProgress, { type: 'poll-sleep', ms: cfg(ctx, 'pollMs', 5000) });
		await abortableSleep(cfg(ctx, 'pollMs', 5000), signal);
	}
	const reason = signal?.aborted ? 'aborted' : Date.now() >= deadline ? 'duration' : 'all-exited';
	return { ok: true, data: { exited: [...state.exited], events: state.log, dryRun, sessionId, reason } };
}
