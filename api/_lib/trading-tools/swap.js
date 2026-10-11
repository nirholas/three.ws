// swap_quote and swap_execute: compare every Solana aggregator, then fill the
// chosen route from an agent wallet through the guarded executor.
//
//   swap_quote    prices the trade on every aggregator in swap-routes.js, ranks
//                 the routes by net output after fees and price impact, and,
//                 when an agent wallet can fill it, runs the executor's guard
//                 chain in preview mode and signs a quote_id that pins the
//                 route, the amount and the minimum output the user approved.
//   swap_execute  needs confirm_swap: true and that quote_id. It re-prices the
//                 pinned route live, refuses if the market moved below the
//                 approved minimum, tightens slippage so the on-chain floor is
//                 never lower than that minimum, and hands the fill to
//                 runAgentTrade (api/agents/solana-trade.js): kill switch,
//                 per-trade cap, daily budget, USD ceiling, price-impact
//                 breaker, rug firewall, SOL headroom, idempotent custody
//                 ledger and the protected sender all apply unchanged.
//
// A quote is never filled stale: the signed quote_id expires five minutes
// after issue, each one fills at most once (its nonce is the idempotency key),
// and the fill uses a fresh price, never the cached one the quote showed.
//
// Custodial swaps keep SOL on one side because the guard chain meters spend in
// SOL. Any other pair is compared and explained, never custodially filled.

import { PublicKey } from '@solana/web3.js';

import { sql } from '../db.js';
import { cacheWrap } from '../cache.js';
import { jupiterTokenSearch } from '../token/jupiter.js';
import { isPlatformOwnedUser, effectivePumpFeeBps } from '../pump-platform-fee.js';
import { runAgentTrade, parseTradeRequest } from '../../agents/solana-trade.js';
import { ToolInputError, WSOL_MINT, USDC_MINT, resolveMint, tokenDecimals } from './market.js';
import { toAtomic } from './arbitrage.js';
import { issuePreview, verifyPreview, consumePreview } from './preview.js';
import { refuse, requireUser, requireScope, requireConfirm, requireAgreement, loadOwnedAgent } from './context.js';
import {
	SWAP_AGGREGATORS, parseDexChoice, quoteRoute, compareRoutes, buildRoute, decompileRouteTx,
} from './swap-routes.js';

/** How long a swap quote_id authorizes a fill. */
export const SWAP_QUOTE_TTL_MS = 5 * 60 * 1000;
export const DEFAULT_SWAP_SLIPPAGE_BPS = 100;
const MAX_SLIPPAGE_BPS = 5_000;
const LAMPORTS_PER_SOL = 1_000_000_000;

function fail(status, code, message, detail = null) {
	return Object.assign(new Error(message), { status, code, ...(detail ? { detail } : {}) });
}

// ── arguments ────────────────────────────────────────────────────────────────

function slippageArg(v) {
	if (v == null || v === '') return DEFAULT_SWAP_SLIPPAGE_BPS;
	const n = Number(v);
	if (!Number.isInteger(n) || n < 1 || n > MAX_SLIPPAGE_BPS) {
		throw refuse(400, 'invalid_parameter', `slippage_bps must be a whole number from 1 to ${MAX_SLIPPAGE_BPS}.`, { parameter: 'slippage_bps' });
	}
	return n;
}

function amountRawArg(args, decimals) {
	if (args.amount_raw != null && args.amount_raw !== '') {
		const s = String(args.amount_raw).trim();
		if (!/^\d{1,30}$/.test(s) || BigInt(s) <= 0n) {
			throw refuse(400, 'invalid_parameter', 'amount_raw must be a positive integer in the input token\'s base units.', { parameter: 'amount_raw' });
		}
		return s;
	}
	if (args.amount == null || args.amount === '') {
		throw refuse(400, 'missing_parameter', 'Pass amount (in whole input tokens) or amount_raw (in base units).', { parameter: 'amount' });
	}
	return toAtomic(args.amount, decimals).toString();
}

