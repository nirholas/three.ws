/**
 * Pump.fun composition skills — agent-level loops over read (MCP) + trade (signed).
 * Mirrors examples/skills/pump-fun-compose/handlers.js but runs inside AgentSkills
 * so it composes pumpfun-buy / pumpfun-sell instead of file-based sibling skills.
 *
 * Safety:
 *   - simulate:true       → vet/quote run, signing skipped, returns SIMULATED:* sigs
 *   - sessionId:"..."     → seen/mirrored/spent/exited persisted in agent memory,
 *                           survives crashes within the spend cap.
 */

const MCP_ENDPOINT = 'https://pump-fun-sdk.modelcontextprotocol.name/mcp';
const _sessions = new Map();
let _rpcId = 0;

const DEFAULTS = {
	sessionSpendCapSol: 1.0,
	perTradeSol: 0.05,
	minHoldersForBuy: 30,
	maxTopHolderPct: 25,
	rejectIfCreatorRugCount: 1,
	exitOnConcentrationPct: 40,
	exitOnDevSellPct: 25,
	pollMs: 5000,
};

function cfg(ctx, key) {
	return ctx?.skillConfig?.[key] ?? DEFAULTS[key];
}

async function mcp(toolName, args) {
	const res = await fetch(MCP_ENDPOINT, {
		method: 'POST',
		headers: { 'Content-Type': 'application/json' },
		body: JSON.stringify({
			jsonrpc: '2.0',
			id: ++_rpcId,
			method: 'tools/call',
			params: { name: toolName, arguments: args ?? {} },
		}),
	});
	if (!res.ok) throw new Error(`pump-fun MCP HTTP ${res.status}`);
	const body = await res.json();
	if (body.error) throw new Error(body.error.message ?? 'pump-fun MCP error');
	const text = body.result?.content?.find?.((c) => c.type === 'text')?.text;
	if (text) {
		try { return JSON.parse(text); } catch { return text; }
	}
	return body.result;
}

