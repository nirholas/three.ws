// Telegram magic-link sign-in: a bare /start must not claim the token (the
// sender is only asked to approve, with the request's origin shown), only an
// Approve press by that same Telegram user claims it, and /poll signs in only
// the browser that minted the token.

import { describe, it, expect, vi, beforeEach } from 'vitest';

process.env.APP_ORIGIN = 'https://three.ws';
process.env.JWT_SECRET ||= 'vitest-ephemeral-jwt-secret-00000000000000';
process.env.TELEGRAM_BOT_TOKEN = '123456:TEST-bot-token';

const queue = [];
const calls = [];
vi.mock('../api/_lib/db.js', () => ({
	sql: Object.assign(
		async (strings, ...vals) => {
			calls.push({ text: strings.join('?').replace(/\s+/g, ' '), vals });
			const next = queue.shift();
			return typeof next === 'function' ? next() : (next ?? []);
		},
		{ json: (v) => v },
	),
}));
vi.mock('../api/_lib/zauth.js', () => ({ instrument: () => {}, drain: async () => {} }));
vi.mock('../api/_lib/sentry.js', () => ({ captureException: () => {} }));
vi.mock('../api/_lib/audit.js', () => ({ logAudit: vi.fn() }));
vi.mock('../api/_lib/seed-default-agent.js', () => ({ seedDefaultAgent: vi.fn() }));
vi.mock('../api/_lib/rate-limit.js', () => ({
	limits: { telegramMagicIp: async () => ({ success: true }), telegramMagicPoll: async () => ({ success: true }), identityLink: async () => ({ success: true }), authIp: async () => ({ success: true }) },
	clientIp: () => '203.0.113.9',
}));
vi.mock('../api/_lib/auth.js', async () => {
	const actual = await vi.importActual('../api/_lib/auth.js');
	return { ...actual, getSessionUser: vi.fn(async () => null), createSession: vi.fn(async () => 'sess-token'), sessionCookie: () => '__Host-sid=sess' };
});
const findUserByIdentity = vi.fn(async () => null);
vi.mock('../api/_lib/identities.js', async () => {
	const actual = await vi.importActual('../api/_lib/identities.js');
	return { ...actual, findUserByIdentity: (...a) => findUserByIdentity(...a), linkIdentity: vi.fn(async () => ({ relinked: false })), touchIdentity: vi.fn() };
});
const sendPlatformText = vi.fn(async () => ({}));
const sendTelegramButtons = vi.fn(async () => ({}));
const answerTelegramCallback = vi.fn(async () => ({}));
vi.mock('../api/_lib/gateway/bots.js', () => ({
	telegramConfigured: () => true,
	telegramUsername: async () => 'three_ws_bot',
	sendPlatformText: (...a) => sendPlatformText(...a),
	sendTelegramButtons: (...a) => sendTelegramButtons(...a),
	answerTelegramCallback: (...a) => answerTelegramCallback(...a),
}));
vi.mock('../api/_lib/gateway/store.js', () => ({ enqueueInbox: vi.fn(async () => {}) }));

const tl = await import('../api/_lib/account-link/telegram-login.js');
const { default: authHandler } = await import('../api/auth/telegram/[action].js');
const { default: gatewayHandler } = await import('../api/gateway/telegram.js');
const { telegramWebhookSecret } = await import('../api/_lib/gateway/webhooks.js');

const token = `tl_${'a'.repeat(43)}`;
const ROW_ID = '11111111-1111-4111-8111-111111111111';
const from = { id: 42, first_name: 'Ada', username: 'ada' };
const priv = { id: 42, type: 'private' };

function makeRes() {
	const r = { statusCode: 200, _h: {}, _b: null };
	r.setHeader = (k, v) => { r._h[k.toLowerCase()] = v; };
	r.getHeader = (k) => r._h[k.toLowerCase()];
	r.end = (b) => { r._b = b; };
	Object.defineProperty(r, 'json', { value: () => JSON.parse(r._b) });
	return r;
}
function authReq(action, { method = 'GET', query = '', body, cookie } = {}) {
	return {
		method,
		url: `/api/auth/telegram/${action}${query}`,
		query: { action },
		headers: { 'content-type': 'application/json', origin: 'https://three.ws', 'user-agent': 'TestBrowser/1.0', ...(cookie ? { cookie } : {}) },
		socket: { remoteAddress: '203.0.113.9' },
		body: body === undefined ? undefined : JSON.stringify(body),
	};
}
function webhookReq(update) {
	return {
		method: 'POST',
		url: '/api/gateway/telegram',
		headers: { 'content-type': 'application/json', 'x-telegram-bot-api-secret-token': telegramWebhookSecret() },
		socket: { remoteAddress: '149.154.167.1' },
		body: JSON.stringify(update),
	};
}
const cookieOf = (res) => [].concat(res._h['set-cookie'] || []).map((c) => c.split(';')[0]).filter((c) => c.startsWith('__Host-tgmagic=')).pop();

beforeEach(() => {
	queue.length = 0;
	calls.length = 0;
	findUserByIdentity.mockReset();
	findUserByIdentity.mockResolvedValue(null);
	sendPlatformText.mockClear();
	sendTelegramButtons.mockClear();
	answerTelegramCallback.mockClear();
});

