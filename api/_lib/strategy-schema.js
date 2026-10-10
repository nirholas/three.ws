// Strategy Object config — the validated, versioned rule set behind a Strategy.
//
// A strategy is NOT free text: it is a structured plan with a real schema. This
// module is the single source of truth for that schema. It normalizes arbitrary
// owner input into a clean, bounded config; validates it (so a malformed rule
// set can never be saved); and evaluates a real pump.fun launch against the
// entry conditions (pure + synchronous, so it is trivially testable and the same
// logic runs in the runtime and in a backtest).
//
// Critically, the strategy's own caps (per-trade size, slippage, concurrency)
// are ADDITIONAL constraints layered on top of the agent's server-side spend
// policy — never a way around it. The runtime sizes a buy from `sizing.amount_sol`
// but the trade still passes through the full guard + custody path, so a strategy
// can never exceed the spend leash. Ever.
//
// Version 2 adds the strategy settings an owner tunes in the Strategy Lab:
//   entry.sources            which launch venues a candidate may come from
//   sizing.max_price_impact_bps  a per-strategy price-impact ceiling, applied
//                            as min(this, the agent's own breaker)
//   research                 pre-buy research gates evaluated against a real
//                            gate report (holders, top holder, liquidity,
//                            firewall security score, authorities, dev history)
//   mode                     'auto' buys within caps; 'ask' files an approval
//                            request and waits for the owner's explicit yes
// A v1 config normalizes to v2 losslessly; a config with no mode becomes 'ask',
// the conservative default (the migration backfills stored rows the same way).

const ENTRY_TRIGGERS = ['new_launch'];
const NETWORKS = ['mainnet', 'devnet'];
const STRATEGY_MODES = ['auto', 'ask'];
// Where a candidate can come from. `pump_curve` is any live pump.fun bonding-curve
// launch; `three_ws_launch` is a coin an agent launched through three.ws
// (pump_agent_mints), which is also on the curve. An empty list means every
// source; ['three_ws_launch'] means platform launches only.
const ENTRY_SOURCES = ['pump_curve', 'three_ws_launch'];
export const STRATEGY_CONFIG_VERSION = 2;

export const STRATEGY_CONFIG_DEFAULTS = Object.freeze({
	version: STRATEGY_CONFIG_VERSION,
	mode: 'ask',
	network: 'mainnet',
	entry: {
		trigger: 'new_launch',
		sources: [],
		max_age_minutes: 60,
		min_market_cap_usd: null,
		max_market_cap_usd: null,
		min_liquidity_sol: null,
		require_socials: false,
		max_creator_launches: null,
		min_creator_graduated: null,
		require_sol_quote: true,
	},
	sizing: {
		amount_sol: 0.1,
		max_slippage_bps: 500,
		max_price_impact_bps: null,
	},
	exits: {
		take_profit_pct: 100, // +100% = 2x
		stop_loss_pct: 40, // -40%
		trailing_stop_pct: null,
		max_hold_minutes: null,
	},
	risk: {
		max_concurrent_positions: 3,
		cooldown_minutes: 0,
	},
	research: {
		min_holders: null,
		max_top_holder_pct: null,
		min_liquidity_sol: null,
		security_min_score: null,
		require_no_mint_authority: false,
		require_no_freeze_authority: false,
		dev_history: {
			max_launches: null,
			min_graduated: null,
			block_dev_sold: false,
		},
	},
});

// Hard ceilings the schema enforces regardless of input — defensive bounds so a
// stored config can never carry a nonsense number into the runtime.
const BOUNDS = Object.freeze({
	amount_sol: { min: 0.0001, max: 100 },
	max_slippage_bps: { min: 0, max: 10000 },
	max_age_minutes: { min: 1, max: 10080 }, // up to 7 days
	take_profit_pct: { min: 1, max: 100000 },
	stop_loss_pct: { min: 1, max: 99 },
	trailing_stop_pct: { min: 1, max: 99 },
	max_hold_minutes: { min: 1, max: 525600 }, // up to 1 year
	max_concurrent_positions: { min: 1, max: 50 },
	cooldown_minutes: { min: 0, max: 10080 },
	market_cap_usd: { min: 0, max: 1e12 },
	liquidity_sol: { min: 0, max: 1e9 },
	creator_count: { min: 0, max: 100000 },
	price_impact_bps: { min: 1, max: 10000 },
	holders: { min: 0, max: 10000000 },
	pct: { min: 0, max: 100 },
	score: { min: 0, max: 100 },
});

