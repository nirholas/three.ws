/**
 * GET /api/agents/pumpfun-feed
 * ---------------------------------
 * Live pump.fun activity feed for Solana agents. Streams `claim` and
 * `graduation` events as Server-Sent Events.
 *
 * Auth: session OR bearer (scope `mcp` or `profile`).
 * Query: ?kind=claims|graduations|all  (default all)
 *        ?minTier=notable|influencer|mega   (claim filter, optional)
 *
 * Implementation: serverless functions cannot hold long-lived connections
 * efficiently, so we run a bounded poll loop (every 4s, up to 90s) and let
 * the browser EventSource auto-reconnect. Each tick fetches `claimsSince`
 * from the upstream pumpfun-claims-bot and emits new events.
 */

import { getSessionUser, authenticateBearer, extractBearer, hasScope } from '../_lib/auth.js';
import { cors, method, error, wrap } from '../_lib/http.js';
import { limits, clientIp } from '../_lib/rate-limit.js';
import { pumpfunMcp, pumpfunBotEnabled } from '../_lib/pumpfun-mcp.js';

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

	// When the upstream feed isn't provisioned, open the SSE stream and close
	// it cleanly — a 503 here would trigger EventSource auto-reconnect storms.
	if (!pumpfunBotEnabled()) {
		writeSse(res, 'disabled', { reason: 'pumpfun feed not configured' });
		writeSse(res, 'close', { reason: 'not_configured' });
		res.end();
		return;
	}

	writeSse(res, 'open', { kind, minTier: minTierParam || null });

	const seen = new Set();
	let lastSig = null;
	const started = Date.now();
	let active = true;
	req.on('close', () => {
		active = false;
	});

	const tick = async () => {
		const tasks = [];
		if (kind === 'claims' || kind === 'all') {
			tasks.push(pumpfunMcp.claimsSince({ sinceSig: lastSig, limit: 25 }).then((r) => ({ t: 'claim', r })));
		}
		if (kind === 'graduations' || kind === 'all') {
			tasks.push(pumpfunMcp.graduations({ limit: 10 }).then((r) => ({ t: 'graduation', r })));
		}
		const results = await Promise.all(tasks);
		for (const { t, r } of results) {
			if (!r.ok) continue;
			const items = Array.isArray(r.data) ? r.data : r.data?.items || [];
			for (const ev of items) {
				const id = ev.tx_signature || ev.signature || ev.id;
				if (!id || seen.has(id)) continue;
				seen.add(id);
				if (t === 'claim') {
					if (minTier && TIER_RANK[(ev.tier || '').toLowerCase()] < minTier) continue;
					lastSig = id;
				}
				writeSse(res, t, ev);
			}
		}
	};

	while (active && Date.now() - started < MAX_DURATION_MS) {
		try {
			await tick();
		} catch {}
		writeSse(res, 'ping', { t: Date.now() });
		await sleep(POLL_MS);
	}

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
