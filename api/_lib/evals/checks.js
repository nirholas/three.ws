// Outcome checks: how one eval task's trace is scored.
//
// A check is a small JSON object with a `type`. Each type is a pure function of
// the trace (api/_lib/evals/execute.js), so scoring is deterministic and the
// same report re-scores identically on any machine.
//
//   tool_called         { tool, args?, min? }      the tool ran (executed or sandboxed) with matching args
//   tool_not_called     { tool }                   the tool was never attempted
//   answer_contains     { any?: [], all?: [], caseSensitive? }
//   answer_not_contains { any: [], caseSensitive? }
//   answer_matches      { pattern, flags? }        regular expression over the final answer
//   cost_below          { usd }                    total model spend strictly under the ceiling
//   steps_below         { max }                    model calls + tool calls, at most `max`
//
// An `args` matcher maps each argument name to a literal (strings compare
// case-insensitively after trimming), or to { contains }, { matches, flags },
// or { exists: true|false }.

export const CHECK_TYPES = [
	'tool_called',
	'tool_not_called',
	'answer_contains',
	'answer_not_contains',
	'answer_matches',
	'cost_below',
	'steps_below',
];

function isStringList(v) {
	return Array.isArray(v) && v.length > 0 && v.every((s) => typeof s === 'string' && s.length > 0);
}

function validPattern(pattern, flags) {
	try {
		new RegExp(pattern, flags || '');
		return true;
	} catch {
		return false;
	}
}

function validateArgMatcher(args) {
	const problems = [];
	if (!args || typeof args !== 'object' || Array.isArray(args)) return ['args must be an object of argument matchers'];
	for (const [name, m] of Object.entries(args)) {
		if (m && typeof m === 'object' && !Array.isArray(m)) {
			if ('matches' in m && (typeof m.matches !== 'string' || !validPattern(m.matches, m.flags))) {
				problems.push(`args.${name}.matches is not a valid regular expression`);
			} else if ('contains' in m && typeof m.contains !== 'string') {
				problems.push(`args.${name}.contains must be a string`);
			} else if ('exists' in m && typeof m.exists !== 'boolean') {
				problems.push(`args.${name}.exists must be a boolean`);
			} else if (!('matches' in m) && !('contains' in m) && !('exists' in m)) {
				problems.push(`args.${name} must be a literal or one of { contains }, { matches }, { exists }`);
			}
		}
	}
	return problems;
}

/**
 * Problems with one check definition; empty means valid.
 * @param {any} check
 * @returns {string[]}
 */
export function validateCheck(check) {
	if (!check || typeof check !== 'object') return ['check must be an object'];
	switch (check.type) {
		case 'tool_called': {
			const p = typeof check.tool === 'string' && check.tool ? [] : ['tool is required'];
			if (check.args !== undefined) p.push(...validateArgMatcher(check.args));
			if (check.min !== undefined && !(Number.isInteger(check.min) && check.min >= 1)) p.push('min must be a positive integer');
			return p;
		}
		case 'tool_not_called':
			return typeof check.tool === 'string' && check.tool ? [] : ['tool is required'];
		case 'answer_contains':
			if (check.any === undefined && check.all === undefined) return ['give `any` or `all`'];
			return [
				...(check.any !== undefined && !isStringList(check.any) ? ['any must be a non-empty list of strings'] : []),
				...(check.all !== undefined && !isStringList(check.all) ? ['all must be a non-empty list of strings'] : []),
			];
		case 'answer_not_contains':
			return isStringList(check.any) ? [] : ['any must be a non-empty list of strings'];
		case 'answer_matches':
			return typeof check.pattern === 'string' && validPattern(check.pattern, check.flags) ? [] : ['pattern must be a valid regular expression'];
		case 'cost_below':
			return typeof check.usd === 'number' && check.usd > 0 ? [] : ['usd must be a positive number'];
		case 'steps_below':
			return Number.isInteger(check.max) && check.max >= 1 ? [] : ['max must be a positive integer'];
		default:
			return [`unknown check type "${check.type}" (known: ${CHECK_TYPES.join(', ')})`];
	}
}

function normalize(v) {
	return typeof v === 'string' ? v.trim().toLowerCase() : v;
}

