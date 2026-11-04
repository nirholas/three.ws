// The Telegram gateway against a local HTTP server speaking the Bot API
// (getWebhookInfo, getMe, long-polled getUpdates, sendMessage, inline-button
// callbacks) and a local model server: the allowlist and webhook refusals,
// one session per chat, approvals by button, and the token never logged.

import fs from 'node:fs';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { runGateway } from '../src/commands/gateway.js';
import { approvalText, GatewayError, parseAllowlist, startTelegramGateway } from '../src/gateway.js';
import { listen, modelServer, readBody, tempEnv, testContext, waitFor } from './helpers.js';

const TOKEN = '123456789:THREEsyntheticBotTokenForTests0000000';

/** A local Bot API: tests push updates with `deliver`, and read what the bot sent from `calls`. */
async function botApi({ webhookUrl = '' } = {}) {
	const calls = [];
	const queue = [];
	let waiter = null;
	let updateId = 100;
	let messageId = 1;
	const srv = await listen(async (req, res) => {
		const m = req.url.match(/^\/bot([^/]+)\/(\w+)$/);
		const body = (await readBody(req)) || {};
		const reply = (result, status = 200) => {
			res.writeHead(status, { 'content-type': 'application/json' });
			res.end(JSON.stringify(status === 200 ? { ok: true, result } : { ok: false, description: result }));
		};
		if (!m || m[1] !== TOKEN) return reply('Unauthorized', 401);
		const method = m[2];
		calls.push({ method, body });
		if (method === 'getWebhookInfo') return reply({ url: webhookUrl, pending_update_count: 0 });
		if (method === 'getMe') return reply({ id: 123456789, is_bot: true, first_name: 'Harbour', username: 'harbour_test_bot' });
		if (method === 'getUpdates') {
			const take = () => queue.splice(0).filter((u) => u.update_id >= (body.offset || 0));
			if (queue.length) return reply(take());
			const timer = setTimeout(() => {
				waiter = null;
				reply([]);
			}, (body.timeout || 0) * 1000);
			waiter = () => {
				clearTimeout(timer);
				waiter = null;
				reply(take());
			};
			req.on('close', () => clearTimeout(timer));
			return undefined;
		}
		if (method === 'sendMessage') return reply({ message_id: messageId++, chat: { id: body.chat_id }, text: body.text });
		return reply(true);
	});
	return {
		...srv,
		calls,
		sent: () => calls.filter((c) => c.method === 'sendMessage').map((c) => c.body),
		deliver(update) {
			queue.push({ update_id: updateId++, ...update });
			waiter?.();
		},
		message(chatId, text) {
			this.deliver({ message: { message_id: messageId++, chat: { id: chatId, type: 'private' }, from: { id: chatId, username: `user${chatId}` }, text } });
		},
		press(sent, which) {
			const button = sent.reply_markup.inline_keyboard[0].find((b) => b.text === which);
			this.deliver({ callback_query: { id: `cb${updateId}`, data: button.callback_data, message: { message_id: 1, chat: { id: Number(sent.chat_id) }, text: sent.text } } });
		},
	};
}

const cleanups = [];
afterEach(async () => {
	while (cleanups.length) await cleanups.pop()();
});

async function setup(reply, { webhookUrl } = {}) {
	const t = tempEnv();
	const model = await modelServer(reply);
	const tg = await botApi({ webhookUrl });
	const ctx = testContext(t.env, model.baseUrl);
	cleanups.push(t.cleanup, model.close, tg.close, () => ctx.close());
	return { t, model, tg, ctx };
}

describe('allowlist parsing', () => {
	it('reads ids from flags, config arrays and env strings, and rejects anything else', () => {
		expect(parseAllowlist(['111,222'], [-100333], '444 555')).toEqual(['111,222'.split(',')[0], '222', '-100333', '444', '555']);
		expect(() => parseAllowlist('@someone')).toThrow(GatewayError);
		expect(() => parseAllowlist('12a')).toThrow(/not a Telegram chat id/);
	});
});

