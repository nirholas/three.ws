// A developer webhook can carry a bearer token, sent as
// `Authorization: Bearer <token>` on every delivery. It exists so a three.ws
// event can start a Grok Bot routine: a Grok routine webhook trigger runs only
// for a POST carrying the key Grok issued. The token is someone else's
// credential, so this pins that it is stored encrypted, accepted write-only,
// never echoed back, sent on the wire exactly once per delivery, and that a
// token which no longer decrypts fails the attempt instead of posting without it.

import http from 'node:http';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { Agent } from 'undici';
import { invoke } from './_helpers/monetization.js';

process.env.JWT_SECRET ||= 'test-jwt-secret-for-webhook-bearer-tokens-0123456789';

const authState = { session: null };
const sqlState = { calls: [], responses: [] };

vi.mock('../api/_lib/auth.js', async (importOriginal) => ({
	...(await importOriginal()),
	getSessionUser: vi.fn(async () => authState.session),
}));

vi.mock('../api/_lib/db.js', () => {
	const sql = vi.fn(async (strings, ...values) => {
		sqlState.calls.push({ query: Array.isArray(strings) ? strings.join('?') : String(strings), values });
		return sqlState.responses.shift() ?? [];
	});
	return { sql, isDbUnavailableError: () => false, isDbCapacityError: () => false };
});

vi.mock('../api/_lib/csrf.js', () => ({ requireCsrf: vi.fn(async () => true) }));

// Deliveries go to a loopback receiver: the DNS/pin layer is swapped for a
// plain undici Agent, the fetch is the production one.
vi.mock('../api/_lib/ssrf.js', async (importOriginal) => ({
	...(await importOriginal()),
	validatePublicUrl: (raw) => new URL(raw),
	resolvePublicHost: async () => [{ address: '127.0.0.1', family: 4 }],
	pinnedAgent: () => new Agent(),
}));

const { parseBearerToken, encryptBearerToken, decryptBearerToken, bearerTokenColumn } = await import('../api/_lib/webhook-auth.js');
const { deliver, processDelivery } = await import('../api/_lib/webhook-dispatch.js');
const { serializeWebhook } = await import('../api/_lib/agents-v1/webhooks.js');
const { resetDevSubscriptionCache } = await import('../api/_lib/dev-plans/subscription.js');
const { default: listHandler } = await import('../api/developer/webhooks.js');
const { default: detailHandler } = await import('../api/developer/webhooks/[id].js');

const OWNER = { id: '11111111-1111-4111-8111-111111111111' };
const WEBHOOK_ID = '22222222-2222-4222-8222-222222222222';
const TOKEN = 'xai-routine-key_AbC123.def';

let server;
let base;
const received = [];

beforeAll(async () => {
	server = http.createServer((req, res) => {
		let body = '';
		req.on('data', (c) => { body += c; });
		req.on('end', () => {
			received.push({ url: req.url, headers: req.headers, body });
			res.writeHead(200, { 'content-type': 'application/json' });
			res.end('{"ok":true}');
		});
	});
	await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
	base = `http://127.0.0.1:${server.address().port}`;
});

afterAll(() => {
	server.closeAllConnections();
	server.close();
});

beforeEach(() => {
	resetDevSubscriptionCache();
	authState.session = OWNER;
	sqlState.calls = [];
	sqlState.responses = [];
	received.length = 0;
});

describe('bearer token parsing', () => {
	it('accepts a bare key and strips a pasted "Bearer " prefix', () => {
		expect(parseBearerToken(TOKEN)).toEqual({ token: TOKEN });
		expect(parseBearerToken(`  Bearer ${TOKEN}  `)).toEqual({ token: TOKEN });
		expect(parseBearerToken(`bearer ${TOKEN}`)).toEqual({ token: TOKEN });
	});

	it('rejects values that could split or inject a header, and out-of-range lengths', () => {
		expect(parseBearerToken('abc def ghi').error).toMatch(/visible ASCII/);
		expect(parseBearerToken('abcdefgh\r\nx-evil: 1').error).toMatch(/visible ASCII/);
		expect(parseBearerToken('short').error).toMatch(/at least 8/);
		expect(parseBearerToken('a'.repeat(513)).error).toMatch(/at most 512/);
		expect(parseBearerToken(12345678).error).toMatch(/string/);
	});

	it('bearerTokenColumn leaves an unmentioned token alone, clears on null or "", encrypts a value', async () => {
		expect(await bearerTokenColumn({})).toEqual({ value: undefined });
		expect(await bearerTokenColumn({ bearerToken: null })).toEqual({ value: null });
		expect(await bearerTokenColumn({ bearer_token: '' })).toEqual({ value: null });
		const { value } = await bearerTokenColumn({ bearerToken: TOKEN });
		expect(value).not.toContain(TOKEN);
		expect(await decryptBearerToken(value)).toBe(TOKEN);
		expect((await bearerTokenColumn({ bearerToken: 'has space here' })).error).toBeTruthy();
	});

	it('encrypts with a fresh IV each time', async () => {
		const a = await encryptBearerToken(TOKEN);
		const b = await encryptBearerToken(TOKEN);
		expect(a).not.toBe(b);
		expect(await decryptBearerToken(a)).toBe(TOKEN);
	});
});

