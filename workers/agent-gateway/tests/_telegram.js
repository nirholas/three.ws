// The Telegram Bot API at its boundary. A real grammY Api whose transformer
// answers each call locally instead of sending it to api.telegram.org, so the
// adapter's own request building, error mapping and chunking run for real while
// nothing leaves the machine. Every call is recorded for assertions.

import { Api } from 'grammy';

export const FIXTURE_TOKEN = '7000000001:AAFixtureTokenNeverSentAnywhere000000';

/**
 * @param {(method:string, payload:object) => object|undefined} [answer]
 *   returns a Bot API response ({ ok, result } or { ok:false, error_code, description }),
 *   or undefined for the default success shape.
 */
export function fakeBotApi(answer = () => undefined) {
	const calls = [];
	let nextMessageId = 9000;
	const api = new Api(FIXTURE_TOKEN);
	api.config.use(async (_prev, method, payload) => {
		calls.push({ method, payload });
		const custom = answer(method, payload);
		if (custom) return custom;
		switch (method) {
			case 'sendMessage':
			case 'sendPhoto':
			case 'sendVideo':
			case 'sendDocument':
			case 'sendVoice':
				return { ok: true, result: { message_id: nextMessageId++, date: 1791446400, chat: { id: Number(payload.chat_id), type: 'private' }, text: payload.text } };
			case 'editMessageText':
				return { ok: true, result: { message_id: payload.message_id, date: 1791446400, chat: { id: Number(payload.chat_id), type: 'private' }, text: payload.text } };
			case 'getMe':
				return { ok: true, result: { id: 7000000001, is_bot: true, first_name: 'three.ws', username: 'threewsbot' } };
			case 'getFile':
				return { ok: true, result: { file_id: payload.file_id, file_unique_id: 'u', file_size: 9214, file_path: `voice/${payload.file_id}.oga` } };
			default:
				return { ok: true, result: true };
		}
	});
	return { api, calls, of: (method) => calls.filter((c) => c.method === method) };
}

export const telegramEnv = { TELEGRAM_BOT_TOKEN: FIXTURE_TOKEN, TELEGRAM_BOT_USERNAME: 'threewsbot' };
