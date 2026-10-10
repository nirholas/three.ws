// Natural-language → validated sniper strategy compiler.
//
// A user describes a snipe strategy in plain English ("snipe creators who've
// graduated at least two, market cap under $30k, organic distribution, take
// profit at 3x, stop loss 40%, max 0.3 SOL per trade"). We compile it to a row
// shaped exactly like agent_sniper_strategies / the api/sniper/strategy.js POST
// body, HARD-validate it against the same ranges the arm endpoint enforces, and
// clamp every money/risk knob to the agent's runtime trade guards
// (agent-trade-guards.js) so a compiled strategy can NEVER bypass a spend cap or
// the price-impact breaker. The result carries a plain-language summary plus an
// explicit list of every value we assumed or clamped — so the owner sees the
// truth before arming, never a silent unsafe config.
//
// It also emits the same intent as a Strategy Object v2 config
// (`strategy_object`, api/_lib/strategy-schema.js): research gates, a price-
// impact ceiling, the trade size in SOL, source filters, and the run mode, with
// a per-field `explanations` list saying where each value came from. Mode is
// 'ask' unless the owner explicitly asked for unattended buying.
//
// Prefers the platform LLM (free-first chain in llm.js); falls back to a real
// deterministic intent parser so the feature always compiles, model or not.

import { llmComplete, llmConfigured } from './llm.js';
import { normalizeStrategyConfig, STRATEGY_CONFIG_DEFAULTS } from './strategy-schema.js';

const LAMPORTS_PER_SOL = 1_000_000_000;

// Canonical pump.fun intel categories the classifier emits (intel/classify.js).
const KNOWN_CATEGORIES = ['meme', 'tech', 'ai', 'culture', 'community', 'gaming', 'animal', 'political', 'finance'];

const COMPILE_SYSTEM = `You translate a plain-English pump.fun sniper strategy into ONE JSON object. Output ONLY the JSON — no prose, no markdown fence.

Schema (omit a field or use null when the user didn't specify it — do NOT invent values):
{
  "trigger": "new_mint" | "intel_confirmed",            // "new_mint" snipes blind on launch; "intel_confirmed" waits for the Coin Intelligence read. Use intel_confirmed when the user mentions bundle/organic/concentration/quality/smart-money signals.
  "per_trade_sol": number|null,                         // SOL spent per snipe
  "daily_budget_sol": number|null,                      // total SOL/day budget
  "max_concurrent_positions": integer|null,
  "slippage_pct": number|null,                          // entry slippage tolerance, percent
  "max_price_impact_pct": number|null,                  // reject entry if quote impact exceeds this
  "min_market_cap_usd": number|null,
  "max_market_cap_usd": number|null,
  "min_creator_graduated": integer|null,                // creator must have >= N graduated coins
  "max_creator_launches": integer|null,                 // reject serial ruggers with > N launches
  "require_socials": boolean|null,                      // demand twitter/telegram/website
  "require_sol_quote": boolean|null,                    // SOL-paired only (default true)
  "take_profit_pct": number|null,                       // "3x" => 200 (gain percent above entry)
  "stop_loss_pct": number|null,                         // MANDATORY for safety; percent loss
  "trailing_stop_pct": number|null,
  "max_hold_seconds": integer|null,                     // "hold 30 min" => 1800
  "min_quality_score": number|null,                     // 0-100 (intel_confirmed)
  "max_bundle_score": number|null,                      // 0-1, lower = cleaner launch (intel_confirmed)
  "max_concentration_top1": number|null,                // 0-100, top holder share cap (intel_confirmed)
  "avoid_dev_dump": boolean|null,                        // skip coins where dev already sold
  "allowed_categories": [string]|null,                  // subset of: ${KNOWN_CATEGORIES.join(', ')}
  "min_holders": integer|null,                          // research gate: at least N holders before buying
  "min_liquidity_sol": number|null,                     // research gate: at least N SOL of curve liquidity
  "security_min_score": number|null,                    // research gate: rug/honeypot firewall score floor, 0-100
  "require_no_mint_authority": boolean|null,            // research gate: mint authority must be renounced
  "require_no_freeze_authority": boolean|null,          // research gate: freeze authority must be renounced
  "sources": ["pump_curve"|"three_ws_launch"]|null,     // launch sources; ["three_ws_launch"] = coins launched through three.ws only
  "mode": "auto" | "ask" | null,                        // "auto" ONLY when the user explicitly says buy automatically / without asking; otherwise "ask"
  "summary": string,                                     // one plain-language sentence describing what this strategy does
  "assumptions": [string]                                // anything you defaulted or could not parse
}
Research: "at least 50 holders" => min_holders 50; "top holder under 20%" / "no whales over 20%" => max_concentration_top1 20; "renounced mint" => require_no_mint_authority true; "no freeze" => require_no_freeze_authority true; "safety score 70+" => security_min_score 70.
Conversions: "3x"/"triple" => take_profit_pct 200; "2x" => 100. "graduated at least two" => min_creator_graduated 2. "organic" / "no bundles" => trigger intel_confirmed with a low max_bundle_score (~0.3) and decent min_quality_score (~55). "smart money" => trigger intel_confirmed. Percentages stay percentages. Never reference any coin other than $THREE.`;

