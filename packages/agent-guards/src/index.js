// @three-ws/agent-guards — safety rails for autonomous agents.
//
// Two complementary surfaces:
//   (a) LOCAL, pure-function guards — `policy({...})` builds a normalized leash and
//       `guard(tx, policy)` → { allow, reason, message, detail } re-implements the
//       real server spend-policy / trade-guard checks client-side. Deterministic,
//       zero-dep, ideal to run BEFORE you sign a transaction.
//   (b) A `createGuards({ baseUrl, fetch, ... })` client that wraps the live
//       /api/agents/:id/trade(+/limits) and /api/agents/:id/wallet/limits endpoints.
//
// The local checks mirror api/_lib/agent-trade-guards.js and
// api/_lib/agent-spend-policy.js field-for-field, reason-for-reason, so a leash
// you enforce client-side never disagrees with the one the platform enforces.
// All trading is SOL-quoted on Solana; the only coin three.ws promotes is $THREE.

import { createHttp, ThreeWsError } from './http.js';

export { ThreeWsError, PaymentRequiredError, DEFAULT_BASE_URL } from './http.js';
export {
	DELEGATION_DOMAIN,
	canonicalDelegationFields,
	delegationMessage,
	verifyDelegationSignature,
	checkDelegationCap,
} from './delegation.js';

// 1 SOL = 1e9 lamports — the on-chain unit the per-trade / daily-budget caps use.
export const LAMPORTS_PER_SOL = 1_000_000_000n;

// Fee + rent headroom kept above a buy so it never fails for lack of lamports to
// pay the network fee / open the token ATA. Mirrors SOL_FEE_HEADROOM_LAMPORTS in
// api/_lib/agent-trade-guards.js (~0.003 SOL).
export const SOL_FEE_HEADROOM_LAMPORTS = 3_000_000n;

// Server-side TRADE_LIMIT_DEFAULTS — the discretionary-trade policy applied when
// an owner has not set one. null caps mean "uncapped".
export const TRADE_LIMIT_DEFAULTS = Object.freeze({
	per_trade_sol: null,
	daily_budget_sol: null,
	max_price_impact_pct: 15,
	max_slippage_bps: 1000,
	max_concurrent: null,
	kill_switch: false,
});

// Server-side SPEND_LIMIT_DEFAULTS — the cross-path USD ceiling applied when an
// owner has not set one.
export const SPEND_LIMIT_DEFAULTS = Object.freeze({
	daily_usd: null,
	per_tx_usd: null,
	withdraw_allowlist: [],
	frozen: false,
});

// Base58 alphabet, 32–44 chars — every ed25519 pubkey. A cheap, dependency-free
// pre-filter mirroring BASE58_RE in agent-trade-guards.js (we don't run the full
// PublicKey curve check client-side, but the shape gate catches obvious garbage).
const BASE58_RE = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;
const MAX_ALLOWLIST = 50;

// ── local policy builder ──────────────────────────────────────────────────────

function numOrNull(v) {
	if (v === null || v === undefined || v === '') return null;
	const n = Number(v);
	if (!Number.isFinite(n) || n < 0) return null;
	return n;
}

function clampNum(v, def, { min = 0, max = Infinity, round = false } = {}) {
	const n = Number(v);
	if (!Number.isFinite(n) || n < min) return def;
	const c = Math.min(max, n);
	return round ? Math.round(c) : c;
}

function normalizeAllowlist(raw) {
	const list = (Array.isArray(raw) ? raw : [])
		.map((a) => (typeof a === 'string' ? a.trim() : ''))
		.filter((a) => BASE58_RE.test(a));
	const seen = new Set();
	const out = [];
	for (const a of list) {
		if (!seen.has(a)) {
			seen.add(a);
			out.push(a);
		}
		if (out.length >= MAX_ALLOWLIST) break;
	}
	return out;
}

/**
 * Build a normalized, bounded policy from a loose patch. Mirrors the server's
 * `normalizeTradeLimits` + `normalizeSpendLimits` so the same input produces the
 * same leash whether it's applied here or on the platform: numeric caps coerce to
 * a non-negative number or null, `max_price_impact_pct` clamps 0–100,
 * `max_slippage_bps` 0–10000, `max_concurrent` 1–10000, and booleans coerce
 * strictly to `=== true`. Pass the result to `guard()`.
 */
