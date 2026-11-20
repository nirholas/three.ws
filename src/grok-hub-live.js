// The Live and Reliability sections of /grok, as plain data.
//
// statsTiles reads GET /api/grok/stats (api/_lib/grok-stats.js) and
// uptimeRows reads GET /api/status/mcp (api/status/mcp.js). Both return what
// the page draws, so the wording and rounding are tested without a browser
// (tests/grok-hub.test.js) and src/grok-page.js only builds elements.

const COMPACT = new Intl.NumberFormat('en-US', { notation: 'compact', maximumFractionDigits: 1 });
const WHOLE = new Intl.NumberFormat('en-US');

/** 0 to 9,999 in full; larger as 12.3K, 4.5M. */
export function formatCount(value) {
	const n = Number(value);
	if (!Number.isFinite(n) || n < 0) return '0';
	return n < 10_000 ? WHOLE.format(Math.round(n)) : COMPACT.format(n);
}

/** A success ratio as a percentage: 1 → "100%", 0.99931 → "99.93%", null → "No probes yet". */
export function formatRate(rate) {
	if (rate == null || !Number.isFinite(Number(rate))) return 'No probes yet';
	const pct = Number(rate) * 100;
	if (pct >= 100) return '100%';
	// Floor, never round up: 99.996% must not read as 100%.
	return `${(Math.floor(pct * 100) / 100).toFixed(2)}%`;
}

/** Milliseconds as "840 ms" or "2.4 s"; null → "n/a". */
export function formatMs(ms) {
	if (ms == null || !Number.isFinite(Number(ms))) return 'n/a';
	const n = Number(ms);
	return n < 1000 ? `${Math.round(n)} ms` : `${(n / 1000).toFixed(1)} s`;
}

const AGO = new Intl.RelativeTimeFormat('en-US', { numeric: 'auto' });

/** How long ago an ISO time was: "just now", "4 minutes ago", "2 hours ago", "3 days ago". */
export function formatAgo(iso, now = Date.now()) {
	const t = new Date(iso).getTime();
	if (!Number.isFinite(t)) return 'at an unknown time';
	const s = Math.max(0, Math.round((now - t) / 1000));
	if (s < 45) return 'just now';
	if (s < 3600) return AGO.format(-Math.max(1, Math.round(s / 60)), 'minute');
	if (s < 86_400) return AGO.format(-Math.round(s / 3600), 'hour');
	return AGO.format(-Math.round(s / 86_400), 'day');
}

const DATE = new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' });

/**
 * The tiles for the Live section, or null when the payload is not a stats
 * answer (the section then stays hidden).
 * @param {any} stats
 */
export function statsTiles(stats) {
	if (!stats || typeof stats !== 'object' || !stats.models || !stats.tool_calls || !stats.clients) return null;
	const since = stats.counting_since ? new Date(stats.counting_since) : null;
	return {
		tiles: [
			{ key: 'models', label: '3D models made, 30 days', value: formatCount(stats.models['30d']), detail: `${formatCount(stats.models['24h'])} in the last 24 hours` },
			{ key: 'tool_calls', label: 'Tool calls, 30 days', value: formatCount(stats.tool_calls['30d']), detail: `${formatCount(stats.tool_calls['24h'])} in the last 24 hours` },
			{ key: 'clients', label: 'Signed-in clients, 30 days', value: formatCount(stats.clients['30d']), detail: 'Accounts and install tokens. Anonymous sessions are not counted.' },
		],
		since: since && !Number.isNaN(since.getTime()) ? `Counting since ${DATE.format(since)} (UTC).` : 'No calls recorded in the last 30 days yet.',
		methodology: stats.methodology && typeof stats.methodology === 'object' ? Object.values(stats.methodology).filter((v) => typeof v === 'string') : [],
	};
}

// The servers a Grok user connects to, in the order the page lists them.
const GROK_FACING = ['/api/mcp-grok', '/api/mcp-studio'];

/**
 * One row per Grok-facing server for the Reliability section, or null when
 * the payload has none (the section then stays hidden).
 * @param {any} status
 */
export function uptimeRows(status) {
	const servers = Array.isArray(status?.servers) ? status.servers : [];
	const rows = GROK_FACING.map((p) => servers.find((s) => s?.path === p)).filter(Boolean).map((s) => {
		const w30 = s.windows?.['30d'] || {};
		const w24 = s.windows?.['24h'] || {};
		return {
			path: s.path,
			name: s.name || s.path,
			endpoint: s.server,
			up30d: formatRate(w30.successRate),
			up24h: formatRate(w24.successRate),
			probes30d: formatCount(w30.probes),
			handshakeP50: formatMs(w30.handshakeP50Ms),
			toolCallP50: formatMs(w30.toolCallP50Ms),
			lastOk: s.last ? Boolean(s.last.ok) : null,
			lastAt: s.last?.checkedAt || null,
		};
	});
	return rows.length ? rows : null;
}
