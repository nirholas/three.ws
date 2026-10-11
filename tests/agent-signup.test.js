import { describe, it, expect } from 'vitest';
import { ed25519 } from '@noble/curves/ed25519.js';
import bs58mod from 'bs58';
import {
	buildSignupMessage,
	verifySignupPayload,
	paperModeMeta,
	SKEW_WINDOW_SECONDS,
} from '../api/_lib/agent-signup.js';
import { worstStatus } from '../api/_lib/health-probes.js';

const bs58 = bs58mod.default || bs58mod;
const NOW_MS = 1_800_000_000_000;
const NOW_S = NOW_MS / 1000;

function signed(overrides = {}) {
	const priv = ed25519.utils.randomSecretKey();
	const publicKey = bs58.encode(ed25519.getPublicKey(priv));
	const fields = { name: 'Scout', timestamp: NOW_S, nonce: 'nonce-aaaaaaaaaaaaaaaa', ...overrides };
	const message = buildSignupMessage({ publicKey, ...fields });
	const signature = bs58.encode(ed25519.sign(new TextEncoder().encode(message), priv));
	return { public_key: publicKey, signature, ...fields, priv };
}

const catchErr = (fn) => {
	try {
		fn();
	} catch (e) {
		return e;
	}
	return null;
};

describe('verifySignupPayload', () => {
	it('accepts a correctly signed, fresh payload', () => {
		const body = signed();
		const out = verifySignupPayload(body, NOW_MS);
		expect(out).toMatchObject({ publicKey: body.public_key, name: 'Scout', nonce: body.nonce });
	});

	it('rejects a request whose clock is behind the server, naming the server time', () => {
		const err = catchErr(() => verifySignupPayload(signed({ timestamp: NOW_S - SKEW_WINDOW_SECONDS - 1 }), NOW_MS));
		expect(err.code).toBe('clock_skew');
		expect(err.status).toBe(400);
		expect(err.server_time).toBe(NOW_S);
		expect(err.message).toContain('behind');
	});

	it('rejects a request whose clock is ahead of the server', () => {
		const err = catchErr(() => verifySignupPayload(signed({ timestamp: NOW_S + SKEW_WINDOW_SECONDS + 60 }), NOW_MS));
		expect(err.code).toBe('clock_skew');
		expect(err.message).toContain('ahead');
	});

	it('accepts a timestamp exactly at the edge of the window', () => {
		expect(() => verifySignupPayload(signed({ timestamp: NOW_S - SKEW_WINDOW_SECONDS }), NOW_MS)).not.toThrow();
	});

	it('rejects a signature made over different fields (tampered name)', () => {
		const body = signed();
		const err = catchErr(() => verifySignupPayload({ ...body, name: 'Imposter' }, NOW_MS));
		expect(err.code).toBe('bad_signature');
		expect(err.status).toBe(401);
	});

	it("rejects a signature from another key", () => {
		const a = signed();
		const b = signed();
		const err = catchErr(() => verifySignupPayload({ ...a, signature: b.signature }, NOW_MS));
		expect(err.code).toBe('bad_signature');
	});

	it('rejects malformed input before verifying', () => {
		const body = signed();
		expect(catchErr(() => verifySignupPayload({ ...body, nonce: 'short' }, NOW_MS)).code).toBe('validation_error');
		expect(catchErr(() => verifySignupPayload({ ...body, name: '' }, NOW_MS)).code).toBe('validation_error');
		expect(catchErr(() => verifySignupPayload({ ...body, name: 'a\nb' }, NOW_MS)).code).toBe('validation_error');
		expect(catchErr(() => verifySignupPayload({ ...body, public_key: 'not base58!' }, NOW_MS)).code).toBe('invalid_encoding');
		expect(catchErr(() => verifySignupPayload({ ...body, signature: bs58.encode(new Uint8Array(10)) }, NOW_MS)).code).toBe('invalid_encoding');
		expect(catchErr(() => verifySignupPayload(null, NOW_MS)).code).toBe('validation_error');
	});
});

describe('paper mode', () => {
	it('freezes spend, kills discretionary trades and locks live perps', () => {
		const meta = paperModeMeta('PUBKEY', '2026-10-10T00:00:00.000Z');
		expect(meta.spend_limits.frozen).toBe(true);
		expect(meta.trade_limits.kill_switch).toBe(true);
		expect(meta.perps_limits.live_enabled).toBe(false);
		expect(meta.spend_limits.per_tx_usd).toBeLessThanOrEqual(1);
		expect(meta.autonomy).toMatchObject({ origin: 'self_signup', mode: 'paper' });
	});
});

describe('health roll-up', () => {
	it('is the worst probe; unknown and paused do not count', () => {
		expect(worstStatus(['ok', 'unknown', 'paused'])).toBe('ok');
		expect(worstStatus(['ok', 'degraded'])).toBe('degraded');
		expect(worstStatus(['degraded', 'down', 'ok'])).toBe('down');
	});
});

describe.skipIf(!process.env.DATABASE_URL)('replay protection (real database)', () => {
	it('accepts a nonce once per key and rejects the replay', async () => {
		const { consumeSignupNonce } = await import('../api/_lib/agent-signup.js');
		const { sql } = await import('../api/_lib/db.js');
		const key = `test-key-${Date.now()}`;
		const nonce = 'replay-test-nonce-0001';
		try {
			expect(await consumeSignupNonce(key, nonce)).toBe(true);
			expect(await consumeSignupNonce(key, nonce)).toBe(false);
			expect(await consumeSignupNonce(`${key}-other`, nonce)).toBe(true);
		} finally {
			await sql`delete from agent_self_signup_nonces where public_key like ${`${key}%`}`;
		}
	});
});