// Owners and the natural-language compiler may write camelCase; the stored
// shape is snake_case like every other config key. First present key wins.
function pick(obj, ...keys) {
	for (const k of keys) if (obj && obj[k] !== undefined) return obj[k];
	return undefined;
}

function normalizeSources(v) {
	if (!Array.isArray(v)) return [];
	const out = [];
	for (const raw of v) {
		const s = String(raw || '').trim().toLowerCase();
		if (ENTRY_SOURCES.includes(s) && !out.includes(s)) out.push(s);
	}
	return out.length === ENTRY_SOURCES.length ? [] : out;
}

function numOrNull(v, { min = -Infinity, max = Infinity } = {}) {
	if (v === null || v === undefined || v === '') return null;
	const n = Number(v);
	if (!Number.isFinite(n)) return null;
	return Math.min(max, Math.max(min, n));
}

function intOrNull(v, bounds) {
	const n = numOrNull(v, bounds);
	return n === null ? null : Math.round(n);
}

function clampNum(v, def, { min = 0, max = Infinity, round = false } = {}) {
	const n = Number(v);
	if (!Number.isFinite(n)) return def;
	const c = Math.min(max, Math.max(min, n));
	return round ? Math.round(c) : c;
}

/** Turn a strategy name into a URL-safe, stable slug. */
export function slugifyStrategy(name) {
	const base = String(name || '')
		.toLowerCase()
		.trim()
		.replace(/[^a-z0-9]+/g, '-')
		.replace(/^-+|-+$/g, '')
		.slice(0, 48);
	return base || 'strategy';
}

/**
 * Coerce arbitrary input into a clean, bounded, complete strategy config.
 * Always returns a fully-populated object (missing keys fall back to defaults).
 */
export function normalizeStrategyConfig(raw) {
	const r = raw && typeof raw === 'object' ? raw : {};
	const e = r.entry && typeof r.entry === 'object' ? r.entry : {};
	const s = r.sizing && typeof r.sizing === 'object' ? r.sizing : {};
	const x = r.exits && typeof r.exits === 'object' ? r.exits : {};
	const k = r.risk && typeof r.risk === 'object' ? r.risk : {};
	const q = r.research && typeof r.research === 'object' ? r.research : {};
	const dvRaw = pick(q, 'dev_history', 'devHistory');
	const dv = dvRaw && typeof dvRaw === 'object' ? dvRaw : {};
	const d = STRATEGY_CONFIG_DEFAULTS;

	const trigger = ENTRY_TRIGGERS.includes(e.trigger) ? e.trigger : d.entry.trigger;
	const network = NETWORKS.includes(r.network) ? r.network : d.network;
	const mode = STRATEGY_MODES.includes(r.mode) ? r.mode : d.mode;

	// Creator history and liquidity exist both as cheap entry pre-filters (v1)
	// and as research gates (v2). They are one setting: the research value wins
	// when present, the legacy entry value fills it otherwise, and both halves are
	// written back identical so the two evaluators can never disagree.
	const maxLaunches = intOrNull(pick(dv, 'max_launches', 'maxLaunches') ?? e.max_creator_launches, BOUNDS.creator_count);
	const minGraduated = intOrNull(pick(dv, 'min_graduated', 'minGraduated') ?? e.min_creator_graduated, BOUNDS.creator_count);
	const minLiq = numOrNull(pick(q, 'min_liquidity_sol', 'minLiquiditySol') ?? e.min_liquidity_sol, BOUNDS.liquidity_sol);

	return {
		version: STRATEGY_CONFIG_VERSION,
		mode,
		network,
		entry: {
			trigger,
			sources: normalizeSources(e.sources),
			max_age_minutes: clampNum(e.max_age_minutes, d.entry.max_age_minutes, { ...BOUNDS.max_age_minutes, round: true }),
			min_market_cap_usd: numOrNull(e.min_market_cap_usd, BOUNDS.market_cap_usd),
			max_market_cap_usd: numOrNull(e.max_market_cap_usd, BOUNDS.market_cap_usd),
			min_liquidity_sol: minLiq,
			require_socials: e.require_socials === true,
			max_creator_launches: maxLaunches,
			min_creator_graduated: minGraduated,
			require_sol_quote: e.require_sol_quote !== false,
		},
		sizing: {
			amount_sol: clampNum(s.amount_sol, d.sizing.amount_sol, BOUNDS.amount_sol),
			max_slippage_bps: clampNum(s.max_slippage_bps, d.sizing.max_slippage_bps, { ...BOUNDS.max_slippage_bps, round: true }),
			max_price_impact_bps: intOrNull(pick(s, 'max_price_impact_bps', 'maxPriceImpactBps'), BOUNDS.price_impact_bps),
		},
		exits: {
			take_profit_pct: numOrNull(x.take_profit_pct, BOUNDS.take_profit_pct),
			// stop_loss is mandatory and always present — default applied if absent/invalid.
			stop_loss_pct: clampNum(x.stop_loss_pct, d.exits.stop_loss_pct, BOUNDS.stop_loss_pct),
			trailing_stop_pct: numOrNull(x.trailing_stop_pct, BOUNDS.trailing_stop_pct),
			max_hold_minutes: intOrNull(x.max_hold_minutes, BOUNDS.max_hold_minutes),
		},
		risk: {
			max_concurrent_positions: clampNum(k.max_concurrent_positions, d.risk.max_concurrent_positions, { ...BOUNDS.max_concurrent_positions, round: true }),
			cooldown_minutes: clampNum(k.cooldown_minutes, d.risk.cooldown_minutes, { ...BOUNDS.cooldown_minutes, round: true }),
		},
		research: {
			min_holders: intOrNull(pick(q, 'min_holders', 'minHolders'), BOUNDS.holders),
			max_top_holder_pct: numOrNull(pick(q, 'max_top_holder_pct', 'maxTopHolderPct'), BOUNDS.pct),
			min_liquidity_sol: minLiq,
			security_min_score: intOrNull(pick(q, 'security_min_score', 'securityMinScore'), BOUNDS.score),
			require_no_mint_authority: pick(q, 'require_no_mint_authority', 'requireNoMintAuthority') === true,
			require_no_freeze_authority: pick(q, 'require_no_freeze_authority', 'requireNoFreezeAuthority') === true,
			dev_history: {
				max_launches: maxLaunches,
				min_graduated: minGraduated,
				block_dev_sold: pick(dv, 'block_dev_sold', 'blockDevSold') === true,
			},
		},
	};
}