export function policy(raw = {}) {
	const r = raw && typeof raw === 'object' ? raw : {};
	return {
		// discretionary-trade (SOL) caps — meta.trade_limits
		per_trade_sol: numOrNull(r.per_trade_sol),
		daily_budget_sol: numOrNull(r.daily_budget_sol),
		max_price_impact_pct: clampNum(r.max_price_impact_pct, TRADE_LIMIT_DEFAULTS.max_price_impact_pct, { max: 100 }),
		max_slippage_bps: clampNum(r.max_slippage_bps, TRADE_LIMIT_DEFAULTS.max_slippage_bps, { max: 10000, round: true }),
		max_concurrent: r.max_concurrent == null ? null : clampNum(r.max_concurrent, null, { min: 1, max: 10000, round: true }),
		kill_switch: r.kill_switch === true,
		// cross-path USD spend policy — meta.spend_limits
		daily_usd: numOrNull(r.daily_usd),
		per_tx_usd: numOrNull(r.per_tx_usd),
		withdraw_allowlist: normalizeAllowlist(r.withdraw_allowlist),
		frozen: r.frozen === true,
	};
}

// ── local guard predicates ────────────────────────────────────────────────────
// Each returns null when the trade clears, or { reason, detail } when blocked —
// the same shape and the same reason codes the server's guard predicates use.

function toLamports(sol) {
	// SOL → lamports without float drift on the integer part (mirrors solToLamports).
	if (sol == null) return null;
	const [whole, frac = ''] = String(sol).split('.');
	const fracPadded = (frac + '000000000').slice(0, 9);
	return BigInt(whole || '0') * LAMPORTS_PER_SOL + BigInt(fracPadded || '0');
}

function lamportsToSolStr(lamports, dp = 4) {
	const n = Number(BigInt(lamports)) / 1e9;
	return n.toFixed(dp).replace(/\.?0+$/, '') || '0';
}

/** Discretionary trading paused for this agent. */
export function checkKillSwitch(killed) {
	return killed ? { reason: 'kill_switch', detail: {} } : null;
}

/** Wallet freeze — blocks every autonomous path; owner withdraw stays open. */
export function checkFrozen(frozen, category) {
	if (frozen && category !== 'withdraw') return { reason: 'wallet_frozen', detail: { category } };
	return null;
}

/** Open-position concurrency ceiling. Blocked when openCount >= maxConcurrent. */
export function checkConcurrency(openCount, maxConcurrent) {
	if (maxConcurrent == null) return null;
	if (Number(openCount) >= Number(maxConcurrent)) {
		return { reason: 'max_positions', detail: { open: Number(openCount), max: Number(maxConcurrent) } };
	}
	return null;
}

/** Per-trade spend cap (lamports). Blocked when amount > cap. */
export function checkPerTradeCap(amountLamports, capLamports) {
	if (capLamports == null) return null;
	const amt = BigInt(amountLamports);
	const cap = BigInt(capLamports);
	if (amt > cap) {
		return { reason: 'per_trade_cap', detail: { amount_lamports: amt.toString(), cap_lamports: cap.toString() } };
	}
	return null;
}

/** Rolling daily budget (lamports). Blocked when spent + amount > budget. */
export function checkDailyBudgetLamports(spentLamports, amountLamports, budgetLamports) {
	if (budgetLamports == null) return null;
	const spent = BigInt(spentLamports);
	const amt = BigInt(amountLamports);
	const budget = BigInt(budgetLamports);
	if (spent + amt > budget) {
		return {
			reason: 'daily_budget',
			detail: { spent_lamports: spent.toString(), amount_lamports: amt.toString(), budget_lamports: budget.toString() },
		};
	}
	return null;
}

/** Wallet must cover the spend plus a fee/rent headroom. Blocked when short. */
export function checkSolHeadroom(walletLamports, spendLamports, headroomLamports = SOL_FEE_HEADROOM_LAMPORTS) {
	const wallet = BigInt(walletLamports);
	const spend = BigInt(spendLamports);
	const head = BigInt(headroomLamports);
	if (wallet < spend + head) {
		return {
			reason: 'insufficient_sol',
			detail: { wallet_lamports: wallet.toString(), required_lamports: (spend + head).toString() },
		};
	}
	return null;
}

