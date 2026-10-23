// The pure burner classifier: the same code the guard enforces and the policy
// editor previews, so these cases pin both.

import { describe, it, expect } from 'vitest';
import {
	normalizeBurnerPolicy, validateBurnerPolicy, burnerEnabled, classifyBurnerSpend, ownerSignMessage,
	BURNER_EXPIRY_DEFAULT_MIN,
} from '../api/_lib/burner-tier.js';

const policy = normalizeBurnerPolicy({ autoMaxUsd: 25, dailyAutoMaxUsd: 60, confirmAboveUsd: 500 });

describe('normalizeBurnerPolicy', () => {
	it('is off by default and defaults the expiry to 10 minutes', () => {
		const p = normalizeBurnerPolicy(undefined);
		expect(burnerEnabled(p)).toBe(false);
		expect(p.expiryMinutes).toBe(BURNER_EXPIRY_DEFAULT_MIN);
		expect(BURNER_EXPIRY_DEFAULT_MIN).toBe(10);
	});
	it('bounds the expiry and rejects negative or junk amounts', () => {
		expect(normalizeBurnerPolicy({ autoMaxUsd: 5, expiryMinutes: 1 }).expiryMinutes).toBe(2);
		expect(normalizeBurnerPolicy({ autoMaxUsd: 5, expiryMinutes: 9999 }).expiryMinutes).toBe(60);
		expect(normalizeBurnerPolicy({ autoMaxUsd: -3 }).autoMaxUsd).toBeNull();
		expect(normalizeBurnerPolicy({ autoMaxUsd: 'abc' }).autoMaxUsd).toBeNull();
	});
});

describe('validateBurnerPolicy', () => {
	it('requires the per-spend cap before the other fields', () => {
		expect(validateBurnerPolicy(normalizeBurnerPolicy({ dailyAutoMaxUsd: 10 }))).toMatch(/per-spend/);
	});
	it('rejects a daily or signature limit below the per-spend cap', () => {
		expect(validateBurnerPolicy(normalizeBurnerPolicy({ autoMaxUsd: 25, dailyAutoMaxUsd: 10 }))).toMatch(/daily/);
		expect(validateBurnerPolicy(normalizeBurnerPolicy({ autoMaxUsd: 25, confirmAboveUsd: 10 }))).toMatch(/signature/);
	});
	it('accepts a coherent policy and an empty one', () => {
		expect(validateBurnerPolicy(policy)).toBeNull();
		expect(validateBurnerPolicy(normalizeBurnerPolicy({}))).toBeNull();
	});
});

describe('classifyBurnerSpend', () => {
	it('a spend at or below the cap is auto', () => {
		expect(classifyBurnerSpend({ policy, usd: 25 }).tier).toBe('auto');
		expect(classifyBurnerSpend({ policy, usd: 3.5 }).tier).toBe('auto');
	});
	it('a spend above the cap is pending confirmation, never refused', () => {
		const r = classifyBurnerSpend({ policy, usd: 25.01 });
		expect(r.tier).toBe('confirm');
		expect(r.reason).toMatch(/needs your confirmation/);
	});
	it('a spend above the signature threshold needs the owner wallet', () => {
		expect(classifyBurnerSpend({ policy, usd: 500 }).tier).toBe('confirm');
		expect(classifyBurnerSpend({ policy, usd: 500.01 }).tier).toBe('owner_sign');
	});
	it('crossing the daily total flips later in-cap spends to confirm', () => {
		expect(classifyBurnerSpend({ policy, usd: 20, autoSpentUsd: 40 }).tier).toBe('auto');
		const r = classifyBurnerSpend({ policy, usd: 20, autoSpentUsd: 41 });
		expect(r.tier).toBe('confirm');
		expect(r.reason).toMatch(/daily limit/);
		expect(r.headroomUsd).toBe(19);
	});
	it('an unpriced spend needs confirmation when the burner is on', () => {
		expect(classifyBurnerSpend({ policy, usd: null }).tier).toBe('confirm');
	});
	it('with no cap set it stays out of the way', () => {
		const r = classifyBurnerSpend({ policy: normalizeBurnerPolicy({}), usd: 1e6 });
		expect(r).toMatchObject({ tier: 'auto', enabled: false });
	});
});

describe('ownerSignMessage', () => {
	it('binds request id, recipient, amount, chain and hash', () => {
		const m = ownerSignMessage({ id: 'r1', payloadHash: 'h'.repeat(64), recipient: 'RCPT', amount: 1.5, asset: 'SOL', chain: 'solana', network: 'devnet' });
		expect(m).toContain('request: r1');
		expect(m).toContain('recipient: RCPT');
		expect(m).toContain('amount: 1.5 SOL');
		expect(m).toContain('chain: solana devnet');
		expect(m).toContain(`hash: ${'h'.repeat(64)}`);
	});
});