/** Symbol for display. Issuer metadata is untrusted and only ever shown as a field. */
async function tokenSymbol(mint) {
	if (mint === WSOL_MINT) return 'SOL';
	if (mint === USDC_MINT) return 'USDC';
	const hit = await cacheWrap(`tt:symbol:v1:${mint}`, 3600, async () => {
		const rows = await jupiterTokenSearch(mint, { limit: 1 }).catch(() => []);
		const s = rows.find((r) => r.id === mint)?.symbol;
		return typeof s === 'string' && s ? { s: s.slice(0, 16) } : null;
	}).catch(() => null);
	return hit?.s || `${mint.slice(0, 4)}...${mint.slice(-4)}`;
}

async function feeBpsFor(userId) {
	try {
		if (userId && (await isPlatformOwnedUser(userId))) return 0;
		return await effectivePumpFeeBps();
	} catch {
		return 0;
	}
}

const ui = (raw, decimals) => Number(raw) / 10 ** decimals;

// ── route rows into the executor's quote shape ───────────────────────────────

/**
 * The quoteTrade() shape runAgentTrade expects, built from one priced route.
 * @param {object} route  an ok route row from quoteRoute()
 * @param {{ side: 'buy'|'sell', tokenDecimals: number, impactPct: number }} ctx
 */
export function routeToTradeQuote(route, { side, tokenDecimals: decimals, impactPct }) {
	const shape = {
		venue: route.aggregator,
		graduated: true,
		quoteAsset: 'SOL',
		decimals,
		priceImpactPct: impactPct,
		route: route.route,
		raw: route.raw,
		providerFees: route.provider_fees || [],
	};
	if (side === 'buy') {
		return {
			...shape,
			inAsset: 'SOL', inAmount: ui(route.in_amount_raw, 9), inAtomics: String(route.in_amount_raw),
			outAsset: 'TOKEN', outAtomics: String(route.out_amount_raw), outUi: ui(route.out_amount_raw, decimals),
			minOutAtomics: String(route.min_out_raw), minOutUi: ui(route.min_out_raw, decimals),
		};
	}
	return {
		...shape,
		inAsset: 'TOKEN', inAtomics: String(route.in_amount_raw), inUi: ui(route.in_amount_raw, decimals),
		outAsset: 'SOL', outAtomics: String(route.out_amount_raw), outUi: ui(route.out_amount_raw, 9),
		minOutAtomics: String(route.min_out_raw), minOutUi: ui(route.min_out_raw, 9),
	};
}

/**
 * The impact figure the breaker judges. A route that reports none borrows the
 * worst figure another router reported for the same trade (same pools, same
 * depth); with no figure at all the breaker would run blind, so the caller
 * refuses instead.
 */
export function breakerImpact(route, all) {
	if (route.price_impact_pct != null) return route.price_impact_pct;
	const others = all.filter((r) => r.status === 'ok' && r.price_impact_pct != null).map((r) => r.price_impact_pct);
	return others.length ? Math.max(...others) : null;
}

/**
 * Re-price a pinned route for a fill and prove it is not stale.
 *
 * Refuses when the live output is below the minimum the user approved. When
 * the live route would accept a lower floor than that minimum (its own
 * slippage reaches further down), slippage is tightened to exactly the room
 * between the live output and the approved minimum and the route is re-priced,
 * so the on-chain minimum is never lower than what the user said yes to.
 *
 * @param {object} pin   quote_id claims
 * @param {{ userAddress: string, quote?: Function }} opts  `quote` defaults to quoteRoute
 * @returns {Promise<object>} an ok route row whose min_out_raw >= pin.minOutRaw
 */