/** True when any research gate is switched on (the runtime skips the report otherwise). */
export function researchGatesActive(config) {
	const g = config?.research;
	if (!g) return false;
	const dv = g.dev_history || {};
	return g.min_holders != null || g.max_top_holder_pct != null || g.min_liquidity_sol != null
		|| g.security_min_score != null || g.require_no_mint_authority || g.require_no_freeze_authority
		|| dv.max_launches != null || dv.min_graduated != null || dv.block_dev_sold === true;
}

/**
 * The effective price-impact ceiling in percent for one strategy trade: the
 * tighter of the agent's breaker and the strategy's own max_price_impact_bps.
 * A strategy can only tighten the agent's limit, never loosen it.
 */
export function effectivePriceImpactPct(config, agentMaxPct) {
	const own = config?.sizing?.max_price_impact_bps;
	const ownPct = own == null ? null : own / 100;
	const agent = agentMaxPct == null || !Number.isFinite(Number(agentMaxPct)) ? null : Number(agentMaxPct);
	if (ownPct == null) return agent;
	if (agent == null) return ownPct;
	return Math.min(ownPct, agent);
}

/**
 * The sources one launch belongs to, for the entry.sources filter. The live feed
 * only carries bonding-curve coins (graduated ones are dropped upstream), so
 * every candidate is `pump_curve`; a three.ws agent launch is also tagged.
 */
export function launchSources(launch) {
	const out = ['pump_curve'];
	if (launch?.three_ws_launch === true) out.push('three_ws_launch');
	return out;
}

/**
 * Validate a strategy config. Returns { valid, errors:[{field,message}], config }.
 * `config` is the normalized form (safe to persist). Errors are human-readable
 * and field-tagged so the UI can show them inline.
 */
