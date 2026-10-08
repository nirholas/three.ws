// Regression guards for the October 2026 authorization sweep.
//
// Each block pins one finding: a narrow bearer acting with the account's full
// authority, a sign-in flow handing an account to whoever pre-registered its
// address, a public endpoint closing someone else's stake, a reused idempotency
// key leaking another sender's receipt, a forged node receipt, and an
// unfiltered read awarding any agent the platform's "model verified" badge.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { Readable } from 'node:stream';
import { Keypair } from '@solana/web3.js';
import { ed25519 } from '@noble/curves/ed25519.js';
import bs58 from 'bs58';

const REPO = join(import.meta.dirname, '..', '..');
const src = (rel) => readFileSync(join(REPO, rel), 'utf8');

vi.mock('../../api/_lib/zauth.js', () => ({ instrument: () => false, drain: async () => {} }));
vi.mock('../../api/_lib/sentry.js', () => ({ captureException: () => {} }));

// ── shared request plumbing ───────────────────────────────────────────────────

function mkReq({ method = 'GET', url = '/', headers = {}, body = null, query = {} } = {}) {
	const req = body ? Readable.from([Buffer.from(JSON.stringify(body))]) : Readable.from([]);
	req.method = method;
	req.url = url;
	req.query = query;
	req.headers = { host: 'three.ws', ...(body ? { 'content-type': 'application/json' } : {}), ...headers };
	req.socket = { remoteAddress: '127.0.0.1' };
	return req;
}
function mkRes() {
	return {
		statusCode: 200,
		headers: {},
		body: '',
		headersSent: false,
		writableEnded: false,
		setHeader(k, v) { this.headers[k.toLowerCase()] = v; },
		getHeader(k) { return this.headers[k.toLowerCase()]; },
		end(chunk) { if (chunk !== undefined) this.body += chunk; this.writableEnded = true; this.headersSent = true; },
	};
}
const parseBody = (res) => (res.body ? JSON.parse(res.body) : null);

// ── 1. requestUserHasScope ────────────────────────────────────────────────────

describe('requestUserHasScope', () => {
	it('lets a cookie session through and holds a bearer to its grant', async () => {
		const { requestUserHasScope } = await import('../../api/_lib/auth.js');
		expect(requestUserHasScope({ id: 'u', email: 'a@b.c' }, 'wallet:write')).toBe(true);
		expect(requestUserHasScope({ id: 'u', source: 'bearer', scope: 'inference' }, 'profile')).toBe(false);
		expect(requestUserHasScope({ id: 'u', source: 'bearer', scope: 'profile wallet:write' }, 'profile wallet:write')).toBe(true);
		expect(requestUserHasScope(null, 'profile')).toBe(false);
	});
});

// ── 2. reserved .local registration addresses ─────────────────────────────────

describe('registration refuses platform-minted .local addresses', () => {
	it('rejects the wallet, privy, sso and username placeholder domains', async () => {
		const { registerBody } = await import('../../api/_lib/validate.js');
		const ok = (email) => registerBody.safeParse({ email, password: 'correct horse battery' }).success;
		expect(ok('person@example.com')).toBe(true);
		expect(ok('sol-0123456789abcdef@wallet.local')).toBe(false);
		expect(ok('wallet-0xabc@wallet.local')).toBe(false);
		expect(ok('privy-abc@privy.local')).toBe(false);
		expect(ok('saml-abc@sso.three.ws.local')).toBe(false);
		expect(ok('somehandle@users.three.ws.local')).toBe(false);
	});

	it('SIWS never adopts a password account squatting the placeholder', () => {
		const code = src('api/auth/siws/[action].js');
		expect(code).toMatch(/existingUser\?\.password_hash/);
	});
});

// ── 3. reputation market: only the staker withdraws ───────────────────────────

