// @ts-check
// Pure rule-evaluation logic for pump dashboard alerts (Task 04).
//
// No DB, no network, no env — every function here is deterministic given its
// inputs so the matching/cooldown/crossing logic can be unit-tested in
// isolation (see tests/pump-alert-eval.test.js). The runner
// (pump-alert-runner.js) supplies real data and the delivery side-effects.

/**
 * @typedef {Object} AlertRule
 * @property {string} id
 * @property {string} user_id
 * @property {'graduation'|'price_above'|'price_below'|'whale_buy'|'new_mint'|'market_price'} kind
 * @property {string|null} [target_mint]
 * @property {string|null} [target_agent]
 * @property {string|null} [target_market]   prediction market id (market_price)
 * @property {'yes'|'no'|null} [target_side] outcome side watched (market_price)
 * @property {'above'|'below'|null} [direction] crossing direction (market_price)
 * @property {number|null} [threshold]
 * @property {boolean} [deliver_in_app]
 * @property {string|null} [webhook_url]
 * @property {string|null} [webhook_secret]
 * @property {string|null} [telegram_chat]
 * @property {number} cooldown_seconds
 * @property {boolean} enabled
 * @property {string|null} [label]
 */

/** Kinds that require a specific mint target. */
export const MINT_TARGETED_KINDS = Object.freeze(['price_above', 'price_below', 'whale_buy']);
/** Kinds that require an agent target. */
export const AGENT_TARGETED_KINDS = Object.freeze(['new_mint']);
/** Kinds that watch one outcome of a prediction market. */
export const MARKET_TARGETED_KINDS = Object.freeze(['market_price']);
/** Kinds whose threshold is meaningful and must be > 0. */
export const THRESHOLD_KINDS = Object.freeze(['price_above', 'price_below', 'whale_buy', 'market_price']);

/**
 * True when enough wall-clock has passed since the rule last fired.
 * @param {string|number|Date|null|undefined} lastFiredAt
 * @param {number} cooldownSeconds
 * @param {number} [now] epoch ms
 */
export function cooldownElapsed(lastFiredAt, cooldownSeconds, now = Date.now()) {
	if (!lastFiredAt) return true;
	const last = lastFiredAt instanceof Date ? lastFiredAt.getTime() : new Date(lastFiredAt).getTime();
	if (!Number.isFinite(last)) return true;
	return now - last >= Math.max(0, (cooldownSeconds || 0) * 1000);
}

/**
 * Does a graduation event satisfy this rule's targeting?
 * @param {AlertRule} rule
 * @param {{ mint?: string }} grad
 * @param {{ agentMints?: Set<string> }} [ctx] mints owned by the rule's target agent
 */
export function gradMatchesRule(rule, grad, ctx = {}) {
	if (rule.kind !== 'graduation') return false;
	if (!grad?.mint) return false;
	if (rule.target_mint) return grad.mint === rule.target_mint;
	if (rule.target_agent) return ctx.agentMints instanceof Set && ctx.agentMints.has(grad.mint);
	return true; // global graduation rule
}

/**
 * Does a new-mint row (from pump_agent_mints) satisfy this rule?
 * @param {AlertRule} rule
 * @param {{ agent_id?: string, mint?: string }} mintRow
 */
export function newMintMatchesRule(rule, mintRow) {
	if (rule.kind !== 'new_mint') return false;
	if (!rule.target_agent) return false;
	return mintRow?.agent_id === rule.target_agent;
}

/**
 * Is this trade a whale buy for the rule (right mint, a buy, >= threshold SOL)?
 * @param {AlertRule} rule
 * @param {{ mint?: string, is_buy?: boolean, sol_amount?: number }} trade
 */
export function isWhaleBuy(rule, trade) {
	if (rule.kind !== 'whale_buy') return false;
	if (!rule.target_mint || trade?.mint !== rule.target_mint) return false;
	if (!trade?.is_buy) return false;
	const sol = Number(trade.sol_amount);
	const threshold = Number(rule.threshold);
	return Number.isFinite(sol) && Number.isFinite(threshold) && threshold > 0 && sol >= threshold;
}

/**
 * Edge-triggered evaluation of a price (USD market cap) rule. Fires once when
 * the metric crosses the threshold, then stays quiet until it crosses back and
 * crosses again — so a token parked above the line doesn't alert every tick.
 *
 * @param {AlertRule} rule
 * @param {number|null|undefined} currentMcapUsd
 * @param {{ side?: 'over'|'under'|null }} [lastState]
 * @returns {{ fire: boolean, nextState: { side: 'over'|'under' }, reason: string }}
 */