function num(v) {
	if (v === null || v === undefined || v === '') return null;
	const n = Number(v);
	return Number.isFinite(n) ? n : null;
}
function intOrNull(v) {
	const n = num(v);
	return n == null ? null : Math.floor(n);
}
function str(v, max = 240) {
	if (typeof v !== 'string') return '';
	return v.trim().slice(0, max);
}
function clamp(n, min, max) {
	return Math.min(max, Math.max(min, n));
}

function safeJsonExtract(text) {
	if (typeof text !== 'string') return null;
	const t = text.trim().replace(/^```(?:json)?/i, '').replace(/```$/, '').trim();
	const start = t.indexOf('{');
	const end = t.lastIndexOf('}');
	if (start < 0 || end < start) return null;
	try {
		return JSON.parse(t.slice(start, end + 1));
	} catch {
		return null;
	}
}

/**
 * Compile NL → validated strategy.
 * @param {string} text                 the user's plain-English description
 * @param {object} [opts]
 * @param {object} [opts.tradeLimits]   agent meta.trade_limits — runtime ceilings to clamp to
 * @param {string} [opts.network]
 * @param {object} [opts.track]         llm spend attribution
 * @returns {Promise<{ok:boolean, error?:string, message?:string, via?:string,
 *   source_text?:string, strategy?:object, summary?:string, assumptions?:string[],
 *   clamped?:string[], warnings?:string[]}>}
 */
