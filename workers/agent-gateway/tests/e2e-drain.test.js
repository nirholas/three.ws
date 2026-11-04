// End to end, receiver to reply: a recorded Telegram update is POSTed over a
// real socket to the production webhook handler (api/gateway/telegram.js), which
// verifies the secret header and writes the gateway_inbox row exactly as it does
// in production; one drain cycle of the worker then claims that row, runs it
// through the real gateway core and the real Telegram adapter, and replies.
//
// The database is a real Postgres (PGlite built from the shipped gateway
// migrations, tests/_db.js). The Telegram Bot API is the only thing answered
// locally (tests/_telegram.js), so nothing leaves the machine.

import http from 'node:http';
import { readFileSync } from 'node:fs';
import { describe, it, expect, beforeAll, beforeEach, afterAll, vi } from 'vitest';
import { createGatewayDb } from './_db.js';
import { fakeBotApi, telegramEnv, FIXTURE_TOKEN } from './_telegram.js';

const holder = vi.hoisted(() => ({ db: null }));

vi.mock('../../../api/_lib/db.js', async (importOriginal) => {
	const actual = await importOriginal();
	return { ...actual, sql: (strings, ...values) => holder.db.sql(strings, ...values) };
});

process.env.TELEGRAM_BOT_TOKEN = FIXTURE_TOKEN;
const { telegramWebhookSecret } = await import('../../../api/_lib/gateway/webhooks.js');
const { default: receiver } = await import('../../../api/gateway/telegram.js');
const { createDrainer } = await import('../src/drain.js');
const { createTelegramAdapter } = await import('../src/adapters/telegram.js');
const { loadConfig } = await import('../src/config.js');

const fixture = (name) => JSON.parse(readFileSync(new URL(`./fixtures/${name}.json`, import.meta.url), 'utf8'));
const quietLog = { debug() {}, info() {}, warn() {}, error() {} };
let server;

async function deliver(update, secret = telegramWebhookSecret()) {
	const { port } = server.address();
	const res = await fetch(`http://127.0.0.1:${port}/api/gateway/telegram`, {
		method: 'POST',
		headers: { 'content-type': 'application/json', 'x-telegram-bot-api-secret-token': secret },
		body: JSON.stringify(update),
	});
	return { status: res.status, body: await res.json() };
}

function worker() {
	const bot = fakeBotApi();
	const adapter = createTelegramAdapter({ env: telegramEnv, api: bot.api });
	const drainer = createDrainer({ adapters: new Map([['telegram', adapter]]), config: { ...loadConfig({}), pollMs: 50 }, log: quietLog });
	const drainOnce = async () => {
		const n = await drainer.tick();
		await Promise.allSettled([...drainer.inflight.values()]);
		return n;
	};
	return { bot, drainer, drainOnce };
}

const inbox = () => holder.db.query('SELECT id, platform, dedupe_key, chat_key, payload, status, attempts, locked_until, last_error, finished_at FROM gateway_inbox ORDER BY id');

beforeAll(async () => {
	holder.db = await createGatewayDb();
	server = http.createServer((req, res) => receiver(req, res));
	await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
});

afterAll(async () => {
	await new Promise((resolve) => server.close(resolve));
});

beforeEach(async () => {
	await holder.db.exec('TRUNCATE gateway_inbox, gateway_pair_codes, gateway_links, agent_identities, users RESTART IDENTITY CASCADE');
});

describe('receiver to reply', () => {
	it('queues a verified update the way production does, then one drain cycle replies and releases the lease', async () => {
		const update = fixture('telegram-update-help');
		expect(await deliver(update)).toEqual({ status: 200, body: { ok: true } });

		const [queued] = await inbox();
		expect(queued).toMatchObject({
			platform: 'telegram',
			dedupe_key: String(update.update_id),
			chat_key: 'telegram:5550001001',
			status: 'queued',
			attempts: 0,
			locked_until: null,
		});
		expect(queued.payload).toEqual(update);

		const { bot, drainer, drainOnce } = worker();
		expect(await drainOnce()).toBe(1);

		const sent = bot.of('sendMessage');
		expect(sent).toHaveLength(1);
		expect(sent[0].payload.chat_id).toBe('5550001001');
		expect(sent[0].payload.text).toContain('Talk to your three.ws agent here');

		const [done] = await inbox();
		expect(done).toMatchObject({ status: 'done', attempts: 1, locked_until: null, last_error: null });
		expect(done.finished_at).toBeTruthy();
		expect(drainer.stats).toMatchObject({ claimed: 1, completed: 1, retried: 0, deadLettered: 0 });
	});

	it('answers a redelivered update_id exactly once, before and after the first reply', async () => {
		const update = fixture('telegram-update-help');
		const { bot, drainOnce } = worker();

		expect((await deliver(update)).status).toBe(200);
		expect((await deliver(update)).status).toBe(200);
		expect(await inbox()).toHaveLength(1);
		await drainOnce();

		expect((await deliver(update)).status).toBe(200);
		expect(await inbox()).toHaveLength(1);
		expect(await drainOnce()).toBe(0);

		expect(bot.of('sendMessage')).toHaveLength(1);
	});

	it('refuses a delivery without the webhook secret and queues nothing', async () => {
		const { status } = await deliver(fixture('telegram-update-help'), 'not-the-secret');
		expect(status).toBe(401);
		expect(await inbox()).toHaveLength(0);
	});
});
