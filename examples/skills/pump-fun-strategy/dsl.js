// Strategy DSL — pure functions. No I/O, no side effects.
//
// A strategy spec describes:
//   scan:    where new candidate tokens come from (newTokens | trending | mintList)
//   filters: predicates that must pass before entering a position
//   entry:   { side: 'buy', amountSol }
//   exit:    array of { if: <predicate>, do: { side: 'sell', percent | amountTokens } }
//
// Predicates are tiny strings: "<lhs> <op> <rhs>".
//   lhs paths are dotted, resolved against a `view` object the runner builds:
//     holders.total, holders.topHolderPct, creator.rugCount,
//     curve.graduationPct, position.pnlPct, position.ageSec, etc.
//   ops: > >= < <= == !=
//
// Keeping the predicate language deliberately tiny — same evaluator powers
// live runs and the backtester so they cannot drift.

const OP_RE = /^\s*([\w.]+)\s*(>=|<=|==|!=|>|<)\s*(-?[\d.]+%?)\s*$/;

const OPS = {
	'>':  (a, b) => a > b,
	'>=': (a, b) => a >= b,
	'<':  (a, b) => a < b,
	'<=': (a, b) => a <= b,
	'==': (a, b) => a === b,
	'!=': (a, b) => a !== b,
};

export function parsePredicate(src) {
	const m = OP_RE.exec(src);
	if (!m) throw new Error(`bad predicate: ${src}`);
	const [, lhs, op, rhsRaw] = m;
	const rhs = rhsRaw.endsWith('%') ? Number(rhsRaw.slice(0, -1)) : Number(rhsRaw);
	if (Number.isNaN(rhs)) throw new Error(`bad rhs in: ${src}`);
	return { lhs, op, rhs, src };
}

function get(view, path) {
	return path.split('.').reduce((o, k) => (o == null ? undefined : o[k]), view);
}

export function evalPredicate(pred, view) {
	const left = get(view, pred.lhs);
	if (left == null || Number.isNaN(left)) return false;
	const fn = OPS[pred.op];
	return fn(left, pred.rhs);
}

export function compileStrategy(spec) {
	if (!spec || typeof spec !== 'object') throw new Error('strategy must be an object');
	if (!spec.scan) throw new Error('strategy.scan required');
	if (!spec.entry) throw new Error('strategy.entry required');

	const filters = (spec.filters ?? []).map(parsePredicate);
	const exits = (spec.exit ?? []).map((rule) => ({
		when: parsePredicate(rule.if),
		action: rule.do,
	}));

	return {
		scan: spec.scan,                    // { kind: 'newTokens'|'trending'|'mintList', limit?, mints? }
		filters,
		entry: spec.entry,                  // { side: 'buy', amountSol }
		exits,
		caps: spec.caps ?? {},              // { sessionSpendCapSol, perTradeSol, maxOpenPositions }
		passes(view)  { return filters.every((p) => evalPredicate(p, view)); },
		shouldExit(view) {
			for (const e of exits) if (evalPredicate(e.when, view)) return e.action;
			return null;
		},
	};
}

// ── Metric catalog ───────────────────────────────────────────────────────────
// The explicit schema for predicate left-hand-sides. This is the single source
// of truth for which paths a strategy may reference, the natural domain of each
// (used to detect impossible thresholds), and the run contexts in which the
// value actually exists:
//   - 'filter': the entry-candidate view (no open position yet).
//   - 'exit':   the open-position view (has position.*).
// buildView() below MUST stay in sync with this table — every populated path is
// listed, and nothing is listed that buildView never populates. Keeping the two
// together is what lets the validator promise that a strategy which validates
// will run with the same meaning.
//
// domain: { min, max } — null means unbounded on that side. `integer` flags
// counts (== on a fractional rhs is then impossible).
export const METRICS = {
	'holders.total':         { min: 0,    max: null, integer: true,  contexts: ['filter', 'exit'], label: 'holder count' },
	'holders.topHolderPct':  { min: 0,    max: 100,  integer: false, contexts: ['filter', 'exit'], label: 'top-holder %' },
	'creator.rugCount':      { min: 0,    max: null, integer: true,  contexts: ['filter', 'exit'], label: 'creator rug count' },
	'curve.graduationPct':   { min: 0,    max: 100,  integer: false, contexts: ['filter', 'exit'], label: 'graduation %' },
	'curve.priceSol':        { min: 0,    max: null, integer: false, contexts: ['filter', 'exit'], label: 'price (SOL)' },
	'token.ageSec':          { min: 0,    max: null, integer: false, contexts: ['filter', 'exit'], label: 'token age (s)' },
	'token.marketCapSol':    { min: 0,    max: null, integer: false, contexts: ['filter', 'exit'], label: 'market cap (SOL)' },
	'position.pnlPct':       { min: -100, max: null, integer: false, contexts: ['exit'],            label: 'position PnL %' },
	'position.ageSec':       { min: 0,    max: null, integer: false, contexts: ['exit'],            label: 'position age (s)' },
	'position.amountTokens': { min: 0,    max: null, integer: false, contexts: ['exit'],            label: 'position size (tokens)' },
	'position.entryPriceSol':{ min: 0,    max: null, integer: false, contexts: ['exit'],            label: 'entry price (SOL)' },
};