export async function compileStrategyFromText(text, { tradeLimits = null, network = 'mainnet', track = null } = {}) {
	const source = typeof text === 'string' ? text.trim().slice(0, 4000) : '';
	if (source.length < 3) {
		return { ok: false, error: 'empty', message: 'Describe your strategy in a sentence or two first.' };
	}

	let parsed = null;
	let via = 'heuristic';
	if (llmConfigured()) {
		try {
			const out = await llmComplete({
				system: COMPILE_SYSTEM,
				user: source,
				maxTokens: 700,
				timeoutMs: 25_000,
				track: track ? { ...track, tool: 'sniper-strategy-compile' } : { tool: 'sniper-strategy-compile' },
			});
			parsed = safeJsonExtract(out.text);
			if (parsed) via = 'model';
		} catch (e) {
			console.warn('[strategy-compiler] LLM compile failed, using heuristic:', e?.message);
		}
	}
	if (!parsed) parsed = heuristicCompile(source);

	const assumptions = Array.isArray(parsed.assumptions) ? parsed.assumptions.map((w) => str(w)).filter(Boolean) : [];
	const clamped = [];

	// ── raw field extraction ──────────────────────────────────────────────────
	let trigger = parsed.trigger === 'intel_confirmed' || parsed.trigger === 'first_claim' ? parsed.trigger : 'new_mint';

	let perTradeSol = num(parsed.per_trade_sol);
	let dailySol = num(parsed.daily_budget_sol);
	// A per-trade size with no daily budget: assume room for a few trades a day so
	// the owner can arm without re-typing. Never let per-trade exceed the daily cap.
	if (perTradeSol != null && perTradeSol > 0 && dailySol == null) {
		dailySol = perTradeSol * 5;
		assumptions.push(`No daily budget given — assumed ${dailySol} SOL/day (5× your per-trade size). Adjust before arming.`);
	}
	if (perTradeSol != null && dailySol != null && perTradeSol > dailySol) {
		dailySol = perTradeSol;
		clamped.push(`Daily budget raised to ${dailySol} SOL so it covers a single ${perTradeSol} SOL trade.`);
	}

	// Clamp money + risk knobs to the agent's runtime trade guards. These are the
	// SAME ceilings agent-trade-guards.js enforces on every live buy — a compiled
	// strategy must never be able to exceed them.
	const tl = tradeLimits || {};
	if (perTradeSol != null && tl.per_trade_sol != null && perTradeSol > tl.per_trade_sol) {
		perTradeSol = tl.per_trade_sol;
		clamped.push(`Per-trade size clamped to your ${tl.per_trade_sol} SOL trade cap.`);
	}
	if (dailySol != null && tl.daily_budget_sol != null && dailySol > tl.daily_budget_sol) {
		dailySol = tl.daily_budget_sol;
		clamped.push(`Daily budget clamped to your ${tl.daily_budget_sol} SOL/day cap.`);
		if (perTradeSol != null && perTradeSol > dailySol) perTradeSol = dailySol;
	}

	let slippageBps = parsed.slippage_pct != null ? Math.round(num(parsed.slippage_pct) * 100) : null;
	if (slippageBps != null) slippageBps = clamp(slippageBps, 0, 5000);
	if (slippageBps != null && tl.max_slippage_bps != null && slippageBps > tl.max_slippage_bps) {
		slippageBps = tl.max_slippage_bps;
		clamped.push(`Slippage clamped to your ${(tl.max_slippage_bps / 100).toFixed(2)}% ceiling.`);
	}

	let maxImpact = num(parsed.max_price_impact_pct);
	if (maxImpact != null) maxImpact = clamp(maxImpact, 0, 100);
	const impactCeil = tl.max_price_impact_pct != null ? tl.max_price_impact_pct : 15;
	if (maxImpact == null) maxImpact = Math.min(10, impactCeil);
	if (maxImpact > impactCeil) {
		maxImpact = impactCeil;
		clamped.push(`Max price impact clamped to the ${impactCeil}% safety breaker.`);
	}

	let maxConcurrent = intOrNull(parsed.max_concurrent_positions);
	if (maxConcurrent != null) maxConcurrent = clamp(maxConcurrent, 1, 50);
	if (maxConcurrent == null) maxConcurrent = 1;
	if (tl.max_concurrent != null && maxConcurrent > tl.max_concurrent) {
		maxConcurrent = tl.max_concurrent;
		clamped.push(`Max concurrent positions clamped to your ${tl.max_concurrent} cap.`);
	}

	// ── exits — stop-loss is mandatory and must be > 0 ─────────────────────────
	let stopLoss = num(parsed.stop_loss_pct);
	if (stopLoss == null || stopLoss <= 0) {
		stopLoss = 35;
		assumptions.push('No stop-loss specified — defaulted to 35%. A stop-loss is mandatory; raise or lower it, but it can never be removed.');
	}
	stopLoss = clamp(stopLoss, 1, 95);

	let takeProfit = num(parsed.take_profit_pct);
	if (takeProfit != null) takeProfit = takeProfit > 0 ? clamp(takeProfit, 1, 100000) : null;
	let trailing = num(parsed.trailing_stop_pct);
	if (trailing != null) trailing = trailing > 0 ? clamp(trailing, 1, 95) : null;

	let maxHold = intOrNull(parsed.max_hold_seconds);
	if (maxHold != null) maxHold = clamp(maxHold, 30, 86400);
	if (maxHold == null) maxHold = 1800;

	// ── entry filters ──────────────────────────────────────────────────────────
	const minMc = num(parsed.min_market_cap_usd);
	const maxMc = num(parsed.max_market_cap_usd);
	const minGrad = intOrNull(parsed.min_creator_graduated);
	const maxLaunches = intOrNull(parsed.max_creator_launches);
	const requireSocials = parsed.require_socials === true;
	const requireSolQuote = parsed.require_sol_quote !== false; // default true
	const avoidDevDump = parsed.avoid_dev_dump !== false;        // default true

	let minQuality = num(parsed.min_quality_score);
	if (minQuality != null) minQuality = clamp(Math.round(minQuality), 0, 100);
	let maxBundle = num(parsed.max_bundle_score);
	if (maxBundle != null) maxBundle = clamp(maxBundle, 0, 1);
	let maxConc = num(parsed.max_concentration_top1);
	if (maxConc != null) maxConc = clamp(maxConc, 0, 100);

	let categories = Array.isArray(parsed.allowed_categories)
		? [...new Set(parsed.allowed_categories.map((c) => str(c, 24).toLowerCase()).filter((c) => KNOWN_CATEGORIES.includes(c)))]
		: null;
	if (categories && categories.length === 0) categories = null;

	// Intel-only signals only bite when the trigger waits for the intel read.
	if (trigger !== 'intel_confirmed' && (minQuality != null || maxBundle != null || maxConc != null || categories)) {
		trigger = 'intel_confirmed';
		assumptions.push('Switched to "intel-confirmed" entry — your filters (quality / bundle / concentration / category) need the Coin Intelligence read, which the blind launch trigger can\'t see.');
	}

	const perTradeLamports = perTradeSol != null ? String(Math.max(0, Math.round(perTradeSol * LAMPORTS_PER_SOL))) : '0';
	const dailyLamports = dailySol != null ? String(Math.max(0, Math.round(dailySol * LAMPORTS_PER_SOL))) : '0';

	const strategy = {
		trigger,
		daily_budget_lamports: dailyLamports,
		per_trade_lamports: perTradeLamports,
		max_concurrent_positions: maxConcurrent,
		slippage_bps: slippageBps != null ? slippageBps : 500,
		max_price_impact_pct: Number(maxImpact.toFixed(2)),
		min_market_cap_usd: minMc,
		max_market_cap_usd: maxMc,
		min_creator_graduated: minGrad,
		max_creator_launches: maxLaunches,
		require_socials: requireSocials,
		require_sol_quote: requireSolQuote,
		take_profit_pct: takeProfit,
		stop_loss_pct: Number(stopLoss.toFixed(2)),
		trailing_stop_pct: trailing,
		max_hold_seconds: maxHold,
		min_quality_score: minQuality,
		max_bundle_score: maxBundle,
		max_concentration_top1: maxConc,
		avoid_dev_dump: avoidDevDump,
		allowed_categories: categories,
	};

	const warnings = [];
	if (BigInt(perTradeLamports) <= 0n || BigInt(dailyLamports) <= 0n) {
		warnings.push('Set a per-trade size and a daily budget before you can arm this — a live strategy needs real SOL to spend.');
	}

	const summary = str(parsed.summary, 400) || describeStrategy(strategy);
	const { config: strategyObject, explanations } = toStrategyObject(parsed, strategy, { network, perTradeSol, assumptions });

	return {
		ok: true,
		via,
		source_text: source,
		strategy,
		strategy_object: strategyObject,
		explanations,
		summary,
		assumptions: [...new Set(assumptions)],
		clamped: [...new Set(clamped)],
		warnings,
	};
}

