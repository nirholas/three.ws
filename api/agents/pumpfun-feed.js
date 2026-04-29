/**
 * GET /api/agents/pumpfun-feed
 * ---------------------------------
 * Live pump.fun activity feed. Streams `mint`, `graduation`, and `claim`
 * events as Server-Sent Events.
 *
 * Auth: session OR bearer (scope `mcp` or `profile`).
 * Query: ?kind=all|mint|graduation|claims  (default all)
 *        ?minTier=notable|influencer|mega  (claim filter, optional)
 *
 * Sources (in priority order):
 *   1. pump.fun public WebSocket (always available — mint + graduation)
 *   2. Redis/pumpfun-bot (optional — adds claim events when configured)
 */

import { getSessionUser, authenticateBearer, extractBearer, hasScope } from '../_lib/auth.js';
import { cors, method, error, wrap } from '../_lib/http.js';
import { limits } from '../_lib/rate-limit.js';
import { pumpfunMcp, pumpfunBotEnabled } from '../_lib/pumpfun-mcp.js';
import { connectPumpFunFeed } from '../_lib/pumpfun-ws-feed.js';

const POLL_MS = 4000;
const MAX_DURATION_MS = 90_000;
const TIER_RANK = { notable: 1, influencer: 2, mega: 3 };

export default wrap(async (req, res) => {
	if (cors(req, res, { methods: 'GET,OPTIONS', credentials: true })) return;
	if (!method(req, res, ['GET'])) return;

	const session = await getSessionUser(req);
	const bearer = session ? null : await authenticateBearer(extractBearer(req));
	if (!session && !bearer) return error(res, 401, 'unauthorized', 'sign in required');
	if (bearer && !hasScope(bearer.scope, 'mcp') && !hasScope(bearer.scope, 'profile')) {
		return error(res, 403, 'insufficient_scope', 'requires mcp or profile scope');
	}

	const userId = session?.id ?? bearer.userId;
	const rl = await limits.mcpUser(String(userId));
	if (!rl.success) return error(res, 429, 'rate_limited', 'too many feed connections');

	const url = new URL(req.url, 'http://x');
	const kind = url.searchParams.get('kind') || 'all';
	const minTierParam = url.searchParams.get('minTier');
	const minTier = TIER_RANK[minTierParam] || 0;

	res.statusCode = 200;
	res.setHeader('content-type', 'text/event-stream; charset=utf-8');
	res.setHeader('cache-control', 'no-store');
	res.setHeader('connection', 'keep-alive');
	res.setHeader('x-accel-buffering', 'no');
	res.flushHeaders?.();

	const started = Date.now();
	let active = true;
	req.on('close', () => { active = false; });

	const wsAbort = new AbortController();
	req.on('close', () => wsAbort.abort());

	// Event queue fed by the pump.fun WebSocket
	const queue = [];
	const wsKind = kind === 'claims' ? 'graduation' : kind; // claims come from bot only
	const stopWs = connectPumpFunFeed({
		kind: wsKind,
		signal: wsAbort.signal,
		onEvent: ({ kind: evKind, data }) => {
			if (active) queue.push({ evKind, data });
		},
	});

	writeSse(res, 'open', { kind, minTier: minTierParam || null, source: 'websocket' });

	// Optional: also poll Redis/bot for claim events if configured
	const seen = new Set();
	let lastSig = null;

	const tickClaims = pumpfunBotEnabled()
		? async () => {
				if (kind !== 'claims' && kind !== 'all') return;
				const r = await pumpfunMcp.claimsSince({ sinceSig: lastSig, limit: 25 });
				if (!r.ok) return;
				const items = Array.isArray(r.data) ? r.data : r.data?.items || [];
				for (const ev of items) {
					const id = ev.tx_signature || ev.signature || ev.id;
					if (!id || seen.has(id)) continue;
					seen.add(id);
					if (minTier && TIER_RANK[(ev.tier || '').toLowerCase()] < minTier) continue;
					lastSig = id;
					writeSse(res, 'claim', ev);
				}
		  }
		: null;

	while (active && Date.now() - started < MAX_DURATION_MS) {
		// Drain WebSocket event queue
		while (queue.length > 0 && active) {
			const { evKind, data } = queue.shift();
			writeSse(res, evKind, data);
		}

		// Pull claim events from Redis/bot if available
		if (tickClaims) {
			try { await tickClaims(); } catch {}
		}

		writeSse(res, 'ping', { t: Date.now() });
		await sleep(POLL_MS);
	}

	stopWs();
	writeSse(res, 'close', { reason: 'duration_limit' });
	res.end();
});

function writeSse(res, event, data) {
	res.write(`event: ${event}\n`);
	res.write(`data: ${JSON.stringify(data)}\n\n`);
}

function sleep(ms) {
	return new Promise((r) => setTimeout(r, ms));
}