export const SCAN_KINDS = ['newTokens', 'trending', 'mintList'];

const LAMPORTS_PER_SOL = 1e9;
const PUMP_TOKEN_DECIMALS = 6;

/** A finite number from a number or numeric string, else undefined. */
function num(v) {
	if (v == null || v === '') return undefined;
	const n = typeof v === 'number' ? v : Number(v);
	return Number.isFinite(n) ? n : undefined;
}

/** First finite value among the candidates, else undefined. */
function firstNum(...candidates) {
	for (const c of candidates) {
		const n = num(c);
		if (n !== undefined) return n;
	}
	return undefined;
}

/**
 * Spot price in SOL per whole token. An explicit price wins; otherwise it is
 * derived from the bonding curve's virtual reserves, which is what the live
 * pump-fun MCP `getBondingCurve` returns (lamports over 6-decimal base units).
 */
export function curvePriceSol(curve, decimals = PUMP_TOKEN_DECIMALS) {
	const explicit = firstNum(curve?.priceSol, curve?.price);
	if (explicit !== undefined) return explicit;
	const vSol = num(curve?.virtualSolReserves);
	const vTok = num(curve?.virtualTokenReserves);
	if (vSol === undefined || vTok === undefined || vSol <= 0 || vTok <= 0) return undefined;
	return (vSol / LAMPORTS_PER_SOL) / (vTok / 10 ** decimals);
}

function launchAgeSec(details) {
	const raw = details?.createdAt ?? details?.created_at ?? details?.created_timestamp;
	if (raw == null) return undefined;
	const ms = typeof raw === 'number' ? (raw < 1e12 ? raw * 1000 : raw) : new Date(raw).getTime();
	if (!Number.isFinite(ms)) return undefined;
	return Math.max(0, (Date.now() - ms) / 1000);
}

// Build the `view` object the predicates evaluate against. Pure: takes raw
// pump-fun-style payloads + (optional) position state.
//
// A metric whose source payload is missing or does not carry it stays
// undefined, never 0: evalPredicate treats undefined as false, so a filter on
// data we could not fetch fails closed instead of passing on a fabricated zero
// ("creator.rugCount == 0" must not pass because the creator profile is down).
export function buildView({ details, holders, creator, curve, position, trades }) {
	const decimals = firstNum(details?.decimals) ?? PUMP_TOKEN_DECIMALS;
	const priceSol = curvePriceSol(curve, decimals);
	const supplyRaw = num(details?.supply);
	const v = {
		holders: {
			// `holders.count` from the MCP is the size of the largest-accounts
			// sample (max 20), not the number of holders, so it is not used here.
			total: firstNum(holders?.total, holders?.holderCount),
			topHolderPct: firstNum(holders?.topHolderPct, holders?.topHolderPercent, holders?.holders?.[0]?.pct),
		},
		creator: {
			rugCount: firstNum(creator?.rugCount, creator?.rug_count, Array.isArray(creator?.rugFlags) ? creator.rugFlags.length : undefined),
		},
		curve: {
			graduationPct: firstNum(curve?.graduationPct, curve?.graduationPercent, curve?.progressPct),
			priceSol,
		},
		token: {
			ageSec: launchAgeSec(details),
			marketCapSol: firstNum(
				details?.marketCapSol,
				priceSol !== undefined && supplyRaw !== undefined ? priceSol * (supplyRaw / 10 ** decimals) : undefined,
			),
		},
	};
	if (position) {
		const entryPrice = position.entryPriceSol ?? 0;
		const nowPrice = v.curve.priceSol || position.lastPriceSol || entryPrice;
		v.position = {
			pnlPct: entryPrice > 0 ? ((nowPrice - entryPrice) / entryPrice) * 100 : 0,
			ageSec: position.openedAt ? (Date.now() - position.openedAt) / 1000 : 0,
			amountTokens: position.amountTokens ?? 0,
			entryPriceSol: entryPrice,
		};
	}
	if (trades) {
		v.trades = {
			buyCount: trades.filter((t) => t.side === 'buy').length,
			sellCount: trades.filter((t) => t.side === 'sell').length,
		};
	}
	return v;
}