export async function freshPinnedRoute(pin, { userAddress, quote = quoteRoute }) {
	const args = {
		inputMint: pin.inputMint, outputMint: pin.outputMint, amountRaw: pin.amountRaw,
		slippageBps: pin.slippageBps, userAddress, fresh: true,
	};
	const approvedMin = BigInt(pin.minOutRaw);
	const moved = (liveOut) => fail(409, 'quote_moved', 'The price moved below the minimum you approved since this quote. Nothing was sent. Request a new quote.', {
		approved_min_out_raw: pin.minOutRaw, live_out_raw: liveOut == null ? null : String(liveOut), aggregator: pin.aggregator,
	});

	let route = await quote(pin.aggregator, args);
	if (route.status !== 'ok') {
		throw fail(503, 'route_unavailable', `The ${pin.aggregator} route could not be re-priced (${route.reason}). Nothing was sent. Request a new quote.`, { aggregator: pin.aggregator, status: route.status });
	}
	const liveOut = BigInt(route.out_amount_raw);
	if (liveOut < approvedMin) throw moved(liveOut);
	if (BigInt(route.min_out_raw) < approvedMin) {
		const tight = Number(((liveOut - approvedMin) * 10_000n) / liveOut);
		if (tight < 1) throw moved(liveOut);
		route = await quote(pin.aggregator, { ...args, slippageBps: Math.min(tight, pin.slippageBps) });
		if (route.status !== 'ok' || BigInt(route.min_out_raw) < approvedMin) throw moved(route.out_amount_raw ?? null);
	}
	return route;
}

/** The runAgentTrade executor for one pinned quote. */
function pinnedExecutor(pin, { userAddress }) {
	return {
		id: pin.aggregator,
		async quote({ side, mintStr }) {
			if (side !== pin.side || mintStr !== pin.mint) throw fail(409, 'quote_mismatch', 'The trade does not match the quote it claims.');
			const route = await freshPinnedRoute(pin, { userAddress });
			const impact = route.price_impact_pct ?? pin.impactPct;
			if (impact == null) throw fail(422, 'impact_unknown', 'No router reported a price impact for this trade, so the price-impact breaker cannot judge it. Pick another dex.');
			return routeToTradeQuote(route, { side: pin.side, tokenDecimals: pin.tokenDecimals, impactPct: impact });
		},
		async build({ conn, ownerPk, quote }) {
			const list = await buildRoute(pin.aggregator, { raw: quote.raw, userAddress: ownerPk.toBase58(), conn });
			return decompileRouteTx(list, { conn, ownerPk, inputMint: pin.inputMint, providerFees: quote.providerFees, inAmountRaw: quote.inAtomics });
		},
	};
}

/** An executor that replays one already-priced route, for the guard preview. */
function staticExecutor(route, ctx) {
	return {
		id: route.aggregator,
		quote: async () => routeToTradeQuote(route, ctx),
		build: async () => {
			throw fail(409, 'preview_only', 'This executor only prices.');
		},
	};
}

function tradeBody({ side, mint, amountRaw, slippageBps }) {
	const body = { side, mint, network: 'mainnet', slippage_bps: slippageBps };
	if (side === 'buy') body.sol_amount = Number(BigInt(amountRaw)) / LAMPORTS_PER_SOL;
	else body.token_amount_raw = amountRaw;
	return body;
}

function custodialSide(inputMint, outputMint) {
	if (inputMint === WSOL_MINT && outputMint !== WSOL_MINT) return { side: 'buy', mint: outputMint };
	if (outputMint === WSOL_MINT && inputMint !== WSOL_MINT) return { side: 'sell', mint: inputMint };
	return null;
}

// ── swap_quote ───────────────────────────────────────────────────────────────

/**
 * @param {{ input_mint: string, output_mint: string, amount?: number|string, amount_raw?: string,
 *           dex?: string, slippage_bps?: number, agent_id?: string }} args
 * @param {{ principal?: object, req?: object }} ctx
 */
