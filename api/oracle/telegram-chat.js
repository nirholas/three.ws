/**
 * Oracle: the Telegram chat the signed-in user has verified.
 *
 *   GET /api/oracle/telegram-chat
 *   200 { linked: true,  chat_id: "123456789" }
 *   200 { linked: false, chat_id: null }
 *   401 when not signed in
 *
 * /api/oracle/follow and /api/oracle/test-alert only accept this chat id, so
 * the follow and arm panels read it here to prefill and lock their input.
 * Auth: session cookie or bearer token.
 */

import { cors, json, method, wrap, error } from '../_lib/http.js';
import { resolveUserId, verifiedTelegramChatId } from '../_lib/oracle/verified-chat.js';

export default wrap(async (req, res) => {
	if (cors(req, res, { methods: 'GET,OPTIONS', credentials: true })) return;
	if (!method(req, res, ['GET'])) return;

	const userId = await resolveUserId(req);
	if (!userId) return error(res, 401, 'unauthorized', 'sign in to use Telegram alerts');

	const chatId = await verifiedTelegramChatId(userId);
	res.setHeader('cache-control', 'private, no-store');
	return json(res, 200, { linked: Boolean(chatId), chat_id: chatId });
});