// ── Semantic validation ──────────────────────────────────────────────────────
// validateStrategySpec is pure: structure + predicate-path + numeric-domain +
// cross-rule reachability analysis, with no I/O. It is the shared gate run by
// the validate endpoint, runStrategy, and backtestStrategy so the three can
// never disagree about whether a spec is operationally sound. Live checks that
// need the chain or the DB (mint existence, quote-asset pairing) layer on top in
// the handler/endpoint — they are not part of this pure function.
//
// Returns { issues, meta } where each issue is
//   { level: 'error' | 'warning' | 'info', field, code, message }
// An 'error' means the strategy is operationally broken and must not run.

const BASE58_RE = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;

function isFiniteNum(n) {
	return typeof n === 'number' && Number.isFinite(n);
}

// Classify a single `<path> <op> <rhs>` predicate against a metric's domain.
function classifyThreshold(metric, op, rhs) {
	const { min, max, integer } = metric;
	const hasMin = min != null;
	const hasMax = max != null;
	let impossible = false;
	let alwaysTrue = false;
	switch (op) {
		case '>':
			if (hasMax && rhs >= max) impossible = true;
			else if (hasMin && rhs < min) alwaysTrue = true;
			break;
		case '>=':
			if (hasMax && rhs > max) impossible = true;
			else if (hasMin && rhs <= min) alwaysTrue = true;
			break;
		case '<':
			if (hasMin && rhs <= min) impossible = true;
			else if (hasMax && rhs > max) alwaysTrue = true;
			break;
		case '<=':
			if (hasMin && rhs < min) impossible = true;
			else if (hasMax && rhs >= max) alwaysTrue = true;
			break;
		case '==':
			if ((hasMin && rhs < min) || (hasMax && rhs > max) || (integer && !Number.isInteger(rhs)))
				impossible = true;
			break;
		// '!=' is satisfiable across any of our ranged metrics.
	}
	return { impossible, alwaysTrue };
}

// Detect filters on the same path whose intersection is empty (the strategy
// could never enter). Only inspects individually-satisfiable numeric filters.
function detectFilterContradictions(parsed, issues) {
	const byPath = new Map();
	for (const p of parsed) {
		if (!byPath.has(p.pred.lhs)) byPath.set(p.pred.lhs, []);
		byPath.get(p.pred.lhs).push(p);
	}
	for (const [path, list] of byPath) {
		if (list.length < 2) continue;
		const metric = METRICS[path];
		let lo = { v: metric.min ?? -Infinity, incl: true };
		let hi = { v: metric.max ?? Infinity, incl: true };
		const eqs = [];
		for (const { pred } of list) {
			const { op, rhs } = pred;
			if (op === '>') lo = rhs > lo.v ? { v: rhs, incl: false } : rhs === lo.v ? { v: rhs, incl: false } : lo;
			else if (op === '>=') lo = rhs > lo.v ? { v: rhs, incl: true } : lo;
			else if (op === '<') hi = rhs < hi.v ? { v: rhs, incl: false } : rhs === hi.v ? { v: rhs, incl: false } : hi;
			else if (op === '<=') hi = rhs < hi.v ? { v: rhs, incl: true } : hi;
			else if (op === '==') eqs.push(rhs);
		}
		const sources = list.map((p) => p.pred.src);
		const within = (e) =>
			(e > lo.v || (e === lo.v && lo.incl)) && (e < hi.v || (e === hi.v && hi.incl));
		let empty = false;
		if (eqs.length) {
			if (new Set(eqs).size > 1) empty = true;
			else if (!within(eqs[0])) empty = true;
		} else if (lo.v > hi.v) {
			empty = true;
		} else if (lo.v === hi.v && (!lo.incl || !hi.incl)) {
			empty = true;
		}
		if (empty) {
			issues.push({
				level: 'error',
				field: list[0].field,
				code: 'contradictory_filters',
				message: `Filters on ${metric.label} (${path}) can never be true together: ${sources.join(' AND ')}. The strategy would never enter a position.`,
			});
		}
	}
}

