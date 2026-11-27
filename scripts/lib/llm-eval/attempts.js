// Attempts that ended without an answer. The eval retries a timeout, a rate
// limit and a server error, and the results file keeps only the attempt that
// settled the row, so without this count the report would show a latency and a
// spend that leave the retried attempts out. PURE.

/**
 * Why an attempt ended without an answer, or null when it answered or failed in
 * a way a retry cannot fix (a 4xx). A non-null kind is exactly what is retried.
 * @returns {'timeout' | 'network' | 'rate_limit' | 'server' | null}
 */
export function attemptKind(res) {
	if (res.ok) return null;
	if (res.status === 0) return res.error === 'timeout' ? 'timeout' : 'network';
	if (res.status === 429) return 'rate_limit';
	if (res.status >= 500) return 'server';
	return null;
}

/**
 * Sum the per-run counts in runs.json.
 * @param {{ unanswered?: Record<string, Record<string, number>> }[]} runs
 * @returns {Record<string, Record<string, number>>} lane -> kind -> attempts
 */
export function tallyUnanswered(runs) {
	const out = {};
	for (const run of runs) {
		for (const [lane, kinds] of Object.entries(run.unanswered || {})) {
			for (const [kind, n] of Object.entries(kinds)) {
				out[lane] ??= {};
				out[lane][kind] = (out[lane][kind] || 0) + n;
			}
		}
	}
	return out;
}
