// The drain loop against a real Postgres inbox (PGlite built from the shipped
// gateway migrations) and the real gateway core. Only the Telegram Bot API is
// answered locally (tests/_telegram.js), so claim, lease, ordering, retry,
// backoff, dead letters, notifications and the preview sweeper all run for real.

import { readFileSync } from 'node:fs';
import { describe, it, expect, beforeAll, beforeEach, vi } from 'vitest';
import { createGatewayDb, seedPairedChat } from './_db.js';
import { fakeBotApi, telegramEnv } from './_telegram.js';

const holder = vi.hoisted(() => ({ db: null }));

vi.mock('../../../api/_lib/db.js', async (importOriginal) => {
	const actual = await importOriginal();
	return { ...actual, sql: (strings, ...values) => holder.db.sql(strings, ...values) };
});

const store = await import('../../../api/_lib/gateway/store.js');
const { createDrainer } = await import('../src/drain.js');
const { createTelegramAdapter } = await import('../src/adapters/telegram.js');

const fixture = (name) => JSON.parse(readFileSync(new URL(`./fixtures/${name}.json`, import.meta.url), 'utf8'));
const quietLog = { debug() {}, info() {}, warn() {}, error() {} };

const baseConfig = {
	concurrency: 4,
	pollMs: 50,
	leaseSeconds: 60,
	maxAttempts: 3,
	backoffBaseMs: 5000,
	backoffMaxMs: 60_000,
	turnTimeoutMs: 10_000,
	sweepMs: 60_000,
	pruneKeepDays: 7,
	shutdownGraceMs: 1000,
	chatKeys: null,
};

async function queueTelegram(update) {
	return store.enqueueInbox({ platform: 'telegram', dedupeKey: String(update.update_id), chatKey: `telegram:${update.message?.chat.id ?? update.callback_query.message.chat.id}`, payload: update });
}

function setup({ answer, config = {}, defaultHandler } = {}) {
	const bot = fakeBotApi(answer);
	const adapter = createTelegramAdapter({ env: telegramEnv, api: bot.api });
	const drainer = createDrainer({ adapters: new Map([['telegram', adapter]]), config: { ...baseConfig, ...config }, log: quietLog, ...(defaultHandler ? { defaultHandler } : {}) });
	const drain = async () => {
		const n = await drainer.tick();
		await Promise.allSettled([...drainer.inflight.values()]);
		return n;
	};
	return { bot, adapter, drainer, drain };
}

async function inboxRows() {
	return holder.db.query('SELECT id, platform, status, attempts, last_error, locked_until, chat_key FROM gateway_inbox ORDER BY id');
}

beforeAll(async () => {
	holder.db = await createGatewayDb();
});

beforeEach(async () => {
	await holder.db.exec('TRUNCATE gateway_inbox, gateway_reply_codes, gateway_previews, gateway_pair_codes, gateway_links, agent_identities, users RESTART IDENTITY CASCADE');
});

describe('drain: unpaired chats', () => {
	it('answers a queued Telegram /help through the core and the adapter, then acknowledges the row', async () => {
		const { bot, drain } = setup();
		expect(await queueTelegram(fixture('telegram-update-help'))).toBe(true);
		expect(await drain()).toBe(1);

		const sent = bot.of('sendMessage');
		expect(sent).toHaveLength(1);
		expect(sent[0].payload.chat_id).toBe('5550001001');
		expect(sent[0].payload.text).toContain('Talk to your three.ws agent here');
		expect(sent[0].payload.text).toContain('send /start to get a pairing code');
		const [row] = await inboxRows();
		expect(row).toMatchObject({ status: 'done', attempts: 1 });
	});

	it('/start addressed to this bot in a group issues a pairing code and stores only its hash', async () => {
		const { bot, drain } = setup();
		await queueTelegram(fixture('telegram-update-start-group'));
		await drain();
		const [msg] = bot.of('sendMessage');
		const code = /Your pairing code: ([A-Z0-9]{4}-[A-Z0-9]{4})/.exec(msg.payload.text)?.[1];
		expect(code).toBeTruthy();
		const codes = await holder.db.query('SELECT origin, platform, chat_id, chat_title, code_hash FROM gateway_pair_codes');
		expect(codes).toHaveLength(1);
		expect(codes[0]).toMatchObject({ origin: 'chat', platform: 'telegram', chat_id: '-1005550002002', chat_title: 'Fixture Traders' });
		expect(codes[0].code_hash).not.toContain(code.replace('-', ''));
	});

	it('a duplicate delivery of the same update is queued once and answered once', async () => {
		const { bot, drain } = setup();
		const update = fixture('telegram-update-help');
		expect(await queueTelegram(update)).toBe(true);
		expect(await queueTelegram(update)).toBe(false);
		await drain();
		await drain();
		expect(bot.of('sendMessage')).toHaveLength(1);
	});
});

