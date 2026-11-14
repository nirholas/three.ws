/**
 * Live trade room: one leader's SSE stream.
 *
 *   GET /api/sniper/room-stream?agent_id=<uuid>&network=mainnet&since=<iso>&session=<id>
 *
 * The sniper worker is a separate process, so like /api/sniper/stream this
 * DB-polls agent_sniper_positions (every POLL_INTERVAL_MS) for this leader's
 * rows that moved past a cursor, and derives what happened from timestamps
 * (api/_lib/trade-room.js eventsSince), so a position that opens and closes
 * inside one poll still emits its buy before its sell.
 *
 * `since` is the newest event the page already painted from /api/sniper/room,
 * so nothing falls in the gap between snapshot and stream. It is clamped to ten
 * minutes back so a stale tab cannot ask for a replay of the whole ledger.
 *
 * Chat rides the same connection: each poll also reads messages created, and
 * messages hidden, after a chat cursor (`chat_since`, defaulting to `since`).
 * A chat table that is not migrated yet disables chat for this connection and
 * leaves the trade stream untouched.
 *
 * `session` is the viewer's random tab id. While the connection is open the
 * session counts as a spectator of this room (api/_lib/trade-room-presence.js)
 * and is removed on close, so the room's "watching" number is live.
 *
 * Events:
 *   open      { agent_id, network, spectators, presence_scope }
 *   trade     one positionEvents() row (kind buy | sell)
 *   quote     { position_id, symbol, current_sol, unrealized_pct, at }
 *   chat      one shaped chat message (api/_lib/trade-room-chat.js shapeMessage)
 *   chat_hidden { id }  a message the owner hid or its author removed
 *   presence  { spectators, presence_scope }
 *   ping      { t }
 *   error     { message }
 *   close     { reason }  the client reconnects with its newest `since`
 */

import { cors, method, rateLimited, error } from '../_lib/http.js';
import { limits, clientIp } from '../_lib/rate-limit.js';
import { isUuid } from '../_lib/validate.js';
import {
	loadRoomAgent, fetchChangedPositions, eventsSince, sanitizeSession, streamStartCursor,
} from '../_lib/trade-room.js';
import {
	chatCursor, fetchNewMessages, fetchHiddenSince, shapeMessage, isMissingTable,
} from '../_lib/trade-room-chat.js';
import { touchSpectator, leaveSpectator, countSpectators } from '../_lib/trade-room-presence.js';

const MAX_DURATION_MS = 90_000;
const PING_INTERVAL_MS = 15_000;
const POLL_INTERVAL_MS = 2_000;
const PRESENCE_TOUCH_MS = 10_000;
const PRESENCE_READ_MS = 5_000;
const NETWORKS = new Set(['mainnet', 'devnet']);

