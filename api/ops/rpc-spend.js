// GET /api/ops/rpc-spend: where the Solana RPC quota goes.
//
// Every request that reaches a provider through the rotating connection layer
// (api/_lib/solana/connection.js) is counted by caller (API route template or
// cron name), JSON-RPC method and lane host, in hourly per-instance shards in
// the shared cache (api/_lib/solana/rpc-spend.js). This board merges those
// shards and ranks the (caller, method) pairs, so an operator can see which
// route burns the paid quota before a provider cuts the plan off.
//
// Query: ?hours=1..48 (default 24), ?top=1..100 (default 20).
// `calls` counts real provider calls; `saved` counts reads answered by the
// fresh-read cache or joined to an identical in-flight read (lanes `cache` and
// `coalesced`), which cost the provider nothing.
//
// Auth: authorizeOps (admin session, or x-ops-secret / OPS_SECRET), the same
// gate as /api/ops/health. Read-only; makes no RPC calls itself.

import { cors, json, method, wrap, error, rateLimited } from '../_lib/http.js';
import { limits, clientIp } from '../_lib/rate-limit.js';
import { authorizeOps } from '../_lib/ops-auth.js';
import { flushRpcSpend, readRpcSpend, summarizeRpcSpend, laneBudgets, laneCallsToday } from '../_lib/solana/rpc-spend.js';

export const maxDuration = 30;

function clampInt(raw, min, max, fallback) {
	const n = Number.parseInt(String(raw ?? ''), 10);
	if (!Number.isFinite(n)) return fallback;
	return Math.min(max, Math.max(min, n));
}

export default wrap(async (req, res) => {
	if (cors(req, res, { methods: 'GET,OPTIONS' })) return;
	if (!method(req, res, ['GET'])) return;

	const rl = await limits.authedReadIp(clientIp(req));
	if (!rl.success) return rateLimited(res, rl);

	const auth = await authorizeOps(req);
	if (!auth.ok) return error(res, 401, 'unauthorized', 'ops secret or admin session required');

	const url = new URL(req.url, 'http://localhost');
	const hours = clampInt(url.searchParams.get('hours'), 1, 48, 24);
	const top = clampInt(url.searchParams.get('top'), 1, 100, 20);

	// Publish this instance's pending counts first, so the board includes the
	// calls this very instance made in the last minute.
	await flushRpcSpend();
	const { from, to, instances, rows } = await readRpcSpend({ hours });
	const summary = summarizeRpcSpend(rows, top);

	const budgets = [...laneBudgets()].map(([lane, b]) => {
		const today = laneCallsToday(lane);
		return {
			lane,
			daily: b.daily,
			fraction: b.fraction,
			calls_today: today,
			over_budget: today >= b.daily * b.fraction,
		};
	});

	return json(
		res,
		200,
		{
			ok: true,
			window: { hours, from: new Date(from).toISOString(), to: new Date(to).toISOString() },
			instances,
			calls: summary.calls,
			saved: summary.saved,
			saved_ratio: summary.calls + summary.saved ? Math.round((summary.saved / (summary.calls + summary.saved)) * 1000) / 1000 : 0,
			top: summary.top,
			by_lane: summary.byLane,
			by_caller: summary.byCaller,
			top_caller: summary.topCaller,
			budgets,
		},
		{ 'cache-control': 'private, no-store' },
	);
});
