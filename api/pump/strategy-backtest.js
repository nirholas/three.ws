// POST /api/pump/strategy-backtest
// Body: { strategy, mints?: string[], sinceMs?: number, useStub?: boolean }
//
// When useStub:true (or PUMPFUN_BOT_URL is unset) we feed the backtester a
// deterministic synthetic trade history so the demo runs without an upstream
// MCP. Otherwise the read-only `pump-fun` skill proxies its real worker.

import { cors, json, method, wrap, error, readJson } from '../_lib/http.js';
import { limits, clientIp } from '../_lib/rate-limit.js';
import { makeRuntime } from '../_lib/skill-runtime.js';

function stubInvoke(tool, args) {
	const t0 = 1_700_000_000_000;
	if (tool === 'pump-fun.getTokenDetails') {
		return { ok: true, data: { creator: `CREATOR_${args.mint.slice(0, 4)}`, createdAt: new Date(t0).toISOString(), marketCapSol: 12 } };
	}
	if (tool === 'pump-fun.getTokenHolders') {
		// Pseudo-random but deterministic per mint.
		const seed = [...args.mint].reduce((s, c) => s + c.charCodeAt(0), 0);
		const total = 30 + (seed % 200);
		const top = 5 + (seed % 35);
		return { ok: true, data: { total, holders: [{ pct: top }] } };
	}
	if (tool === 'pump-fun.getCreatorProfile') {
		return { ok: true, data: { rugCount: args.creator.endsWith('X') ? 1 : 0 } };
	}
	if (tool === 'pump-fun.getBondingCurve') {
		return { ok: true, data: { priceSol: 0.001, graduationPct: 12 } };
	}
	if (tool === 'pump-fun.getTokenTrades') {
		const seed = [...args.mint].reduce((s, c) => s + c.charCodeAt(0), 0);
		// Generate a small price walk: starts at 0.001, drifts by seed parity.
		const drift = seed % 5 === 0 ? -0.0002 : seed % 3 === 0 ? 0.0008 : 0.0003;
		const prices = Array.from({ length: 20 }, (_, i) => Math.max(0.0001, 0.001 + drift * i + Math.sin(i + seed) * 0.0001));
		return {
			ok: true,
			data: {
				trades: prices.map((p, i) => ({
					timestamp: t0 + i * 60_000,
					side: i % 2 === 0 ? 'buy' : 'sell',
					solAmount: p * 1000,
					tokenAmount: 1000,
					priceSol: p,
				})),
			},
		};
	}
	return { ok: true, data: {} };
}

export default wrap(async (req, res) => {
	if (cors(req, res, { methods: 'POST,OPTIONS', origins: '*' })) return;
	if (!method(req, res, ['POST'])) return;

	const rl = await limits.authIp(clientIp(req));
	if (!rl.success) return error(res, 429, 'rate_limited', 'too many requests');

	const body = await readJson(req);
	if (!body?.strategy) return error(res, 400, 'validation_error', 'strategy required');

	const useStub = body.useStub === true || !process.env.PUMPFUN_BOT_URL;
	const rt = makeRuntime();

	let invoke = rt.invoke;
	if (useStub) {
		// Override invoke for the read-only pump-fun calls. Trade calls still go
		// through the real runtime (and will reject without a wallet), which is
		// fine — backtest never calls them.
		invoke = async (tool, args) => {
			if (tool.startsWith('pump-fun.')) return stubInvoke(tool, args);
			return rt.invoke(tool, args);
		};
	}

	// backtestStrategy needs ctx.skills.invoke; we call it directly with a
	// shimmed ctx so we can inject the stub.
	const { backtestStrategy } = await import('../../examples/skills/pump-fun-strategy/handlers.js');
	const ctx = { skills: { invoke }, memory: { note: () => {} } };

	const result = await backtestStrategy(
		{ strategy: body.strategy, mints: body.mints, sinceMs: body.sinceMs ?? 0 },
		ctx,
	);
	if (!result.ok) return error(res, 400, 'validation_error', result.error);
	return json(res, 200, { data: result.data, stub: useStub });
});
