import { describe, it, expect, vi, beforeEach } from 'vitest';

const sqlMock = vi.fn();
vi.mock('../api/_lib/db.js', () => ({ sql: (...a) => sqlMock(...a) }));
const sessionMock = vi.fn();
vi.mock('../api/_lib/auth.js', () => ({ getSessionUser: (...a) => sessionMock(...a) }));

import {
	CODE_ALPHABET,
	CODE_LENGTH,
	HANDOFF_TTL_SEC,
	newCode,
	normalizeCode,
	mintHandoff,
	resolveHandoff,
	startPairing,
	claimPairing,
	pairingStatus,
} from '../api/_lib/glass-codes.js';
import handoff from '../api/glass/handoff.js';
import pair from '../api/glass/pair.js';

const PIN = '0b9d2f6e-8c1a-4f6e-9a3b-5d7c2e1f0a44';

function call(handler, { method = 'GET', query = {}, body = null, headers = {}, ip = '203.0.113.9' } = {}) {
	return new Promise((resolve, reject) => {
		const out = { status: 0, headers: {}, body: '' };
		const res = {
			statusCode: 200,
			headersSent: false,
			writableEnded: false,
			setHeader(k, v) { out.headers[k.toLowerCase()] = v; },
			getHeader(k) { return out.headers[k.toLowerCase()]; },
			writeHead(status, h = {}) { this.statusCode = status; for (const [k, v] of Object.entries(h)) out.headers[k.toLowerCase()] = v; this.headersSent = true; },
			write(c) { out.body += c; return true; },
			end(c) {
				if (c) out.body += c;
				this.writableEnded = true;
				out.status = this.statusCode;
				resolve({ ...out, json: out.body ? safeParse(out.body) : null });
			},
		};
		const chunks = body ? [Buffer.from(JSON.stringify(body))] : [];
		const req = {
			method,
			query,
			url: '/api/glass/x',
			headers: { 'content-type': 'application/json', 'x-forwarded-for': ip, ...headers },
			socket: { remoteAddress: ip },
			body: body ?? undefined,
			[Symbol.asyncIterator]: async function* () { for (const c of chunks) yield c; },
		};
		Promise.resolve(handler(req, res)).catch(reject);
	});
}
const safeParse = (s) => { try { return JSON.parse(s); } catch { return null; } };

beforeEach(() => {
	sqlMock.mockReset();
	sessionMock.mockReset();
});

describe('code format', () => {
	it('is six characters from an alphabet with no look-alikes', () => {
		for (let i = 0; i < 200; i++) {
			const c = newCode();
			expect(c).toHaveLength(CODE_LENGTH);
			for (const ch of c) expect(CODE_ALPHABET).toContain(ch);
		}
		expect(CODE_ALPHABET).not.toMatch(/[01OIL]/);
	});
	it('normalizes case and separators and rejects anything else', () => {
		expect(normalizeCode('ab2-cd3')).toBe('AB2CD3');
		expect(normalizeCode(' ab2 cd3 ')).toBe('AB2CD3');
		expect(normalizeCode('ABCDE')).toBeNull();
		expect(normalizeCode('ABCDEFG')).toBeNull();
		expect(normalizeCode('ABC0EF')).toBeNull();
		expect(normalizeCode(null)).toBeNull();
	});
});

describe('handoff store', () => {
	it('resolves a minted code to its pin and expires it on schedule', async () => {
		const now = Date.now();
		const { code } = await mintHandoff(PIN, { now });
		expect((await resolveHandoff(code.toLowerCase(), { now: now + 1000 })).pinId).toBe(PIN);
		expect(await resolveHandoff(code, { now: now + HANDOFF_TTL_SEC * 1000 + 1 })).toBeNull();
	});
	it('does not resolve a code that was never minted', async () => {
		expect(await resolveHandoff('ZZZZZZ')).toBeNull();
	});
});

