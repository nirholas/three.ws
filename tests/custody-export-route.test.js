// POST /api/agents/:id/wallet/export end to end through the real handler: the
// response carries ciphertext only, and nothing the server writes to stdout,
// stderr or the console contains the secret key in any common encoding. Only
// the collaborators around the handler (auth, CSRF, re-auth grant, ledger and
// the encrypted-key recovery) are faked; sealing, the handler and the response
// shape are the real code.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Keypair } from '@solana/web3.js';
import { PassThrough } from 'node:stream';

const AGENT = '55555555-5555-4555-8555-555555555555';
const kp = Keypair.generate();
const address = kp.publicKey.toBase58();

vi.mock('../api/_lib/db.js', () => ({
	sql: vi.fn(async () => []),
	isDbUnavailableError: () => false,
	isDbCapacityError: () => false,
}));
vi.mock('../api/_lib/custody/auth.js', async () => {
	class CustodyHttpError extends Error {
		constructor(status, code, message, detail = null) {
			super(message);
			Object.assign(this, { status, code, detail, expose: true });
		}
	}
	return {
		CustodyHttpError,
		requirePrincipal: vi.fn(async () => ({ userId: 'user-1', via: 'session', scope: null })),
		loadOwnedAgent: vi.fn(async () => ({
			id: AGENT, user_id: 'user-1', name: 'Test agent',
			meta: { solana_address: address, encrypted_solana_secret: 'ciphertext-at-rest' },
		})),
	};
});
vi.mock('../api/_lib/rate-limit.js', () => ({
	limits: { custodyExport: vi.fn(async () => ({ success: true })), walletRead: vi.fn(async () => ({ success: true })) },
	clientIp: () => '127.0.0.1',
}));
vi.mock('../api/_lib/csrf.js', () => ({ requireCsrf: vi.fn(async () => true) }));
vi.mock('../api/_lib/real-funds-agreement.js', () => ({ requireRealFundsAgreement: vi.fn(async () => true) }));
vi.mock('../api/_lib/custody/reauth.js', () => ({
	startReauth: vi.fn(), completeReauth: vi.fn(), consumeReauthGrant: vi.fn(async () => undefined),
}));
vi.mock('../api/_lib/agent-trade-guards.js', () => ({ recordCustodyEvent: vi.fn(async () => 1) }));
vi.mock('../api/_lib/audit.js', () => ({ logAudit: vi.fn() }));
vi.mock('../api/_lib/cache.js', () => ({ cacheSet: vi.fn(async () => undefined) }));
vi.mock('../api/_lib/solana/connection.js', () => ({ solanaConnection: vi.fn() }));
vi.mock('../api/_lib/agent-wallet.js', () => ({
	generateSolanaAgentWallet: vi.fn(),
	recoverSolanaAgentKeypair: vi.fn(async () => Keypair.fromSecretKey(Uint8Array.from(kp.secretKey))),
}));

const { default: handler } = await import('../api/agents/wallet-custody.js');
const { recordCustodyEvent } = await import('../api/_lib/agent-trade-guards.js');
const { beginKeyExport, openSealedKey } = await import('../src/wallet/export.js');

function request(body) {
	const req = new PassThrough();
	req.method = 'POST';
	req.url = `/api/agents/${AGENT}/wallet/export`;
	req.headers = { 'content-type': 'application/json', host: 'localhost' };
	req.end(JSON.stringify(body));
	return req;
}

function response() {
	const res = {
		statusCode: 200, headers: {}, body: '', headersSent: false, writableEnded: false,
		setHeader(k, v) { this.headers[k.toLowerCase()] = v; },
		getHeader(k) { return this.headers[k.toLowerCase()]; },
		writeHead(code, h = {}) { this.statusCode = code; for (const [k, v] of Object.entries(h)) this.setHeader(k, v); return this; },
		write(chunk) { this.body += chunk; return true; },
		end(chunk) { if (chunk) this.body += chunk; this.writableEnded = true; this.headersSent = true; },
	};
	return res;
}

const encodings = () => [
	Buffer.from(kp.secretKey).toString('base64'),
	Buffer.from(kp.secretKey.slice(0, 32)).toString('base64'),
	Buffer.from(kp.secretKey).toString('hex'),
	JSON.stringify(Array.from(kp.secretKey)),
	Array.from(kp.secretKey).join(','),
];

describe('POST /api/agents/:id/wallet/export', () => {
	let captured;
	const restore = [];

	beforeEach(() => {
		captured = [];
		const grab = (...args) => captured.push(args.map((a) => (typeof a === 'string' ? a : JSON.stringify(a))).join(' '));
		for (const level of ['log', 'info', 'warn', 'error', 'debug']) {
			const spy = vi.spyOn(console, level).mockImplementation(grab);
			restore.push(spy);
		}
		for (const stream of [process.stdout, process.stderr]) {
			const spy = vi.spyOn(stream, 'write').mockImplementation((chunk) => { captured.push(String(chunk)); return true; });
			restore.push(spy);
		}
		vi.mocked(recordCustodyEvent).mockClear();
	});
	afterEach(() => restore.splice(0).forEach((s) => s.mockRestore()));

	it('returns only the sealed envelope and logs no secret bytes', async () => {
		const { publicKey, privateKey } = await beginKeyExport();
		const res = response();
		await handler(request({ confirm_export: true, reauth_grant: 'grant-token', client_public_key: publicKey }), res, AGENT, 'export', []);

		expect(res.statusCode).toBe(200);
		const out = JSON.parse(res.body);
		expect(out.data.address).toBe(address);
		expect(out.data.shown_once).toBe(true);
		for (const needle of encodings()) {
			expect(res.body).not.toContain(needle);
			expect(captured.join('\n')).not.toContain(needle);
		}

		const ledger = vi.mocked(recordCustodyEvent).mock.calls[0][0];
		expect(ledger.eventType).toBe('export');
		for (const needle of encodings()) expect(JSON.stringify(ledger)).not.toContain(needle);

		const opened = await openSealedKey(out.data.sealed, privateKey, { agentId: AGENT, address });
		expect(Buffer.from(opened).equals(Buffer.from(kp.secretKey))).toBe(true);
	});

	it('refuses without confirm_export and writes no ledger row', async () => {
		const { publicKey } = await beginKeyExport();
		const res = response();
		await handler(request({ reauth_grant: 'grant-token', client_public_key: publicKey }), res, AGENT, 'export', []);
		expect(res.statusCode).toBe(400);
		expect(JSON.parse(res.body).error).toBe('confirmation_required');
		expect(recordCustodyEvent).not.toHaveBeenCalled();
	});
});
