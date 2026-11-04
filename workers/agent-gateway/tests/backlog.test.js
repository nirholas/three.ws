// The backlog policy: what the worker does with deliveries that sat in
// gateway_inbox while no worker was running. A row older than
// GATEWAY_BACKLOG_TTL_SECONDS is not answered as if it had just arrived (a
// weeks-old "/balance" answered today would be wrong and confusing); the chat
// gets one short "I was offline" reply instead, and every other stale row of
// that chat is closed in the same step, so ten unanswered messages produce one
// apology, not ten. Rows younger than the TTL are answered normally.
//
// Real Postgres inbox (PGlite from the shipped migrations), real core, real
// Telegram adapter; only the Bot API is answered locally (tests/_telegram.js).

import { readFileSync } from 'node:fs';
import { describe, it, expect, beforeAll, beforeEach, vi } from 'vitest';
import { createGatewayDb } from './_db.js';
import { fakeBotApi, telegramEnv } from './_telegram.js';

const holder = vi.hoisted(() => ({ db: null }));

vi.mock('../../../api/_lib/db.js', async (importOriginal) => {
	const actual = await importOriginal();
	return { ...actual, sql: (strings, ...values) => holder.db.sql(strings, ...values) };
});

const store = await import('../../../api/_lib/gateway/store.js');
const { createDrainer, OFFLINE_REPLY } = await import('../src/drain.js');
const { createTelegramAdapter } = await import('../src/adapters/telegram.js');
const { loadConfig } = await import('../src/config.js');

const fixture = (name) => JSON.parse(readFileSync(new URL(`./fixtures/${name}.json`, import.meta.url), 'utf8'));
const quietLog = { debug() {}, info() {}, warn() {}, error() {} };
const TTL = 3600;

function setup(ttl = TTL) {
	const bot = fakeBotApi();
	const adapter = createTelegramAdapter({ env: telegramEnv, api: bot.api });
	const config = { ...loadConfig({}), pollMs: 50, backlogTtlSeconds: ttl };
	const drainer = createDrainer({ adapters: new Map([['telegram', adapter]]), config, log: quietLog });
	const drain = async () => {
		const n = await drainer.tick();
		await Promise.allSettled([...drainer.inflight.values()]);
		return n;
	};
	return { bot, drainer, drain };
}

async function queue(update, ageSeconds) {
	const chatId = update.message?.chat.id ?? update.callback_query.message.chat.id;
	await store.enqueueInbox({ platform: 'telegram', dedupeKey: String(update.update_id), chatKey: `telegram:${chatId}`, payload: update });
	await holder.db.query(
		"UPDATE gateway_inbox SET created_at = now() - make_interval(secs => $1) WHERE dedupe_key = $2",
		[ageSeconds, String(update.update_id)],
	);
}

const nth = (base, i, text) => ({ ...base, update_id: base.update_id + 100 + i, message: { ...base.message, message_id: 5000 + i, text } });

async function rows() {
	return holder.db.query('SELECT dedupe_key, status, last_error FROM gateway_inbox ORDER BY id');
}

beforeAll(async () => {
	holder.db = await createGatewayDb();
});

beforeEach(async () => {
	await holder.db.exec('TRUNCATE gateway_inbox, gateway_pair_codes, gateway_links, agent_identities, users RESTART IDENTITY CASCADE');
});