async function loadState(memory, sessionId, init) {
	if (!sessionId) return { ...init };
	if (_sessions.has(sessionId)) return _sessions.get(sessionId);
	try {
		const entries = memory?.query?.({ tags: [`compose:${sessionId}`], limit: 1 }) || [];
		const prior = entries[0]?.content;
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

function saveState(memory, sessionId, state) {
	if (!sessionId) return;
	_sessions.set(sessionId, state);
	const serializable = {
		...state,
		seen: state.seen ? [...state.seen] : undefined,
		mirrored: state.mirrored ? [...state.mirrored] : undefined,
		exited: state.exited ? [...state.exited] : undefined,
	};
	try {
		memory?.add?.({
			type: 'project',
			content: serializable,
			tags: [`compose:${sessionId}`],
			important: true,
		});
	} catch {}
}

async function maybeBuy(skills, ctx, simulate, mint, solAmount) {
	if (simulate) return { signature: `SIMULATED:buy:${mint}:${solAmount}`, simulated: true };
	const r = await skills.perform('pumpfun-buy', { mint, solAmount }, ctx);
	if (!r?.success) throw new Error(r?.output || 'pumpfun-buy failed');
	return r.data;
}

async function maybeSell(skills, ctx, simulate, mint) {
	const status = await skills.perform('pumpfun-status', { mint }, ctx);
	const tokenAmount = status?.data?.userBalance ?? '0';
	if (simulate) return { signature: `SIMULATED:sell:${mint}:${tokenAmount}`, simulated: true };
	if (tokenAmount === '0') return { signature: 'NOOP:no-balance', simulated: false };
	const r = await skills.perform('pumpfun-sell', { mint, tokenAmount }, ctx);
	if (!r?.success) throw new Error(r?.output || 'pumpfun-sell failed');
	return r.data;
}

function passesFilters(ctx, { creator, holders }) {
	const rugCount = creator?.rugCount ?? creator?.rugFlags?.length ?? 0;
	if (rugCount >= cfg(ctx, 'rejectIfCreatorRugCount')) {
		return { ok: false, reason: `creator has ${rugCount} prior rug(s)` };
	}
	const holderCount = holders?.total ?? holders?.holders?.length ?? 0;
	if (holderCount < cfg(ctx, 'minHoldersForBuy')) {
		return { ok: false, reason: `only ${holderCount} holders` };
	}
	const top = holders?.topHolderPct ?? holders?.holders?.[0]?.pct ?? 0;
	if (top > cfg(ctx, 'maxTopHolderPct')) {
		return { ok: false, reason: `top holder owns ${top}%` };
	}
	return { ok: true };
}

async function vetMint(mint) {
	const [details, holders] = await Promise.all([
		mcp('getTokenDetails', { mint }),
		mcp('getTokenHolders', { mint, limit: 20 }),
	]);
	const creatorAddr = details?.creator ?? details?.token?.creator;
	const creator = creatorAddr ? await mcp('getCreatorProfile', { creator: creatorAddr }) : { rugCount: 0 };
	return { details, holders, creator };
}

/**
 * @param {import('./agent-skills.js').AgentSkills} skills
 */
export function registerPumpFunComposeSkills(skills) {
	skills.register({
		name: 'pumpfun-research-and-buy',
		description: 'Research a pump.fun token, then buy if it passes rug/holder filters. Set simulate:true to dry-run.',
		instruction: 'search → vet (curve, holders, creator rug flags) → buy via pumpfun-buy.',
		animationHint: 'inspect',
		voicePattern: 'Researching {{query}}…',
		mcpExposed: true,
		inputSchema: {
			type: 'object',
			properties: {
				query: { type: 'string' },
				amountSol: { type: 'number' },
				simulate: { type: 'boolean' },
			},
			required: ['query'],
		},
		handler: async (args, ctx) => {
			const simulate = !!args.simulate;
			const search = await mcp('searchTokens', { query: args.query, limit: 1 });
			const mint = search?.results?.[0]?.mint ?? search?.[0]?.mint ?? args.query;
			const v = await vetMint(mint);
			const verdict = passesFilters(ctx, v);
			if (!verdict.ok) {
				return {
					success: true,
					output: `Skipping ${mint.slice(0, 8)}…: ${verdict.reason}`,
					sentiment: -0.1,
					data: { mint, decision: 'skip', reason: verdict.reason, simulate },
				};
			}
			const amountSol = args.amountSol ?? cfg(ctx, 'perTradeSol');
			const buy = await maybeBuy(skills, ctx, simulate, mint, amountSol);
			return {
				success: true,
				output: simulate
					? `Dry-run buy ${amountSol} SOL of ${mint.slice(0, 8)}….`
					: `Bought ${amountSol} SOL of ${mint.slice(0, 8)}….`,
				sentiment: 0.6,
				data: { mint, decision: 'buy', amountSol, sig: buy.signature, simulate },
			};
		},
	});

	skills.register({
		name: 'pumpfun-auto-snipe',
		description: 'Poll new tokens, vet, and auto-buy each pass with perTradeSol until sessionSpendCapSol. Persists seen/spent under sessionId.',
		instruction: 'autoSnipe loop. Use simulate:true to validate filters without spending.',
		animationHint: 'gesture',
		voicePattern: 'Sniping for {{durationSec}}s…',
		mcpExposed: true,
		inputSchema: {
			type: 'object',
			properties: {
				durationSec: { type: 'integer', minimum: 10, maximum: 3600 },
				perTradeSol: { type: 'number' },
				sessionId: { type: 'string' },
				simulate: { type: 'boolean' },
			},
			required: ['durationSec'],
		},
		handler: async (args, ctx) => {
			const simulate = !!args.simulate;
			const sessionId = args.sessionId;
			const deadline = Date.now() + args.durationSec * 1000;
			const perTrade = args.perTradeSol ?? cfg(ctx, 'perTradeSol');
			const cap = cfg(ctx, 'sessionSpendCapSol');
			const state = await loadState(ctx?.memory, sessionId, { seen: new Set(), spent: 0, log: [] });

			while (!args.signal?.aborted && Date.now() < deadline && state.spent + perTrade <= cap) {
				const fresh = await mcp('getNewTokens', { limit: 20 }).catch(() => null);
				const items = fresh?.tokens ?? fresh ?? [];
				for (const t of items) {
					const mint = t.mint ?? t.address;
					if (!mint || state.seen.has(mint)) continue;
					state.seen.add(mint);
					const v = await vetMint(mint).catch((e) => ({ verdict: { ok: false, reason: e.message } }));
					const verdict = v.verdict || passesFilters(ctx, v);
					if (!verdict.ok) {
						state.log.push({ mint, action: 'skip', reason: verdict.reason });
						continue;
					}
					try {
						const buy = await maybeBuy(skills, ctx, simulate, mint, perTrade);
						state.spent += perTrade;
						state.log.push({ mint, action: simulate ? 'simulate-buy' : 'buy', sig: buy.signature, spent: state.spent });
						saveState(ctx?.memory, sessionId, state);
						if (state.spent + perTrade > cap) break;
					} catch (e) {
						state.log.push({ mint, action: 'error', reason: e.message });
					}
				}
				saveState(ctx?.memory, sessionId, state);
				await new Promise((r) => setTimeout(r, cfg(ctx, 'pollMs')));
			}
			return {
				success: true,
				output: `${simulate ? 'Dry-run' : 'Snipe'} done. Spent ${state.spent} SOL across ${state.log.length} events.`,
				sentiment: 0.4,
				data: { spent: state.spent, trades: state.log, simulate, sessionId },
			};
		},
	});

	skills.register({
		name: 'pumpfun-copy-trade',
		description: 'Mirror a wallet\'s recent pump.fun buys with size scaling. Persists mirrored sigs under sessionId.',
		instruction: 'copyTrade loop.',
		animationHint: 'gesture',
		voicePattern: 'Copy-trading {{wallet}}…',
		mcpExposed: true,
		inputSchema: {
			type: 'object',
			properties: {
				wallet: { type: 'string' },
				sizeMultiplier: { type: 'number', minimum: 0.001, maximum: 10 },
				durationSec: { type: 'integer', minimum: 10, maximum: 7200 },
				sessionId: { type: 'string' },
				simulate: { type: 'boolean' },
			},
			required: ['wallet', 'durationSec'],
		},
		handler: async (args, ctx) => {
			const simulate = !!args.simulate;
			const sessionId = args.sessionId;
			const deadline = Date.now() + args.durationSec * 1000;
			const mult = args.sizeMultiplier ?? 1;
			const cap = cfg(ctx, 'sessionSpendCapSol');
			const state = await loadState(ctx?.memory, sessionId, { mirrored: new Set(), spent: 0, log: [] });

			while (!args.signal?.aborted && Date.now() < deadline && state.spent < cap) {
				const profile = await mcp('getCreatorProfile', { creator: args.wallet }).catch(() => null);
				const recentMints = (profile?.tokens ?? []).map((t) => t.mint).filter(Boolean);
				for (const mint of recentMints) {
					const trades = await mcp('getTokenTrades', { mint, limit: 20 }).catch(() => null);
					const buys = (trades?.trades ?? trades ?? []).filter(
						(t) => t.side === 'buy' && t.wallet === args.wallet && !state.mirrored.has(t.sig),
					);
					for (const b of buys) {
						state.mirrored.add(b.sig);
						const amountSol = Math.min((b.solAmount ?? 0) * mult, cap - state.spent);
						if (amountSol <= 0) break;
						try {
							const r = await maybeBuy(skills, ctx, simulate, mint, amountSol);
							state.spent += amountSol;
							state.log.push({ mint, mirroredFrom: b.sig, sig: r.signature, amountSol, simulate });
							saveState(ctx?.memory, sessionId, state);
						} catch (e) {
							state.log.push({ mint, error: e.message });
						}
					}
				}
				saveState(ctx?.memory, sessionId, state);
				await new Promise((r) => setTimeout(r, cfg(ctx, 'pollMs')));
			}
			return {
				success: true,
				output: `${simulate ? 'Dry-run' : 'Copy-trade'} done. Mirrored ${state.log.length} buys, spent ${state.spent} SOL.`,
				sentiment: 0.4,
				data: { spent: state.spent, mirrors: state.log, simulate, sessionId },
			};
		},
	});

	skills.register({
		name: 'pumpfun-rug-exit-watch',
		description: 'Watch held mints; auto-sell on top-holder concentration or dev-wallet sell triggers. Persists exited mints under sessionId.',
		instruction: 'rugExitWatch loop.',
		animationHint: 'concern',
		voicePattern: 'Watching {{mints.length}} positions…',
		mcpExposed: true,
		inputSchema: {
			type: 'object',
			properties: {
				mints: { type: 'array', items: { type: 'string' } },
				durationSec: { type: 'integer', minimum: 10, maximum: 86400 },
				sessionId: { type: 'string' },
				simulate: { type: 'boolean' },
			},
			required: ['mints', 'durationSec'],
		},
		handler: async (args, ctx) => {
			const simulate = !!args.simulate;
			const sessionId = args.sessionId;
			const deadline = Date.now() + args.durationSec * 1000;
			const concentrationLimit = cfg(ctx, 'exitOnConcentrationPct');
			const devSellLimit = cfg(ctx, 'exitOnDevSellPct');
			const state = await loadState(ctx?.memory, sessionId, { exited: new Set(), log: [] });

			while (!args.signal?.aborted && Date.now() < deadline && state.exited.size < args.mints.length) {
				for (const mint of args.mints) {
					if (state.exited.has(mint)) continue;
					const [holders, trades, details] = await Promise.all([
						mcp('getTokenHolders', { mint, limit: 10 }).catch(() => null),
						mcp('getTokenTrades', { mint, limit: 50 }).catch(() => null),
						mcp('getTokenDetails', { mint }).catch(() => null),
					]);
					const top = holders?.topHolderPct ?? holders?.holders?.[0]?.pct ?? 0;
					const dev = details?.creator ?? details?.token?.creator;
					const devSells = (trades?.trades ?? trades ?? []).filter((t) => t.side === 'sell' && t.wallet === dev);
					const devSellPct = devSells.reduce((s, t) => s + (t.pctOfSupply ?? 0), 0);

					let trigger = null;
					if (top >= concentrationLimit) trigger = `top holder ${top}%`;
					else if (devSellPct >= devSellLimit) trigger = `dev sold ${devSellPct}%`;
					if (!trigger) continue;

					try {
						const sell = await maybeSell(skills, ctx, simulate, mint);
						state.exited.add(mint);
						state.log.push({ mint, trigger, sig: sell.signature, simulate });
						saveState(ctx?.memory, sessionId, state);
					} catch (e) {
						state.log.push({ mint, trigger, error: e.message });
					}
				}
				saveState(ctx?.memory, sessionId, state);
				await new Promise((r) => setTimeout(r, cfg(ctx, 'pollMs')));
			}
			return {
				success: true,
				output: `Exit watch done. Exited ${state.exited.size}/${args.mints.length} positions.`,
				sentiment: state.exited.size > 0 ? -0.2 : 0.2,
				data: { exited: [...state.exited], events: state.log, simulate, sessionId },
			};
		},
	});
}
