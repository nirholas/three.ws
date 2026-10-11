// Swap route comparison across independent Solana aggregators.
//
// swap_quote never trusts one router's word that its route is the best. It
// prices the same trade on every aggregator below in parallel, normalizes each
// answer to one shape, deducts every fee that changes what the wallet ends up
// with, and ranks the routes by that net output. The caller sees every route,
// the winner, and the plain-language reasons it won.
//
// Aggregators (ids are what the `dex` argument takes):
//
//   jupiter   the platform's default Solana router (lite-api), also the engine
//             behind `dex:<label>`, which pins one DEX the router reports
//   lifi      LI.FI's Solana same-chain router. Its fixed fee is deducted from
//             the input before the swap and is reported as a line item.
//             LIFI_API_KEY (optional) lifts the keyless rate limit.
//   raydium   Raydium's own trade API, routing Raydium pools only
//
// Every adapter answers `quote()` with a RouteQuote and `build()` with an
// unsigned base64 transaction for the agent wallet. build() output is checked
// and decompiled into plain instructions (see decompileRouteTx) so the guarded
// executor sets its own compute budget, appends the three.ws fee, and signs.
//
// Net output, the ranking key, is measured in the output token:
//   - output is SOL: router output minus the three.ws fee and the network fee
//   - input is SOL:  router output scaled by in / (in + three.ws fee + network
//                    fee), the output per SOL actually spent
//   - neither side SOL: router output (the SOL-denominated costs are listed)
// Provider fees that the router already took out of its quoted output (or
// input) are listed but never deducted twice. Refundable rent deposits for new
// token accounts are listed separately and not ranked on, because every route
// needs the same account.

import { Keypair, PublicKey, TransactionMessage, VersionedTransaction } from '@solana/web3.js';
import { getAssociatedTokenAddressSync } from '@solana/spl-token';

import { jupiterQuote, jupiterSwapTx } from '../token/jupiter.js';
import { fetchUpstream } from '../upstream-fetch.js';
import { cacheWrap } from '../cache.js';
import { resolveTokenProgramForMintOwner } from '../pump-trade-args.js';
import { LEG_FEE_LAMPORTS } from './arbitrage.js';
import { ToolInputError, WSOL_MINT } from './market.js';

export const SWAP_AGGREGATORS = Object.freeze(['jupiter', 'lifi', 'raydium']);
export const SWAP_DEX_CHOICES = Object.freeze(['auto', ...SWAP_AGGREGATORS]);