describe('verifyUnstakeProof', () => {
	const kp = Keypair.generate();
	const position = { network: 'devnet', signature: '5'.repeat(88), staker: kp.publicKey.toBase58() };

	async function sign(keypair, issuedAt, pos = position) {
		const { unstakeProofMessage } = await import('../../src/shared/reputation-staking.js');
		const msg = new TextEncoder().encode(unstakeProofMessage({ network: pos.network, stakeSignature: pos.signature, issuedAt }));
		return bs58.encode(ed25519.sign(msg, keypair.secretKey.slice(0, 32)));
	}

	it('accepts a fresh signature by the staker', async () => {
		const { verifyUnstakeProof } = await import('../../api/_lib/reputation-market.js');
		const now = Date.now();
		const signature = await sign(kp, now);
		expect(() => verifyUnstakeProof({ position, proof: { issued_at: now, signature }, now })).not.toThrow();
	});

	it('refuses a missing proof, a stale proof, and another wallet', async () => {
		const { verifyUnstakeProof } = await import('../../api/_lib/reputation-market.js');
		const now = Date.now();
		expect(() => verifyUnstakeProof({ position, proof: null, now })).toThrow(/Sign the unstake message/);
		const old = now - 10 * 60_000;
		const staleSig = await sign(kp, old);
		expect(() => verifyUnstakeProof({ position, proof: { issued_at: old, signature: staleSig }, now })).toThrow(/too old/);
		const otherSig = await sign(Keypair.generate(), now);
		expect(() => verifyUnstakeProof({ position, proof: { issued_at: now, signature: otherSig }, now })).toThrow(/Only the wallet/);
	});

	it('refuses a staker proof minted for a different position', async () => {
		const { verifyUnstakeProof } = await import('../../api/_lib/reputation-market.js');
		const now = Date.now();
		const sig = await sign(kp, now, { ...position, signature: '6'.repeat(88) });
		expect(() => verifyUnstakeProof({ position, proof: { issued_at: now, signature: sig }, now })).toThrow(/Only the wallet/);
	});
});

// ── 4. knock: a reused request_id is a retry only for the same knock ──────────

const knockStore = { existing: null };
vi.mock('../../api/_lib/knock/store.js', async (orig) => ({
	...(await orig()),
	findByRequestId: vi.fn(async () => knockStore.existing),
	recordKnock: vi.fn(async () => ({ id: 'new-knock' })),
	getDoor: vi.fn(async () => ({})),
	isBlocked: vi.fn(async () => false),
	knocksToday: vi.fn(async () => 0),
}));
vi.mock('../../api/_lib/companion/store.js', () => ({ insertEvent: vi.fn(async () => ({ id: 'evt' })) }));
vi.mock('../../api/_lib/notify.js', () => ({ insertNotification: vi.fn() }));

describe('deliverKnock duplicate handling', () => {
	const clean = { senderName: 'Ada', message: 'hello there', requestId: 'ada-001', subject: null };

	it('returns the original knock for a genuine retry', async () => {
		const { deliverKnock } = await import('../../api/_lib/knock/deliver.js');
		knockStore.existing = { id: 'orig', sender_name: 'Ada', message: 'hello there' };
		const out = await deliverKnock({ userId: 'owner', clean });
		expect(out.duplicate).toBe(true);
		expect(out.knock.id).toBe('orig');
	});

	it('refuses a different knock reusing the key, without disclosing the original', async () => {
		const { deliverKnock } = await import('../../api/_lib/knock/deliver.js');
		knockStore.existing = { id: 'orig', sender_name: 'Someone', message: 'private' };
		await expect(deliverKnock({ userId: 'owner', clean })).rejects.toMatchObject({ status: 409, code: 'request_id_conflict' });
	});
});

// ── 5. bearer scope on account surfaces ───────────────────────────────────────

const authState = { user: null };
vi.mock('../../api/_lib/auth.js', async (orig) => {
	const actual = await orig();
	return { ...actual, getRequestUser: vi.fn(async () => authState.user) };
});
vi.mock('../../api/_lib/rate-limit.js', () => {
	const ok = async () => ({ success: true, limit: 1, remaining: 1, reset: Date.now() + 1000 });
	return { limits: new Proxy({}, { get: () => ok }), clientIp: () => '127.0.0.1' };
});
vi.mock('../../api/_lib/csrf.js', () => ({ requireCsrf: vi.fn(async () => true) }));
vi.mock('../../api/_lib/db.js', () => ({
	sql: Object.assign(vi.fn(async () => []), { transaction: vi.fn(async () => []) }),
	isDbUnavailableError: () => false,
	isDbCapacityError: () => false,
}));