describe('backlog TTL', () => {
	it('defaults to six hours and can be turned off with 0', () => {
		expect(loadConfig({}).backlogTtlSeconds).toBe(21_600);
		expect(loadConfig({ GATEWAY_BACKLOG_TTL_SECONDS: '0' }).backlogTtlSeconds).toBe(0);
		expect(() => loadConfig({ GATEWAY_BACKLOG_TTL_SECONDS: 'six hours' })).toThrow(/GATEWAY_BACKLOG_TTL_SECONDS/);
	});

	it('answers a delivery one second inside the TTL as normal', async () => {
		const { bot, drain } = setup();
		await queue(fixture('telegram-update-help'), TTL - 1);
		await drain();
		const sent = bot.of('sendMessage');
		expect(sent).toHaveLength(1);
		expect(sent[0].payload.text).toContain('Talk to your three.ws agent here');
		expect((await rows())[0]).toMatchObject({ status: 'done', last_error: null });
	});

	it('replies once that it was offline for a delivery one second past the TTL, and does not run it', async () => {
		const { bot, drainer, drain } = setup();
		await queue(fixture('telegram-update-help'), TTL + 1);
		await drain();
		const sent = bot.of('sendMessage');
		expect(sent).toHaveLength(1);
		expect(sent[0].payload.chat_id).toBe('5550001001');
		expect(sent[0].payload.text).toBe(OFFLINE_REPLY);
		expect((await rows())[0]).toMatchObject({ status: 'done', last_error: expect.stringMatching(/^aged_out/) });
		expect(drainer.stats.agedOut).toBe(1);
	});

	it('closes every stale row of the chat with a single apology, then answers what arrived after', async () => {
		const { bot, drainer, drain } = setup();
		const base = fixture('telegram-update-help');
		await queue(nth(base, 1, '/help'), TTL * 48);
		await queue(nth(base, 2, 'what is my balance?'), TTL * 24);
		await queue(nth(base, 3, '/start'), TTL + 30);
		await queue(nth(base, 4, '/help'), 5);
		await drain();
		await drain();
		await drain();
		const texts = bot.of('sendMessage').map((c) => c.payload.text);
		expect(texts).toHaveLength(2);
		expect(texts[0]).toBe(OFFLINE_REPLY);
		expect(texts[1]).toContain('Talk to your three.ws agent here');
		expect((await rows()).map((r) => [r.status, /^aged_out/.test(r.last_error || '')])).toEqual([
			['done', true], ['done', true], ['done', true], ['done', false],
		]);
		expect(drainer.stats.agedOut).toBe(3);
		expect(await holder.db.query('SELECT count(*)::int AS n FROM gateway_pair_codes')).toEqual([{ n: 0 }]);
	});

	it('closes a stale group message without posting in the group unless it was a command', async () => {
		const { bot, drain } = setup();
		const group = fixture('telegram-update-start-group');
		const chatter = { ...group, update_id: group.update_id + 900, message: { ...group.message, message_id: 7000, text: 'gm everyone' } };
		await queue(chatter, TTL + 60);
		await drain();
		expect(bot.of('sendMessage')).toHaveLength(0);
		expect((await rows())[0]).toMatchObject({ status: 'done', last_error: expect.stringMatching(/^aged_out/) });
	});

	it('never apologizes for a stale forwarded message', async () => {
		const { bot, drain } = setup();
		const base = fixture('telegram-update-text');
		const fwd = { ...base, update_id: base.update_id + 900, message: { ...base.message, forward_origin: { type: 'hidden_user', sender_user_name: 'someone', date: 1791446000 } } };
		await queue(fwd, TTL + 60);
		await drain();
		expect(bot.of('sendMessage')).toHaveLength(0);
		expect((await rows())[0].status).toBe('done');
	});

	it('leaves stale notifications to their own expiry, not the inbound backlog rule', async () => {
		const { drain } = setup();
		await queue(fixture('telegram-update-help'), TTL + 60);
		await store.enqueueInbox({ platform: 'telegram', dedupeKey: 'notify:1', chatKey: 'telegram:5550001001', payload: { kind: 'notify', chatId: '5550001001', text: 'Your agent bought 0.1 SOL of $THREE.' } });
		await holder.db.query("UPDATE gateway_inbox SET created_at = now() - interval '2 hours' WHERE dedupe_key = 'notify:1'");
		await drain();
		const [, notify] = await rows();
		expect(notify).toMatchObject({ dedupe_key: 'notify:1', status: 'queued' });
	});

	it('answers everything when the TTL is 0', async () => {
		const { bot, drain } = setup(0);
		await queue(fixture('telegram-update-help'), TTL * 100);
		await drain();
		expect(bot.of('sendMessage')[0].payload.text).toContain('Talk to your three.ws agent here');
	});
});
