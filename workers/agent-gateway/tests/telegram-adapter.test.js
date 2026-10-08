// The Telegram adapter: update normalisation and the send surface, with the
// Bot API answered at its boundary (tests/_telegram.js).

import { readFileSync } from 'node:fs';
import { describe, it, expect } from 'vitest';
import { createTelegramAdapter, parseTelegramCommand, toPlatformError } from '../src/adapters/telegram.js';
import { PlatformError } from '../src/errors.js';
import { fakeBotApi, telegramEnv, FIXTURE_TOKEN } from './_telegram.js';

const fixture = (name) => JSON.parse(readFileSync(new URL(`./fixtures/${name}.json`, import.meta.url), 'utf8'));

function adapterWith(answer, opts = {}) {
	const bot = fakeBotApi(answer);
	return { bot, adapter: createTelegramAdapter({ env: telegramEnv, api: bot.api, ...opts }) };
}

describe('parseTelegramCommand', () => {
	it('reads commands, arguments and the bot suffix', () => {
		expect(parseTelegramCommand('/help')).toEqual({ command: 'help', args: '' });
		expect(parseTelegramCommand('/USE 2', 'threewsbot')).toEqual({ command: 'use', args: '2' });
		expect(parseTelegramCommand('/link@threewsbot ABCD-EFGH', 'threewsbot')).toEqual({ command: 'link', args: 'ABCD-EFGH' });
		expect(parseTelegramCommand('/start@SomeOtherBot', 'threewsbot')).toEqual({ foreign: true });
		expect(parseTelegramCommand('hello /help')).toBeNull();
	});
});

describe('telegram normalize', () => {
	const { adapter } = adapterWith();

	it('turns a command message into a command event', () => {
		expect(adapter.normalize(fixture('telegram-update-help'))).toMatchObject({
			platform: 'telegram', chatId: '5550001001', chatType: 'private', userId: '5550001001', username: 'fixture_owner', command: 'help', args: '',
		});
	});

	it('keeps a group title and strips the bot suffix', () => {
		expect(adapter.normalize(fixture('telegram-update-start-group'))).toMatchObject({ chatId: '-1005550002002', chatTitle: 'Fixture Traders', command: 'start' });
	});

	it('ignores a command meant for another bot in the same group', () => {
		const u = fixture('telegram-update-start-group');
		u.message.text = '/start@SomeOtherBot';
		expect(adapter.normalize(u)).toBeNull();
	});

	it('turns plain text into a text event and drops a mention of the bot', () => {
		const u = fixture('telegram-update-text');
		expect(adapter.normalize(u)).toMatchObject({ text: 'what is my balance?' });
		u.message.text = '@threewsbot what is my balance?';
		expect(adapter.normalize(u).text).toBe('what is my balance?');
	});

	it('maps an Approve or Cancel press to an action with the pressed message', () => {
		const u = fixture('telegram-update-callback');
		u.callback_query.data = 'gw:ap:0c7f9a52-3f0e-4c61-9d0f-1f1e2d3c4b5a';
		expect(adapter.normalize(u)).toMatchObject({
			action: { verb: 'approve', previewId: '0c7f9a52-3f0e-4c61-9d0f-1f1e2d3c4b5a' },
			messageRef: { chatId: '5550001001', messageId: 4190 },
			callbackQueryId: '4382910029381273001',
			userId: '5550001001',
		});
	});

	it('ignores buttons it did not create and messages from bots', () => {
		const press = fixture('telegram-update-callback');
		press.callback_query.data = 'something-else';
		expect(adapter.normalize(press)).toBeNull();
		const botMsg = fixture('telegram-update-text');
		botMsg.message.from.is_bot = true;
		expect(adapter.normalize(botMsg)).toBeNull();
		expect(adapter.normalize({ update_id: 1, edited_message: {} })).toBeNull();
	});

	it('fetches a voice note through getFile and the file endpoint', async () => {
		const requested = [];
		const fetchImpl = async (url) => {
			requested.push(url);
			return new Response(Buffer.from('OggS-fixture-bytes'), { headers: { 'content-type': 'application/octet-stream' } });
		};
		const { bot, adapter: a } = adapterWith(undefined, { fetch: fetchImpl });
		const event = a.normalize(fixture('telegram-update-voice'));
		const { buffer, mimeType } = await event.voice.fetch();
		expect(bot.of('getFile')[0].payload.file_id).toBe('AwACAgEAAxkBAAIQ-fixture-voice');
		expect(requested[0]).toBe(`https://api.telegram.org/file/bot${FIXTURE_TOKEN}/voice/AwACAgEAAxkBAAIQ-fixture-voice.oga`);
		expect(buffer.toString()).toBe('OggS-fixture-bytes');
		expect(mimeType).toBe('audio/ogg');
	});

	it('takes the largest photo size and keeps the caption', async () => {
		const fetchImpl = async () => new Response(Buffer.from([0xff, 0xd8]), { headers: { 'content-type': 'image/jpeg' } });
		const { bot, adapter: a } = adapterWith(undefined, { fetch: fetchImpl });
		const event = a.normalize(fixture('telegram-update-photo'));
		expect(event.photo.caption).toBe('is this chart bullish?');
		const { mimeType } = await event.photo.fetch();
		expect(bot.of('getFile')[0].payload.file_id).toBe('AgACAgEAAxkBAAIQ-fixture-large');
		expect(mimeType).toBe('image/jpeg');
	});
});

