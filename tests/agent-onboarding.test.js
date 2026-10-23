// Challenge-response signup (api/_lib/agent-onboarding.js) and the x402 plan
// upgrade quote (api/billing/agent-upgrade.js). The database is a small
// stateful stand-in that executes the exact statements the module issues, so the
// replay, binding, expiry and single-use rules are tested as the code runs them.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ed25519 } from '@noble/curves/ed25519.js';
import bs58mod from 'bs58';

const bs58 = bs58mod.default || bs58mod;

const state = { challenges: new Map(), signups: 0 };

vi.mock('../api/_lib/db.js', () => {
	const sql = (strings, ...values) => {
		const text = strings.join('?').replace(/\s+/g, ' ').trim();
		const run = () => {
			if (text.startsWith('delete from agent_signup_challenges')) return [];
			if (text.startsWith('insert into agent_signup_challenges')) {
				const [nonce, public_key, ip, issued_at, expires_at] = values;
				state.challenges.set(nonce, { nonce, public_key, ip, issued_at, expires_at, consumed_at: null });
				return [];
			}
			if (text.startsWith('select nonce, public_key, issued_at')) {
				const row = state.challenges.get(values[0]);
				return row ? [{ ...row }] : [];
			}
			if (text.startsWith('update agent_signup_challenges set consumed_at')) {
				const [nonce, publicKey, notAfter] = values;
				const row = state.challenges.get(nonce);
				if (!row || row.public_key !== publicKey || row.consumed_at || new Date(row.expires_at) <= new Date(notAfter)) return [];
				row.consumed_at = new Date().toISOString();
				return [{ nonce }];
			}
			if (text.startsWith('select count(*)::int as n from agent_self_signups')) return [{ n: state.signups }];
			throw new Error(`unexpected statement: ${text}`);
		};
		const result = Promise.resolve().then(run);
		return result;
	};
	sql.transaction = async () => [];
	return { sql };
});

vi.mock('../api/_lib/env.js', async (importActual) => {
	const actual = await importActual();
	return {
		...actual,
		env: new Proxy(actual.env, {
			get: (t, k) => (k === 'APP_ORIGIN' ? 'https://three.ws' : k === 'AGENT_SIGNUP_DAILY_CAP' ? 3 : t[k]),
		}),
	};
});

const {
	buildChallengeMessage,
	issueChallenge,
	redeemChallenge,
	assertUnderDailyCap,
	assertPublicKey,
	verifyChallengeSignature,
	CHALLENGE_TTL_SECONDS,
} = await import('../api/_lib/agent-onboarding.js');

function keypair() {
	const priv = ed25519.utils.randomSecretKey();
	return { priv, publicKey: bs58.encode(ed25519.getPublicKey(priv)) };
}
const sign = (priv, message) => bs58.encode(ed25519.sign(new TextEncoder().encode(message), priv));
const codeOf = async (promise) => {
	try {
		await promise;
		return null;
	} catch (err) {
		return err;
	}
};

beforeEach(() => {
	state.challenges.clear();
	state.signups = 0;
});

describe('challenge message', () => {
	it('is deterministic and names every bound field', () => {
		const fields = { domain: 'three.ws', publicKey: 'K', nonce: 'N', issuedAt: 'I', expiresAt: 'E' };
		expect(buildChallengeMessage(fields)).toBe(buildChallengeMessage({ ...fields }));
		const msg = buildChallengeMessage(fields);
		for (const part of ['domain: three.ws', 'public_key: K', 'nonce: N', 'issued_at: I', 'expires_at: E']) expect(msg).toContain(part);
	});

	it('rejects a malformed public key before any challenge exists', () => {
		expect(() => assertPublicKey('not-a-key')).toThrow();
		expect(() => assertPublicKey(bs58.encode(new Uint8Array(31)))).toThrow();
		const { publicKey } = keypair();
		expect(assertPublicKey(publicKey)).toBe(publicKey);
	});
});

