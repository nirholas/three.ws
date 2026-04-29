// POST /api/pump/strategy-backtest
// Body: { strategy, mints?: string[], sinceMs?: number, limit?: number }
//
// Replays a strategy against historical pump.fun trade data via the read-only
// pump-fun skill (which proxies a public MCP — no env vars required). When
// `mints` is omitted, the candidate set is sourced from the strategy's
// `scan.kind` (newTokens | trending | mintList).

import { cors, json, method, wrap, error, readJson } from '../_lib/http.js';
import { limits, clientIp } from '../_lib/rate-limit.js';
import { makeRuntime } from '../_lib/skill-runtime.js';

async function resolveMints(invoke, strategy, explicit, limit) {
	if (Array.isArray(explicit) && explicit.length) return explicit;
	const scan = strategy?.scan ?? {};
	if (scan.kind === 'mintList' && Array.isArray(scan.mints)) return scan.mints;
	const tool = scan.kind === 'trending' ? 'pump-fun.getTrendingTokens' : 'pump-fun.getNewTokens';
	const r = await invoke(tool, { limit: limit ?? scan.limit ?? 20 });
	if (!r.ok) throw new Error(`scan failed: ${r.error}`);
	const items = r.data?.tokens ?? r.data ?? [];
	return items.map((t) => t.mint ?? t.address).filter(Boolean);
}

export default wrap(async (req, res) => {
	if (cors(req, res, { methods: 'POST,OPTIONS', origins: '*' })) return;
	if (!method(req, res, ['POST'])) return;

	const rl = await limits.authIp(clientIp(req));
	if (!rl.success) return error(res, 429, 'rate_limited', 'too many requests');

	const body = await readJson(req);
	if (!body?.strategy) return error(res, 400, 'validation_error', 'strategy required');

	const rt = makeRuntime();
	let mints;
	try {
		mints = await resolveMints(rt.invoke, body.strategy, body.mints, body.limit);
	} catch (e) {
		return error(res, 502, 'upstream_error', e.message);
	}
	if (!mints.length) return error(res, 422, 'no_candidates', 'no mints to backtest');

	const { backtestStrategy } = await import('../../examples/skills/pump-fun-strategy/handlers.js');
	const result = await backtestStrategy(
		{ strategy: body.strategy, mints, sinceMs: body.sinceMs ?? 0 },
		{ skills: { invoke: rt.invoke }, memory: { note: () => {} } },
	);
	if (!result.ok) return error(res, 400, 'validation_error', result.error);
	return json(res, 200, { data: { ...result.data, mintsUsed: mints } });
});
