// POST /api/pump/strategy-run  (Server-Sent Events)
// Body: { strategy, durationSec, useStub?: boolean }
//
// Streams a simulated live run as SSE. Each line of activity (skip / enter /
// exit / error) is emitted as `event: log` with a JSON payload. A final
// `event: done` carries the summary. Always simulate=true on this endpoint —
// no real signing from the browser-facing surface.

import { cors, method, error, readJson } from '../_lib/http.js';
import { limits, clientIp } from '../_lib/rate-limit.js';
import { makeRuntime } from '../_lib/skill-runtime.js';

function stubInvoke(tool, args) {
	const t0 = Date.now();
	if (tool === 'pump-fun.getNewTokens' || tool === 'pump-fun.getTrendingTokens') {
		const limit = args?.limit ?? 5;
		return { ok: true, data: { tokens: Array.from({ length: limit }, (_, i) => ({ mint: `MINT${Math.floor(t0 / 1000)}_${i}` })) } };
	}
	if (tool === 'pump-fun.getTokenDetails') {
		return { ok: true, data: { creator: `CREATOR_${args.mint.slice(0, 4)}`, createdAt: new Date().toISOString(), marketCapSol: 12 } };
	}
	if (tool === 'pump-fun.getTokenHolders') {
		const seed = [...args.mint].reduce((s, c) => s + c.charCodeAt(0), 0);
		return { ok: true, data: { total: 30 + (seed % 200), holders: [{ pct: 5 + (seed % 35) }] } };
	}
	if (tool === 'pump-fun.getCreatorProfile') {
		return { ok: true, data: { rugCount: 0 } };
	}
	if (tool === 'pump-fun.getBondingCurve') {
		const seed = [...(args?.mint ?? '')].reduce((s, c) => s + c.charCodeAt(0), 0);
		// Drift price up over time so exits eventually trigger.
		const drift = ((Date.now() / 5000) % 30) * 0.00002 * (seed % 3 === 0 ? 1 : -1);
		return { ok: true, data: { priceSol: Math.max(0.0001, 0.001 + drift), graduationPct: 12 } };
	}
	if (tool === 'pump-fun.getTokenTrades') {
		return { ok: true, data: { trades: [] } };
	}
	return { ok: true, data: {} };
}

export default async function handler(req, res) {
	if (cors(req, res, { methods: 'POST,OPTIONS', origins: '*' })) return;
	if (!method(req, res, ['POST'])) return;

	const rl = await limits.authIp(clientIp(req));
	if (!rl.success) return error(res, 429, 'rate_limited', 'too many requests');

	let body;
	try { body = await readJson(req); } catch (e) { return error(res, 400, 'validation_error', e.message); }
	if (!body?.strategy) return error(res, 400, 'validation_error', 'strategy required');
	const durationSec = Math.max(5, Math.min(120, Number(body.durationSec) || 30));

	res.statusCode = 200;
	res.setHeader('content-type', 'text/event-stream');
	res.setHeader('cache-control', 'no-cache, no-transform');
	res.setHeader('connection', 'keep-alive');
	res.setHeader('access-control-allow-origin', '*');

	const send = (event, data) => {
		res.write(`event: ${event}\n`);
		res.write(`data: ${JSON.stringify(data)}\n\n`);
	};

	const useStub = body.useStub === true || !process.env.PUMPFUN_BOT_URL;
	const rt = makeRuntime({ onEvent: (e) => send('memory', e) });

	let invoke = rt.invoke;
	if (useStub) {
		invoke = async (tool, args) => {
			if (tool.startsWith('pump-fun.')) return stubInvoke(tool, args);
			return rt.invoke(tool, args);
		};
	}

	send('start', { durationSec, useStub });

	const { runStrategy } = await import('../../examples/skills/pump-fun-strategy/handlers.js');
	const ctx = {
		skills: { invoke },
		skillConfig: { defaultPollMs: 1500 },
		memory: { note: (tag, value) => send('memory', { tag, value }) },
	};

	// Patch the log via a Proxy on the strategy state isn't trivial — instead
	// run with a short poll interval and stream the final log piece-by-piece by
	// wrapping invoke to forward enter/skip/exit decisions live.
	const wrappedCtx = {
		...ctx,
		skills: {
			invoke: async (tool, args) => {
				const r = await invoke(tool, args);
				if (tool === 'pump-fun-trade.buyToken' || tool === 'pump-fun-trade.sellToken') {
					send('trade', { tool, args, result: r });
				}
				return r;
			},
		},
	};

	try {
		const result = await runStrategy(
			{ strategy: body.strategy, durationSec, simulate: true },
			wrappedCtx,
		);
		// Stream the trade log as discrete events for the UI.
		for (const entry of result.data?.log ?? []) send('log', entry);
		send('done', result.data);
	} catch (e) {
		send('error', { message: e.message });
	}
	res.end();
}