// Exits are evaluated top-down and the first match wins. Flag any later rule
// that an earlier rule on the same path always pre-empts.
function detectShadowedExits(parsed, issues) {
	for (let j = 0; j < parsed.length; j++) {
		for (let i = 0; i < j; i++) {
			const a = parsed[i].pred;
			const b = parsed[j].pred;
			if (a.lhs !== b.lhs) continue;
			const aUp = a.op === '>' || a.op === '>=';
			const bUp = b.op === '>' || b.op === '>=';
			const aDown = a.op === '<' || a.op === '<=';
			const bDown = b.op === '<' || b.op === '<=';
			const shadowed = (aUp && bUp && a.rhs <= b.rhs) || (aDown && bDown && a.rhs >= b.rhs);
			if (shadowed) {
				issues.push({
					level: 'warning',
					field: `exit[${parsed[j].idx}]`,
					code: 'shadowed_exit',
					message: `Exit rule "${b.src}" is unreachable — the earlier rule "${a.src}" always matches first (exits are checked top-down, first match wins). Order exits most-specific first.`,
				});
				break;
			}
		}
	}
}

// Validate + classify a single predicate string for the given context. Returns
// the parsed predicate (or null if it could not be parsed / is unusable).
function checkPredicate(src, context, field, issues) {
	if (typeof src !== 'string') {
		issues.push({ level: 'error', field, code: 'bad_predicate_type', message: `${field} must be a predicate string like "holders.total > 50".` });
		return null;
	}
	let pred;
	try {
		pred = parsePredicate(src);
	} catch (e) {
		issues.push({ level: 'error', field, code: 'unparseable_predicate', message: `${field}: ${e.message}. Expected "<path> <op> <number>", op one of > >= < <= == !=.` });
		return null;
	}
	const metric = METRICS[pred.lhs];
	if (!metric) {
		const known = Object.keys(METRICS).join(', ');
		issues.push({ level: 'error', field, code: 'unknown_path', message: `${field}: "${pred.lhs}" is not a recognized metric. A typo silently evaluates to false at runtime. Valid paths: ${known}.` });
		return null;
	}
	if (!metric.contexts.includes(context)) {
		issues.push({ level: 'error', field, code: 'path_unavailable_in_context', message: `${field}: "${pred.lhs}" is only available in ${metric.contexts.join('/')} rules. ${context === 'filter' ? 'No position exists when filters run, so this can never be true and the strategy would never enter.' : `It is not populated in ${context} rules.`}` });
		return null;
	}
	const { impossible, alwaysTrue } = classifyThreshold(metric, pred.op, pred.rhs);
	if (impossible) {
		issues.push({ level: 'error', field, code: 'impossible_threshold', message: `${field}: "${src}" can never be true — ${metric.label} is bounded to [${metric.min ?? '-∞'}, ${metric.max ?? '∞'}]${metric.integer ? ' (whole numbers)' : ''}.` });
		return null;
	}
	if (alwaysTrue) {
		issues.push({ level: 'warning', field, code: context === 'exit' ? 'exit_always_true' : 'redundant_filter', message: context === 'exit' ? `${field}: "${src}" is always true — this exit fires on the first tick, closing the position immediately.` : `${field}: "${src}" is always true for ${metric.label} and has no filtering effect.` });
	}
	return pred;
}

