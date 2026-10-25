import { describe, it, expect } from 'vitest';
import {
	telegramChatState,
	loadTelegramChat,
	telegramLoginUrl,
	telegramActionError,
} from '../src/oracle-telegram.js';

describe('telegramChatState', () => {
	it('is linked when the server returns a verified chat id', () => {
		expect(telegramChatState({ ok: true, status: 200, data: { linked: true, chat_id: 42 } })).toEqual({
			status: 'linked',
			chatId: '42',
		});
	});
	it('is unlinked when signed in without a Telegram identity', () => {
		expect(telegramChatState({ ok: true, status: 200, data: { linked: false, chat_id: null } })).toEqual({
			status: 'unlinked',
		});
	});
	it('is signed_out on 401', () => {
		expect(telegramChatState({ ok: false, status: 401, data: null }).status).toBe('signed_out');
	});
	it('maps transport and server failures to actionable errors', () => {
		expect(telegramChatState({ ok: false, status: 0, data: null }).message).toMatch(/connection/);
		expect(telegramChatState({ ok: false, status: 429, data: null }).message).toMatch(/Wait/);
		expect(telegramChatState({ ok: false, status: 500, data: null }).message).toMatch(/HTTP 500/);
	});
});

describe('helpers', () => {
	it('loadTelegramChat calls the endpoint through the supplied api function', async () => {
		const seen = [];
		const st = await loadTelegramChat(async (p) => {
			seen.push(p);
			return { ok: true, status: 200, data: { linked: true, chat_id: '7' } };
		});
		expect(seen).toEqual(['/api/oracle/telegram-chat']);
		expect(st.chatId).toBe('7');
	});
	it('login url round-trips the return path', () => {
		expect(telegramLoginUrl('/oracle/arm?x=1')).toBe('/login?next=%2Foracle%2Farm%3Fx%3D1');
	});
	it('prefers the server description for action errors', () => {
		expect(telegramActionError({ status: 403, data: { error_description: 'link first' } }, 'Failed')).toBe('link first');
		expect(telegramActionError({ status: 500, data: null }, 'Failed')).toBe('Failed');
		expect(telegramActionError({ status: 401 }, 'Failed')).toMatch(/Sign in/);
	});
});