export async function swapQuote(args, ctx = {}) {
	const dex = parseDexChoice(args.dex);
	const slippageBps = slippageArg(args.slippage_bps);
	if (!args.input_mint || !args.output_mint) {
		throw refuse(400, 'missing_parameter', 'input_mint and output_mint are required (a mint address, a symbol, or SOL / USDC).', { parameter: args.input_mint ? 'output_mint' : 'input_mint' });
	}
	const [inputMint, outputMint] = await Promise.all([resolveMint(args.input_mint), resolveMint(args.output_mint)]);
	if (inputMint === outputMint) throw refuse(400, 'invalid_parameter', 'input_mint and output_mint must differ.', { parameter: 'output_mint' });
	const [inDecimals, outDecimals, inSymbol, outSymbol] = await Promise.all([
		tokenDecimals(inputMint), tokenDecimals(outputMint), tokenSymbol(inputMint), tokenSymbol(outputMint),
	]);
	const amountRaw = amountRawArg(args, inDecimals);

	let agent = null;
	if (args.agent_id) {
		requireScope(ctx, 'wallet:read');
		agent = await loadOwnedAgent(ctx, args.agent_id);
	}
	const userId = ctx?.principal?.userId || null;
	const address = agent?.meta?.solana_address || null;
	const feeBps = await feeBpsFor(userId);

	const aggregators = dex.dexLabel ? [...SWAP_AGGREGATORS, dex.choice] : [...SWAP_AGGREGATORS];
	const rows = await Promise.all(aggregators.map((a) => quoteRoute(a, { inputMint, outputMint, amountRaw, slippageBps, userAddress: address })));
	const chosen = dex.choice === 'auto' ? null : dex.choice;
	const cmp = compareRoutes(rows, { inputMint, outputMint, feeBps, outDecimals, outSymbol, chosen });

	const pair = {
		input: { mint: inputMint, symbol: inSymbol, decimals: inDecimals, amount_raw: amountRaw, amount: ui(amountRaw, inDecimals) },
		output: { mint: outputMint, symbol: outSymbol, decimals: outDecimals },
	};
	const base = {
		chain: 'solana',
		network: 'mainnet',
		...pair,
		dex: dex.choice,
		slippage_bps: slippageBps,
		three_ws_fee_bps: feeBps,
		best: cmp.best,
		selected: cmp.selected,
		routes: cmp.routes,
		unavailable: cmp.unavailable,
		why: cmp.why,
		as_of: new Date().toISOString(),
	};

	if (!cmp.routes.length) {
		throw refuse(502, 'no_route', `No aggregator could price ${inSymbol} to ${outSymbol} at this size right now.`, { unavailable: cmp.unavailable });
	}
	if (!cmp.selected) {
		const r = cmp.unavailable.find((u) => u.aggregator === chosen);
		throw refuse(422, 'no_route', `${chosen} could not price this trade${r ? ` (${r.reason})` : ''}. Use dex "auto" to take the best route that answered.`, {
			routes: cmp.routes.map((x) => ({ aggregator: x.aggregator, net_out: x.net_out })),
			unavailable: cmp.unavailable,
		});
	}

	const execution = await executionPreview({ ctx, agent, address, userId, inputMint, outputMint, amountRaw, slippageBps, outDecimals, inDecimals, rows, cmp, feeBps });
	return { ...base, ...execution };
}

/**
 * Whether this quote can be filled from the agent wallet, the guard chain's
 * verdict, the confirmation table, and the signed quote_id.
 */