/** Price-impact circuit breaker. Blocked when impact > max. */
export function checkPriceImpact(priceImpactPct, maxPct) {
	if (maxPct == null || priceImpactPct == null) return null;
	if (Number(priceImpactPct) > Number(maxPct)) {
		return { reason: 'price_impact', detail: { impact_pct: Number(priceImpactPct), max_pct: Number(maxPct) } };
	}
	return null;
}

/** Per-transaction USD ceiling. Blocked when usd > cap (with the server's 1e-9 slack). */
export function checkPerTxUsd(usdValue, perTxUsd, category = 'trade') {
	if (perTxUsd == null || usdValue == null) return null;
	if (Number(usdValue) > Number(perTxUsd) + 1e-9) {
		return { reason: 'per_tx_exceeded', detail: { category, usd: Number(usdValue), per_tx_usd: Number(perTxUsd) } };
	}
	return null;
}

/** Rolling daily USD ceiling. Blocked when spentUsd + usd > cap. */
export function checkDailyUsd(spentUsd, usdValue, dailyUsd, category = 'trade') {
	if (dailyUsd == null || usdValue == null) return null;
	const spent = Number(spentUsd) || 0;
	if (spent + Number(usdValue) > Number(dailyUsd) + 1e-9) {
		return {
			reason: 'daily_exceeded',
			detail: { category, usd: Number(usdValue), spent_usd: spent, daily_usd: Number(dailyUsd) },
		};
	}
	return null;
}

/** Withdraw allowlist — destination gate. Blocked when the target isn't allowed. */
export function checkAllowlist(destination, allowlist) {
	if (!Array.isArray(allowlist) || allowlist.length === 0) return null;
	const dest = typeof destination === 'string' ? destination.trim() : '';
	if (!dest || !allowlist.includes(dest)) {
		return { reason: 'destination_not_allowed', detail: { destination: dest || null, allowlist_size: allowlist.length } };
	}
	return null;
}

// Map a guard reason → an actionable, plain-language message — the same wording
// the server's GUARD_RESPONSE / SpendLimitError surface, so a UI reads identically
// whether the rejection came from here or the API.
const REASON_MESSAGE = {
	kill_switch: () => 'Trading is paused for this agent. Re-enable discretionary trading under Limits & Safety to continue.',
	wallet_frozen: () => 'This wallet is frozen. Autonomous spending (trades, snipes, payments) is paused. Unfreeze it under Limits & Safety to resume.',
	per_trade_cap: (d) => `This trade of ${lamportsToSolStr(d.amount_lamports)} SOL is over the per-trade cap of ${lamportsToSolStr(d.cap_lamports)} SOL. Lower the amount or raise the cap under Limits & Safety.`,
	daily_budget: (d) => `This trade would bring today's spend to ${lamportsToSolStr(BigInt(d.spent_lamports) + BigInt(d.amount_lamports))} SOL, over the daily budget of ${lamportsToSolStr(d.budget_lamports)} SOL. Wait for the window to roll over or raise the budget.`,
	per_tx_exceeded: (d) => `This ${d.category} is $${Number(d.usd).toFixed(2)}, over the per-transaction limit of $${Number(d.per_tx_usd).toFixed(2)}.`,
	daily_exceeded: (d) => `This ${d.category} would bring today's spend to $${(Number(d.spent_usd) + Number(d.usd)).toFixed(2)}, over the daily limit of $${Number(d.daily_usd).toFixed(2)}.`,
	max_positions: (d) => `This agent already holds ${d.open} open ${d.open === 1 ? 'trade' : 'trades'} (max ${d.max}). Close one before opening another.`,
	insufficient_sol: (d) => `The agent wallet needs about ${lamportsToSolStr(d.required_lamports)} SOL (including network fees) but holds ${lamportsToSolStr(d.wallet_lamports)}. Fund the wallet and retry.`,
	price_impact: (d) => `Price impact is ${Number(d.impact_pct).toFixed(2)}% — above the ${Number(d.max_pct).toFixed(2)}% safety breaker. Lower the trade size or raise the impact limit under Limits & Safety.`,
	destination_not_allowed: () => 'That destination is not on this agent’s withdraw allowlist. Add it under Limits & Safety, or send to an allowed address.',
};