export function validateStrategyConfig(raw) {
	const errors = [];
	const config = normalizeStrategyConfig(raw);

	if (!(config.sizing.amount_sol > 0)) {
		errors.push({ field: 'sizing.amount_sol', message: 'Per-trade size must be greater than 0 SOL.' });
	}
	if (!(config.exits.stop_loss_pct > 0)) {
		errors.push({ field: 'exits.stop_loss_pct', message: 'A stop-loss is required — every strategy must define its downside.' });
	}
	if (
		config.entry.min_market_cap_usd != null &&
		config.entry.max_market_cap_usd != null &&
		config.entry.min_market_cap_usd > config.entry.max_market_cap_usd
	) {
		errors.push({ field: 'entry.max_market_cap_usd', message: 'Max market cap must be greater than min market cap.' });
	}
	if (config.exits.take_profit_pct == null && config.exits.trailing_stop_pct == null && config.exits.max_hold_minutes == null) {
		errors.push({ field: 'exits', message: 'Define at least one upside exit: take-profit, trailing stop, or max hold.' });
	}
	const rawMode = raw && typeof raw === 'object' ? raw.mode : undefined;
	if (rawMode !== undefined && rawMode !== null && !STRATEGY_MODES.includes(rawMode)) {
		errors.push({ field: 'mode', message: 'Mode must be "auto" (buy within caps) or "ask" (request approval for each buy).' });
	}
	const rawSources = raw?.entry?.sources;
	if (Array.isArray(rawSources)) {
		const bad = rawSources.filter((x) => !ENTRY_SOURCES.includes(String(x || '').trim().toLowerCase()));
		if (bad.length) errors.push({ field: 'entry.sources', message: `Unknown source: ${bad.map(String).join(', ')}. Use ${ENTRY_SOURCES.join(', ')}.` });
	}

	return { valid: errors.length === 0, errors, config };
}

/**
 * Evaluate one real launch against a strategy's entry conditions. Pure +
 * synchronous. Returns { pass, reasons } — reasons always explains the verdict
 * (kept on rejections too, for the runtime's evaluation log).
 *
 * @param {object} config  normalized strategy config
 * @param {object} launch  normalized launch: { mint, created_at(ms), market_cap_usd,
 *                         liquidity_sol, creator_launches, creator_graduated,
 *                         twitter, telegram, website, is_usdc_pair }
 * @param {number} nowMs   current epoch ms
 */
export function matchesEntry(config, launch, nowMs) {
	const e = config.entry;
	const reasons = [];

	if (!launch || !launch.mint) return { pass: false, reasons: ['no_mint'] };

	// Age gate — only act on genuinely recent launches.
	if (e.max_age_minutes != null && launch.created_at) {
		const ageMin = (nowMs - Number(launch.created_at)) / 60000;
		if (!Number.isFinite(ageMin) || ageMin < 0) {
			// Clock skew / bad timestamp — treat as fresh, don't reject.
		} else if (ageMin > e.max_age_minutes) {
			return { pass: false, reasons: [`too_old:${Math.round(ageMin)}m`] };
		} else {
			reasons.push(`age:${Math.round(ageMin)}m`);
		}
	}

	// SOL-quote requirement — the agent wallet trades in SOL on this path.
	if (e.require_sol_quote && launch.is_usdc_pair === true) {
		return { pass: false, reasons: ['quote_not_sol'] };
	}

	// Source filter: the candidate must come from at least one allowed venue.
	if (Array.isArray(e.sources) && e.sources.length) {
		const have = launchSources(launch);
		if (!have.some((src) => e.sources.includes(src))) {
			return { pass: false, reasons: [`source_excluded:${have.join('+')}`] };
		}
	}

	const mc = numOrNull(launch.market_cap_usd);
	if (e.min_market_cap_usd != null) {
		if (mc == null || mc < e.min_market_cap_usd) return { pass: false, reasons: [`mc_below_min:${mc ?? 'n/a'}`] };
	}
	if (e.max_market_cap_usd != null && mc != null && mc > e.max_market_cap_usd) {
		return { pass: false, reasons: [`mc_above_max:${Math.round(mc)}`] };
	}
	if (mc != null) reasons.push(`mc:${Math.round(mc)}`);

	const liq = numOrNull(launch.liquidity_sol);
	if (e.min_liquidity_sol != null) {
		if (liq == null || liq < e.min_liquidity_sol) return { pass: false, reasons: [`liq_below_min:${liq ?? 'n/a'}`] };
		reasons.push(`liq:${liq.toFixed(2)}sol`);
	}

	const launches = numOrNull(launch.creator_launches);
	if (e.max_creator_launches != null && launches != null && launches > e.max_creator_launches) {
		return { pass: false, reasons: [`creator_launches:${launches}`] };
	}
	const graduated = numOrNull(launch.creator_graduated);
	if (e.min_creator_graduated != null) {
		if (graduated == null || graduated < e.min_creator_graduated) return { pass: false, reasons: [`creator_graduated_below:${graduated ?? 'n/a'}`] };
		reasons.push(`creator_graduated:${graduated}`);
	}

	const hasSocials = !!(launch.twitter || launch.telegram || launch.website);
	if (e.require_socials && !hasSocials) {
		return { pass: false, reasons: ['no_socials'] };
	}
	if (hasSocials) reasons.push('has_socials');

	return { pass: true, reasons };
}