/** Whether one call's arguments satisfy an args matcher. */
export function argsMatch(matcher, args) {
	if (!matcher) return true;
	const a = args && typeof args === 'object' ? args : {};
	for (const [name, m] of Object.entries(matcher)) {
		const value = a[name];
		if (m && typeof m === 'object' && !Array.isArray(m)) {
			if ('exists' in m) {
				const present = value !== undefined && value !== null && value !== '';
				if (present !== m.exists) return false;
				continue;
			}
			if (typeof value !== 'string' && typeof value !== 'number') return false;
			const s = String(value);
			if ('contains' in m && !s.toLowerCase().includes(m.contains.toLowerCase())) return false;
			if ('matches' in m && !new RegExp(m.matches, m.flags || '').test(s)) return false;
			continue;
		}
		if (normalize(value) !== normalize(m)) return false;
	}
	return true;
}

function describeArgs(matcher) {
	return matcher ? ` with ${JSON.stringify(matcher)}` : '';
}

function haystack(answer, caseSensitive) {
	return caseSensitive ? answer : answer.toLowerCase();
}

/**
 * Run one check over a trace.
 * @param {object} check
 * @param {{ answer: string, toolCalls: Array<{tool: string, args: object, sandboxed?: boolean, blocked?: boolean}>, costUsd: number|null, steps: number }} trace
 * @returns {{ type: string, passed: boolean, detail: string }}
 */
export function runCheck(check, trace) {
	const answer = trace.answer || '';
	const attempted = (trace.toolCalls || []).filter((c) => !c.blocked);
	switch (check.type) {
		case 'tool_called': {
			const min = check.min || 1;
			const hits = attempted.filter((c) => c.tool === check.tool && argsMatch(check.args, c.args));
			const seen = attempted.filter((c) => c.tool === check.tool).map((c) => JSON.stringify(c.args));
			return {
				type: check.type,
				passed: hits.length >= min,
				detail: hits.length >= min
					? `${check.tool} called ${hits.length}x${describeArgs(check.args)}`
					: seen.length
						? `${check.tool} called with ${seen.join(', ')}, none matched${describeArgs(check.args)}`
						: `${check.tool} was never called`,
			};
		}
		case 'tool_not_called': {
			const any = (trace.toolCalls || []).filter((c) => c.tool === check.tool);
			return {
				type: check.type,
				passed: any.length === 0,
				detail: any.length ? `${check.tool} was attempted ${any.length}x` : `${check.tool} not attempted`,
			};
		}
		case 'answer_contains': {
			const hay = haystack(answer, check.caseSensitive);
			const norm = (s) => (check.caseSensitive ? s : s.toLowerCase());
			const missingAll = (check.all || []).filter((s) => !hay.includes(norm(s)));
			const anyOk = !check.any || check.any.some((s) => hay.includes(norm(s)));
			const passed = missingAll.length === 0 && anyOk;
			return {
				type: check.type,
				passed,
				detail: passed
					? 'answer contains the expected text'
					: missingAll.length
						? `answer is missing ${missingAll.map((s) => JSON.stringify(s)).join(', ')}`
						: `answer contains none of ${check.any.map((s) => JSON.stringify(s)).join(', ')}`,
			};
		}
		case 'answer_not_contains': {
			const hay = haystack(answer, check.caseSensitive);
			const found = check.any.filter((s) => hay.includes(check.caseSensitive ? s : s.toLowerCase()));
			return {
				type: check.type,
				passed: found.length === 0,
				detail: found.length ? `answer contains ${found.map((s) => JSON.stringify(s)).join(', ')}` : 'answer avoids the forbidden text',
			};
		}
		case 'answer_matches': {
			const passed = new RegExp(check.pattern, check.flags || '').test(answer);
			return { type: check.type, passed, detail: passed ? `answer matches /${check.pattern}/` : `answer does not match /${check.pattern}/` };
		}
		case 'cost_below': {
			if (trace.costUsd == null) return { type: check.type, passed: false, detail: 'cost unknown: a model call ran on an unpriced lane' };
			const passed = trace.costUsd < check.usd;
			return { type: check.type, passed, detail: `cost $${trace.costUsd.toFixed(6)} ${passed ? '<' : '>='} $${check.usd}` };
		}
		case 'steps_below': {
			const passed = trace.steps <= check.max;
			return { type: check.type, passed, detail: `${trace.steps} steps (limit ${check.max})` };
		}
		default:
			return { type: String(check.type), passed: false, detail: 'unknown check type' };
	}
}

/**
 * Score a task: every check, the fraction that passed, and whether all did.
 * @returns {{ passed: boolean, score: number, checks: Array<{type: string, passed: boolean, detail: string}> }}
 */
export function scoreTask(task, trace) {
	const checks = task.checks.map((c) => runCheck(c, trace));
	const passedCount = checks.filter((c) => c.passed).length;
	return { passed: passedCount === checks.length, score: checks.length ? passedCount / checks.length : 0, checks };
}