describe('redeemChallenge', () => {
	it('accepts a correct signature once', async () => {
		const { priv, publicKey } = keypair();
		const ch = await issueChallenge({ publicKey, ip: '203.0.113.7' });
		expect(ch.ttl_seconds).toBe(CHALLENGE_TTL_SECONDS);
		await expect(redeemChallenge({ publicKey, nonce: ch.nonce, signature: sign(priv, ch.message) })).resolves.toBeUndefined();
	});

	it('rejects a replayed nonce with 409 nonce_reused', async () => {
		const { priv, publicKey } = keypair();
		const ch = await issueChallenge({ publicKey, ip: null });
		const signature = sign(priv, ch.message);
		await redeemChallenge({ publicKey, nonce: ch.nonce, signature });
		const err = await codeOf(redeemChallenge({ publicKey, nonce: ch.nonce, signature }));
		expect(err.code).toBe('nonce_reused');
		expect(err.status).toBe(409);
	});

	it('rejects a wrong signature with 401 bad_signature and does not burn the nonce', async () => {
		const { priv, publicKey } = keypair();
		const other = keypair();
		const ch = await issueChallenge({ publicKey, ip: null });
		const err = await codeOf(redeemChallenge({ publicKey, nonce: ch.nonce, signature: sign(other.priv, ch.message) }));
		expect(err.code).toBe('bad_signature');
		expect(err.status).toBe(401);
		await expect(redeemChallenge({ publicKey, nonce: ch.nonce, signature: sign(priv, ch.message) })).resolves.toBeUndefined();
	});

	it('rejects a signature over a different message', async () => {
		const { priv, publicKey } = keypair();
		const ch = await issueChallenge({ publicKey, ip: null });
		const err = await codeOf(redeemChallenge({ publicKey, nonce: ch.nonce, signature: sign(priv, `${ch.message}\nextra`) }));
		expect(err.code).toBe('bad_signature');
	});

	it('rejects a nonce issued to a different key', async () => {
		const a = keypair();
		const b = keypair();
		const ch = await issueChallenge({ publicKey: a.publicKey, ip: null });
		const err = await codeOf(redeemChallenge({ publicKey: b.publicKey, nonce: ch.nonce, signature: sign(b.priv, ch.message) }));
		expect(err.code).toBe('invalid_nonce');
		expect(err.status).toBe(400);
	});

	it('rejects an unknown nonce', async () => {
		const { priv, publicKey } = keypair();
		const err = await codeOf(redeemChallenge({ publicKey, nonce: 'A'.repeat(32), signature: sign(priv, 'x') }));
		expect(err.code).toBe('invalid_nonce');
	});

	it('rejects an expired challenge with 410', async () => {
		const { priv, publicKey } = keypair();
		const past = new Date(Date.now() - 2 * CHALLENGE_TTL_SECONDS * 1000);
		const ch = await issueChallenge({ publicKey, ip: null, now: past });
		const err = await codeOf(redeemChallenge({ publicKey, nonce: ch.nonce, signature: sign(priv, ch.message) }));
		expect(err.code).toBe('nonce_expired');
		expect(err.status).toBe(410);
	});

	it('requires a nonce and a signature', async () => {
		const { publicKey } = keypair();
		expect((await codeOf(redeemChallenge({ publicKey, nonce: undefined, signature: 'x' }))).code).toBe('validation_error');
		const ch = await issueChallenge({ publicKey, ip: null });
		expect((await codeOf(redeemChallenge({ publicKey, nonce: ch.nonce, signature: '' }))).code).toBe('validation_error');
	});

	it('two concurrent redemptions of one challenge: exactly one wins', async () => {
		const { priv, publicKey } = keypair();
		const ch = await issueChallenge({ publicKey, ip: null });
		const signature = sign(priv, ch.message);
		const results = await Promise.allSettled([
			redeemChallenge({ publicKey, nonce: ch.nonce, signature }),
			redeemChallenge({ publicKey, nonce: ch.nonce, signature }),
		]);
		expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
		expect(results.find((r) => r.status === 'rejected').reason.code).toBe('nonce_reused');
	});
});

describe('verifyChallengeSignature', () => {
	it('returns false rather than throwing on a well-formed but wrong signature', () => {
		const { publicKey } = keypair();
		expect(verifyChallengeSignature({ message: 'm', signature: bs58.encode(new Uint8Array(64)), publicKey })).toBe(false);
	});
	it('throws a 400 on a signature of the wrong length', () => {
		const { publicKey } = keypair();
		expect(() => verifyChallengeSignature({ message: 'm', signature: bs58.encode(new Uint8Array(10)), publicKey })).toThrow(/64 bytes/);
	});
});

describe('daily account cap', () => {
	it('allows signups below the cap and refuses at it with 429', async () => {
		state.signups = 2;
		await expect(assertUnderDailyCap()).resolves.toBeUndefined();
		state.signups = 3;
		const err = await codeOf(assertUnderDailyCap());
		expect(err.status).toBe(429);
		expect(err.code).toBe('daily_cap_reached');
	});
});