async function executionPreview({ agent, address, userId, inputMint, outputMint, amountRaw, slippageBps, inDecimals, outDecimals, rows, cmp, feeBps }) {
	const notReady = (reason, code) => ({ executable: false, execution: { code, reason }, quote_id: null });
	if (!agent) {
		return notReady('Pass agent_id to fill this from one of your agent wallets. Without it this is a price comparison only.', 'no_agent');
	}
	const sided = custodialSide(inputMint, outputMint);
	if (!sided) {
		return notReady('Agent-wallet swaps keep SOL on one side, because the spend guards meter in SOL. Swap through SOL in two steps.', 'unsupported_pair');
	}
	if (!address || !agent.meta?.encrypted_solana_secret) {
		return notReady('This agent has no signable Solana wallet yet. Create one with provision_wallet, fund it, then quote again.', 'no_wallet');
	}

	const selectedRow = rows.find((r) => r.status === 'ok' && r.aggregator === cmp.selected.aggregator);
	const impactPct = breakerImpact(selectedRow, rows);
	if (impactPct == null) {
		return notReady('No router reported a price impact for this trade, so the price-impact breaker cannot judge it. Pick another dex.', 'impact_unknown');
	}
	const tokenDec = sided.side === 'buy' ? outDecimals : inDecimals;
	const parsed = parseTradeRequest({ ...tradeBody({ side: sided.side, mint: sided.mint, amountRaw, slippageBps }), preview: true });
	if (!parsed.ok) throw refuse(400, 'invalid_parameter', parsed.message);
	const guard = await runAgentTrade({
		agentId: agent.id, userId, meta: agent.meta, address,
		encryptedSecret: agent.meta.encrypted_solana_secret,
		parsed, ownerInitiated: false,
		executor: staticExecutor(selectedRow, { side: sided.side, tokenDecimals: tokenDec, impactPct }),
	});
	if (guard.error) throw refuse(guard.status, guard.error.code, guard.error.message, guard.error.detail);
	const g = guard.data;
	const blockers = [g.guard, g.funds].filter(Boolean).map((w) => ({ code: w.code, message: w.message }));

	const sel = cmp.selected;
	const pin = {
		userId, agentId: agent.id, aggregator: sel.aggregator, side: sided.side, mint: sided.mint,
		inputMint, outputMint, amountRaw, slippageBps, outRaw: sel.out_amount_raw, minOutRaw: sel.min_out_raw,
		tokenDecimals: tokenDec, impactPct, feeBps, issuedAt: Date.now(),
	};
	const issued = issuePreview('swap', pin, { prefix: 'q' });
	return {
		executable: blockers.length === 0,
		execution: blockers.length ? { code: blockers[0].code, reason: blockers[0].message, blocked_by: blockers } : null,
		guards: {
			price_impact_pct: g.price_impact_pct,
			usd: g.usd,
			wallet_balance_sol: g.wallet_balance_sol,
			firewall: g.firewall,
			blocked_by: blockers,
		},
		confirmation: {
			action: 'swap',
			chain: 'solana',
			network: 'mainnet',
			wallet: address,
			recipient: `${address} (the agent wallet itself)`,
			agent: { id: agent.id, name: agent.name },
			pay: { mint: inputMint, amount: ui(amountRaw, inDecimals), amount_raw: amountRaw },
			receive_expected: { mint: outputMint, amount: sel.out_amount, amount_raw: sel.out_amount_raw },
			receive_at_least: { mint: outputMint, amount: sel.min_out, amount_raw: sel.min_out_raw },
			via: sel.aggregator,
			route: sel.route,
			slippage_bps: slippageBps,
			three_ws_fee_bps: feeBps,
			network_fee_lamports: sel.costs.network_fee_lamports,
		},
		quote_id: issued.id,
		expires_at: new Date(pin.issuedAt + SWAP_QUOTE_TTL_MS).toISOString(),
	};
}

// ── swap_execute ─────────────────────────────────────────────────────────────

async function custodyClaimed(agentId, key) {
	const rows = await sql`
		SELECT 1 FROM agent_custody_events WHERE agent_id = ${agentId} AND idempotency_key = ${key} LIMIT 1
	`.catch(() => [{}]);
	return rows.length > 0;
}

function unconfirmed(detail) {
	return {
		chain: 'solana',
		network: 'mainnet',
		status: 'submitted_unconfirmed',
		signature: detail?.signature ?? null,
		explorer: detail?.explorer ?? null,
		custody_event_id: detail?.custody_event_id ?? null,
		message: 'The swap was submitted but not confirmed in time. Check the explorer link before trying again; do not re-quote and resend blindly.',
	};
}

