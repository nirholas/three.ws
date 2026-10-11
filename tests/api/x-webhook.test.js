// Tests for /api/x/webhook: CRC challenge-response, signature verification,
// and dedupe with the mention-polling cron's own insert path. Against the
// REAL x_mention_events migration in an in-process Postgres (PGlite), the
// same pattern tests/x-mention-store.test.js uses, so a column or CHECK this
// handler relies on cannot drift from what production gets.

import { readFileSync } from 'node:fs';
import { createHmac } from 'node:crypto';
import { Readable } from 'node:stream';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { PGlite } from '@electric-sql/pglite';

vi.mock('../../api/_lib/zauth.js', () => ({ instrument: () => {}, drain: async () => {} }));
vi.mock('../../api/_lib/sentry.js', () => ({ captureException: () => {} }));

const dbState = { pg: null };

vi.mock('../../api/_lib/db.js', () => {
	const sql = async (strings, ...values) => {
		const text = strings.reduce((acc, part, i) => acc + part + (i < values.length ? `$${i + 1}` : ''), '');
		const out = await dbState.pg.query(text, values);
		return out.rows;
	};
	return { sql, isDbUnavailableError: () => false, isDbCapacityError: () => false };
});

const MIG = new URL('../../api/_lib/migrations/', import.meta.url);
const MIGRATION = readFileSync(new URL('20261008170000_x_mention_events.sql', MIG), 'utf8');
const APP_SETTINGS = (() => {
	const src = readFileSync(new URL('20260922210000_free_tier_models.sql', MIG), 'utf8');
	const start = src.indexOf('CREATE TABLE IF NOT EXISTS app_settings');
	return src.slice(start, src.indexOf(');', start) + 2);
})();

beforeEach(async () => {
	dbState.pg = new PGlite();
	await dbState.pg.exec(APP_SETTINGS);
	await dbState.pg.exec(MIGRATION);
});

const SECRET = 'fixture-consumer-secret';
const ORIGINAL_ENV = { ...process.env };

beforeEach(() => {
	process.env = { ...ORIGINAL_ENV };
	process.env.X_WEBHOOK_ENABLED = '1';
	process.env.X_API_SECRET = SECRET;
	process.env.X_API_KEY = 'fixture-app-key';
	process.env.X_ACCESS_TOKEN = '1700000000000000001-fixtureaccesstoken';
	process.env.X_ACCESS_SECRET = 'fixture-access-secret';
	delete process.env.X_COMPANY_HANDLE;
	delete process.env.X_COMPANY_USER_ID;
});

const FIXTURE_PATH = new URL('../fixtures/x-webhook/tweet-create-events.fixture.json', import.meta.url);
const rawFixture = () => readFileSync(FIXTURE_PATH, 'utf8');

function sign(raw, secret = SECRET) {
	return `sha256=${createHmac('sha256', secret).update(raw).digest('base64')}`;
}

function makeReq({ method = 'POST', body = '', headers = {}, query = {} } = {}) {
	const buf = Buffer.from(body, 'utf8');
	const stream = Readable.from(body ? [buf] : []);
	stream.method = method;
	stream.url = '/api/x/webhook';
	stream.query = query;
	stream.headers = {
		'content-type': 'application/json',
		'content-length': String(buf.length),
		...headers,
	};
	return stream;
}

function makeRes() {
	return {
		statusCode: 200,
		_h: {},
		writableEnded: false,
		setHeader(k, v) { this._h[k.toLowerCase()] = v; },
		getHeader(k) { return this._h[k.toLowerCase()]; },
		end(body) { this._body = body; this.writableEnded = true; },
	};
}

async function callWebhook(req, res) {
	const handler = (await import('../../api/x/webhook.js')).default;
	await handler(req, res);
	return { res, body: res._body ? JSON.parse(res._body) : null };
}

async function mentionRow(tweetId) {
	const { getMentionEvent } = await import('../../api/_lib/x-mention-store.js');
	return getMentionEvent(tweetId);
}

describe('GET /api/x/webhook (CRC)', () => {
	it('answers the challenge with HMAC-SHA256(crc_token, consumer secret), base64, sha256= prefixed', async () => {
		const { res, body } = await callWebhook(makeReq({ method: 'GET', query: { crc_token: 'challenge-abc' } }), makeRes());
		expect(res.statusCode).toBe(200);
		expect(body.response_token).toBe(sign('challenge-abc'));
	});

	it('rejects a GET with no crc_token', async () => {
		const { res, body } = await callWebhook(makeReq({ method: 'GET', query: {} }), makeRes());
		expect(res.statusCode).toBe(400);
		expect(body.error).toBe('bad_request');
	});
});