describe('drain: ordering and leases', () => {
	it('claims one row per chat at a time, so replies leave in arrival order', async () => {
		const { bot, drain } = setup();
		const first = fixture('telegram-update-help');
		const second = { ...fixture('telegram-update-help'), update_id: first.update_id + 1, message: { ...first.message, message_id: 4200, text: '/start' } };
		await queueTelegram(first);
		await queueTelegram(second);
		expect(await drain()).toBe(1);
		expect(bot.of('sendMessage')[0].payload.text).toContain('Talk to your three.ws agent here');
		expect(await drain()).toBe(1);
		expect(bot.of('sendMessage')[1].payload.text).toContain('Your pairing code');
		expect((await inboxRows()).map((r) => r.status)).toEqual(['done', 'done']);
	});

	it('never hands out a row whose lease is still held, and renews a held lease', async () => {
		await queueTelegram(fixture('telegram-update-help'));
		const [claimed] = await store.claimInbox({ limit: 5, leaseSeconds: 60 });
		expect(claimed.attempts).toBe(1);
		expect(await store.claimInbox({ limit: 5, leaseSeconds: 60 })).toHaveLength(0);
		expect(await store.renewInboxLease(claimed.id, 120)).toBe(true);
		await store.completeInbox(claimed.id);
		expect(await store.renewInboxLease(claimed.id, 120)).toBe(false);
	});

	it('reclaims a row whose lease expired (a crashed worker) and counts the attempt', async () => {
		await queueTelegram(fixture('telegram-update-help'));
		const [claimed] = await store.claimInbox({ limit: 1, leaseSeconds: 60 });
		await holder.db.query("UPDATE gateway_inbox SET locked_until = now() - interval '1 second' WHERE id = $1", [claimed.id]);
		const [again] = await store.claimInbox({ limit: 1, leaseSeconds: 60 });
		expect(again.id).toBe(claimed.id);
		expect(again.attempts).toBe(2);
	});

	it('leaves rows for a platform this worker has no adapter for', async () => {
		const { drain } = setup();
		await store.enqueueInbox({ platform: 'discord', dedupeKey: 'i-1', chatKey: 'discord:1', payload: fixture('discord-interaction-command') });
		expect(await drain()).toBe(0);
		const [row] = await inboxRows();
		expect(row).toMatchObject({ platform: 'discord', status: 'queued', attempts: 0 });
	});

	it('drains only the chats named in chatKeys when asked to', async () => {
		const { bot, drain } = setup({ config: { chatKeys: ['telegram:-1005550002002'] } });
		await queueTelegram(fixture('telegram-update-help'));
		await queueTelegram(fixture('telegram-update-start-group'));
		expect(await drain()).toBe(1);
		expect(bot.of('sendMessage')[0].payload.chat_id).toBe('-1005550002002');
		expect((await inboxRows()).map((r) => r.status)).toEqual(['queued', 'done']);
	});
});

