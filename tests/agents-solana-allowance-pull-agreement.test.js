// POST /api/agents/:id/allowance { op: 'pull' } signs and sends a real transfer
// with the agent's custodial key, so it must refuse an account that has not
// signed the real-funds agreements before the key is ever recovered.

import { describe, it, expect, beforeEach, vi } from 'vitest';

process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-secret-for-allowance-pull';

const gate = { signed: false };
vi.mock('../api/_lib/real-funds-agreement.js', () => ({
	requireRealFundsAgreement: vi.fn(async (req, res) => {
		if (gate.signed) return true;
		const { error } = await import('../api/_lib/http.js');
		error(res, 403, 'risk_ack_required', 'Sign the real-funds agreements before using real funds. Nothing was sent.');
		return false;
	}),
	currentSignatureFor: vi.fn(async () => null),
	agreementRequirement: () => ({ version: 2, sign_url: 'https://three.ws/legal/agreements', documents: [] }),
}));

vi.mock('../api/_lib/auth.js', () => ({
	getSessionUser: vi.fn(async () => ({ id: 'user-1' })),
	authenticateBearer: vi.fn(async () => null),
	extractBearer: vi.fn(() => null),
}));
vi.mock('../api/_lib/csrf.js', () => ({ requireCsrf: vi.fn(async () => true) }));
vi.mock('../api/_lib/spend-scope.js', () => ({ assertBearerMaySpend: vi.fn() }));
vi.mock('../api/_lib/rate-limit.js', () => ({
	limits: { walletRead: vi.fn(async () => ({ success: true })) },
	clientIp: vi.fn(() => '127.0.0.1'),
}));
vi.mock('../api/_lib/db.js', () => ({
	sql: vi.fn(async () => [{ id: 'agent-1', user_id: 'user-1', meta: { solana_address: 'AgentAddr', encrypted_solana_secret: 'ENC' } }]),
	isDbUnavailableError: () => false,
	isDbCapacityError: () => false,
}));
vi.mock('../api/_lib/audit.js', () => ({ logAudit: vi.fn() }));

const conn = {
	simulateTransaction: vi.fn(async () => ({ value: { err: null, logs: [] } })),
	sendRawTransaction: vi.fn(async () => 'SIG'),
};
vi.mock('../api/_lib/agent-pumpfun.js', () => ({ solanaConnection: vi.fn(() => conn) }));
vi.mock('../api/_lib/solana/confirm.js', () => ({ confirmOrThrow: vi.fn(async () => {}) }));
vi.mock('../api/_lib/agent-wallet.js', () => ({ recoverSolanaAgentKeypair: vi.fn(async () => ({ publicKey: 'kp' })) }));
vi.mock('../api/_lib/agent-trade-guards.js', () => ({ recordCustodyEvent: vi.fn(async () => {}) }));

const ROW = { id: 'al-1', revokedAt: null, network: 'mainnet', kind: 'fixed', delegationPda: 'Pda', ownerWallet: 'Owner', mint: 'Mint', capRaw: '1000' };
vi.mock('../api/_lib/onchain-allowance-store.js', () => ({
	listAllowances: vi.fn(),
	recordAllowance: vi.fn(),
	markRevoked: vi.fn(),
	getAllowance: vi.fn(async () => ROW),
	checkAgentAllowanceSpend: vi.fn(async () => ({ allow: true, allowance: { id: 'al-1' } })),
}));
const buildSignedPull = vi.fn(async () => ({ tx: { serialize: () => Buffer.alloc(1) }, blockhash: 'bh', lastValidBlockHeight: 1, receiverAta: 'Ata' }));
class AllowanceError extends Error { constructor(code, message) { super(message); this.code = code; } }
vi.mock('../api/_lib/onchain-allowance.js', () => ({
	AllowanceError,
	prepareCreateAllowance: vi.fn(),
	prepareRevokeAllowance: vi.fn(),
	readAllowance: vi.fn(async () => ({ remaining: '1000', expired: false })),
	checkAllowancePull: vi.fn(async () => ({ allow: true })),
	buildSignedPull,
	describeProgramFailure: vi.fn(() => 'failed'),
	recurringEnabled: vi.fn(() => true),
}));

const { handleAllowance } = await import('../api/agents/solana-allowance.js');
const { recoverSolanaAgentKeypair } = await import('../api/_lib/agent-wallet.js');

function mockReq(body) {
	const buf = Buffer.from(JSON.stringify(body));
	return {
		method: 'POST',
		url: '/api/agents/agent-1/allowance',
		headers: { host: 'localhost', 'content-type': 'application/json' },
		on(evt, cb) {
			if (evt === 'data') queueMicrotask(() => cb(buf));
			if (evt === 'end') queueMicrotask(() => cb());
		},
		destroy() {},
	};
}
function mockRes() {
	return {
		statusCode: 200, headers: {}, body: undefined, ended: false,
		setHeader(k, v) { this.headers[k.toLowerCase()] = v; },
		getHeader(k) { return this.headers[k.toLowerCase()]; },
		end(b) { this.body = b; this.ended = true; },
	};
}

beforeEach(() => {
	vi.clearAllMocks();
	gate.signed = false;
});

describe('allowance pull real-funds agreement', () => {
	it('refuses an unsigned account before recovering the key or building a transaction', async () => {
		const res = mockRes();
		await handleAllowance(mockReq({ op: 'pull', id: 'al-1', amountRaw: '10' }), res, 'agent-1');
		expect(res.statusCode).toBe(403);
		expect(JSON.parse(res.body).error).toBe('risk_ack_required');
		expect(recoverSolanaAgentKeypair).not.toHaveBeenCalled();
		expect(buildSignedPull).not.toHaveBeenCalled();
		expect(conn.simulateTransaction).not.toHaveBeenCalled();
		expect(conn.sendRawTransaction).not.toHaveBeenCalled();
	});

	it('pulls normally once the account has signed', async () => {
		gate.signed = true;
		const res = mockRes();
		await handleAllowance(mockReq({ op: 'pull', id: 'al-1', amountRaw: '10' }), res, 'agent-1');
		expect(res.statusCode).toBe(200);
		expect(recoverSolanaAgentKeypair).toHaveBeenCalledTimes(1);
		expect(conn.sendRawTransaction).toHaveBeenCalledTimes(1);
	});
});