describe('delivery carries the bearer token', () => {
	it('sends Authorization: Bearer alongside the signature headers', async () => {
		const out = await deliver(`${base}/routine`, 'whsec_test', 'evt_1', '{"type":"run.finished"}', { bearerToken: TOKEN });
		expect(out.statusCode).toBe(200);
		expect(received).toHaveLength(1);
		expect(received[0].headers.authorization).toBe(`Bearer ${TOKEN}`);
		expect(received[0].headers['webhook-signature']).toMatch(/^v1,/);
		expect(received[0].body).toBe('{"type":"run.finished"}');
	});

	it('sends no Authorization header when the endpoint has no token', async () => {
		await deliver(`${base}/plain`, 'whsec_test', 'evt_2', '{}');
		expect(received[0].headers.authorization).toBeUndefined();
	});

	it('processDelivery decrypts the stored token and posts with it', async () => {
		sqlState.responses = [[{
			id: 'd1', event_id: 'evt_3', event_type: 'run.finished', payload: { type: 'run.finished' }, attempt: 0,
			webhook_id: WEBHOOK_ID, url: `${base}/grok`, secret: 'whsec_test', active: true,
			auth_token_enc: await encryptBearerToken(TOKEN),
		}]];
		const outcome = await processDelivery('d1');
		expect(outcome.status).toBe('succeeded');
		expect(received).toHaveLength(1);
		expect(received[0].headers.authorization).toBe(`Bearer ${TOKEN}`);
		// The token never lands in the delivery log.
		expect(JSON.stringify(sqlState.calls.slice(1).map((c) => c.values))).not.toContain(TOKEN);
	});

	it('fails the attempt without posting when the stored token no longer decrypts', async () => {
		sqlState.responses = [[{
			id: 'd2', event_id: 'evt_4', event_type: 'run.finished', payload: {}, attempt: 0,
			webhook_id: WEBHOOK_ID, url: `${base}/grok`, secret: 'whsec_test', active: true,
			auth_token_enc: Buffer.from('not a real ciphertext at all').toString('base64'),
		}]];
		const outcome = await processDelivery('d2');
		expect(received).toHaveLength(0);
		expect(outcome.status).toBe('pending');
		expect(outcome.attempt.error).toBe('bearer_token_unreadable');
	});
});

describe('the token is write-only through the APIs', () => {
	const subRow = {
		user_id: OWNER.id,
		plan_id: 'free',
		period_start: new Date(Date.now() - 86_400_000).toISOString(),
		period_end: new Date(Date.now() + 86_400_000).toISOString(),
	};
	const row = {
		id: WEBHOOK_ID, url: 'https://example.com/hook', events: ['run.finished'], active: true,
		description: null, created_at: '2026-11-04T00:00:00.000Z', updated_at: '2026-11-04T00:00:00.000Z',
	};

	it('POST stores the token encrypted and answers with has_bearer_token only', async () => {
		sqlState.responses = [[{ count: 0 }], [subRow], [{ ...row, has_bearer_token: true }]];
		const { status, body } = await invoke(listHandler, {
			method: 'POST',
			url: '/api/developer/webhooks',
			body: { url: 'https://example.com/hook', events: ['run.finished'], bearer_token: `Bearer ${TOKEN}` },
		});
		expect(status).toBe(201);
		expect(body.webhook.has_bearer_token).toBe(true);
		expect(JSON.stringify(body)).not.toContain(TOKEN);
		const insert = sqlState.calls.at(-1);
		expect(insert.query).toContain('auth_token_enc');
		expect(insert.values).not.toContain(TOKEN);
		const enc = insert.values.at(-1);
		expect(await decryptBearerToken(enc)).toBe(TOKEN);
	});

	it('POST rejects a malformed token before touching the database', async () => {
		const { status, body } = await invoke(listHandler, {
			method: 'POST',
			url: '/api/developer/webhooks',
			body: { url: 'https://example.com/hook', events: ['run.finished'], bearer_token: 'two words here' },
		});
		expect(status).toBe(400);
		expect(body.error_description).toMatch(/visible ASCII/);
		expect(sqlState.calls).toHaveLength(0);
	});

	it('PATCH with null clears the token, and leaves it alone when not mentioned', async () => {
		sqlState.responses = [[{ ...row, has_bearer_token: true }], [{ ...row, has_bearer_token: false }]];
		const cleared = await invoke(detailHandler, {
			method: 'PATCH',
			url: `/api/developer/webhooks/${WEBHOOK_ID}?id=${WEBHOOK_ID}`,
			query: { id: WEBHOOK_ID },
			body: { bearer_token: null },
		});
		expect(cleared.status).toBe(200);
		expect(cleared.body.webhook.has_bearer_token).toBe(false);
		const update = sqlState.calls.at(-1);
		// The placeholders after "auth_token_enc = case when" are the
		// "mentioned" flag and the new value: set, to null.
		const i = update.query.split('?').findIndex((part) => part.includes('auth_token_enc = case when'));
		expect(i).toBeGreaterThan(0);
		expect(update.values.slice(i, i + 2)).toEqual([true, null]);

		sqlState.calls = [];
		sqlState.responses = [[{ ...row, has_bearer_token: true }], [{ ...row, has_bearer_token: true }]];
		await invoke(detailHandler, {
			method: 'PATCH',
			url: `/api/developer/webhooks/${WEBHOOK_ID}?id=${WEBHOOK_ID}`,
			query: { id: WEBHOOK_ID },
			body: { description: 'Grok Bot routine' },
		});
		const untouched = sqlState.calls.at(-1);
		const j = untouched.query.split('?').findIndex((part) => part.includes('auth_token_enc = case when'));
		expect(untouched.values[j]).toBe(false);
	});

	it('the v1 serializer reports hasBearerToken and never the ciphertext', async () => {
		const out = serializeWebhook({ ...row, auth_token_enc: await encryptBearerToken(TOKEN) });
		expect(out.hasBearerToken).toBe(true);
		expect(JSON.stringify(out)).not.toMatch(/auth_token|xai-routine/);
		expect(serializeWebhook(row).hasBearerToken).toBe(false);
	});
});