describe('drain: failures', () => {
	const serverError = (method) => (method === 'sendMessage' ? { ok: false, error_code: 502, description: 'Bad Gateway' } : undefined);

	it('requeues a transient platform failure with backoff, then dead-letters after maxAttempts', async () => {
		const { bot, drain } = setup({ answer: serverError, config: { maxAttempts: 2 } });
		await queueTelegram(fixture('telegram-update-help'));
		await drain();
		let [row] = await inboxRows();
		expect(row).toMatchObject({ status: 'queued', attempts: 1 });
		expect(row.last_error).toMatch(/^transient: telegram: Bad Gateway/);
		expect(new Date(row.locked_until).getTime()).toBeGreaterThan(Date.now() + 3000);

		// Still backing off: not claimable, and it keeps heading its chat.
		expect(await drain()).toBe(0);

		await holder.db.query("UPDATE gateway_inbox SET locked_until = now() - interval '1 second'");
		await drain();
		[row] = await inboxRows();
		expect(row).toMatchObject({ status: 'failed', attempts: 2 });
		expect(row.last_error).toMatch(/^attempts_exhausted/);
		// The help text twice, then the apology attempt after giving up.
		expect(bot.of('sendMessage')).toHaveLength(3);
		expect(bot.of('sendMessage')[2].payload.text).toContain('Something went wrong on our side');
	});

	it('honours a 429 retry_after longer than the backoff', async () => {
		const { drain } = setup({ answer: (m) => (m === 'sendMessage' ? { ok: false, error_code: 429, description: 'Too Many Requests: retry after 120', parameters: { retry_after: 120 } } : undefined) });
		await queueTelegram(fixture('telegram-update-help'));
		await drain();
		const [row] = await inboxRows();
		expect(row.status).toBe('queued');
		expect(new Date(row.locked_until).getTime()).toBeGreaterThan(Date.now() + 110_000);
	});

	it('dead-letters a permanent refusal at once and does not retry or apologise', async () => {
		const { bot, drain } = setup({ answer: (m) => (m === 'sendMessage' ? { ok: false, error_code: 403, description: 'Forbidden: bot was blocked by the user' } : undefined) });
		await queueTelegram(fixture('telegram-update-help'));
		await drain();
		const [row] = await inboxRows();
		expect(row).toMatchObject({ status: 'failed', attempts: 1 });
		expect(row.last_error).toMatch(/^permanent: telegram: Forbidden: bot was blocked/);
		expect(bot.of('sendMessage')).toHaveLength(1);
	});

	it('never re-runs an event that already delivered something before it failed', async () => {
		const handler = async (event, gw) => {
			await gw.sendText(event.chatId, 'first part of an answer');
			throw new Error('lane dropped mid-turn');
		};
		const { bot, drain } = setup({ defaultHandler: handler });
		await queueTelegram(fixture('telegram-update-text'));
		await drain();
		const [row] = await inboxRows();
		expect(row).toMatchObject({ status: 'failed', attempts: 1 });
		expect(row.last_error).toMatch(/^partially_delivered: lane dropped mid-turn/);
		expect(bot.of('sendMessage')).toHaveLength(1);
	});

	it('fails a turn that outlives the timeout without apologising (it may still answer)', async () => {
		const handler = () => new Promise(() => {});
		const { bot, drain } = setup({ defaultHandler: handler, config: { turnTimeoutMs: 50 } });
		await queueTelegram(fixture('telegram-update-text'));
		await drain();
		const [row] = await inboxRows();
		expect(row.status).toBe('failed');
		expect(row.last_error).toMatch(/^timeout/);
		expect(bot.of('sendMessage')).toHaveLength(0);
	});

	it('acknowledges a delivery with nothing to answer (a sticker) without calling the platform', async () => {
		const { bot, drain } = setup();
		const update = fixture('telegram-update-help');
		delete update.message.text;
		delete update.message.entities;
		update.message.sticker = { file_id: 'CAACAgIAAxkBAAIfixture', width: 512, height: 512, is_animated: false, is_video: false, type: 'regular' };
		await queueTelegram(update);
		await drain();
		expect((await inboxRows())[0].status).toBe('done');
		expect(bot.calls).toHaveLength(0);
	});
});

describe('drain: paired chats', () => {
	it('a paired owner pressing Cancel on a live preview cancels it and strips the buttons', async () => {
		const { link, user, agent } = await seedPairedChat(holder.db, { chatId: '5550001001', platformUserId: '5550001001' });
		const [preview] = await holder.db.query(
			`INSERT INTO gateway_previews (link_id, user_id, agent_id, kind, proposal, message_ref, expires_at)
			 VALUES ($1, $2, $3, 'buy', $4::jsonb, $5::jsonb, now() + interval '10 minutes') RETURNING id`,
			[link.id, user.id, agent.id, JSON.stringify({ kind: 'buy', network: 'mainnet', sol_amount: 0.1, mint: 'THREEsynthetic1111111111111111111111111111', slippage_bps: 100, quote: { expected_out: 1000, min_received: 990, price_impact_pct: 0.4 } }), JSON.stringify({ chatId: '5550001001', messageId: 4190 })],
		);
		const update = fixture('telegram-update-callback');
		update.callback_query.data = `gw:cx:${preview.id}`;
		const { bot, drain } = setup();
		await queueTelegram(update);
		await drain();

		expect(bot.of('answerCallbackQuery')[0].payload).toMatchObject({ callback_query_id: '4382910029381273001', text: 'Cancelled' });
		const [edit] = bot.of('editMessageText');
		expect(edit.payload).toMatchObject({ chat_id: '5550001001', message_id: 4190 });
		expect(edit.payload.text).toContain('Cancelled. Nothing was sent.');
		expect(edit.payload.reply_markup).toEqual({ inline_keyboard: [] });
		const [after] = await holder.db.query('SELECT status FROM gateway_previews WHERE id = $1', [preview.id]);
		expect(after.status).toBe('cancelled');
	});

	it('someone else in a paired chat is told it belongs to another account', async () => {
		await seedPairedChat(holder.db, { chatId: '5550001001', platformUserId: '1' });
		const { bot, drain } = setup();
		await queueTelegram(fixture('telegram-update-text'));
		await drain();
		expect(bot.of('sendMessage')[0].payload.text).toContain("paired to another person's three.ws account");
	});

	it('/new in a paired chat resets the thread context', async () => {
		const { link } = await seedPairedChat(holder.db, { chatId: '5550001001', platformUserId: '5550001001' });
		const update = fixture('telegram-update-help');
		update.message.text = '/new';
		update.message.entities = [{ offset: 0, length: 4, type: 'bot_command' }];
		const { bot, drain } = setup();
		await queueTelegram(update);
		await drain();
		expect(bot.of('sendMessage')[0].payload.text).toContain('Started a fresh thread');
		const [after] = await holder.db.query('SELECT context_reset_at FROM gateway_links WHERE id = $1', [link.id]);
		expect(after.context_reset_at).not.toBeNull();
	});
});

