// Backtest integrity: the three checks that decide whether a backtest number can
// be trusted.
//
//   1. Look-ahead audit. Replays a decision function with the data truncated at
//      each decision time and fails if any decision changes when the future is
//      removed. A decision that depends on data after its own timestamp is
//      look-ahead bias, and it makes a backtest look better than live can be.
//   2. Dataset manifest. Every backtest records which dataset it ran on (id,
//      range, source, row count, content hash), so a second run can prove it saw
//      the same bytes. A result without a manifest is marked unreproducible.
//   3. Prior causality. Per-subject running counters (a creator's prior launches)
//      must never fall or stall as time advances; if they do, they were computed
//      with knowledge of the future.
//
// Pure functions only. No network, no database, no wallet.

import { createHash } from 'node:crypto';

export const MANIFEST_VERSION = 1;
const MAX_REPORTED = 50;
const DEFAULT_MAX_CHECKS = 400;

function canonical(v) {
	if (v === undefined) return null;
	if (v instanceof Date) return v.toISOString();
	if (typeof v === 'bigint') return v.toString();
	if (Array.isArray(v)) return v.map(canonical);
	if (v && typeof v === 'object') {
		const out = {};
		for (const k of Object.keys(v).sort()) out[k] = canonical(v[k]);
		return out;
	}
	return v;
}

const same = (a, b) => JSON.stringify(canonical(a)) === JSON.stringify(canonical(b));

/**
 * Indexes to audit: every index when there are few, otherwise an even stride that
 * always includes the first and last decision.
 */
function auditIndexes(total, maxChecks) {
	if (total <= maxChecks) return Array.from({ length: total }, (_, i) => i);
	const out = new Set([0, total - 1]);
	const stride = (total - 1) / (maxChecks - 1);
	for (let k = 0; k < maxChecks; k++) out.add(Math.round(k * stride));
	return [...out].sort((a, b) => a - b);
}

/**
 * Look-ahead audit.
 *
 * `decide(visible, index)` returns the decision for `visible[index]` (any
 * JSON-comparable value). It is called twice per audited index: once with the full
 * series and once with the series truncated right after that decision, so
 * `visible.length === index + 1`. If the two decisions differ, the decision used
 * data from the future.
 *
 * @param {object} args
 * @param {any[]} args.series        Time-ordered bars or events.
 * @param {(visible:any[], index:number)=>any} args.decide
 * @param {number} [args.maxChecks=400]
 * @returns {{ ok: boolean, method: string, total: number, checked: number, offending: number[], offending_truncated: boolean, errors: number }}
 */
export function auditLookahead({ series, decide, maxChecks = DEFAULT_MAX_CHECKS }) {
	if (!Array.isArray(series)) throw new TypeError('auditLookahead: series must be an array');
	if (typeof decide !== 'function') throw new TypeError('auditLookahead: decide must be a function');
	const total = series.length;
	const indexes = auditIndexes(total, Math.max(2, Math.floor(maxChecks)));
	const offending = [];
	let errors = 0;
	for (const i of indexes) {
		let full;
		let truncated;
		try {
			full = decide(series, i);
			truncated = decide(series.slice(0, i + 1), i);
		} catch {
			errors++;
			offending.push(i);
			continue;
		}
		if (!same(full, truncated)) offending.push(i);
	}
	return {
		ok: offending.length === 0,
		method: 'truncate-future',
		total,
		checked: indexes.length,
		offending: offending.slice(0, MAX_REPORTED),
		offending_truncated: offending.length > MAX_REPORTED,
		errors,
	};
}

/**
 * Causality check for per-subject running counters. `rows` must be time-ordered.
 * For each subject, the counter at a later row must be at least one higher than at
 * the previous row (each earlier row is itself one more prior occurrence).
 *
 * @returns {{ ok: boolean, checked: number, offending: number[] }}
 */
export function checkPriorsCausal({ rows, subjectOf, priorOf }) {
	const last = new Map();
	const offending = [];
	let checked = 0;
	rows.forEach((row, i) => {
		const subject = subjectOf(row);
		const prior = priorOf(row);
		if (subject == null || prior == null) return;
		checked++;
		const before = last.get(subject);
		if (before != null && prior < before + 1) offending.push(i);
		last.set(subject, prior);
	});
	return { ok: offending.length === 0, checked, offending: offending.slice(0, MAX_REPORTED) };
}

/**
 * Describe the exact dataset a backtest ran on.
 *
 * @param {object} args
 * @param {string} args.id        Stable dataset id (e.g. table plus network plus window).
 * @param {string} args.source    Where the rows came from.
 * @param {any[]} args.rows       The rows, in the order the replay consumed them.
 * @param {(row:any)=>any} args.project  Picks the fields that determine the result.
 * @param {(row:any)=>any} args.timeOf   Row timestamp (Date, ISO string or epoch ms).
 */
export function buildDatasetManifest({ id, source, rows, project, timeOf }) {
	const hash = createHash('sha256');
	let from = null;
	let to = null;
	for (const row of rows) {
		hash.update(JSON.stringify(canonical(project(row))));
		hash.update('\n');
		const t = timeOf(row);
		const ms = t instanceof Date ? t.getTime() : typeof t === 'number' ? t : Date.parse(t);
		if (Number.isFinite(ms)) {
			if (from == null || ms < from) from = ms;
			if (to == null || ms > to) to = ms;
		}
	}
	return {
		version: MANIFEST_VERSION,
		id,
		source,
		range: {
			from: from == null ? null : new Date(from).toISOString(),
			to: to == null ? null : new Date(to).toISOString(),
		},
		row_count: rows.length,
		content_hash: hash.digest('hex'),
	};
}

/** True when a manifest carries every field needed to reproduce the run. */
export function isCompleteManifest(m) {
	return !!(
		m &&
		typeof m === 'object' &&
		typeof m.id === 'string' && m.id &&
		typeof m.source === 'string' && m.source &&
		m.range && typeof m.range === 'object' && 'from' in m.range && 'to' in m.range &&
		Number.isInteger(m.row_count) && m.row_count >= 0 &&
		typeof m.content_hash === 'string' && /^[0-9a-f]{64}$/.test(m.content_hash)
	);
}

/**
 * Stamp `reproducible` on a result. A result with no complete manifest (every
 * snapshot saved before manifests existed) is explicitly unreproducible.
 */
export function withReproducibility(result) {
	if (!result || typeof result !== 'object') return result;
	const manifest = result.integrity?.manifest;
	if (isCompleteManifest(manifest)) return { ...result, reproducible: true };
	return {
		...result,
		reproducible: false,
		integrity: {
			...(result.integrity || {}),
			manifest: null,
			unreproducible_reason: 'No dataset manifest was recorded for this run, so it cannot be re-run against the same data.',
		},
	};
}
