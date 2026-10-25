// Oracle follow and test-alert must bind chat_id to a Telegram chat the caller
// verified by linking Telegram, and test-alert must HTML-escape the agent name.

import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../api/_lib/http.js', async () => {
	const actual = await vi.importActual('../../api/_lib/http.js');
	return {
		...actual,
		wrap: (fn) => fn,
		cors: () => false,
		method: () => true,
		rateLimited: (res) => { res._rateLimited = true; },
		json: (res, status, body) => { res._json = { status, body }; return res; },
		error: (res, status, code, message) => {
			res._json = { status, body: { error: code, error_description: message } };
			return res;
		},
		readJson: async (req) => JSON.parse(req._rawBody),
	};
});

vi.mock('../../api/_lib/rate-limit.js', () => ({
	limits: {
		publicIp: async () => ({ success: true }),
		oracleFollowIp: async () => ({ success: true }),
		oracleTelegramTestIp: async () => ({ success: true }),
	},
	clientIp: () => '1.2.3.4',
}));

const USER_ID = 'ab2aabd2-39f7-493b-8191-c9f174af62ab';
const AGENT_ID = '5e05f68f-eead-4ef9-b6b4-fc85ea73bbe9';
let sessionUser = { id: USER_ID };
vi.mock('../../api/_lib/auth.js', () => ({
	getSessionUser: async () => sessionUser,
	authenticateBearer: async () => null,
	extractBearer: () => null,
}));

const queries = [];
let linkedSubject = '555';
vi.mock('../../api/_lib/db.js', () => ({
	sql: (strings) => {
		const q = strings.join('?');
		queries.push(q);
		if (q.includes('user_identities')) return Promise.resolve(linkedSubject ? [{ subject: linkedSubject }] : []);
		if (q.includes('agent_identities') && q.includes('name')) return Promise.resolve([{ name: '<a href="https://evil.example">Click</a>' }]);
		if (q.includes('agent_identities')) return Promise.resolve([{ id: AGENT_ID }]);
		return Promise.resolve([]);
	},
	isDbUnavailableError: () => false,
}));

const sent = [];
vi.mock('../../api/_lib/upstream-fetch.js', () => ({
	fetchUpstream: async (url, init) => {
		sent.push(JSON.parse(init.body));
		return { json: async () => ({ ok: true }) };
	},
}));

import follow from '../../api/oracle/follow.js';
import testAlert from '../../api/oracle/test-alert.js';

const res0 = () => ({ statusCode: 200, _headers: {}, setHeader() {}, getHeader() {}, end() {} });
const req = (method, body, url = '/api/oracle/follow') => ({
	method, url, headers: { host: 'three.ws' }, _rawBody: JSON.stringify(body || {}), on() {},
});

beforeEach(() => {
	queries.length = 0; sent.length = 0;
	sessionUser = { id: USER_ID };
	linkedSubject = '555';
	process.env.TELEGRAM_BOT_TOKEN = 't';
});

describe('oracle follow proof of chat control', () => {
	it('rejects an anonymous subscribe', async () => {
		sessionUser = null;
		const res = res0();
		await follow(req('POST', { agent_id: AGENT_ID, chat_id: '999' }), res);
		expect(res._json.status).toBe(401);
		expect(queries.some((q) => q.includes('insert into oracle_followers'))).toBe(false);
	});
	it('rejects an anonymous unsubscribe', async () => {
		sessionUser = null;
		const res = res0();
		await follow(req('DELETE', { agent_id: AGENT_ID, chat_id: '999' }), res);
		expect(res._json.status).toBe(401);
		expect(queries.some((q) => q.includes('delete from oracle_followers'))).toBe(false);
	});
	it('rejects a chat_id other than the caller verified chat', async () => {
		const res = res0();
		await follow(req('DELETE', { agent_id: AGENT_ID, chat_id: '999' }), res);
		expect(res._json.status).toBe(403);
		expect(queries.some((q) => q.includes('delete from oracle_followers'))).toBe(false);
	});
	it('allows the verified chat', async () => {
		const res = res0();
		await follow(req('POST', { agent_id: AGENT_ID, chat_id: '555' }), res);
		expect(res._json.status).toBe(201);
	});
});

describe('oracle test-alert', () => {
	it('refuses a chat_id the caller has not verified', async () => {
		const res = res0();
		await testAlert(req('POST', { agent_id: AGENT_ID, chat_id: '999' }, '/api/oracle/test-alert'), res);
		expect(res._json.status).toBe(403);
		expect(sent.length).toBe(0);
	});
	it('escapes the agent name in the HTML message', async () => {
		const res = res0();
		await testAlert(req('POST', { agent_id: AGENT_ID, chat_id: '555' }, '/api/oracle/test-alert'), res);
		expect(sent.length).toBe(1);
		expect(sent[0].text).not.toContain('<a href="https://evil.example">');
		expect(sent[0].text).toContain('&lt;a href="https://evil.example"&gt;');
	});
});