describe('drain: notifications', () => {
	async function queueNotify(payload, key = 'n1') {
		return store.enqueueInbox({ platform: 'telegram', dedupeKey: `notify:${key}`, chatKey: `telegram:${payload.chatId}`, payload: { kind: 'notify', ...payload } });
	}

	it('delivers a queued notification to its paired chat', async () => {
		const { link } = await seedPairedChat(holder.db, { chatId: '5550001001', platformUserId: '5550001001' });
		const { bot, drain } = setup();
		await queueNotify({ chatId: '5550001001', linkId: link.id, type: 'run_completed', text: 'Your run finished\nhttps://three.ws/agents', expiresAt: new Date(Date.now() + 60_000).toISOString() });
		await drain();
		expect(bot.of('sendMessage')[0].payload).toMatchObject({ chat_id: '5550001001', text: 'Your run finished\nhttps://three.ws/agents' });
		expect((await inboxRows())[0].status).toBe('done');
	});

	it('drops a stale notification and one whose chat was unlinked, without sending', async () => {
		const { link, user } = await seedPairedChat(holder.db, { chatId: '5550001001', platformUserId: '5550001001' });
		await store.revokeLink(link.id, user.id);
		const { bot, drain } = setup();
		await queueNotify({ chatId: '5550001001', linkId: link.id, type: 'bid', text: 'New bid', expiresAt: new Date(Date.now() + 60_000).toISOString() }, 'n-revoked');
		await queueNotify({ chatId: '5550009999', linkId: null, type: 'bid', text: 'Old bid', expiresAt: new Date(Date.now() - 1000).toISOString() }, 'n-stale');
		await drain();
		expect(bot.of('sendMessage')).toHaveLength(0);
		expect((await inboxRows()).map((r) => r.status)).toEqual(['done', 'done']);
	});
});

describe('drain: sweeper', () => {
	it('expires an overdue preview and removes its buttons in the chat', async () => {
		const { link, user, agent } = await seedPairedChat(holder.db, { chatId: '5550001001', platformUserId: '5550001001' });
		await holder.db.query(
			`INSERT INTO gateway_previews (link_id, user_id, agent_id, kind, proposal, message_ref, expires_at)
			 VALUES ($1, $2, $3, 'limits', $4::jsonb, $5::jsonb, now() - interval '1 minute')`,
			[link.id, user.id, agent.id, JSON.stringify({ kind: 'limits', changes: { per_trade_sol: 0.5 } }), JSON.stringify({ chatId: '5550001001', messageId: 4300 })],
		);
		const { bot, drainer } = setup();
		await drainer.sweep();
		const [edit] = bot.of('editMessageText');
		expect(edit.payload.message_id).toBe(4300);
		expect(edit.payload.text).toContain('Per-trade cap: 0.5 SOL');
		expect(edit.payload.text).toContain('Expired. Ask your agent again for a fresh quote.');
		expect(edit.payload.reply_markup).toEqual({ inline_keyboard: [] });
		const [p] = await holder.db.query('SELECT status FROM gateway_previews');
		expect(p.status).toBe('expired');
		expect(drainer.stats.previewsExpired).toBe(1);
	});
});

describe('drain: loop lifecycle', () => {
	it('start() drains continuously and stop() returns once running rows finish', async () => {
		const { bot, drainer } = setup();
		await queueTelegram(fixture('telegram-update-help'));
		drainer.start();
		await vi.waitFor(async () => expect((await inboxRows())[0].status).toBe('done'), { timeout: 5000, interval: 25 });
		const { abandoned } = await drainer.stop();
		expect(abandoned).toBe(0);
		expect(bot.of('sendMessage')).toHaveLength(1);
		expect(drainer.health()).toMatchObject({ ok: true, stopping: true, platforms: ['telegram'], completed: 1 });
	});
});