export function evaluatePriceRule(rule, currentMcapUsd, lastState = {}) {
	// Number(null) is 0 (finite), so guard null/undefined explicitly — a missing
	// price must hit the no-price branch, not read as a $0 market cap.
	const mcap = currentMcapUsd == null ? NaN : Number(currentMcapUsd);
	const threshold = Number(rule.threshold);
	// Without a live price we can't decide — preserve prior state, don't fire.
	if (!Number.isFinite(mcap) || !Number.isFinite(threshold) || threshold <= 0) {
		return { fire: false, nextState: { side: lastState.side === 'over' ? 'over' : 'under' }, reason: 'no_price' };
	}

	if (rule.kind === 'price_above') {
		const over = mcap >= threshold;
		const fire = over && lastState.side !== 'over';
		return { fire, nextState: { side: over ? 'over' : 'under' }, reason: over ? 'above_threshold' : 'below_threshold' };
	}
	if (rule.kind === 'price_below') {
		const under = mcap <= threshold;
		const fire = under && lastState.side !== 'under';
		return { fire, nextState: { side: under ? 'under' : 'over' }, reason: under ? 'below_threshold' : 'above_threshold' };
	}
	return { fire: false, nextState: { side: 'under' }, reason: 'not_price_rule' };
}

/**
 * Edge-triggered evaluation of a prediction-market watch: fires once when the
 * watched side's implied probability crosses `threshold` in `direction`, then
 * re-arms only after it crosses back. Same shape as evaluatePriceRule.
 *
 * @param {AlertRule} rule
 * @param {number|null|undefined} probability current implied probability, 0..1
 * @param {{ side?: 'over'|'under'|null }} [lastState]
 */
export function evaluateMarketPriceRule(rule, probability, lastState = {}) {
	const p = probability == null ? NaN : Number(probability);
	const threshold = Number(rule.threshold);
	if (!Number.isFinite(p) || !Number.isFinite(threshold) || threshold <= 0 || threshold >= 1) {
		return { fire: false, nextState: { side: lastState.side === 'over' ? 'over' : 'under' }, reason: 'no_price' };
	}
	const over = p >= threshold;
	const nextState = { side: /** @type {'over'|'under'} */ (over ? 'over' : 'under') };
	if (rule.direction === 'below') {
		const under = p <= threshold;
		// Seed state from the first reading so a market already below the line
		// when the watch is created does not fire instantly.
		const fire = under && lastState.side === 'over';
		return { fire, nextState: { side: under ? 'under' : 'over' }, reason: under ? 'below_threshold' : 'above_threshold' };
	}
	const fire = over && lastState.side === 'under';
	return { fire, nextState, reason: over ? 'above_threshold' : 'below_threshold' };
}

// ── Payload builders ─────────────────────────────────────────────────────────
// Every alert is stored as a `user_notifications` row of type 'pump_alert' with
// a payload shaped consistently across kinds so the dashboard renders them
// uniformly. `event_id` is the dedupe key the runner persists in last_event_id.

const iso = (v) => {
	if (!v) return null;
	const d = v instanceof Date ? v : new Date(v);
	return Number.isFinite(d.getTime()) ? d.toISOString() : null;
};

/** @param {{ mint?: string, name?: string, symbol?: string, amount_sol?: number, market_cap_usd?: number, tx_signature?: string, seen_at?: any }} g */
export function buildGraduationPayload(rule, g) {
	return {
		kind: 'graduation',
		rule_id: rule.id,
		event_id: g.tx_signature || g.mint || null,
		mint: g.mint || null,
		name: g.name || null,
		symbol: g.symbol || null,
		amount_sol: g.amount_sol != null ? Number(g.amount_sol) : null,
		market_cap_usd: g.market_cap_usd != null ? Number(g.market_cap_usd) : null,
		tx: g.tx_signature || null,
		at: iso(g.seen_at) || iso(Date.now()),
	};
}

/** @param {{ id?: string, mint?: string, name?: string, symbol?: string, agent_id?: string, created_at?: any }} m */
export function buildNewMintPayload(rule, m) {
	return {
		kind: 'new_mint',
		rule_id: rule.id,
		event_id: m.mint || m.id || null,
		mint: m.mint || null,
		name: m.name || null,
		symbol: m.symbol || null,
		agent_id: m.agent_id || rule.target_agent || null,
		at: iso(m.created_at) || iso(Date.now()),
	};
}

/** @param {{ mint?: string, name?: string, symbol?: string }} token @param {{ sol_amount?: number, sol_value_usd?: number, signature?: string, buyer?: string, ts?: any }} trade */
export function buildWhalePayload(rule, token, trade) {
	return {
		kind: 'whale_buy',
		rule_id: rule.id,
		event_id: trade.signature || null,
		mint: token.mint || rule.target_mint || null,
		name: token.name || null,
		symbol: token.symbol || null,
		amount_sol: trade.sol_amount != null ? Number(trade.sol_amount) : null,
		amount_usd: trade.sol_value_usd != null ? Number(trade.sol_value_usd) : null,
		buyer: trade.buyer || null,
		tx: trade.signature || null,
		at: iso(trade.ts) || iso(Date.now()),
	};
}