const RESEARCH_SOURCES = ['pump_curve', 'three_ws_launch'];

/**
 * The same compiled intent as a Strategy Object v2 config, plus one explanation
 * per setting that is not a schema default. `strategy` is the already clamped
 * sniper row, so every money knob carries the same spend-guard clamp.
 */
export function toStrategyObject(parsed, strategy, { network = 'mainnet', perTradeSol = null, assumptions = [] } = {}) {
	const p = parsed || {};
	const explanations = [];
	const explain = (field, value, why) => explanations.push({ field, value, why });
	const D = STRATEGY_CONFIG_DEFAULTS;

	const explicitAuto = p.mode === 'auto';
	const mode = explicitAuto ? 'auto' : 'ask';
	explain('mode', mode, explicitAuto
		? 'You asked for unattended buying: every buy still passes the research gates and your spend caps.'
		: 'Ask mode: each buy waits for your approval. Switch to auto once you trust the gates.');

	let sources = Array.isArray(p.sources) ? [...new Set(p.sources.map((x) => String(x).toLowerCase()).filter((x) => RESEARCH_SOURCES.includes(x)))] : [];
	if (sources.length === RESEARCH_SOURCES.length) sources = [];
	if (sources.length) explain('entry.sources', sources, sources.includes('three_ws_launch') && sources.length === 1
		? 'Only coins launched through three.ws are considered.'
		: 'Only live pump.fun bonding-curve launches are considered.');

	const amountSol = perTradeSol != null && perTradeSol > 0
		? Number(BigInt(strategy.per_trade_lamports)) / LAMPORTS_PER_SOL
		: D.sizing.amount_sol;
	explain('sizing.amount_sol', amountSol, perTradeSol != null && perTradeSol > 0
		? `${amountSol} SOL per buy, within your trade cap.`
		: `No trade size given, so the ${D.sizing.amount_sol} SOL default is used.`);
	const impactBps = Math.max(1, Math.round(strategy.max_price_impact_pct * 100));
	explain('sizing.max_price_impact_bps', impactBps, `A buy whose quote moves the price more than ${strategy.max_price_impact_pct}% is skipped. It can only tighten your agent's own breaker.`);

	const g = {
		min_holders: intOrNull(p.min_holders),
		max_top_holder_pct: strategy.max_concentration_top1,
		min_liquidity_sol: num(p.min_liquidity_sol),
		security_min_score: num(p.security_min_score),
		require_no_mint_authority: p.require_no_mint_authority === true,
		require_no_freeze_authority: p.require_no_freeze_authority === true,
		dev_history: {
			max_launches: strategy.max_creator_launches,
			min_graduated: strategy.min_creator_graduated,
			block_dev_sold: strategy.avoid_dev_dump === true,
		},
	};
	if (g.min_holders != null) g.min_holders = clamp(g.min_holders, 0, 10_000_000);
	if (g.min_liquidity_sol != null) g.min_liquidity_sol = clamp(g.min_liquidity_sol, 0, 1e9);
	if (g.security_min_score != null) g.security_min_score = clamp(Math.round(g.security_min_score), 0, 100);
	if (g.min_holders != null) explain('research.min_holders', g.min_holders, `Skip coins with fewer than ${g.min_holders} holders.`);
	if (g.max_top_holder_pct != null) explain('research.max_top_holder_pct', g.max_top_holder_pct, `Skip coins whose largest holder owns more than ${g.max_top_holder_pct}% (the bonding curve is not counted as a holder).`);
	if (g.min_liquidity_sol != null) explain('research.min_liquidity_sol', g.min_liquidity_sol, `Skip coins with less than ${g.min_liquidity_sol} SOL of curve liquidity.`);
	if (g.security_min_score != null) explain('research.security_min_score', g.security_min_score, `Skip coins the rug and honeypot firewall scores below ${g.security_min_score}/100.`);
	if (g.require_no_mint_authority) explain('research.require_no_mint_authority', true, 'Skip coins whose creator can still mint new supply.');
	if (g.require_no_freeze_authority) explain('research.require_no_freeze_authority', true, 'Skip coins whose creator can freeze holder accounts.');
	if (g.dev_history.max_launches != null) explain('research.dev_history.max_launches', g.dev_history.max_launches, `Skip creators with more than ${g.dev_history.max_launches} launches.`);
	if (g.dev_history.min_graduated != null) explain('research.dev_history.min_graduated', g.dev_history.min_graduated, `Only buy from creators with at least ${g.dev_history.min_graduated} graduated coins.`);
	if (g.dev_history.block_dev_sold) explain('research.dev_history.block_dev_sold', true, 'Skip coins whose creator has already sold.');

	const raw = {
		version: 2,
		mode,
		network,
		entry: {
			trigger: 'new_launch',
			sources,
			max_age_minutes: D.entry.max_age_minutes,
			min_market_cap_usd: strategy.min_market_cap_usd,
			max_market_cap_usd: strategy.max_market_cap_usd,
			require_socials: strategy.require_socials,
			require_sol_quote: strategy.require_sol_quote,
		},
		sizing: { amount_sol: amountSol, max_slippage_bps: strategy.slippage_bps, max_price_impact_bps: impactBps },
		exits: {
			take_profit_pct: strategy.take_profit_pct,
			stop_loss_pct: strategy.stop_loss_pct,
			trailing_stop_pct: strategy.trailing_stop_pct,
			max_hold_minutes: strategy.max_hold_seconds != null ? Math.max(1, Math.round(strategy.max_hold_seconds / 60)) : null,
		},
		risk: { max_concurrent_positions: strategy.max_concurrent_positions, cooldown_minutes: 0 },
		research: g,
	};
	if (strategy.min_market_cap_usd != null || strategy.max_market_cap_usd != null) {
		explain('entry.market_cap_usd', [strategy.min_market_cap_usd, strategy.max_market_cap_usd], `Market cap band ${strategy.min_market_cap_usd != null ? `$${strategy.min_market_cap_usd}` : 'any'} to ${strategy.max_market_cap_usd != null ? `$${strategy.max_market_cap_usd}` : 'any'}.`);
	}
	if (strategy.take_profit_pct == null && strategy.trailing_stop_pct == null && raw.exits.max_hold_minutes == null) {
		raw.exits.take_profit_pct = D.exits.take_profit_pct;
		assumptions.push(`No upside exit given for the Strategy Object, so take-profit defaults to +${D.exits.take_profit_pct}%.`);
	}
	if ((strategy.min_quality_score != null || strategy.max_bundle_score != null || strategy.allowed_categories) && Array.isArray(assumptions)) {
		assumptions.push('Quality, bundle, and category filters apply to the sniper rule set only; the Strategy Object enforces the research gates listed in the explanations.');
	}
	return { config: normalizeStrategyConfig(raw), explanations };
}