// Plain-language labels for each research check, shared by the runtime's
// decision log, the Lab's block breakdown, and the compiler's explanations.
export const RESEARCH_CHECK_LABELS = Object.freeze({
	min_holders: 'Minimum holders',
	max_top_holder_pct: 'Largest holder share',
	min_liquidity_sol: 'Minimum liquidity',
	security_min_score: 'Firewall security score',
	require_no_mint_authority: 'Mint authority renounced',
	require_no_freeze_authority: 'Freeze authority renounced',
	dev_max_launches: 'Creator launch count',
	dev_min_graduated: 'Creator graduations',
	dev_block_sold: 'Creator has not sold',
});

const NUMBER_FORMATS = new Map();
function fmt(v, digits = 2) {
	if (v == null) return 'unknown';
	let f = NUMBER_FORMATS.get(digits);
	if (!f) NUMBER_FORMATS.set(digits, (f = new Intl.NumberFormat('en-US', { maximumFractionDigits: digits })));
	return f.format(Number(v));
}

/**
 * Evaluate a strategy's research gates against a gate report. Pure + sync.
 *
 * Fail closed: a gate the owner switched on whose data the report could not
 * establish blocks the buy with an "unknown" reason. A research gate exists to
 * prove something about a coin before money moves, so "could not check" is
 * never treated as "passed". Gates left off are reported with status 'off'.
 *
 * @param {object} config  normalized strategy config
 * @param {object} report  gate report (api/_lib/strategy-research.js#buildGateReport):
 *   { holders:{count, top_holder_pct}, liquidity:{sol}, security:{score},
 *     authority:{known, mint_authority, freeze_authority},
 *     dev:{launches, graduated, sold} }
 * @returns {{ pass:boolean, blocked_by:Array, checks:Array }}
 *   each check: { check, label, status:'pass'|'fail'|'unknown'|'off', actual, required, reason }
 */
