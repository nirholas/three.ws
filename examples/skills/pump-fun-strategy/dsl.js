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

// Build the `view` object the predicates evaluate against. Pure: takes raw
// pump-fun-style payloads + (optional) position state.
export function buildView({ details, holders, creator, curve, position, trades }) {
	const v = {
		holders: {
			total: holders?.total ?? holders?.holders?.length ?? 0,
			topHolderPct: holders?.topHolderPct ?? holders?.holders?.[0]?.pct ?? 0,
		},
		creator: {
			rugCount: creator?.rugCount ?? creator?.rugFlags?.length ?? 0,
		},
		curve: {
			graduationPct: curve?.graduationPct ?? curve?.progressPct ?? 0,
			priceSol: curve?.priceSol ?? curve?.price ?? 0,
		},
		token: {
			ageSec: details?.createdAt ? (Date.now() - new Date(details.createdAt).getTime()) / 1000 : 0,
			marketCapSol: details?.marketCapSol ?? 0,
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