describe('startTelegramGateway refusals', () => {
	it('refuses an empty allowlist before touching the network', async () => {
		const { ctx, tg } = await setup(() => ({ content: 'x' }));
		await expect(startTelegramGateway({ ctx, token: TOKEN, allow: [], apiBase: tg.url })).rejects.toMatchObject({ code: 'empty_allowlist' });
		await expect(runGateway({ ctx, allow: [], apiBase: tg.url, withScheduler: false })).rejects.toThrow(/empty allowlist/);
		await expect(startTelegramGateway({ ctx, token: '', allow: ['1'], apiBase: tg.url })).rejects.toMatchObject({ code: 'no_token' });
		expect(tg.calls).toEqual([]);
	});

	it('refuses to poll a bot that has a webhook, without deleting it', async () => {
		const { ctx, tg } = await setup(() => ({ content: 'x' }), { webhookUrl: 'https://hooks.example.test/telegram' });
		await expect(startTelegramGateway({ ctx, token: TOKEN, allow: ['42'], apiBase: tg.url })).rejects.toMatchObject({ code: 'webhook_set', message: expect.stringContaining('hooks.example.test') });
		expect(tg.calls.map((c) => c.method)).toEqual(['getWebhookInfo']);
	});

	it('reports a rejected token', async () => {
		const { ctx, tg } = await setup(() => ({ content: 'x' }));
		await expect(startTelegramGateway({ ctx, token: '999:wrongwrongwrongwrongwrongwrongwrong', allow: ['42'], apiBase: tg.url })).rejects.toMatchObject({ code: 'unauthorized' });
	});
});

describe('running gateway', () => {
	it('answers only allowlisted chats, one session per chat, and never logs the token', async () => {
		const { ctx, tg, model, t } = await setup((body) => ({ content: `You said: ${body.messages.at(-1).content}` }));
		const logs = [];
		const gw = await startTelegramGateway({ ctx, token: TOKEN, allow: ['42'], apiBase: tg.url, log: (e) => logs.push(e), pollTimeoutS: 1 });
		expect(gw.bot.username).toBe('harbour_test_bot');

		tg.message(7, 'let me in');
		tg.message(42, 'first message');
		await waitFor(() => tg.sent().some((s) => s.text === 'You said: first message'));
		tg.message(42, 'second message');
		await waitFor(() => tg.sent().some((s) => s.text === 'You said: second message'));
		await gw.stop();

		expect(model.requests).toHaveLength(2);
		const contents = model.requests[1].messages.map((m) => m.content);
		expect(contents).toContain('first message');
		expect(contents).toContain('You said: first message');
		expect(tg.sent().every((s) => String(s.chat_id) === '42')).toBe(true);
		expect(logs).toContainEqual({ kind: 'ignored', chatId: '7', from: 'user7' });
		const sessions = ctx.store.listSessions({ limit: 10 }).filter((s) => s.channel === 'telegram:42');
		expect(sessions).toHaveLength(1);
		expect(JSON.stringify(logs)).not.toContain(TOKEN);
		expect(fs.existsSync(path.join(t.home, 'data'))).toBe(true);
	});

	it('runs a write only after the Approve button, and not after Deny', async () => {
		let round = 0;
		const { ctx, tg, t } = await setup((body) => {
			round++;
			const last = body.messages.at(-1);
			if (last.role === 'tool') return { content: last.content.includes('blocked') ? 'Understood, I left it alone.' : 'Saved the note.' };
			return { toolCalls: [{ name: 'write_file', args: { path: last.content.includes('deny') ? 'denied.txt' : 'approved.txt', content: 'tide at 06:42' } }] };
		});
		const gw = await startTelegramGateway({ ctx, token: TOKEN, allow: ['42'], apiBase: tg.url, pollTimeoutS: 1 });

		tg.message(42, 'write the note, approve it');
		const ask = await waitFor(() => tg.sent().find((s) => s.reply_markup));
		expect(ask.text).toMatch(/^Approve write tool write_file\?/);
		expect(ask.reply_markup.inline_keyboard[0].map((b) => b.text)).toEqual(['Approve', 'Deny']);
		tg.press(ask, 'Approve');
		await waitFor(() => tg.sent().some((s) => s.text === 'Saved the note.'));
		expect(fs.readFileSync(path.join(t.cwd, 'approved.txt'), 'utf8')).toBe('tide at 06:42');
		expect(tg.calls.some((c) => c.method === 'answerCallbackQuery' && c.body.text === 'Approved')).toBe(true);

		tg.message(42, 'write it again but deny');
		const ask2 = await waitFor(() => tg.sent().filter((s) => s.reply_markup)[1]);
		tg.press(ask2, 'Deny');
		await waitFor(() => tg.sent().some((s) => s.text === 'Understood, I left it alone.'));
		expect(fs.existsSync(path.join(t.cwd, 'denied.txt'))).toBe(false);
		await gw.stop();
		expect(round).toBe(4);
	});

	it('shows recipient, amount, token and chain for a financial approval', () => {
		const text = approvalText({
			tool: { name: 'send_payment', toolClass: 'financial' },
			args: { recipient: 'THREEsynthetic1111111111111111111111111111', amount: '25', token: '$THREE', chain: 'solana' },
		});
		expect(text.split('\n').slice(0, 5)).toEqual([
			'Approve financial tool send_payment?',
			'Recipient: THREEsynthetic1111111111111111111111111111',
			'Amount: 25',
			'Token: $THREE',
			'Chain: solana',
		]);
	});
});