export default async function handleRoomStream(req, res) {
	if (cors(req, res, { methods: 'GET,OPTIONS' })) return;
	if (!method(req, res, ['GET'])) return;

	const rl = await limits.mcpIp(clientIp(req));
	if (!rl.success) return rateLimited(res, rl);

	const url = new URL(req.url, `http://${req.headers.host || 'x'}`);
	const agentId = (url.searchParams.get('agent_id') || '').trim();
	const network = NETWORKS.has(url.searchParams.get('network')) ? url.searchParams.get('network') : 'mainnet';
	const session = sanitizeSession(url.searchParams.get('session'));
	if (!isUuid(agentId)) return error(res, 400, 'invalid_agent', 'agent_id must be a valid agent UUID');

	let agent;
	try {
		agent = await loadRoomAgent(agentId);
	} catch {
		return error(res, 503, 'unavailable', 'The trade ledger is unreachable right now. Retry in a moment.');
	}
	if (!agent) return error(res, 404, 'not_found', 'No such trader, or it is not public.');

	res.writeHead(200, {
		'Content-Type': 'text/event-stream; charset=utf-8',
		'Cache-Control': 'no-cache, no-transform',
		Connection: 'keep-alive',
		'X-Accel-Buffering': 'no',
	});
	res.flushHeaders?.();

	let active = true;
	const send = (event, data) => {
		if (!active) return;
		res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
	};

	let cursorMs = streamStartCursor(url.searchParams.get('since'));
	let polling = false;
	let lastPresence = null;
	let chatPolling = false;
	let chatEnabled = true;
	let chatCursorMs = chatCursor(url.searchParams.get('chat_since') || url.searchParams.get('since'));
	let hiddenCursorMs = chatCursorMs;
	const ownerId = agent.user_id || null;

	const poll = async () => {
		if (!active || polling) return;
		polling = true;
		try {
			const rows = await fetchChangedPositions({ agentId, network, cursorIso: new Date(cursorMs).toISOString() });
			if (rows.length) {
				const { trades, quotes } = eventsSince(rows, cursorMs, { network });
				for (const t of trades) send('trade', t);
				for (const q of quotes) send('quote', q);
				for (const r of rows) {
					const changed = new Date(r.changed_at).getTime();
					if (changed > cursorMs) cursorMs = changed;
				}
			}
		} catch {
			send('error', { message: 'poll_failed' });
		} finally {
			polling = false;
		}
	};

	// Chat is decoration on the trades: a failure here never emits `error` or
	// stops the stream. A missing table switches chat off for this connection.
	const pollChat = async () => {
		if (!active || !chatEnabled || chatPolling) return;
		chatPolling = true;
		try {
			const fresh = await fetchNewMessages({ agentId, cursorIso: new Date(chatCursorMs).toISOString() });
			for (const m of fresh) {
				send('chat', shapeMessage(m, { ownerId }));
				const t = new Date(m.created_at).getTime();
				if (t > chatCursorMs) chatCursorMs = t;
			}
			const hidden = await fetchHiddenSince({ agentId, cursorIso: new Date(hiddenCursorMs).toISOString() });
			for (const h of hidden) {
				send('chat_hidden', { id: h.id });
				const t = new Date(h.hidden_at).getTime();
				if (t > hiddenCursorMs) hiddenCursorMs = t;
			}
		} catch (err) {
			if (isMissingTable(err)) chatEnabled = false;
		} finally {
			chatPolling = false;
		}
	};

	const readPresence = async () => {
		if (!active) return;
		try {
			const p = await countSpectators(agentId);
			if (!lastPresence || p.count !== lastPresence.count || p.scope !== lastPresence.scope) {
				lastPresence = p;
				send('presence', { spectators: p.count, presence_scope: p.scope });
			}
		} catch {
			/* presence is decoration on top of the trades; never fail the stream for it */
		}
	};

	if (session) await touchSpectator(agentId, session).catch(() => null);
	const opening = await countSpectators(agentId).catch(() => null);
	lastPresence = opening;
	send('open', {
		agent_id: agentId,
		network,
		spectators: opening ? opening.count : null,
		presence_scope: opening ? opening.scope : null,
	});

	const pollTimer = setInterval(() => { poll(); pollChat(); }, POLL_INTERVAL_MS);
	const presenceTimer = setInterval(readPresence, PRESENCE_READ_MS);
	const touchTimer = session
		? setInterval(() => touchSpectator(agentId, session).catch(() => null), PRESENCE_TOUCH_MS)
		: null;
	const ping = setInterval(() => send('ping', { t: Date.now() }), PING_INTERVAL_MS);

	// A duration-limit close keeps the session's presence: the client reconnects
	// within a second, and a viewer who does not simply ages out of the TTL.
	const teardown = ({ leave = true } = {}) => {
		if (!active) return;
		active = false;
		clearInterval(pollTimer);
		clearInterval(presenceTimer);
		if (touchTimer) clearInterval(touchTimer);
		clearInterval(ping);
		clearTimeout(durationTimer);
		if (session && leave) leaveSpectator(agentId, session).catch(() => null);
		try { res.end(); } catch { /* socket already gone */ }
	};
	const durationTimer = setTimeout(() => {
		send('close', { reason: 'duration_limit' });
		teardown({ leave: false });
	}, MAX_DURATION_MS);

	req.on('close', () => teardown());
}