describe('magic link claim needs an in-chat approval', () => {
	it('a bare /start never moves the token to claimed', async () => {
		queue.push([{ id: ROW_ID, intent: 'login', user_id: null, request: { ip: '203.0.113.9', ua: 'TestBrowser/1.0', at: '2026-10-25T10:00:00.000Z' } }]);
		const out = await tl.requestMagicApproval({ token, from, chat: priv });
		expect(out).toMatchObject({ ok: true, id: ROW_ID, intent: 'login' });
		expect(calls.some((c) => /status = 'claimed'/.test(c.text))).toBe(false);
	});

	it('the webhook answers /start with an Approve button naming the requesting IP and browser', async () => {
		queue.push([{ id: ROW_ID, intent: 'login', user_id: null, request: { ip: '203.0.113.9', ua: 'TestBrowser/1.0', at: '2026-10-25T10:00:00.000Z' } }]);
		const res = makeRes();
		await gatewayHandler(webhookReq({ update_id: 1, message: { text: `/start ${token}`, from, chat: priv } }), res);
		expect(res.json()).toEqual({ ok: true, magic: 'awaiting_approval' });
		expect(calls.some((c) => /status = 'claimed'/.test(c.text))).toBe(false);
		expect(sendTelegramButtons).toHaveBeenCalledTimes(1);
		const [chatId, text, buttons] = sendTelegramButtons.mock.calls[0];
		expect(chatId).toBe(42);
		expect(text).toContain('203.0.113.9');
		expect(text).toContain('TestBrowser/1.0');
		expect(buttons[0].data).toBe(`tla:${ROW_ID}`);
		expect(sendPlatformText).not.toHaveBeenCalled();
	});

	it('only the Approve press claims, scoped to the parked Telegram user and chat', async () => {
		queue.push([{ id: ROW_ID, intent: 'login', user_id: null, claims: { subject: '42' } }]);
		const res = makeRes();
		await gatewayHandler(webhookReq({ update_id: 2, callback_query: { id: 'cq1', data: `tla:${ROW_ID}`, from, message: { chat: priv } } }), res);
		expect(res.json()).toEqual({ ok: true, magic: 'claimed' });
		const claim = calls.find((c) => /status = 'claimed'/.test(c.text));
		expect(claim.text).toMatch(/pending'->'claims'->>'subject' = \?/);
		expect(claim.vals).toEqual(expect.arrayContaining([ROW_ID, '42', '42']));
		expect(answerTelegramCallback).toHaveBeenCalledWith('cq1', expect.stringContaining('Approved'));
	});

	it('an approval by anyone but the parked user claims nothing', async () => {
		queue.push([]);
		const out = await tl.claimMagicToken({ id: ROW_ID, from: { id: 99 }, chat: { id: 99, type: 'private' } });
		expect(out).toEqual({ ok: false, reason: 'expired' });
	});

	it('Decline burns the token', async () => {
		queue.push([{ id: ROW_ID }]);
		const res = makeRes();
		await gatewayHandler(webhookReq({ update_id: 3, callback_query: { id: 'cq2', data: `tld:${ROW_ID}`, from, message: { chat: priv } } }), res);
		expect(res.json()).toEqual({ ok: true, magic: 'declined' });
		expect(calls.some((c) => /set status = 'expired'/.test(c.text))).toBe(true);
	});
});

describe('magic login poll is bound to the minting browser', () => {
	async function mint() {
		queue.push([{ id: ROW_ID, expires_at: new Date(Date.now() + 600000) }]);
		const res = makeRes();
		await authHandler(authReq('magic', { method: 'POST', body: { intent: 'login' } }), res);
		expect(res.statusCode).toBe(200);
		return { res, issued: res.json() };
	}
	const claimedRow = { id: ROW_ID, intent: 'login', user_id: null, next: null, claims: { subject: '42', display_name: 'Ada' }, status: 'claimed', expires_at: new Date(Date.now() + 600000) };

	it('stores the requesting IP and browser for the approval prompt', async () => {
		await mint();
		const insert = calls.find((c) => /insert into telegram_login_tokens/.test(c.text));
		const stored = JSON.parse(insert.vals.find((v) => typeof v === 'string' && v.includes('"request"')));
		expect(stored.request).toMatchObject({ ip: '203.0.113.9', ua: 'TestBrowser/1.0' });
	});

	it('a claimed login polled from a browser without the binding cookie is refused and not completed', async () => {
		queue.push([claimedRow]);
		const res = makeRes();
		await authHandler(authReq('poll', { query: `?id=${ROW_ID}&secret=attacker-secret` }), res);
		expect(res.statusCode).toBe(403);
		expect(calls.some((c) => /set status = 'completed'/.test(c.text))).toBe(false);
		expect(String(res._h['set-cookie'] || '')).not.toContain('sess');
	});

	it('the minting browser completes the sign-in', async () => {
		const { res: minted } = await mint();
		const bound = cookieOf(minted);
		expect(bound).toBeTruthy();
		queue.length = 0;
		findUserByIdentity.mockResolvedValue({ id: 'user-1', identity_id: 'i1' });
		queue.push([claimedRow], [{ ...claimedRow, status: 'completed' }], []);
		const res = makeRes();
		await authHandler(authReq('poll', { query: `?id=${ROW_ID}&secret=s`, cookie: bound }), res);
		expect(res.statusCode).toBe(200);
		expect(res.json()).toMatchObject({ status: 'completed', intent: 'login' });
	});

	it('a cookie minted for another token does not unlock this one', async () => {
		const { res: minted } = await mint();
		const bound = cookieOf(minted);
		queue.length = 0;
		queue.push([{ ...claimedRow, id: '22222222-2222-4222-8222-222222222222' }]);
		const res = makeRes();
		await authHandler(authReq('poll', { query: `?id=22222222-2222-4222-8222-222222222222&secret=s`, cookie: bound }), res);
		expect(res.statusCode).toBe(403);
	});
});
