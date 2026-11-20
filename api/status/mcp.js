// @ts-check
// GET /api/status/mcp: public uptime of the Grok-facing MCP connectors.
//
// Per server: success rate and handshake / tool-call latency percentiles over
// 24 hours, 7 days and 30 days, computed from mcp_probe_results (written every
// five minutes by api/cron/mcp-probe.js), plus the newest probe. Public and
// credential-free: aggregates, the failing step's name and timestamps only, no
// error text, no request detail. Rendered by /status ("Connector uptime").
//
// Cached 60s in this instance and in shared caches: the data moves every five
// minutes, so a page-load burst costs one aggregate query.

import { cors, json, method, wrap, rateLimited } from '../_lib/http.js';
import { limits, clientIp } from '../_lib/rate-limit.js';
import { loadManifest } from '../_lib/mcp-probe.js';
import { probeUptime } from '../_lib/mcp-probe-store.js';

export const CACHE_TTL_MS = 60_000;
export const PROBE_INTERVAL_SECONDS = 300;

let memo = { value: null, expiresAt: 0 };

/** Forget the memo (tests). */
export function resetMcpStatusCache() {
	memo = { value: null, expiresAt: 0 };
}

async function namesByPath() {
	try {
		const manifest = await loadManifest();
		/** @type {Map<string, string>} */
		const out = new Map();
		for (const s of manifest?.servers || []) {
			if (typeof s?.endpoint === 'string') out.set(new URL(s.endpoint).pathname, String(s.name || ''));
		}
		return out;
	} catch {
		return new Map();
	}
}

export async function buildMcpStatus() {
	const [rows, names] = await Promise.all([probeUptime(), namesByPath()]);
	return {
		generatedAt: new Date().toISOString(),
		probeIntervalSeconds: PROBE_INTERVAL_SECONDS,
		servers: rows.map((r) => {
			const path = new URL(r.server).pathname;
			return { name: names.get(path) || path, path, server: r.server, last: r.last, windows: r.windows };
		}),
	};
}

export default wrap(async (req, res) => {
	if (cors(req, res, { origins: '*', methods: 'GET,OPTIONS' })) return;
	if (!method(req, res, ['GET'])) return;

	const rl = await limits.publicIp(clientIp(req));
	if (!rl.success) return rateLimited(res, rl);

	const now = Date.now();
	if (!memo.value || memo.expiresAt <= now) {
		try {
			memo = { value: await buildMcpStatus(), expiresAt: now + CACHE_TTL_MS };
		} catch (err) {
			console.warn('[status/mcp] uptime read failed:', err?.message || err);
			return json(
				res,
				503,
				{ error: 'uptime_unavailable', message: 'Connector uptime could not be read right now. The probe keeps running; try again in a minute.' },
				{ 'cache-control': 'no-store' },
			);
		}
	}
	return json(res, 200, memo.value, { 'cache-control': 'public, max-age=60, s-maxage=60' });
});