// Plain-language fallback description, in case the model didn't return a summary.
function describeStrategy(s) {
	const parts = [];
	const perSol = Number(BigInt(s.per_trade_lamports)) / LAMPORTS_PER_SOL;
	const daySol = Number(BigInt(s.daily_budget_lamports)) / LAMPORTS_PER_SOL;
	parts.push(s.trigger === 'intel_confirmed'
		? 'Waits for the Coin Intelligence read, then snipes coins that clear your filters'
		: 'Snipes brand-new pump.fun launches that clear your filters');
	if (perSol > 0) parts.push(`at ${perSol} SOL each (up to ${daySol} SOL/day)`);
	const exits = [];
	if (s.take_profit_pct) exits.push(`take profit +${s.take_profit_pct}%`);
	exits.push(`stop loss ${s.stop_loss_pct}%`);
	if (s.trailing_stop_pct) exits.push(`${s.trailing_stop_pct}% trailing stop`);
	parts.push(`Exits on ${exits.join(', ')}.`);
	return parts.join(', ').replace(', Exits', '. Exits');
}

// ── deterministic intent parser — real implementation, not a mock ──────────────
// Extracts the same fields from common phrasings so the feature always compiles
// even with no model configured.
function heuristicCompile(text) {
	// Normalize small number-words ("at least two") to digits so the numeric
	// patterns below catch them. Bounded to one..ten — enough for graduation/
	// launch/concurrency counts; larger figures are written as digits anyway.
	const WORDS = { one: '1', two: '2', three: '3', four: '4', five: '5', six: '6', seven: '7', eight: '8', nine: '9', ten: '10' };
	let lowered = text.toLowerCase();
	for (const [w, d] of Object.entries(WORDS)) lowered = lowered.replace(new RegExp(`\\b${w}\\b`, 'g'), d);
	const t = ` ${lowered} `;
	const out = { assumptions: [], allowed_categories: null };

	const moneyToNum = (m) => {
		if (!m) return null;
		let v = parseFloat(m.replace(/[$,\s]/g, ''));
		if (/k\b/i.test(m)) v *= 1_000;
		if (/m(?:m|illion)?\b/i.test(m)) v *= 1_000_000;
		return Number.isFinite(v) ? v : null;
	};

	// take profit: "3x" / "take profit at 3x" / "tp 200%"
	const mult = t.match(/(\d+(?:\.\d+)?)\s*x\b/);
	if (mult) out.take_profit_pct = (parseFloat(mult[1]) - 1) * 100;
	const tp = t.match(/(?:take[ -]?profit|tp)\D{0,12}?(\d+(?:\.\d+)?)\s*%/);
	if (tp) out.take_profit_pct = parseFloat(tp[1]);

	const sl = t.match(/(?:stop[ -]?loss|sl|stop)\D{0,12}?(\d+(?:\.\d+)?)\s*%/);
	if (sl) out.stop_loss_pct = parseFloat(sl[1]);
	// Match either order: "trailing 25%" or "30% trailing stop".
	const trail = t.match(/(?:trailing|trail)(?:\s*stop)?\D{0,10}?(\d+(?:\.\d+)?)\s*%|(\d+(?:\.\d+)?)\s*%\s*trailing/);
	if (trail) out.trailing_stop_pct = parseFloat(trail[1] || trail[2]);

	const perTrade = t.match(/(\d+(?:\.\d+)?)\s*sol\s*(?:per|\/|each|a)\s*(?:trade|snipe|buy|position)/);
	if (perTrade) out.per_trade_sol = parseFloat(perTrade[1]);
	const maxPer = t.match(/(?:max|up to)\s*(\d+(?:\.\d+)?)\s*sol/);
	if (maxPer && out.per_trade_sol == null) out.per_trade_sol = parseFloat(maxPer[1]);
	const daily = t.match(/(\d+(?:\.\d+)?)\s*sol\s*(?:a|per|\/)\s*day|daily\s*budget\D{0,8}(\d+(?:\.\d+)?)\s*sol/);
	if (daily) out.daily_budget_sol = parseFloat(daily[1] || daily[2]);

	const underMc = t.match(/(?:under|below|less than|max(?:imum)?(?:\s*market\s*cap)?(?:\s*of)?)\s*\$?\s*([\d.,]+\s*[km]?)/);
	if (underMc && /market\s*cap|mcap|mc\b|cap/.test(t)) out.max_market_cap_usd = moneyToNum(underMc[1]);
	const overMc = t.match(/(?:over|above|more than|min(?:imum)?(?:\s*market\s*cap)?(?:\s*of)?)\s*\$?\s*([\d.,]+\s*[km]?)/);
	if (overMc && /market\s*cap|mcap|mc\b|cap/.test(t)) out.min_market_cap_usd = moneyToNum(overMc[1]);

	const grad = t.match(/graduat\w*\s*(?:at least\s*|>=?\s*)?(\d+)|(\d+)\+?\s*graduat/);
	if (grad) out.min_creator_graduated = parseInt(grad[1] || grad[2], 10);

	const hold = t.match(/(?:hold|timeout|exit after)\D{0,10}?(\d+(?:\.\d+)?)\s*(min|minute|hour|hr|sec|second)/);
	if (hold) {
		let s = parseFloat(hold[1]);
		if (/min/.test(hold[2])) s *= 60; else if (/h/.test(hold[2])) s *= 3600;
		out.max_hold_seconds = Math.round(s);
	}

	const impact = t.match(/(\d+(?:\.\d+)?)\s*%\s*(?:max(?:imum)?\s*)?(?:price\s*)?impact|(?:price\s*)?impact\D{0,12}?(\d+(?:\.\d+)?)\s*%/);
	if (impact) out.max_price_impact_pct = parseFloat(impact[1] || impact[2]);

	const slip = t.match(/(\d+(?:\.\d+)?)\s*%?\s*slippage|slippage\D{0,8}(\d+(?:\.\d+)?)\s*%/);
	if (slip) out.slippage_pct = parseFloat(slip[1] || slip[2]);

	if (/\bsocials?\b|twitter|telegram|website/.test(t)) out.require_socials = true;
	if (/no dev (?:dump|sell)|dev (?:hasn'?t|didn'?t) (?:dump|sell)/.test(t)) out.avoid_dev_dump = true;

	// intel signals
	if (/organic|no bundle|not bundled|clean (?:launch|distribution)|distributed/.test(t)) {
		out.trigger = 'intel_confirmed';
		out.max_bundle_score = 0.3;
		if (out.min_quality_score == null) out.min_quality_score = 55;
		out.assumptions.push('Read "organic / clean distribution" as a low bundle-score ceiling (0.3) and a 55+ quality bar.');
	}
	const conc = t.match(/(?:concentration|top\s*holder|whale)\D{0,12}?(\d+(?:\.\d+)?)\s*%/);
	if (conc) { out.trigger = 'intel_confirmed'; out.max_concentration_top1 = parseFloat(conc[1]); }
	const q = t.match(/quality\D{0,10}?(\d+(?:\.\d+)?)/);
	if (q) { out.trigger = 'intel_confirmed'; out.min_quality_score = parseFloat(q[1]); }
	for (const cat of KNOWN_CATEGORIES) {
		if (new RegExp(`\\b${cat}\\b`).test(t)) out.allowed_categories = [...(out.allowed_categories || []), cat];
	}
	if (out.allowed_categories) out.trigger = 'intel_confirmed';

	// research gates (Strategy Object): these don't need the intel trigger
	const holders = t.match(/(?:at least|min(?:imum)?|>=?|over|more than)\s*(\d[\d,]*)\s*holders?|(\d[\d,]*)\+\s*holders?/);
	if (holders) out.min_holders = parseInt((holders[1] || holders[2]).replace(/,/g, ''), 10);
	const liq = t.match(/(\d+(?:\.\d+)?)\s*sol\s*(?:of\s*)?liquidity|liquidity\D{0,16}?(\d+(?:\.\d+)?)\s*sol/);
	if (liq) out.min_liquidity_sol = parseFloat(liq[1] || liq[2]);
	const secScore = t.match(/(?:security|safety|firewall|rug)\s*score\D{0,10}?(\d+)/);
	if (secScore) out.security_min_score = parseInt(secScore[1], 10);
	if (/(?:renounced|revoked|no)\s*mint(?:\s*authority)?|mint\s*authority\s*(?:renounced|revoked|disabled)/.test(t)) out.require_no_mint_authority = true;
	if (/(?:renounced|revoked|no)\s*freeze(?:\s*authority)?|freeze\s*authority\s*(?:renounced|revoked|disabled)/.test(t)) out.require_no_freeze_authority = true;
	// The number-word pass above has already turned "three.ws" into "3.ws".
	if (/(?:three\.ws|3\.ws|threews|platform)\s*launch/.test(t)) out.sources = ['three_ws_launch'];
	if (/\bauto(?:matically)?\b|without asking|no approval|don'?t ask/.test(t)) out.mode = 'auto';
	else if (/\bask (?:me|first)|approval|approve each|confirm each/.test(t)) out.mode = 'ask';

	return out;
}
