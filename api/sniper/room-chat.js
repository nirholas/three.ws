/**
 * Live trade room: spectator chat.
 *
 *   GET    /api/sniper/room-chat?agent_id=<uuid>             recent messages, viewer context, `t` (stream cursor)
 *   POST   /api/sniper/room-chat?agent_id=<uuid>  { body }   send (signed in, CSRF)
 *   DELETE /api/sniper/room-chat?agent_id=<uuid>&id=<uuid>   author removes their own,
 *                                                            room owner hides anyone's
 *
 * New messages and removals reach open rooms through /api/sniper/room-stream
 * (`chat` and `chat_hidden` events). The room is gated exactly like the
 * snapshot and the stream: a private or deleted trader has no room (404).
 *
 * Failure codes the page turns into guidance: unauthorized (401), empty,
 * too_long, invalid_body (400), blocked_content (422), duplicate (409),
 * rate_limited (429), not_found (404), forbidden (403), unavailable (503: the
 * chat table is not migrated yet or the database is unreachable).
 */

import { cors, json, method, wrap, error, readJson, rateLimited } from '../_lib/http.js';
import { limits, clientIp } from '../_lib/rate-limit.js';
import { getSessionUser } from '../_lib/auth.js';
import { requireCsrf } from '../_lib/csrf.js';
import { isUuid } from '../_lib/validate.js';
import { loadRoomAgent } from '../_lib/trade-room.js';
import {
	CHAT_MAX_LEN, validateBody, shapeMessage, canRemove, isMissingTable,
	listMessages, insertMessage, isDuplicate, loadMessage, removeMessage,
} from '../_lib/trade-room-chat.js';

function unavailable(res) {
	return error(res, 503, 'unavailable', 'Room chat is not available right now. Retry in a moment.');
}

export default wrap(async (req, res) => {
	if (cors(req, res, { methods: 'GET,POST,DELETE,OPTIONS', credentials: true })) return;
	if (!method(req, res, ['GET', 'POST', 'DELETE'])) return;

	const params = new URL(req.url, `http://${req.headers.host || 'x'}`).searchParams;
	const agentId = (params.get('agent_id') || '').trim();
	if (!isUuid(agentId)) return error(res, 400, 'invalid_agent', 'agent_id must be a valid agent UUID');

	const rl = await limits.publicIp(clientIp(req));
	if (!rl.success) return rateLimited(res, rl);

	let agent;
	try {
		agent = await loadRoomAgent(agentId);
	} catch {
		return unavailable(res);
	}
	if (!agent) return error(res, 404, 'not_found', 'No such trader, or it is not public.');
	const ownerId = agent.user_id || null;

	const user = await getSessionUser(req, res).catch(() => null);

	if (req.method === 'GET') {
		// Taken BEFORE the read: the page hands it to the stream as its chat
		// cursor, so anything created or hidden after this instant is replayed
		// (the client dedupes by id) and nothing falls in the gap.
		const t = Date.now();
		let rows;
		try {
			rows = await listMessages({ agentId });
		} catch (err) {
			if (isMissingTable(err)) return unavailable(res);
			throw err;
		}
		return json(
			res,
			200,
			{
				messages: rows.map((r) => shapeMessage(r, { ownerId, viewerId: user?.id || null })),
				viewer: {
					signed_in: Boolean(user),
					is_owner: Boolean(user && ownerId && String(user.id) === String(ownerId)),
				},
				max_length: CHAT_MAX_LEN,
				t,
			},
			{ 'cache-control': 'private, no-store' },
		);
	}

	if (!user) return error(res, 401, 'unauthorized', 'Sign in to join the chat.');
	if (!(await requireCsrf(req, res, user.id))) return;

	if (req.method === 'POST') {
		const body = await readJson(req).catch(() => null);
		const checked = validateBody(body?.body);
		if (!checked.ok) return error(res, checked.status, checked.code, checked.message);

		const burst = await limits.tradeRoomChat(user.id);
		if (!burst.success) return rateLimited(res, burst, 'You are sending messages too fast. Wait a few seconds.');

		try {
			if (await isDuplicate({ agentId, userId: user.id, body: checked.body })) {
				return error(res, 409, 'duplicate', 'You just sent that exact message.');
			}
			const row = await insertMessage({ agentId, userId: user.id, body: checked.body });
			return json(res, 201, { message: shapeMessage(row, { ownerId, viewerId: user.id }) });
		} catch (err) {
			if (isMissingTable(err)) return unavailable(res);
			throw err;
		}
	}

	// DELETE
	const id = (params.get('id') || '').trim();
	if (!isUuid(id)) return error(res, 400, 'invalid_message', 'id must be a valid message UUID');
	try {
		const message = await loadMessage({ agentId, id });
		if (!message) return error(res, 404, 'not_found', 'That message is already gone.');
		const role = canRemove({ message, viewerId: user.id, ownerId });
		if (!role) return error(res, 403, 'forbidden', 'Only the author or the room owner can remove a message.');
		await removeMessage({ agentId, id, byUserId: user.id });
		return json(res, 200, { id, removed_by: role });
	} catch (err) {
		if (isMissingTable(err)) return unavailable(res);
		throw err;
	}
});