export function evaluateResearchGates(config, report) {
	const g = config?.research || STRATEGY_CONFIG_DEFAULTS.research;
	const dv = g.dev_history || {};
	const r = report || {};
	const checks = [];

	const add = (check, required, actual, ok, reason) => {
		let status;
		if (required == null || required === false) status = 'off';
		else if (actual == null) status = 'unknown';
		else status = ok ? 'pass' : 'fail';
		// Reasons are built only for checks that ran: the match preview replays tens
		// of thousands of coins through this function, and number formatting is slow.
		let why = null;
		if (status === 'unknown') why = `${RESEARCH_CHECK_LABELS[check]} could not be verified, so the buy is held back.`;
		else if (status !== 'off') why = reason();
		checks.push({ check, label: RESEARCH_CHECK_LABELS[check], status, actual: actual ?? null, required: required === false ? null : required, reason: why });
	};

	const holders = numOrNull(r.holders?.count);
	add('min_holders', g.min_holders, holders, holders != null && holders >= g.min_holders,
		() => `${fmt(holders, 0)} holders against a minimum of ${fmt(g.min_holders, 0)}.`);

	const top = numOrNull(r.holders?.top_holder_pct);
	add('max_top_holder_pct', g.max_top_holder_pct, top, top != null && top <= g.max_top_holder_pct,
		() => `The largest holder owns ${fmt(top, 1)}% against a ceiling of ${fmt(g.max_top_holder_pct, 1)}%.`);

	const liq = numOrNull(r.liquidity?.sol);
	add('min_liquidity_sol', g.min_liquidity_sol, liq, liq != null && liq >= g.min_liquidity_sol,
		() => `${fmt(liq)} SOL of liquidity against a minimum of ${fmt(g.min_liquidity_sol)} SOL.`);

	const score = numOrNull(r.security?.score);
	add('security_min_score', g.security_min_score, score, score != null && score >= g.security_min_score,
		() => `Firewall score ${fmt(score, 0)}/100 against a minimum of ${fmt(g.security_min_score, 0)}.`);

	const authKnown = r.authority?.known === true;
	const mintAuth = authKnown ? (r.authority.mint_authority ? 'active' : 'renounced') : null;
	add('require_no_mint_authority', g.require_no_mint_authority || null, mintAuth, mintAuth === 'renounced',
		() => mintAuth === 'active' ? 'The creator can still mint new supply.' : 'Mint authority is renounced.');
	const freezeAuth = authKnown ? (r.authority.freeze_authority ? 'active' : 'renounced') : null;
	add('require_no_freeze_authority', g.require_no_freeze_authority || null, freezeAuth, freezeAuth === 'renounced',
		() => freezeAuth === 'active' ? 'The creator can freeze holder accounts, so a buy might never sell.' : 'Freeze authority is renounced.');

	const launches = numOrNull(r.dev?.launches);
	add('dev_max_launches', dv.max_launches, launches, launches != null && launches <= dv.max_launches,
		() => `The creator has launched ${fmt(launches, 0)} coins against a ceiling of ${fmt(dv.max_launches, 0)}.`);
	const grads = numOrNull(r.dev?.graduated);
	add('dev_min_graduated', dv.min_graduated, grads, grads != null && grads >= dv.min_graduated,
		() => `The creator has graduated ${fmt(grads, 0)} coins against a minimum of ${fmt(dv.min_graduated, 0)}.`);
	const sold = typeof r.dev?.sold === 'boolean' ? (r.dev.sold ? 'sold' : 'holding') : null;
	add('dev_block_sold', dv.block_dev_sold || null, sold, sold === 'holding',
		() => sold === 'sold' ? 'The creator has already sold their own allocation.' : 'The creator has not sold.');

	const blocked_by = checks
		.filter((c) => c.status === 'fail' || c.status === 'unknown')
		.map(({ check, label, status, actual, required, reason }) => ({ check, label, status, actual, required, reason }));
	return { pass: blocked_by.length === 0, blocked_by, checks };
}

/**
 * Decide whether an open position should exit, given a live re-quote. Pure.
 * Returns { exit, reason } — reason ∈ take_profit|stop_loss|trailing_stop|timeout.
 *
 * @param {object} config normalized config
 * @param {object} pos    { entry_lamports, peak_value_lamports, opened_at(ms) }
 * @param {bigint|number|string} currentValueLamports  live quoteForSell value
 * @param {number} nowMs
 */
export function shouldExit(config, pos, currentValueLamports, nowMs) {
	const x = config.exits;
	const entry = Number(pos.entry_lamports || 0);
	const cur = Number(currentValueLamports || 0);

	// Time-based exit is independent of price — check it even with no entry basis.
	if (x.max_hold_minutes != null && pos.opened_at) {
		const heldMin = (nowMs - Number(pos.opened_at)) / 60000;
		if (heldMin >= x.max_hold_minutes) return { exit: true, reason: 'timeout' };
	}

	if (!(entry > 0) || !(cur >= 0)) return { exit: false, reason: null };
	const pnlPct = ((cur - entry) / entry) * 100;

	if (x.take_profit_pct != null && pnlPct >= x.take_profit_pct) {
		return { exit: true, reason: 'take_profit' };
	}
	if (x.stop_loss_pct != null && pnlPct <= -x.stop_loss_pct) {
		return { exit: true, reason: 'stop_loss' };
	}
	if (x.trailing_stop_pct != null) {
		const peak = Math.max(Number(pos.peak_value_lamports || 0), cur, entry);
		if (peak > 0) {
			const dropFromPeakPct = ((peak - cur) / peak) * 100;
			if (dropFromPeakPct >= x.trailing_stop_pct) return { exit: true, reason: 'trailing_stop' };
		}
	}
	return { exit: false, reason: null };
}

export { ENTRY_TRIGGERS, NETWORKS, STRATEGY_MODES, ENTRY_SOURCES };
