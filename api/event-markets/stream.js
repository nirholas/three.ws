/**
 * Event Markets live odds feed (server-sent events).
 *
 *   GET /api/event-markets/stream              every open market (global feed)
 *   GET /api/event-markets/stream?slug=<slug>  one market
 *
 * Events: snapshot | resync | resume | open | odds | pick | move | lock |
 * resolve | ping | close. Schema and reconnect behavior: docs/event-markets.md,
 * section "Live feed".
 *
 * Anonymous by construction: a pick event carries the outcome and a count, never
 * an account. The stream is served from the shared event log (see hub.js), so a
 * pick placed on any Cloud Run instance reaches listeners on every instance.
 *
 * Cloud Run caps a request at its timeout, so a connection ends itself shortly
 * before that with `event: close` and the browser's EventSource reconnects with
 * Last-Event-ID, replaying only what it missed. `retry:` sets the reconnect delay.
 */

import { cors, error, method, rateLimited } from '../_lib/http.js';
import { limits, clientIp } from '../_lib/rate-limit.js';
import { feedConfig } from '../_lib/event-markets/feed-config.js';
import { createHub } from '../_lib/event-markets/hub.js';
import { eventsSince, latestEventId, oldestRetainedEventId, pruneEvents } from '../_lib/event-markets/events.js';
import { processFeed, snapshotMarkets } from '../_lib/event-markets/feed.js';

const SLUG_RE = /^[a-z0-9][a-z0-9-]{1,78}$/;
const cfg = feedConfig.stream;

const hub = createHub({
	source: {
		eventsSince,
		latestId: latestEventId,
		oldestId: oldestRetainedEventId,
		snapshot: snapshotMarkets,
		process: processFeed,
		prune: pruneEvents,
	},
});

let heartbeat = null;
function ensureHeartbeat() {
	if (heartbeat) return;
	heartbeat = setInterval(() => {
		if (hub.size === 0) {
			clearInterval(heartbeat);
			heartbeat = null;
			return;
		}
		hub.heartbeat();
	}, cfg.heartbeatMs);
	heartbeat.unref?.();
}

function parseLastEventId(req, url) {
	const raw = req.headers['last-event-id'] ?? url.searchParams.get('lastEventId');
	if (raw == null || raw === '') return null;
	const n = Number(raw);
	return Number.isInteger(n) && n >= 0 ? n : null;
}

export default async function handleEventMarketsStream(req, res) {
	if (cors(req, res, { methods: 'GET,OPTIONS', origins: '*' })) return;
	if (!method(req, res, ['GET'])) return;

	const ip = clientIp(req);
	const rl = await limits.publicIp(ip);
	if (!rl.success) return rateLimited(res, rl);

	const url = new URL(req.url, `http://${req.headers.host || 'x'}`);
	const slug = url.searchParams.get('slug');
	if (slug && !SLUG_RE.test(slug)) return error(res, 400, 'validation_error', 'slug is not a valid market slug');

	const admit = hub.admit(ip);
	if (!admit.ok) {
		res.setHeader('retry-after', '5');
		return error(res, 429, admit.reason, admit.reason === 'too_many_connections'
			? `At most ${cfg.maxConnectionsPerIp} live connections per address. Close another tab or use one shared connection.`
			: 'The live feed is at capacity. Retry in a few seconds.');
	}

	res.writeHead(200, {
		'Content-Type': 'text/event-stream; charset=utf-8',
		'Cache-Control': 'no-cache, no-transform',
		Connection: 'keep-alive',
		'X-Accel-Buffering': 'no',
	});
	res.flushHeaders?.();
	res.write(`retry: ${cfg.retryMs}\n\n`);

	let detach = null;
	let closed = false;
	let durationTimer = null;
	const finish = () => {
		if (closed) return;
		closed = true;
		clearTimeout(durationTimer);
		detach?.();
		try {
			res.end();
		} catch {}
	};
	req.on('close', finish);

	// Spread connection ends so a deploy or a restart does not reconnect everyone
	// in the same second.
	const lifetime = cfg.maxConnectionMs * (0.9 + Math.random() * 0.1);
	durationTimer = setTimeout(() => {
		if (!closed) res.write(`event: close\ndata: ${JSON.stringify({ reason: 'duration_limit', reconnect: true })}\n\n`);
		finish();
	}, lifetime);

	try {
		const off = await hub.attach({
			write: (chunk) => res.write(chunk),
			end: finish,
			backlog: () => res.writableLength,
			slug,
			ip,
			lastEventId: parseLastEventId(req, url),
		});
		if (closed) off();
		else detach = off;
		ensureHeartbeat();
	} catch (err) {
		console.error('[event-markets] stream attach failed:', err?.message || err);
		if (!closed) res.write(`event: error\ndata: ${JSON.stringify({ message: 'attach_failed', reconnect: true })}\n\n`);
		finish();
	}
}