const DEX_PREFIX = 'dex:';
const LABEL_RE = /^[\w .+()'-]{1,64}$/;
const QUOTE_TIMEOUT_MS = 8_000;
const BUILD_TIMEOUT_MS = 12_000;
const LIFI_BASE = 'https://li.quest/v1';
const LIFI_SOLANA = 'SOL';
const RAYDIUM_BASE = 'https://transaction-v1.raydium.io';
// LI.FI names native SOL by the system program address.
const LIFI_NATIVE_SOL = '11111111111111111111111111111111';
// LI.FI needs a sender to price a comparison quote with no agent wallet, and
// refuses the system program as one. A throwaway public key per process prices
// the route without naming any real wallet; its secret key is never used.
let quoteOnlySender = null;
const quoteOnlySenderAddress = () => (quoteOnlySender ??= Keypair.generate().publicKey.toBase58());

/** A route-level failure: carries a status the comparison reports instead of throwing. */
class RouteError extends Error {
	constructor(status, message) {
		super(message);
		this.routeStatus = status;
	}
}

const pct = (v, scale = 1) => {
	const n = Number(v);
	return Number.isFinite(n) ? Math.max(0, n * scale) : null;
};

async function fetchRouteJson(name, url, init, timeoutMs) {
	let res;
	try {
		res = await fetchUpstream(url, init, { name: `swap-${name}`, timeoutMs, attempts: 1, okWhen: (r) => r.status < 500 && r.status !== 429 });
	} catch (err) {
		if (Number(err?.status) === 429) throw new RouteError('rate_limited', 'rate limiting quotes right now');
		throw new RouteError('unavailable', 'did not answer in time');
	}
	const body = await res.json().catch(() => null);
	if (res.status === 429) throw new RouteError('rate_limited', 'rate limiting quotes right now');
	return { status: res.status, ok: res.ok, body };
}

// ── jupiter ──────────────────────────────────────────────────────────────────

async function jupiterRoute({ inputMint, outputMint, amountRaw, slippageBps, dexLabel = null }) {
	let q;
	try {
		q = await jupiterQuote({
			inputMint, outputMint, amount: String(amountRaw), slippageBps,
			dexes: dexLabel ? [dexLabel] : null,
			onlyDirectRoutes: Boolean(dexLabel),
		});
	} catch (err) {
		const s = Number(err?.status);
		if (s === 400 || s === 404) throw new RouteError('no_route', 'no route for this pair at this size');
		if (s === 429) throw new RouteError('rate_limited', 'rate limiting quotes right now');
		throw new RouteError('unavailable', 'could not be reached');
	}
	return normalizeJupiter(q, { amountRaw, slippageBps, dexLabel });
}

/** Normalize a Jupiter quote body. Pure, exported for the recorded-quote tests. */
export function normalizeJupiter(q, { amountRaw, slippageBps, dexLabel = null }) {
	if (!q?.outAmount) throw new RouteError('no_route', 'no route for this pair at this size');
	const labels = (q.routePlan || []).map((r) => r?.swapInfo?.label).filter(Boolean);
	return {
		aggregator: dexLabel ? `${DEX_PREFIX}${dexLabel}` : 'jupiter',
		in_amount_raw: String(q.inAmount ?? amountRaw),
		out_amount_raw: String(q.outAmount),
		min_out_raw: String(q.otherAmountThreshold ?? q.outAmount),
		slippage_bps: Number(q.slippageBps ?? slippageBps),
		price_impact_pct: pct(q.priceImpactPct, 100),
		impact_source: 'reported',
		route: labels,
		provider_fees: [],
		deposits_lamports: 0,
		raw: q,
	};
}

async function jupiterBuild({ raw, userAddress }) {
	try {
		return [await jupiterSwapTx({ quote: raw, userPublicKey: userAddress, wrapAndUnwrapSol: true })];
	} catch {
		throw new RouteError('unavailable', 'jupiter could not build this route right now');
	}
}

// ── lifi ─────────────────────────────────────────────────────────────────────

function lifiHeaders() {
	const key = process.env.LIFI_API_KEY?.trim();
	return { accept: 'application/json', ...(key ? { 'x-lifi-api-key': key } : {}) };
}

// LI.FI names native SOL by the system program address; the wrapped SOL mint
// there means an SPL balance the agent wallet does not hold.
const lifiToken = (mint) => (mint === WSOL_MINT ? LIFI_NATIVE_SOL : mint);

/** Normalize a LI.FI quote body. Pure, exported for the recorded-quote tests. */
export function normalizeLifi(body, { amountRaw, slippageBps }) {
	const e = body?.estimate;
	if (!e?.toAmount) throw new RouteError('no_route', body?.message ? String(body.message).slice(0, 160) : 'no route for this pair at this size');
	const fees = Array.isArray(e.feeCosts) ? e.feeCosts : [];
	const providerFees = fees
		.filter((f) => f.included !== false)
		.map((f) => ({
			name: String(f.name || 'fee'),
			amount_raw: String(f.amount ?? '0'),
			mint: f.token?.address === LIFI_NATIVE_SOL ? WSOL_MINT : f.token?.address || null,
			pct: f.percentage != null ? Number(f.percentage) * 100 : null,
			usd: f.amountUSD != null ? Number(f.amountUSD) : null,
			already_deducted: true,
		}));
	const deposits = fees
		.filter((f) => f.included === false && /rent/i.test(String(f.name || '')))
		.reduce((s, f) => s + Number(f.amount || 0), 0);
	const fromUsd = Number(e.fromAmountUSD);
	const toUsd = Number(e.toAmountUSD);
	const feeUsd = providerFees.reduce((s, f) => s + (f.usd || 0), 0);
	// LI.FI reports no impact figure; derive one from its own USD valuation of
	// both sides, net of the fees it charged, so it is comparable in spirit.
	const impact = fromUsd > 0 && Number.isFinite(toUsd) ? Math.max(0, ((fromUsd - feeUsd - toUsd) / fromUsd) * 100) : null;
	const steps = Array.isArray(body.includedSteps) ? body.includedSteps : [];
	return {
		aggregator: 'lifi',
		in_amount_raw: String(e.fromAmount ?? amountRaw),
		out_amount_raw: String(e.toAmount),
		min_out_raw: String(e.toAmountMin ?? e.toAmount),
		slippage_bps: slippageBps,
		price_impact_pct: impact,
		impact_source: impact == null ? 'unreported' : 'derived_from_usd_values',
		route: steps.filter((s) => s.type === 'swap').map((s) => s.toolDetails?.name || s.tool).filter(Boolean),
		provider_fees: providerFees,
		deposits_lamports: deposits,
		raw: { tx: body.transactionRequest?.data || null, id: body.id || null },
	};
}

async function lifiRoute({ inputMint, outputMint, amountRaw, slippageBps, userAddress }) {
	const u = new URL(`${LIFI_BASE}/quote`);
	u.searchParams.set('fromChain', LIFI_SOLANA);
	u.searchParams.set('toChain', LIFI_SOLANA);
	u.searchParams.set('fromToken', lifiToken(inputMint));
	u.searchParams.set('toToken', lifiToken(outputMint));
	u.searchParams.set('fromAmount', String(amountRaw));
	u.searchParams.set('fromAddress', userAddress || quoteOnlySenderAddress());
	u.searchParams.set('slippage', String(slippageBps / 10_000));
	const { ok, status, body } = await fetchRouteJson('lifi', u.toString(), { headers: lifiHeaders() }, QUOTE_TIMEOUT_MS);
	if (!ok) {
		if (status === 404 || status === 400) throw new RouteError('no_route', body?.message ? String(body.message).slice(0, 160) : 'no route for this pair at this size');
		throw new RouteError('unavailable', `answered HTTP ${status}`);
	}
	return normalizeLifi(body, { amountRaw, slippageBps });
}

async function lifiBuild({ raw }) {
	if (!raw?.tx) throw new RouteError('unavailable', 'lifi returned no transaction for this route');
	return [raw.tx];
}

// ── raydium ──────────────────────────────────────────────────────────────────

/** Normalize a Raydium compute body. Pure, exported for the recorded-quote tests. */
export function normalizeRaydium(body, { amountRaw, slippageBps }) {
	if (!body?.success || !body.data?.outputAmount) {
		const msg = String(body?.msg || 'no route');
		throw new RouteError('no_route', msg === 'INSUFFICIENT_LIQUIDITY' ? 'no Raydium pool with enough liquidity for this pair' : msg.slice(0, 160).toLowerCase());
	}
	const d = body.data;
	return {
		aggregator: 'raydium',
		in_amount_raw: String(d.inputAmount ?? amountRaw),
		out_amount_raw: String(d.outputAmount),
		min_out_raw: String(d.otherAmountThreshold ?? d.outputAmount),
		slippage_bps: Number(d.slippageBps ?? slippageBps),
		// Raydium reports impact already in percent.
		price_impact_pct: pct(d.priceImpactPct),
		impact_source: 'reported',
		route: (d.routePlan || []).map((p) => `raydium:${String(p.poolId || '').slice(0, 6)}`),
		// Pool fees are already inside outputAmount; listed for transparency.
		provider_fees: (d.routePlan || []).map((p) => ({
			name: 'Raydium pool fee',
			amount_raw: String(p.feeAmount ?? '0'),
			mint: p.feeMint || null,
			pct: p.feeRate != null ? Number(p.feeRate) / 100 : null,
			usd: null,
			already_deducted: true,
		})),
		deposits_lamports: 0,
		raw: body,
	};
}

async function raydiumRoute({ inputMint, outputMint, amountRaw, slippageBps }) {
	const u = new URL(`${RAYDIUM_BASE}/compute/swap-base-in`);
	u.searchParams.set('inputMint', inputMint);
	u.searchParams.set('outputMint', outputMint);
	u.searchParams.set('amount', String(amountRaw));
	u.searchParams.set('slippageBps', String(slippageBps));
	u.searchParams.set('txVersion', 'V0');
	const { ok, status, body } = await fetchRouteJson('raydium', u.toString(), { headers: { accept: 'application/json' } }, QUOTE_TIMEOUT_MS);
	if (!ok && !body) throw new RouteError('unavailable', `answered HTTP ${status}`);
	return normalizeRaydium(body, { amountRaw, slippageBps });
}

async function raydiumBuild({ raw, userAddress, conn }) {
	const d = raw?.data;
	if (!d) throw new RouteError('unavailable', 'raydium returned no route to build');
	const inputIsSol = d.inputMint === WSOL_MINT;
	const outputIsSol = d.outputMint === WSOL_MINT;
	let inputAccount;
	if (!inputIsSol) {
		const info = await conn.getAccountInfo(new PublicKey(d.inputMint));
		if (!info) throw new RouteError('no_route', 'the input mint does not exist on mainnet');
		const program = resolveTokenProgramForMintOwner(info.owner);
		inputAccount = getAssociatedTokenAddressSync(new PublicKey(d.inputMint), new PublicKey(userAddress), false, program).toBase58();
	}
	const { ok, status, body } = await fetchRouteJson('raydium', `${RAYDIUM_BASE}/transaction/swap-base-in`, {
		method: 'POST',
		headers: { accept: 'application/json', 'content-type': 'application/json' },
		body: JSON.stringify({
			// The protected sender replaces the compute budget, so this value never lands.
			computeUnitPriceMicroLamports: '1',
			swapResponse: raw,
			txVersion: 'V0',
			wallet: userAddress,
			wrapSol: inputIsSol,
			unwrapSol: outputIsSol,
			...(inputAccount ? { inputAccount } : {}),
		}),
	}, BUILD_TIMEOUT_MS);
	if (!ok || !body?.success) throw new RouteError('unavailable', `raydium could not build this route (${body?.msg || status})`);
	return (body.data || []).map((t) => t.transaction).filter(Boolean);
}

// ── registry ─────────────────────────────────────────────────────────────────

const ADAPTERS = {
	jupiter: { quote: (a) => jupiterRoute(a), build: jupiterBuild },
	lifi: { quote: (a) => lifiRoute(a), build: lifiBuild },
	raydium: { quote: (a) => raydiumRoute(a), build: raydiumBuild },
};

/** Validate the `dex` argument. Returns { choice, aggregator, dexLabel }. */
export function parseDexChoice(dex = 'auto') {
	const v = String(dex ?? 'auto').trim() || 'auto';
	if (SWAP_DEX_CHOICES.includes(v)) return { choice: v, aggregator: v === 'auto' ? null : v, dexLabel: null };
	if (v.startsWith(DEX_PREFIX) && LABEL_RE.test(v.slice(DEX_PREFIX.length))) {
		return { choice: v, aggregator: 'jupiter', dexLabel: v.slice(DEX_PREFIX.length) };
	}
	throw new ToolInputError('invalid_dex', `dex must be one of ${SWAP_DEX_CHOICES.join(', ')}, or dex:<label> with a venue label arbitrage_prices returned.`, { dex: v });
}

/** Quote one aggregator. Never throws for a route-level failure; returns a status row. */
export async function quoteRoute(aggregator, args) {
	const dexLabel = aggregator.startsWith(DEX_PREFIX) ? aggregator.slice(DEX_PREFIX.length) : null;
	const adapter = ADAPTERS[dexLabel ? 'jupiter' : aggregator];
	if (!adapter) return { aggregator, status: 'unavailable', reason: 'unknown aggregator' };
	const started = Date.now();
	try {
		const key = `tt:swap:v1:${aggregator}:${args.inputMint}:${args.outputMint}:${args.amountRaw}:${args.slippageBps}:${args.userAddress || '-'}`;
		// A short cache absorbs a burst of identical quotes (a UI and an agent
		// asking at once) without ever serving a price older than a few seconds.
		const q = args.fresh
			? await adapter.quote({ ...args, dexLabel })
			: await cacheWrap(key, 5, () => adapter.quote({ ...args, dexLabel }));
		return { ...q, status: 'ok', latency_ms: Date.now() - started };
	} catch (err) {
		if (err instanceof RouteError) return { aggregator, status: err.routeStatus, reason: err.message, latency_ms: Date.now() - started };
		return { aggregator, status: 'unavailable', reason: 'quote failed unexpectedly', latency_ms: Date.now() - started };
	}
}

/**
 * Net output of one route in output-token base units, plus the cost lines
 * that produced it. Pure, exported for the recorded-quote tests.
 * @param {object} route   an ok RouteQuote
 * @param {{ inputMint: string, outputMint: string, feeBps: number, networkLamports?: number }} ctx
 */
export function netOutcome(route, { inputMint, outputMint, feeBps, networkLamports = LEG_FEE_LAMPORTS }) {
	const out = BigInt(route.out_amount_raw);
	const inRaw = BigInt(route.in_amount_raw);
	const bps = BigInt(Math.max(0, Math.floor(feeBps || 0)));
	const network = BigInt(networkLamports);
	let platformFee = 0n;
	let net;
	let basis;
	if (outputMint === WSOL_MINT) {
		platformFee = (out * bps) / 10_000n;
		net = out - platformFee - network;
		basis = 'router output minus the three.ws fee and the network fee, in SOL';
	} else if (inputMint === WSOL_MINT) {
		platformFee = (inRaw * bps) / 10_000n;
		const outlay = inRaw + platformFee + network;
		net = outlay > 0n ? (out * inRaw) / outlay : 0n;
		basis = 'router output scaled to the SOL actually spent (input plus the three.ws fee and the network fee)';
	} else {
		net = out;
		basis = 'router output; the network fee is paid in SOL and listed separately';
	}
	return {
		net_out_raw: (net > 0n ? net : 0n).toString(),
		costs: {
			three_ws_fee_bps: Number(bps),
			three_ws_fee_raw: platformFee.toString(),
			three_ws_fee_mint: outputMint === WSOL_MINT || inputMint === WSOL_MINT ? WSOL_MINT : null,
			network_fee_lamports: Number(network),
			provider_fees: route.provider_fees || [],
			refundable_deposits_lamports: route.deposits_lamports || 0,
		},
		basis,
	};
}

function bpsBetween(a, b) {
	const x = Number(a);
	const y = Number(b);
	// Hundredths of a bp: close routes often differ by less than one.
	return y > 0 ? Math.round(((x - y) / y) * 1_000_000) / 100 : null;
}

/**
 * Rank priced routes by net output and explain the result. Pure, exported for
 * the recorded-quote tests.
 * @param {object[]} routes  quoteRoute() rows (ok and failed)
 * @param {{ inputMint, outputMint, feeBps, outDecimals, outSymbol, chosen?: string|null }} ctx
 */
export function compareRoutes(routes, ctx) {
	const ok = routes.filter((r) => r.status === 'ok').map((r) => ({ ...r, ...netOutcome(r, ctx) }));
	ok.sort((a, b) => {
		const d = BigInt(b.net_out_raw) - BigInt(a.net_out_raw);
		return d > 0n ? 1 : d < 0n ? -1 : (a.price_impact_pct ?? 100) - (b.price_impact_pct ?? 100);
	});
	const best = ok[0] || null;
	const ui = (raw) => Number(raw) / 10 ** ctx.outDecimals;
	const ranked = ok.map((r, i) => ({
		rank: i + 1,
		aggregator: r.aggregator,
		status: 'ok',
		route: r.route,
		in_amount_raw: r.in_amount_raw,
		out_amount_raw: r.out_amount_raw,
		out_amount: ui(r.out_amount_raw),
		min_out_raw: r.min_out_raw,
		min_out: ui(r.min_out_raw),
		net_out_raw: r.net_out_raw,
		net_out: ui(r.net_out_raw),
		vs_best_bps: best ? bpsBetween(r.net_out_raw, best.net_out_raw) : null,
		price_impact_pct: r.price_impact_pct,
		impact_source: r.impact_source,
		slippage_bps: r.slippage_bps,
		costs: r.costs,
		net_basis: r.basis,
		latency_ms: r.latency_ms,
	}));
	const failed = routes.filter((r) => r.status !== 'ok').map((r) => ({ aggregator: r.aggregator, status: r.status, reason: r.reason }));

	const chosenId = ctx.chosen || best?.aggregator || null;
	const selected = ranked.find((r) => r.aggregator === chosenId) || null;
	const why = [];
	if (best && ranked.length > 1) {
		const runner = ranked[1];
		const edge = bpsBetween(best.net_out_raw, runner.net_out_raw);
		why.push(
			edge
				? `${best.aggregator} delivers ${ui(best.net_out_raw).toPrecision(8)} ${ctx.outSymbol} net, ${edge} bps more than ${runner.aggregator} (${ui(runner.net_out_raw).toPrecision(8)}).`
				: `${best.aggregator} and ${runner.aggregator} tie at ${ui(best.net_out_raw).toPrecision(8)} ${ctx.outSymbol} net${
						(best.price_impact_pct ?? 100) < (runner.price_impact_pct ?? 100) ? `; ${best.aggregator} has the lower price impact` : ''
					}.`,
		);
		for (const r of ranked) {
			const deducted = (r.costs.provider_fees || []).filter((f) => f.name && !/pool fee/i.test(f.name));
			for (const f of deducted) {
				why.push(`${r.aggregator} charges a ${f.name}${f.pct != null ? ` of ${Number(f.pct.toFixed(4))}%` : ''}, already taken out of its quote.`);
			}
		}
		const impacts = ranked.filter((r) => r.price_impact_pct != null);
		if (impacts.length > 1) {
			const lo = impacts.reduce((m, r) => (r.price_impact_pct < m.price_impact_pct ? r : m));
			const hi = impacts.reduce((m, r) => (r.price_impact_pct > m.price_impact_pct ? r : m));
			if (hi.price_impact_pct - lo.price_impact_pct >= 0.05) {
				why.push(`Price impact ranges from ${lo.price_impact_pct.toFixed(3)}% (${lo.aggregator}) to ${hi.price_impact_pct.toFixed(3)}% (${hi.aggregator}).`);
			}
		}
	} else if (best) {
		why.push(`${best.aggregator} is the only aggregator that priced this trade.`);
	}
	for (const f of failed) why.push(`${f.aggregator}: ${f.reason}.`);
	if (ctx.chosen && selected && best && selected.aggregator !== best.aggregator) {
		why.push(`You picked ${selected.aggregator}; it returns ${Math.abs(selected.vs_best_bps)} bps less net than ${best.aggregator}.`);
	}
	return { best: best?.aggregator || null, selected, routes: ranked, unavailable: failed, why };
}

const SYSTEM_PROGRAM = '11111111111111111111111111111111';
const TOKEN_PROGRAMS = new Set(['TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA', 'TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb']);
// Rent-exempt minimum for a 165-byte SPL token account, what wrapping SOL into
// a fresh account costs on top of the amount wrapped (returned when it closes).
export const TOKEN_ACCOUNT_RENT_LAMPORTS = 2_039_280n;

/**
 * What a route may move out of the wallet besides the swap itself: the
 * provider fees it disclosed as separate charges (never pool fees, which stay
 * inside the swap program). Keyed by mint, wrapped SOL meaning lamports.
 * @param {object[]} providerFees  a route row's provider_fees
 * @returns {Map<string, bigint>}
 */
export function feeAllowance(providerFees = []) {
	const out = new Map();
	for (const f of providerFees) {
		if (!f?.mint || /pool fee/i.test(String(f.name || ''))) continue;
		if (!/^\d+$/.test(String(f.amount_raw))) continue;
		out.set(f.mint, (out.get(f.mint) || 0n) + BigInt(f.amount_raw));
	}
	return out;
}

const u64At = (data, offset) => (data.length >= offset + 8 ? Buffer.from(data).readBigUInt64LE(offset) : 0n);

/**
 * Sum what the top-level instructions move out of the owner's wallet to
 * anyone else: SOL transfers and SPL transfers the owner signs. Transfers into
 * the owner's own wrapped SOL account, into an account the same transaction
 * creates, or into a temporary token account the same transaction closes back
 * to the owner under the owner's authority (how some routers wrap the SOL they
 * swap) are the swap's own plumbing and are not counted as outflow. They are
 * summed separately as `wrapped`, so the caller can bound them by the swap's
 * input. Pure, exported for the tests.
 * @param {object[]} instructions  decompiled TransactionInstructions
 * @param {{ ownerPk: PublicKey, inputMint: string }} ctx
 * @returns {{ lamports: bigint, tokens: Map<string, bigint>, destinations: string[], wrapped: bigint, wrappedAccounts: string[] }}
 */
export function walletOutflows(instructions, { ownerPk, inputMint }) {
	const owner = ownerPk.toBase58();
	const own = new Set([owner, getAssociatedTokenAddressSync(new PublicKey(WSOL_MINT), ownerPk, false).toBase58()]);
	for (const ix of instructions) {
		const program = ix.programId.toBase58();
		if (program === SYSTEM_PROGRAM && ix.data.length >= 4) {
			const kind = Buffer.from(ix.data).readUInt32LE(0);
			// CreateAccount (0) and CreateAccountWithSeed (3) fund a new account at keys[1].
			if ((kind === 0 || kind === 3) && ix.keys[1]) own.add(ix.keys[1].pubkey.toBase58());
		} else if (TOKEN_PROGRAMS.has(program) && ix.data[0] === 9) {
			// CloseAccount (9): [account, destination, authority]. Closed back to the
			// owner by the owner, so every lamport left in it returns to the wallet;
			// if the owner were not its authority the whole transaction would fail.
			const [account, destination, authority] = ix.keys.map((k) => k.pubkey.toBase58());
			if (account && destination === owner && authority === owner) own.add(account);
		}
	}
	let lamports = 0n;
	let wrapped = 0n;
	const wrappedAccounts = new Set();
	const tokens = new Map();
	const destinations = [];
	for (const ix of instructions) {
		const program = ix.programId.toBase58();
		const data = ix.data;
		if (program === SYSTEM_PROGRAM && data.length >= 12) {
			const kind = Buffer.from(data).readUInt32LE(0);
			// Transfer (2) and TransferWithSeed (11) both carry lamports at offset 4.
			if (kind !== 2 && kind !== 11) continue;
			const from = ix.keys[0]?.pubkey.toBase58();
			const to = ix.keys[kind === 2 ? 1 : 2]?.pubkey.toBase58();
			if (from !== owner || !to) continue;
			if (!own.has(to)) {
				lamports += u64At(data, 4);
				destinations.push(to);
			} else if (to !== owner) {
				wrapped += u64At(data, 4);
				wrappedAccounts.add(to);
			}
		} else if (TOKEN_PROGRAMS.has(program) && data.length >= 9) {
			const kind = data[0];
			// Transfer (3): [source, destination, authority]; TransferChecked (12): [source, mint, destination, authority].
			if (kind !== 3 && kind !== 12) continue;
			const authority = ix.keys[kind === 3 ? 2 : 3]?.pubkey.toBase58();
			const to = ix.keys[kind === 3 ? 1 : 2]?.pubkey.toBase58();
			if (authority !== owner || !to || own.has(to)) continue;
			const mint = kind === 12 ? ix.keys[1]?.pubkey.toBase58() : inputMint;
			tokens.set(mint, (tokens.get(mint) || 0n) + u64At(data, 1));
			destinations.push(to);
		}
	}
	return { lamports, tokens, destinations, wrapped, wrappedAccounts: [...wrappedAccounts] };
}

/**
 * Check, decompile and flatten a router's unsigned transaction(s) into plain
 * instructions plus lookup tables for the agent wallet. Refuses anything that
 * would need a second signer, pays from a different wallet, or moves more out
 * of the wallet than the swap and the fees the route disclosed. With
 * inAmountRaw, SOL parked in the wallet's own wrapping accounts is also capped
 * at the swap's input (when it spends SOL) plus one token account's rent per
 * account, so a router cannot wrap more than the trade it quoted.
 * @param {string[]} b64List
 * @param {{ conn: object, ownerPk: PublicKey, inputMint: string, providerFees?: object[], inAmountRaw?: string }} ctx
 */
export async function decompileRouteTx(b64List, { conn, ownerPk, inputMint, providerFees = [], inAmountRaw = null }) {
	if (!Array.isArray(b64List) || b64List.length !== 1) {
		throw Object.assign(new Error('this route needs more than one transaction; pick another aggregator'), { status: 422, code: 'multi_tx_route' });
	}
	const tx = VersionedTransaction.deserialize(Buffer.from(b64List[0], 'base64'));
	const header = tx.message.header;
	const payer = tx.message.staticAccountKeys[0];
	if (header.numRequiredSignatures !== 1 || !payer.equals(ownerPk)) {
		throw Object.assign(new Error('the router built a transaction that is not signed by the agent wallet alone; nothing was sent'), { status: 422, code: 'unexpected_signer' });
	}
	const addressLookupTables = [];
	for (const l of tx.message.addressTableLookups || []) {
		const res = await conn.getAddressLookupTable(new PublicKey(l.accountKey));
		if (!res?.value) throw Object.assign(new Error('an address lookup table for this route could not be read'), { status: 502, code: 'build_failed' });
		addressLookupTables.push(res.value);
	}
	const message = TransactionMessage.decompile(tx.message, { addressLookupTableAccounts: addressLookupTables });

	const allowed = feeAllowance(providerFees);
	const flows = walletOutflows(message.instructions, { ownerPk, inputMint });
	const over = [];
	if (flows.lamports > (allowed.get(WSOL_MINT) || 0n)) over.push({ asset: 'SOL', moved: flows.lamports.toString(), disclosed: (allowed.get(WSOL_MINT) || 0n).toString() });
	for (const [mint, amount] of flows.tokens) {
		if (amount > (allowed.get(mint) || 0n)) over.push({ asset: mint, moved: amount.toString(), disclosed: (allowed.get(mint) || 0n).toString() });
	}
	if (inAmountRaw != null && /^\d+$/.test(String(inAmountRaw))) {
		const swapIn = inputMint === WSOL_MINT ? BigInt(inAmountRaw) : 0n;
		const cap = swapIn + TOKEN_ACCOUNT_RENT_LAMPORTS * BigInt(flows.wrappedAccounts.length);
		if (flows.wrapped > cap) over.push({ asset: 'SOL (wrapped)', moved: flows.wrapped.toString(), disclosed: cap.toString() });
	}
	if (over.length) {
		throw Object.assign(new Error('the router built a transaction that moves more out of the wallet than the swap and its disclosed fees; nothing was sent'), {
			status: 422, code: 'unexpected_transfer', detail: { over, destinations: flows.destinations },
		});
	}
	return { instructions: message.instructions, addressLookupTables };
}

/** Build the unsigned transaction(s) for an ok route. */
export async function buildRoute(aggregator, { raw, userAddress, conn }) {
	const key = aggregator.startsWith(DEX_PREFIX) ? 'jupiter' : aggregator;
	const adapter = ADAPTERS[key];
	if (!adapter) throw Object.assign(new Error('unknown aggregator'), { status: 422, code: 'invalid_dex' });
	try {
		return await adapter.build({ raw, userAddress, conn });
	} catch (err) {
		if (err instanceof RouteError) throw Object.assign(new Error(err.message), { status: 502, code: 'build_failed' });
		throw err;
	}
}