function decision(blocked) {
	if (!blocked) return { allow: true, reason: null, message: null, detail: {} };
	const msg = REASON_MESSAGE[blocked.reason] || (() => `Trade rejected: ${blocked.reason}`);
	return { allow: false, reason: blocked.reason, message: msg(blocked.detail || {}), detail: blocked.detail || {} };
}

/**
 * Run a proposed transaction through every local guard, in the SAME order the
 * server pipeline applies them. Returns `{ allow, reason, message, detail }`.
 *
 * `tx` describes the proposed movement and the live numbers the guards compare
 * against (the caller fetches these — open count, 24h spend, wallet balance,
 * quote — exactly as the server does):
 *   side        'buy' | 'sell'                buys spend SOL; sells move SOL inward
 *   category    'trade'|'snipe'|'x402'|'withdraw'  default 'trade'
 *   amountSol   number      SOL to spend on a buy (→ per-trade + daily-budget cap)
 *   amountLamports  bigint  alternative to amountSol, in lamports
 *   priceImpactPct  number  quoted price impact (→ breaker)
 *   walletLamports  bigint  current wallet balance (→ headroom)
 *   spentLamports   bigint  rolling-24h SOL buys (→ daily SOL budget)
 *   openCount       number  open discretionary positions (→ concurrency)
 *   usdValue        number  USD-equivalent of this tx (→ per-tx + daily USD)
 *   spentUsd        number  rolling-24h USD outflow (→ daily USD)
 *   destination     string  base58 recipient (→ withdraw allowlist)
 */
export function guard(tx = {}, pol = {}) {
	const p = pol.__normalized ? pol : policy(pol);
	const side = tx.side === 'sell' ? 'sell' : 'buy';
	const category = tx.category || 'trade';
	const isBuy = side === 'buy' && category === 'trade';

	// 0. Freeze — blocks every autonomous path; owner withdraw stays open.
	let blocked = checkFrozen(p.frozen, category);
	if (blocked) return decision(blocked);

	// Withdraw is an owner recovery path: only the allowlist gates it here.
	if (category === 'withdraw') {
		return decision(checkAllowlist(tx.destination, p.withdraw_allowlist));
	}

	// 1. Kill switch (discretionary trades).
	blocked = checkKillSwitch(p.kill_switch);
	if (blocked) return decision(blocked);

	// 2. Price-impact breaker (buys and sells).
	blocked = checkPriceImpact(tx.priceImpactPct, p.max_price_impact_pct);
	if (blocked) return decision(blocked);

	if (isBuy) {
		const lamports = tx.amountLamports != null ? BigInt(tx.amountLamports) : toLamports(tx.amountSol);
		if (lamports == null) {
			throw new ThreeWsError('guard() needs `amountSol` or `amountLamports` for a buy.', { code: 'invalid_input' });
		}

		// 3. Per-trade SOL cap.
		const capLamports = p.per_trade_sol == null ? null : toLamports(p.per_trade_sol);
		blocked = checkPerTradeCap(lamports, capLamports);
		if (blocked) return decision(blocked);

		// 4. Concurrency ceiling.
		blocked = checkConcurrency(tx.openCount ?? 0, p.max_concurrent);
		if (blocked) return decision(blocked);

		// 5. Rolling daily SOL budget.
		const budgetLamports = p.daily_budget_sol == null ? null : toLamports(p.daily_budget_sol);
		blocked = checkDailyBudgetLamports(tx.spentLamports ?? 0n, lamports, budgetLamports);
		if (blocked) return decision(blocked);

		// 6. Cross-path USD ceiling (per-tx, then rolling daily).
		blocked = checkPerTxUsd(tx.usdValue, p.per_tx_usd, category);
		if (blocked) return decision(blocked);
		blocked = checkDailyUsd(tx.spentUsd, tx.usdValue, p.daily_usd, category);
		if (blocked) return decision(blocked);

		// 7. SOL fee/rent headroom floor.
		if (tx.walletLamports != null) {
			blocked = checkSolHeadroom(tx.walletLamports, lamports);
			if (blocked) return decision(blocked);
		}
		return decision(null);
	}

	// Sell: only moves SOL inward, so it skips the spend caps but still honors the
	// kill switch (above), the price-impact breaker (above), and the headroom floor.
	if (tx.walletLamports != null) {
		blocked = checkSolHeadroom(tx.walletLamports, 0n);
		if (blocked) return decision(blocked);
	}
	return decision(null);
}