/**
 * Fill a quote from the agent wallet. `dry_run: true` runs every guard, builds
 * the exact transaction and simulates it on chain without signing, spending
 * the quote, or writing the custody ledger.
 * @param {{ quote_id: string, confirm_swap?: boolean, dry_run?: boolean }} args
 * @param {{ principal: object, req?: object }} ctx
 */
export async function swapExecute(args, ctx) {
	const userId = requireUser(ctx);
	const dryRun = args.dry_run === true;
	requireScope(ctx, dryRun ? 'wallet:read' : 'wallet:trade');
	if (!dryRun) requireConfirm(args, 'confirm_swap', 'swap_quote', 'swap_execute');

	const { claims: pin, nonce } = verifyPreview(args.quote_id, 'swap', { userId });
	const age = Date.now() - Number(pin.issuedAt);
	if (!(age >= 0 && age <= SWAP_QUOTE_TTL_MS)) {
		throw refuse(410, 'quote_expired', 'This quote is more than five minutes old. Call swap_quote again and confirm the fresh result.');
	}
	const agent = await loadOwnedAgent(ctx, pin.agentId);
	const address = agent.meta.solana_address;
	if (!address || !agent.meta.encrypted_solana_secret) {
		throw refuse(409, 'no_wallet', 'This agent no longer has a signable Solana wallet.');
	}
	try {
		new PublicKey(address);
	} catch {
		throw refuse(409, 'wallet_preparing', 'This agent\'s wallet is still being prepared; try again in a moment.');
	}
	if (!dryRun) await requireAgreement(ctx, 'mainnet');

	const parsed = parseTradeRequest({
		...tradeBody(pin),
		idempotency_key: `swapq:${nonce}`,
	});
	if (!parsed.ok) throw refuse(400, 'invalid_parameter', parsed.message);

	const release = dryRun ? null : await consumePreview(nonce);
	let r;
	try {
		r = await runAgentTrade({
			agentId: agent.id, userId, meta: agent.meta, address,
			encryptedSecret: agent.meta.encrypted_solana_secret,
			parsed, req: ctx.req || null, ownerInitiated: false,
			executor: pinnedExecutor(pin, { userAddress: address }),
			simulate: dryRun,
		});
	} catch (err) {
		if (release) await release().catch(() => {});
		throw err;
	}
	if (r.error) {
		if (r.error.code === 'trade_unconfirmed') return { ...unconfirmed(r.error.detail), agent_id: agent.id, wallet: address, via: pin.aggregator };
		// Refused before the executor claimed its custody row (the price moved, a
		// guard said no, the wallet is short): the quote stays spendable while it
		// is fresh, so the owner can fix the cause and confirm it again.
		if (release && !(await custodyClaimed(agent.id, parsed.idempotencyKey))) await release().catch(() => {});
		throw refuse(r.status, r.error.code, r.error.message, r.error.detail ?? null);
	}

	const d = r.data;
	const out = {
		chain: 'solana',
		network: 'mainnet',
		agent_id: agent.id,
		wallet: address,
		via: pin.aggregator,
		side: pin.side,
		in: d.in,
		expected_out: d.out,
		min_received: d.min_received,
		approved_min_out_raw: pin.minOutRaw,
		price_impact_pct: d.price_impact_pct,
		three_ws_fee_bps: d.platform_fee_bps,
		usd: d.usd,
	};
	if (dryRun) {
		return {
			...out,
			status: d.err ? 'would_fail' : 'would_succeed',
			simulated: true,
			simulation: { err: d.err, units_consumed: d.units_consumed, logs_tail: d.logs_tail },
			quote_id_still_valid: true,
		};
	}
	return {
		...out,
		status: 'confirmed',
		replayed: Boolean(d.replayed),
		signature: d.signature,
		explorer: d.explorer,
		custody_event_id: d.custody_event_id ?? null,
		new_balance_sol: d.new_balance_sol ?? null,
		execution: d.execution ?? null,
	};
}