describe('GET/POST /api/glass/handoff', () => {
	it('mints a code for a public pin and returns the three.ws/g url', async () => {
		sqlMock.mockResolvedValueOnce([{ id: PIN }]);
		const r = await call(handoff, { method: 'POST', body: { pinId: PIN }, ip: '198.51.100.1' });
		expect(r.status).toBe(200);
		expect(r.json.code).toMatch(/^[A-Z2-9]{6}$/);
		expect(r.json.url).toBe(`https://three.ws/g/${r.json.code}`);
		expect(r.json.expires_in).toBe(HANDOFF_TTL_SEC);
		expect(r.headers['cache-control']).toBe('no-store');
	});
	it('refuses a pin that is hidden, private or expired', async () => {
		sqlMock.mockResolvedValueOnce([]);
		const r = await call(handoff, { method: 'POST', body: { pinId: PIN }, ip: '198.51.100.2' });
		expect(r.status).toBe(404);
		expect(r.json.error).toBe('pin_not_found');
	});
	it('rejects a malformed pin id before touching the database', async () => {
		const r = await call(handoff, { method: 'POST', body: { pinId: 'nope' }, ip: '198.51.100.3' });
		expect(r.status).toBe(400);
		expect(sqlMock).not.toHaveBeenCalled();
	});
	it('resolves a live code to /irl for a browser and to JSON for a client', async () => {
		sqlMock.mockResolvedValueOnce([{ id: PIN }]);
		const { json: minted } = await call(handoff, { method: 'POST', body: { pinId: PIN }, ip: '198.51.100.4' });
		const html = await call(handoff, { query: { code: minted.code }, headers: { accept: 'text/html' }, ip: '198.51.100.4' });
		expect(html.status).toBe(302);
		expect(html.headers.location).toBe(`/irl?pin=${PIN}&from=glass`);
		const api = await call(handoff, { query: { code: minted.code.toLowerCase() }, ip: '198.51.100.4' });
		expect(api.status).toBe(200);
		expect(api.json.pinId).toBe(PIN);
	});
	it('answers 404 for an unknown code and 400 for a malformed one', async () => {
		const unknown = await call(handoff, { query: { code: 'ZZZZZZ' }, ip: '198.51.100.5' });
		expect(unknown.status).toBe(404);
		expect(unknown.json.error).toBe('unknown_code');
		const bad = await call(handoff, { query: { code: 'x' }, ip: '198.51.100.5' });
		expect(bad.status).toBe(400);
	});
	it('rate limits a guessing sweep from one address', async () => {
		let last;
		for (let i = 0; i < 40; i++) last = await call(handoff, { query: { code: 'ZZZZZZ' }, ip: '198.51.100.99' });
		expect(last.status).toBe(429);
	});
});

describe('pairing', () => {
	it('walks waiting to paired when a signed-in phone claims the code', async () => {
		const { code } = await startPairing();
		expect((await pairingStatus(code)).state).toBe('waiting');
		const out = await claimPairing(code, { id: 'u1', display_name: 'Ada' });
		expect(out).toEqual({ ok: true, name: 'Ada' });
		expect(await pairingStatus(code)).toEqual({ state: 'paired', name: 'Ada' });
	});
	it('does not let a second account steal a claimed pairing', async () => {
		const { code } = await startPairing();
		await claimPairing(code, { id: 'u1', display_name: 'Ada' });
		expect(await claimPairing(code, { id: 'u2', display_name: 'Bob' })).toEqual({ ok: false, reason: 'taken' });
	});
	it('expires a pairing', async () => {
		const now = Date.now();
		const { code } = await startPairing({ now });
		expect((await pairingStatus(code, { now: now + 301_000 })).state).toBe('expired');
		expect((await claimPairing(code, { id: 'u1' }, { now: now + 301_000 })).reason).toBe('unknown');
	});
	it('requires a session to claim over HTTP, and then works end to end', async () => {
		const start = await call(pair, { method: 'POST', body: {}, ip: '198.51.100.20' });
		expect(start.status).toBe(200);
		const { code } = start.json;
		sessionMock.mockResolvedValueOnce(null);
		const anon = await call(pair, { method: 'POST', body: { code }, ip: '198.51.100.20' });
		expect(anon.status).toBe(401);
		sessionMock.mockResolvedValueOnce({ id: 'u9', display_name: 'Grace' });
		const claimed = await call(pair, { method: 'POST', body: { code }, ip: '198.51.100.20' });
		expect(claimed.json).toEqual({ ok: true, name: 'Grace' });
		const poll = await call(pair, { query: { code }, ip: '198.51.100.20' });
		expect(poll.json).toEqual({ state: 'paired', name: 'Grace' });
	});
});