// ── shaping helpers for the HTTP client ────────────────────────────────────────

function shapeTradeLimits(raw) {
	const l = raw || {};
	return {
		perTradeSol: l.per_trade_sol ?? null,
		dailyBudgetSol: l.daily_budget_sol ?? null,
		maxPriceImpactPct: l.max_price_impact_pct ?? null,
		maxSlippageBps: l.max_slippage_bps ?? null,
		maxConcurrent: l.max_concurrent ?? null,
		killSwitch: Boolean(l.kill_switch),
		updatedAt: l.updated_at ?? null,
		raw: l,
	};
}

function shapeSpendLimits(raw) {
	const l = raw || {};
	return {
		dailyUsd: l.daily_usd ?? null,
		perTxUsd: l.per_tx_usd ?? null,
		withdrawAllowlist: Array.isArray(l.withdraw_allowlist) ? l.withdraw_allowlist : [],
		frozen: Boolean(l.frozen),
		updatedAt: l.updated_at ?? null,
		raw: l,
	};
}

function shapeDecision(data) {
	const d = data || {};
	const blocked = d.blocked_reason || null;
	return {
		allowed: Boolean(d.allowed),
		reason: blocked ? blocked.code : null,
		message: blocked ? blocked.message : null,
		detail: blocked ? blocked.detail || {} : {},
		side: d.side ?? null,
		mint: d.mint ?? null,
		venue: d.venue ?? null,
		priceImpactPct: d.price_impact_pct ?? null,
		raw: d,
	};
}

function pruneBody(obj) {
	const out = {};
	for (const [k, v] of Object.entries(obj)) {
		if (v === undefined) continue;
		out[k] = v;
	}
	return out;
}

// ── HTTP client ────────────────────────────────────────────────────────────────

/**
 * Create a guards client bound to a base URL + fetch + optional owner auth.
 * Setting or reading a policy is an owner-only action — pass `apiKey` (a bearer
 * token) or a session `cookie`. For paid/x402-gated callers, pass a payment-aware
 * `fetch` (e.g. @three-ws/x402-fetch) and the http core auto-settles 402s.
 */
export function createGuards(options = {}) {
	const request = createHttp(options);
	const cookie = options.cookie || null;

	function authHeaders(extra) {
		const h = { ...(extra || {}) };
		if (cookie) h.cookie = cookie;
		return h;
	}

	/** Bind every call to one agent id — the ergonomic surface the README documents. */
	function forAgent(agentId, opts = {}) {
		const id = requireAgentId(agentId);
		const sig = opts.signal;

		async function getTradeLimits({ signal = sig } = {}) {
			const res = await request(`/api/agents/${id}/trade/limits`, { headers: authHeaders(), signal });
			const data = unwrap(res);
			return { ...shapeTradeLimits(data.limits), defaults: data.defaults ?? null, raw: data };
		}

		async function setTradeLimits(patch, { signal = sig } = {}) {
			if (!patch || typeof patch !== 'object') {
				throw new ThreeWsError('setTradeLimits(patch) needs an object of limit keys to change.', { code: 'invalid_input' });
			}
			const res = await request(`/api/agents/${id}/trade/limits`, {
				method: 'PUT', body: pruneBody(tradePatch(patch)), headers: authHeaders(), signal,
			});
			return shapeTradeLimits(unwrap(res).limits);
		}

		async function getSpendLimits({ network, signal = sig } = {}) {
			const res = await request(`/api/agents/${id}/wallet/limits`, { query: { network }, headers: authHeaders(), signal });
			const data = unwrap(res);
			return {
				...shapeSpendLimits(data.limits),
				spentTodayUsd: data.spent_today_usd ?? null,
				spentTodaySol: data.spent_today_sol ?? null,
				raw: data,
			};
		}

		async function setSpendLimits(patch, { network, signal = sig } = {}) {
			if (!patch || typeof patch !== 'object') {
				throw new ThreeWsError('setSpendLimits(patch) needs an object of limit keys to change.', { code: 'invalid_input' });
			}
			const res = await request(`/api/agents/${id}/wallet/limits`, {
				method: 'PUT', query: { network }, body: pruneBody(spendPatch(patch)), headers: authHeaders(), signal,
			});
			return shapeSpendLimits(unwrap(res).limits);
		}

		// Build the /trade body shared by checkTrade (simulate) and trade (execute).
		function tradeBody(input) {
			validateTradeInput(input);
			return pruneBody({
				side: input.side,
				mint: input.mint,
				amount: input.amount,
				slippageBps: input.slippageBps,
				network: input.network,
				idempotency_key: input.idempotencyKey,
			});
		}

		/** Pre-flight a trade against every guard without moving funds (simulate:true). */
		async function checkTrade(input, { signal = sig } = {}) {
			// The quote endpoint returns the guard verdict + the numbers behind it.
			const res = await request(`/api/agents/${id}/trade/quote`, {
				method: 'POST', body: tradeBody(input), headers: authHeaders(), signal,
			});
			return shapeDecision(unwrap(res));
		}

		/** Execute the real trade — same quote → guard → sign → confirm pipeline. */
		async function trade(input, { signal = sig } = {}) {
			const res = await request(`/api/agents/${id}/trade`, {
				method: 'POST', body: { ...tradeBody(input), simulate: input.simulate === true }, headers: authHeaders(), signal,
			});
			const data = unwrap(res);
			return { ...data, raw: data };
		}

		return { id, getTradeLimits, setTradeLimits, getSpendLimits, setSpendLimits, checkTrade, trade };
	}

	return { forAgent };
}