describe('telegram gateway', () => {
	it('splits a long reply into several messages and returns the last one', async () => {
		const { bot, adapter } = adapterWith();
		const paragraph = 'word '.repeat(700).trim();
		const ref = await adapter.gateway().sendText('42', `${paragraph}\n\n${paragraph}`);
		const sent = bot.of('sendMessage');
		expect(sent.length).toBe(2);
		for (const s of sent) expect(s.payload.text.length).toBeLessThanOrEqual(4000);
		expect(sent[0].payload.link_preview_options).toEqual({ is_disabled: true });
		expect(ref).toEqual({ chatId: '42', messageId: 9001 });
	});

	it('renders choices as one row of inline buttons and removes them on edit', async () => {
		const { bot, adapter } = adapterWith();
		const gw = adapter.gateway();
		const ref = await gw.sendChoice('42', 'Buy preview', [{ id: 'gw:ap:x', label: 'Approve', style: 'primary' }, { id: 'gw:cx:x', label: 'Cancel', style: 'danger' }]);
		expect(bot.of('sendMessage')[0].payload.reply_markup).toEqual({ inline_keyboard: [[{ text: 'Approve', callback_data: 'gw:ap:x' }, { text: 'Cancel', callback_data: 'gw:cx:x' }]] });
		await gw.editMessage(ref, 'Cancelled', { choices: [] });
		expect(bot.of('editMessageText')[0].payload).toMatchObject({ chat_id: '42', message_id: 9000, text: 'Cancelled', reply_markup: { inline_keyboard: [] } });
		await gw.editMessage(ref, 'working: get_quote');
		expect(bot.of('editMessageText')[1].payload.reply_markup).toBeUndefined();
	});

	it('treats an edit to identical text as done', async () => {
		const { adapter } = adapterWith((m) => (m === 'editMessageText' ? { ok: false, error_code: 400, description: 'Bad Request: message is not modified' } : undefined));
		await expect(adapter.gateway().editMessage({ chatId: '42', messageId: 1 }, 'same')).resolves.toBeUndefined();
	});

	it('sends rendered images as photos and other files as documents', async () => {
		const { bot, adapter } = adapterWith();
		const gw = adapter.gateway();
		await gw.sendMedia('42', { url: 'https://three.ws/api/render/glb?glbUrl=https%3A%2F%2Fthree.ws%2Fa.glb', caption: 'Your avatar' });
		await gw.sendMedia('42', { url: 'https://three.ws/models/a.glb' });
		expect(bot.of('sendPhoto')[0].payload).toMatchObject({ chat_id: '42', caption: 'Your avatar' });
		expect(bot.of('sendDocument')[0].payload.document).toBe('https://three.ws/models/a.glb');
	});

	it('answers a button press, and tolerates a press answered too late', async () => {
		const { bot, adapter } = adapterWith((m) => (m === 'answerCallbackQuery' && bot.of('answerCallbackQuery').length > 1 ? { ok: false, error_code: 400, description: 'Bad Request: query is too old' } : undefined));
		const gw = adapter.gateway();
		await gw.ackAction({ callbackQueryId: 'q1' }, 'Cancelled');
		await expect(gw.ackAction({ callbackQueryId: 'q2' }, 'Cancelled')).resolves.toBeUndefined();
		expect(bot.of('answerCallbackQuery')[0].payload).toEqual({ callback_query_id: 'q1', text: 'Cancelled' });
	});

	it('sends a spoken reply as a voice note and shows typing', async () => {
		const { bot, adapter } = adapterWith();
		const gw = adapter.gateway();
		await gw.sendVoice('42', { buffer: Buffer.from('OggS'), mimeType: 'audio/ogg', filename: 'reply.ogg' });
		await gw.typing('42');
		expect(bot.of('sendVoice')).toHaveLength(1);
		expect(bot.of('sendChatAction')[0].payload).toEqual({ chat_id: '42', action: 'typing' });
	});
});

describe('telegram error mapping', () => {
	it('marks refusals permanent and rate limits retryable with their wait', async () => {
		const { adapter } = adapterWith((m, p) => {
			if (p.chat_id === 'blocked') return { ok: false, error_code: 403, description: 'Forbidden: bot was blocked by the user' };
			if (p.chat_id === 'busy') return { ok: false, error_code: 429, description: 'Too Many Requests: retry after 7', parameters: { retry_after: 7 } };
			return undefined;
		});
		const gw = adapter.gateway();
		const blocked = await gw.sendText('blocked', 'hi').catch((e) => e);
		expect(blocked).toBeInstanceOf(PlatformError);
		expect(blocked).toMatchObject({ platform: 'telegram', status: 403, permanent: true });
		const busy = await gw.sendText('busy', 'hi').catch((e) => e);
		expect(busy).toMatchObject({ status: 429, permanent: false, retryAfterMs: 7000 });
	});

	it('passes through errors that are not from the Bot API', () => {
		const e = new Error('db down');
		expect(toPlatformError(e)).toBe(e);
	});
});

describe('telegram polling guard', () => {
	it('refuses to poll while a webhook is set, so production is never cut off', async () => {
		const errors = [];
		const { bot, adapter } = adapterWith((m) => (m === 'getWebhookInfo' ? { ok: true, result: { url: 'https://three.ws/api/gateway/telegram', pending_update_count: 0, has_custom_certificate: false } } : undefined), {
			config: { telegramPolling: true },
			log: { info() {}, warn() {}, error: (msg) => errors.push(msg) },
		});
		await adapter.start({ enqueue: async () => true });
		expect(errors[0]).toMatch(/polling refused/);
		expect(bot.of('deleteWebhook')).toHaveLength(0);
		expect(adapter.describe().mode).toBe('webhook');
	});
});
