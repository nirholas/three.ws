// /api/pay/execute: once the signed transfer has been handed to the paid host,
// an HTTP 402 answer is not proof that nothing landed (a host that is also the
// transaction fee payer can co-sign and broadcast, then answer 402). The
// session budget must therefore stay spent.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { Keypair } from '@solana/web3.js';

vi.mock('../api/_lib/ssrf.js', async (importOriginal) => {
	const actual = await importOriginal();
	return { ...actual, resolvePublicHost: async () => ['203.0.113.10'], pinnedAgent: () => ({ destroy: async () => {} }) };
});

vi.mock('../api/_lib/pay/spend-governor.js', async (importOriginal) => {
	const actual = await importOriginal();
	return {
		...actual,
		verifySessionToken: vi.fn(async () => SESSION),
		reserveSessionSpend: vi.fn(async () => ({
			session: { ...SESSION, spent_usdc: '2000000' },
			railReservationId: 'rail-1', policyDigest: 'd', verdictCode: 'ok',
			verdictSignature: 's', verdictSignedAt: '2026-10-15T00:00:00.000Z',
		})),
		rollbackReservation: vi.fn(async () => {}),
		recordExecution: vi.fn(async () => {}),
	};
});
vi.mock('../api/_lib/db.js', () => ({ sql: vi.fn(async () => []) }));
const PAYER = Keypair.generate();
vi.mock('../api/_lib/x402/pay.js', () => ({ loadSeedKeypair: vi.fn(() => PAYER) }));
vi.mock('../api/_lib/solana/connection.js', () => ({ solanaConnection: vi.fn(() => ({})) }));
const BLOCKHASH = Keypair.generate().publicKey.toBase58();
vi.mock('../api/_lib/solana/read-guards.js', () => ({
	mintDecimals: vi.fn(async () => 6), ataExists: vi.fn(async () => true),
	getRecentBlockhash: vi.fn(async () => BLOCKHASH), isRpcUnavailable: vi.fn(() => false), RPC_RETRY_AFTER_SECONDS: 30,
}));

const { rollbackReservation, recordExecution } = await import('../api/_lib/pay/spend-governor.js');
const { USDC_SOLANA_MINT } = await import('../api/_lib/pay/probe.js');
const { default: handler } = await import('../api/pay/execute.js');

const SESSION = { id: 'sess-1', user_id: 'owner-1', agent_id: null, label: 'x', network: 'solana', spent_usdc: '0', budget_usdc: '100000000' };
const TARGET_URL = 'https://api.example.com/data';
const challenge = () => JSON.stringify({
	x402Version: 2, resource: TARGET_URL,
	accepts: [{ scheme: 'exact', network: 'solana', amount: '2000000', asset: USDC_SOLANA_MINT,
		payTo: Keypair.generate().publicKey.toBase58(), extra: { feePayer: Keypair.generate().publicKey.toBase58() } }],
});

let realFetch;
beforeEach(() => { realFetch = globalThis.fetch; vi.clearAllMocks(); });
afterEach(() => { globalThis.fetch = realFetch; });

describe('POST /api/pay/execute: 402 after the signed transfer was handed over', () => {
	it('keeps the budget spent and records the outcome as uncertain', async () => {
		globalThis.fetch = vi.fn(async () => new Response(challenge(), { status: 402 }));
		const res = { statusCode: 0, payload: null, headers: {},
			setHeader(k, v) { this.headers[String(k).toLowerCase()] = v; }, getHeader(k) { return this.headers[String(k).toLowerCase()]; },
			removeHeader() {}, writeHead(c) { this.statusCode = c; return this; }, get headersSent() { return false; }, get writableEnded() { return false; },
			end(c) { if (c) { try { this.payload = JSON.parse(String(c)); } catch { this.payload = String(c); } } return this; } };
		await handler({ method: 'POST', url: '/api/pay/execute', headers: { 'content-type': 'application/json', origin: 'https://three.ws' },
			body: { session_token: 'pss_11111111-1111-4111-8111-111111111111_abc', url: TARGET_URL } }, res);

		expect(globalThis.fetch).toHaveBeenCalledTimes(2);
		expect(rollbackReservation).not.toHaveBeenCalled();
		expect(recordExecution).toHaveBeenCalledWith(expect.objectContaining({ errorCode: 'payment_rejected' }));
	});
});