// A module-level default client for the zero-config path: `import { guards }`.
let shared = null;
function defaultClient() {
	return (shared ||= createGuards());
}

/**
 * Bind the default client to one agent. `options.token` / `options.apiKey` is the
 * owner's bearer token; `options.cookie` is a session; `options.baseUrl` overrides
 * the origin. For one-off configs use `createGuards(options).forAgent(id)`.
 */
export function guards(agentId, options = {}) {
	if (options.baseUrl || options.fetch || options.apiKey || options.token || options.cookie || options.headers) {
		const apiKey = options.apiKey || options.token;
		return createGuards({ ...options, apiKey }).forAgent(agentId, options);
	}
	return defaultClient().forAgent(agentId, options);
}

// ── input validation + patch normalization (pre-network) ───────────────────────

function requireAgentId(agentId) {
	const id = typeof agentId === 'string' ? agentId.trim() : '';
	if (!id) throw new ThreeWsError('guards(agentId) needs a non-empty agent id string.', { code: 'invalid_input' });
	return encodeURIComponent(id);
}

const SIDES = ['buy', 'sell'];

function validateTradeInput(input) {
	if (!input || typeof input !== 'object') {
		throw new ThreeWsError('trade input must be an object { side, mint, amount }.', { code: 'invalid_input' });
	}
	if (!SIDES.includes(input.side)) {
		throw new ThreeWsError(`Invalid side "${input.side}". Expected "buy" or "sell".`, { code: 'invalid_input' });
	}
	if (!input.mint || typeof input.mint !== 'string' || !BASE58_RE.test(input.mint.trim())) {
		throw new ThreeWsError('trade input needs a base58 Solana `mint`.', { code: 'invalid_input' });
	}
	const isMax = input.side === 'sell' && (input.amount === 'max' || input.amount === 'MAX' || input.amount === 'all');
	if (!isMax) {
		const n = Number(input.amount);
		if (!Number.isFinite(n) || n <= 0) {
			throw new ThreeWsError(
				input.side === 'buy'
					? '`amount` (SOL to spend) must be a positive number.'
					: '`amount` (tokens to sell) must be a positive number or "max".',
				{ code: 'invalid_input' },
			);
		}
	}
}

// Keep only recognized trade-limit keys so a typo never silently widens the leash.
function tradePatch(patch) {
	const out = {};
	for (const k of ['per_trade_sol', 'daily_budget_sol', 'max_price_impact_pct', 'max_slippage_bps', 'max_concurrent', 'kill_switch']) {
		if (k in patch) out[k] = patch[k];
	}
	return out;
}

function spendPatch(patch) {
	const out = {};
	for (const k of ['daily_usd', 'per_tx_usd', 'withdraw_allowlist', 'frozen']) {
		if (k in patch) out[k] = patch[k];
	}
	return out;
}

// Every limits/trade endpoint wraps its payload in { data: ... }.
function unwrap(res) {
	if (!res || typeof res !== 'object') {
		throw new ThreeWsError('Unexpected empty response from the agent-guards endpoint.', { code: 'bad_response' });
	}
	return res.data ?? res;
}
