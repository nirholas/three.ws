// Operator log for firehose `status` events.
//
// The orchestrator reports backfill results and watcher failures as status
// events on the same bus as launches and trades. Subscribers see them, but a
// worker with no subscriber attached (the normal state right after boot) would
// otherwise hide a dead backfill entirely: an empty buffer reads as a quiet
// chain instead of a rate-limited RPC. This logs every warning, plus the
// backfill summary, and collapses an identical warning that repeats inside
// `repeatMs` (a flaky RPC fails every poll) into one line per window.

/**
 * @param {{ write?: (level: 'info'|'warn', line: string) => void, now?: () => number, repeatMs?: number }} [opts]
 * @returns {(ev: { kind: string, data?: any }) => void}
 */
export function createStatusLogger({
	write = (level, line) => (level === 'warn' ? console.warn(line) : console.log(line)),
	now = Date.now,
	repeatMs = 60_000,
} = {}) {
	const seen = new Map(); // `${src}\n${message}` → { at, suppressed }

	return function logStatus(ev) {
		if (ev?.kind !== 'status' || !ev.data) return;
		const { level, src = 'firehose', message, ...rest } = ev.data;

		if (level === 'info') {
			if (src !== 'backfill') return;
			const fields = Object.entries(rest).map(([k, v]) => `${k}=${v}`).join(' ');
			write('info', `[robinhood-feed] backfill · ${fields}`);
			return;
		}
		if (level !== 'warn') return;

		const text = String(message ?? 'unknown error').split('\n')[0].trim();
		const key = `${src}\n${text}`;
		const t = now();
		const prev = seen.get(key);
		if (prev && t - prev.at < repeatMs) {
			prev.suppressed += 1;
			return;
		}
		const suffix = prev?.suppressed ? ` (repeated ${prev.suppressed}x)` : '';
		seen.set(key, { at: t, suppressed: 0 });
		if (seen.size > 200) seen.delete(seen.keys().next().value);
		write('warn', `[robinhood-feed] warn · ${src} · ${text}${suffix}`);
	};
}