describe('bearer scope on the knock door and the chat gateway', () => {
	beforeEach(() => {
		authState.user = { id: 'owner', source: 'bearer', scope: 'inference' };
	});

	it('an inference-only key cannot move the knock payout', async () => {
		const { default: handler } = await import('../../api/knock/settings.js');
		const res = mkRes();
		await handler(mkReq({ method: 'PATCH', url: '/api/knock/settings', body: { pay_to_solana: 'Attacker1111111111111111111111111111111111' } }), res);
		expect(res.statusCode).toBe(403);
		expect(parseBody(res).error).toBe('insufficient_scope');
	});

	it('a profile key still cannot move the payout without wallet:write', async () => {
		authState.user = { id: 'owner', source: 'bearer', scope: 'profile' };
		const { default: handler } = await import('../../api/knock/settings.js');
		const res = mkRes();
		await handler(mkReq({ method: 'PATCH', url: '/api/knock/settings', body: { pay_to_base: '0x0000000000000000000000000000000000000001' } }), res);
		expect(res.statusCode).toBe(403);
	});

	it('an avatars-only token cannot pair a chat that approves trades', async () => {
		authState.user = { id: 'owner', source: 'bearer', scope: 'avatars:read' };
		const { default: handler } = await import('../../api/gateway/connections.js');
		const res = mkRes();
		await handler(mkReq({ method: 'POST', url: '/api/gateway/connections', body: { action: 'issue' } }), res);
		expect(res.statusCode).toBe(403);
		expect(parseBody(res).error).toBe('insufficient_scope');
	});

	it('every companion account route checks the profile scope', () => {
		for (const rel of [
			'api/companion/settings.js',
			'api/companion/poll.js',
			'api/companion/events/index.js',
			'api/companion/events/[id].js',
			'api/companion/events/[id]/reply.js',
			'api/companion/sources/index.js',
			'api/companion/sources/[id].js',
			'api/companion/contacts/index.js',
			'api/companion/contacts/[id].js',
			'api/companion/checkout.js',
		]) {
			expect(src(rel), rel).toMatch(/requestUserHasScope\(user, 'profile'\)/);
		}
	});
});

// ── 6. source-pinned fixes ────────────────────────────────────────────────────

describe('source-pinned authorization fixes', () => {
	it('a node result receipt must be signed by the claiming node key', () => {
		expect(src('api/nodes/jobs/[id]/result.js')).toMatch(/receipt\?\.publicKey === job\.claimedBy/);
	});

	it('password reset consumes its token atomically and revokes refresh tokens', () => {
		const code = src('api/auth/[action].js');
		const fn = code.slice(code.indexOf('async function handleResetPassword'), code.indexOf('// ── verify-email'));
		expect(fn).toMatch(/update password_resets r set consumed_at = now\(\)[\s\S]*returning r\.id, r\.user_id/);
		expect(fn).toMatch(/update oauth_refresh_tokens set revoked_at = now\(\) where user_id = \$\{userId\}/);
	});

	it('the model-verified validation reads only platform-signed memos', () => {
		const code = src('api/agents/solana/_handlers.js');
		const reads = [...code.matchAll(/payload->>'subkind' = \$\{SUBKIND_GLB_SCHEMA\}[^`]*/g)].map((m) => m[0]);
		expect(reads.length).toBeGreaterThanOrEqual(2);
		for (const r of reads) expect(r).toMatch(/attester = \$\{validator\}/);
	});

	it('the platform validator address fails closed without a key', async () => {
		const { platformValidatorAddress } = await import('../../api/_lib/solana-validation-attest.js');
		const saved = process.env.ATTEST_AGENT_SECRET_KEY;
		delete process.env.ATTEST_AGENT_SECRET_KEY;
		try {
			expect(platformValidatorAddress()).toBeNull();
			const kp = Keypair.generate();
			process.env.ATTEST_AGENT_SECRET_KEY = JSON.stringify([...kp.secretKey]);
			expect(platformValidatorAddress()).toBe(kp.publicKey.toBase58());
		} finally {
			if (saved === undefined) delete process.env.ATTEST_AGENT_SECRET_KEY;
			else process.env.ATTEST_AGENT_SECRET_KEY = saved;
		}
	});

	it('manifest publish and the strategy-loop money switch check bearer scope', () => {
		expect(src('api/agents/_id/manifest-signed.js')).toMatch(/hasScope\(bearer\.scope, 'agents:write'\)/);
		expect(src('api/_lib/strategy-loop/routes.js')).toMatch(/hasScope\(principal\.scope, 'wallet:write'\)/);
		expect(src('api/agents/[id]/api-service.js')).toMatch(/hasScope\(bearer\.scope, needed\)/);
		expect(src('api/agents/[id]/memory-seed-farcaster.js')).toMatch(/'memory:write'/);
	});
});