/** @param {{ mint?: string, name?: string, symbol?: string, market_cap_usd?: number }} token */
export function buildPricePayload(rule, token) {
	return {
		kind: rule.kind, // price_above | price_below
		rule_id: rule.id,
		// Bucket the dedupe key by hour so a sustained crossing logs at most one
		// event per cooldown window even if the cron restarts mid-window.
		event_id: `${rule.kind}:${token.mint}:${Math.floor(Date.now() / 3_600_000)}`,
		mint: token.mint || rule.target_mint || null,
		name: token.name || null,
		symbol: token.symbol || null,
		threshold_usd: Number(rule.threshold),
		market_cap_usd: token.market_cap_usd != null ? Number(token.market_cap_usd) : null,
		at: iso(Date.now()),
	};
}

/**
 * @param {AlertRule} rule
 * @param {{ id: string, title?: string, event_id?: string|null, side_label?: string|null, probability: number }} m
 */
export function buildMarketPricePayload(rule, m) {
	return {
		kind: 'market_price',
		rule_id: rule.id,
		event_id: `market_price:${rule.id}:${Math.floor(Date.now() / 60_000)}`,
		market_id: m.id,
		market_title: m.title || null,
		prediction_event_id: m.event_id || null,
		side: rule.target_side || 'yes',
		side_label: m.side_label || null,
		direction: rule.direction || 'above',
		threshold: Number(rule.threshold),
		probability: Number(m.probability),
		link: m.event_id ? `/predictions?event=${encodeURIComponent(m.event_id)}&market=${encodeURIComponent(m.id)}` : '/predictions',
		at: iso(Date.now()),
	};
}

/**
 * Human-readable one-line summary used for the Telegram message and as the
 * in-app feed title.
 * @param {Record<string, any>} p alert payload
 */
export function formatAlertSummary(p) {
	const tok = p.symbol ? `$${p.symbol}` : p.name || (p.mint ? `${p.mint.slice(0, 4)}…${p.mint.slice(-4)}` : 'token');
	const usd = (n) => (n != null && Number.isFinite(Number(n)) ? `$${Math.round(Number(n)).toLocaleString('en-US')}` : null);
	switch (p.kind) {
		case 'graduation': {
			const mc = usd(p.market_cap_usd);
			return `🎓 ${tok} graduated to AMM${mc ? ` at ${mc} mcap` : ''}`;
		}
		case 'new_mint':
			return `🆕 ${tok} just launched`;
		case 'whale_buy': {
			const sol = p.amount_sol != null ? `${Number(p.amount_sol).toFixed(2)} SOL` : 'a large buy';
			const u = usd(p.amount_usd);
			return `🐳 Whale bought ${sol}${u ? ` (${u})` : ''} of ${tok}`;
		}
		case 'price_above':
			return `📈 ${tok} mcap rose above ${usd(p.threshold_usd)} (now ${usd(p.market_cap_usd)})`;
		case 'price_below':
			return `📉 ${tok} mcap fell below ${usd(p.threshold_usd)} (now ${usd(p.market_cap_usd)})`;
		case 'market_price': {
			const pct = (n) => `${(Number(n) * 100).toFixed(1).replace(/\.0$/, '')}%`;
			const side = p.side_label || (p.side === 'no' ? 'No' : 'Yes');
			return `${p.direction === 'below' ? '📉' : '📈'} ${p.market_title || 'Market'}: ${side} ${p.direction === 'below' ? 'fell below' : 'rose above'} ${pct(p.threshold)} (now ${pct(p.probability)})`;
		}
		default:
			return `🔔 ${tok} alert`;
	}
}

/** Default label shown when the user doesn't name a rule. */
export function deriveRuleLabel(rule) {
	const target = rule.target_mint
		? `${rule.target_mint.slice(0, 4)}…${rule.target_mint.slice(-4)}`
		: rule.target_agent
			? 'tracked agent'
			: 'all tokens';
	switch (rule.kind) {
		case 'graduation':
			return `Graduations · ${target}`;
		case 'new_mint':
			return `New launches · ${target}`;
		case 'whale_buy':
			return `Whale buys ≥ ${rule.threshold} SOL · ${target}`;
		case 'price_above':
			return `Mcap above $${rule.threshold} · ${target}`;
		case 'price_below':
			return `Mcap below $${rule.threshold} · ${target}`;
		case 'market_price':
			return `${rule.target_side === 'no' ? 'No' : 'Yes'} ${rule.direction === 'below' ? 'below' : 'above'} ${Math.round(Number(rule.threshold) * 100)}% · ${rule.target_market || 'market'}`;
		default:
			return 'Alert';
	}
}