describe('POST /api/x/webhook (signature)', () => {
	it('rejects a POST with no signature header', async () => {
		const body = rawFixture();
		const { res, body: out } = await callWebhook(makeReq({ body }), makeRes());
		expect(res.statusCode).toBe(401);
		expect(out.error).toBe('unauthorized');
		expect(await mentionRow('1800000000000000901')).toBeNull();
	});

	it('rejects a tampered body even with a signature present', async () => {
		const real = rawFixture();
		const headers = { 'x-twitter-webhooks-signature': sign(real) };
		const tampered = real.replace('fixture_webhook_author', 'someone_else');
		const { res, body: out } = await callWebhook(makeReq({ body: tampered, headers }), makeRes());
		expect(res.statusCode).toBe(401);
		expect(out.error).toBe('unauthorized');
	});

	it('rejects a signature computed with the wrong secret', async () => {
		const real = rawFixture();
		const headers = { 'x-twitter-webhooks-signature': sign(real, 'wrong-secret') };
		const { res, body: out } = await callWebhook(makeReq({ body: real, headers }), makeRes());
		expect(res.statusCode).toBe(401);
		expect(out.error).toBe('unauthorized');
	});

	it('accepts a correctly signed delivery, records the addressed mention with decision left null, and skips the unaddressed one', async () => {
		const real = rawFixture();
		const headers = { 'x-twitter-webhooks-signature': sign(real) };
		const { res, body: out } = await callWebhook(makeReq({ body: real, headers }), makeRes());
		expect(res.statusCode).toBe(200);
		expect(out).toMatchObject({ ok: true, received: 2, inserted: 2, skipped: 1 });

		const addressed = await mentionRow('1800000000000000901');
		expect(addressed).toMatchObject({
			account_kind: 'company',
			account_ref: 'trythreews',
			author_id: '1700000000000000900',
			author_username: 'fixture_webhook_author',
			dry_run: true,
			decision: null,
		});

		const unaddressed = await mentionRow('1800000000000000902');
		expect(unaddressed).toMatchObject({ intent: 'ignore', decision: 'skip', reason: 'not_addressed' });
	});

	it('acks without reading the body while X_WEBHOOK_ENABLED is unset', async () => {
		delete process.env.X_WEBHOOK_ENABLED;
		const real = rawFixture();
		const headers = { 'x-twitter-webhooks-signature': sign(real) };
		const { res, body: out } = await callWebhook(makeReq({ body: real, headers }), makeRes());
		expect(res.statusCode).toBe(200);
		expect(out).toEqual({ ok: true, disabled: true });
		expect(await mentionRow('1800000000000000901')).toBeNull();
	});
});

describe('dedupe with the mention-polling cron', () => {
	it('a tweet the cron already recorded is a silent no-op for the webhook, and vice versa', async () => {
		const { recordMention } = await import('../../api/_lib/x-mention-store.js');
		const { parseMentionIntent } = await import('../../api/_lib/x-mention-intents.js');
		const { normalizeActivityEvent } = await import('../../api/_lib/x-webhook-events.js');

		const payload = JSON.parse(rawFixture());
		const account = { kind: 'company', ref: 'trythreews', userId: '1700000000000000001', handle: 'trythreews' };
		const mention = normalizeActivityEvent(payload.tweet_create_events[0], account);

		// The cron sees it first (same recordMention() every path shares).
		const parsed = parseMentionIntent(mention, account);
		const first = await recordMention({ mention, parsed, dryRun: true });
		expect(first.inserted).toBe(true);

		// The webhook delivers the same tweet: inserted count for THIS tweet is 0.
		const headers = { 'x-twitter-webhooks-signature': sign(rawFixture()) };
		const { body: out } = await callWebhook(makeReq({ body: rawFixture(), headers }), makeRes());
		// Only the second (unaddressed) event in the fixture is new; the first was already recorded.
		expect(out.inserted).toBe(1);
		expect(out.skipped).toBe(1);

		const row = await mentionRow('1800000000000000901');
		expect(row.decision).toBeNull(); // untouched by the webhook's second, no-op delivery
	});
});