export function validateStrategySpec(spec) {
	const issues = [];
	const meta = {
		scanKind: null,
		mintList: [],
		filterCount: 0,
		exitCount: 0,
		denominatedQuote: 'SOL',
		effectivePerTradeSol: null,
		sessionSpendCapSol: null,
		filters: [],
		exits: [],
		summary: '',
	};

	if (!spec || typeof spec !== 'object' || Array.isArray(spec)) {
		issues.push({ level: 'error', field: 'strategy', code: 'not_an_object', message: 'strategy must be a JSON object.' });
		return { issues, meta };
	}

	// ── scan ──
	const scan = spec.scan;
	if (!scan || typeof scan !== 'object' || Array.isArray(scan)) {
		issues.push({ level: 'error', field: 'scan', code: 'scan_required', message: 'strategy.scan is required and must be an object: { kind, ... }.' });
	} else {
		meta.scanKind = scan.kind;
		if (!SCAN_KINDS.includes(scan.kind)) {
			issues.push({ level: 'error', field: 'scan.kind', code: 'bad_scan_kind', message: `scan.kind must be one of ${SCAN_KINDS.join(', ')} (got ${JSON.stringify(scan.kind)}).` });
		}
		if (scan.kind === 'mintList') {
			if (!Array.isArray(scan.mints) || scan.mints.length === 0) {
				issues.push({ level: 'error', field: 'scan.mints', code: 'empty_mint_list', message: 'scan.kind "mintList" requires a non-empty scan.mints array.' });
			} else {
				scan.mints.forEach((m, i) => {
					if (typeof m !== 'string' || !m.trim()) {
						issues.push({ level: 'error', field: `scan.mints[${i}]`, code: 'bad_mint', message: `scan.mints[${i}] must be a non-empty mint address string.` });
					} else {
						meta.mintList.push(m.trim());
						if (!BASE58_RE.test(m.trim())) {
							issues.push({ level: 'warning', field: `scan.mints[${i}]`, code: 'malformed_mint', message: `scan.mints[${i}] "${m}" does not look like a base58 Solana mint (32–44 chars); it will likely fail to resolve at run time.` });
						}
					}
				});
			}
		}
		if (scan.limit != null) {
			if (!isFiniteNum(scan.limit) || scan.limit < 1 || !Number.isInteger(scan.limit)) {
				issues.push({ level: 'error', field: 'scan.limit', code: 'bad_limit', message: 'scan.limit must be a positive integer.' });
			} else if (scan.limit > 100) {
				issues.push({ level: 'warning', field: 'scan.limit', code: 'large_limit', message: 'scan.limit above 100 is clamped by the upstream feed; lower it to stay predictable.' });
			}
		}
	}

	// ── entry ──
	const entry = spec.entry;
	if (!entry || typeof entry !== 'object' || Array.isArray(entry)) {
		issues.push({ level: 'error', field: 'entry', code: 'entry_required', message: 'strategy.entry is required: { side: "buy", amountSol }.' });
	} else {
		if (entry.side !== 'buy') {
			issues.push({ level: 'error', field: 'entry.side', code: 'bad_entry_side', message: `entry.side must be "buy" (got ${JSON.stringify(entry.side)}). Exits are the only sell path.` });
		}
		if (!isFiniteNum(entry.amountSol) || entry.amountSol <= 0) {
			issues.push({ level: 'error', field: 'entry.amountSol', code: 'bad_amount', message: 'entry.amountSol must be a positive number — it is the SOL spent per entry.' });
		} else {
			meta.effectivePerTradeSol = entry.amountSol;
			if (entry.amountSol > 10) {
				issues.push({ level: 'warning', field: 'entry.amountSol', code: 'large_entry', message: `entry.amountSol of ${entry.amountSol} SOL per trade is unusually large — confirm this is intended.` });
			}
		}
		if (entry.slippageBps != null && (!Number.isInteger(entry.slippageBps) || entry.slippageBps < 0 || entry.slippageBps > 10000)) {
			issues.push({ level: 'error', field: 'entry.slippageBps', code: 'bad_slippage', message: 'entry.slippageBps must be an integer between 0 and 10000 (basis points).' });
		}
	}

	// ── filters ──
	const parsedFilters = [];
	if (spec.filters != null) {
		if (!Array.isArray(spec.filters)) {
			issues.push({ level: 'error', field: 'filters', code: 'bad_filters', message: 'strategy.filters must be an array of predicate strings.' });
		} else {
			meta.filterCount = spec.filters.length;
			spec.filters.forEach((src, i) => {
				const field = `filters[${i}]`;
				const pred = checkPredicate(src, 'filter', field, issues);
				if (pred) {
					meta.filters.push(pred.src);
					parsedFilters.push({ pred, field });
				}
			});
			detectFilterContradictions(parsedFilters, issues);
		}
	}

	// ── exits ──
	const parsedExits = [];
	if (spec.exit != null) {
		if (!Array.isArray(spec.exit)) {
			issues.push({ level: 'error', field: 'exit', code: 'bad_exit', message: 'strategy.exit must be an array of { if, do } rules.' });
		} else {
			meta.exitCount = spec.exit.length;
			spec.exit.forEach((rule, i) => {
				if (!rule || typeof rule !== 'object') {
					issues.push({ level: 'error', field: `exit[${i}]`, code: 'bad_exit_rule', message: `exit[${i}] must be an object { if, do }.` });
					return;
				}
				const pred = checkPredicate(rule.if, 'exit', `exit[${i}].if`, issues);
				const action = rule.do;
				if (!action || typeof action !== 'object') {
					issues.push({ level: 'error', field: `exit[${i}].do`, code: 'bad_exit_action', message: `exit[${i}].do must be an object { side: "sell", percent | amountTokens }.` });
				} else {
					if (action.side !== 'sell') {
						issues.push({ level: 'error', field: `exit[${i}].do.side`, code: 'bad_exit_side', message: `exit[${i}].do.side must be "sell".` });
					}
					const hasPct = action.percent != null;
					const hasTok = action.amountTokens != null;
					if (hasPct === hasTok) {
						issues.push({ level: 'error', field: `exit[${i}].do`, code: 'bad_exit_size', message: `exit[${i}].do must specify exactly one of percent (1–100) or amountTokens.` });
					} else if (hasPct && (!isFiniteNum(action.percent) || action.percent <= 0 || action.percent > 100)) {
						issues.push({ level: 'error', field: `exit[${i}].do.percent`, code: 'bad_exit_percent', message: `exit[${i}].do.percent must be a number in (0, 100].` });
					} else if (hasTok && (!isFiniteNum(action.amountTokens) || action.amountTokens <= 0)) {
						issues.push({ level: 'error', field: `exit[${i}].do.amountTokens`, code: 'bad_exit_tokens', message: `exit[${i}].do.amountTokens must be a positive number.` });
					}
				}
				if (pred) {
					meta.exits.push({ if: pred.src, do: action });
					parsedExits.push({ pred, idx: i, src: pred.src });
				}
			});
			detectShadowedExits(parsedExits, issues);
		}
	}

	// ── caps ──
	const caps = spec.caps;
	if (caps != null) {
		if (typeof caps !== 'object' || Array.isArray(caps)) {
			issues.push({ level: 'error', field: 'caps', code: 'bad_caps', message: 'strategy.caps must be an object.' });
		} else {
			if (caps.sessionSpendCapSol != null) {
				if (!isFiniteNum(caps.sessionSpendCapSol) || caps.sessionSpendCapSol <= 0) {
					issues.push({ level: 'error', field: 'caps.sessionSpendCapSol', code: 'bad_session_cap', message: 'caps.sessionSpendCapSol must be a positive number of SOL.' });
				} else {
					meta.sessionSpendCapSol = caps.sessionSpendCapSol;
				}
			}
			if (caps.maxOpenPositions != null && (!Number.isInteger(caps.maxOpenPositions) || caps.maxOpenPositions < 1)) {
				issues.push({ level: 'error', field: 'caps.maxOpenPositions', code: 'bad_max_positions', message: 'caps.maxOpenPositions must be a positive integer (≥ 1).' });
			}
			if (caps.perTradeSol != null) {
				if (!isFiniteNum(caps.perTradeSol) || caps.perTradeSol <= 0) {
					issues.push({ level: 'error', field: 'caps.perTradeSol', code: 'bad_per_trade', message: 'caps.perTradeSol must be a positive number of SOL.' });
				} else if (meta.effectivePerTradeSol != null && caps.perTradeSol !== meta.effectivePerTradeSol) {
					issues.push({ level: 'warning', field: 'caps.perTradeSol', code: 'per_trade_ignored', message: `caps.perTradeSol (${caps.perTradeSol}) is not used at run time — entry.amountSol (${meta.effectivePerTradeSol}) is the per-trade size. Align them to avoid confusion.` });
				}
			}
			// The real gate in the runner is `spent + perTrade <= cap`.
			if (meta.effectivePerTradeSol != null && meta.sessionSpendCapSol != null && meta.effectivePerTradeSol > meta.sessionSpendCapSol) {
				issues.push({ level: 'error', field: 'caps.sessionSpendCapSol', code: 'cap_below_per_trade', message: `caps.sessionSpendCapSol (${meta.sessionSpendCapSol}) is smaller than the per-trade size entry.amountSol (${meta.effectivePerTradeSol}) — the strategy can never place a trade.` });
			}
		}
	}

	meta.summary = [
		meta.scanKind ? `scan: ${meta.scanKind}` : null,
		`${meta.filterCount} filter${meta.filterCount === 1 ? '' : 's'}`,
		`${meta.exitCount} exit${meta.exitCount === 1 ? '' : 's'}`,
		meta.effectivePerTradeSol != null ? `${meta.effectivePerTradeSol} SOL/trade` : null,
	].filter(Boolean).join(' · ');

	return { issues, meta };
}

// Convenience: the fatal subset. Used by runStrategy/backtestStrategy as their
// pre-flight gate so a broken spec fails before any RPC or signing.
export function strategyErrors(spec) {
	return validateStrategySpec(spec).issues.filter((i) => i.level === 'error');
}
