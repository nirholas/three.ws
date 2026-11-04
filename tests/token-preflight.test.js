import { describe, it, expect } from 'vitest';
import { Keypair, PublicKey } from '@solana/web3.js';
import {
	validateAddress,
	validateReceivers,
	classifyAccount,
	describeConflicts,
	buildApplyCommand,
	parseArgs,
} from '../scripts/lib/token-preflight.mjs';

const A = Keypair.generate().publicKey.toBase58();
const B = Keypair.generate().publicKey.toBase58();
const [pda] = PublicKey.findProgramAddressSync([Buffer.from('x')], new PublicKey('11111111111111111111111111111111'));

describe('validateAddress', () => {
	it('accepts an ordinary wallet', () => {
		expect(validateAddress(A)).toMatchObject({ ok: true, pubkey: A, onCurve: true });
	});
	it('rejects empty, malformed, reserved and off-curve addresses', () => {
		expect(validateAddress('').ok).toBe(false);
		expect(validateAddress('not-base58-0OIl').ok).toBe(false);
		expect(validateAddress('11111111111111111111111111111111').errors[0]).toMatch(/System Program/);
		expect(validateAddress('1nc1nerator11111111111111111111111111111111').errors[0]).toMatch(/burn/);
		expect(validateAddress(pda.toBase58()).errors[0]).toMatch(/off the ed25519 curve/);
	});
});

describe('validateReceivers', () => {
	it('requires distinct receivers', () => {
		const v = validateReceivers({ treasury: A, rewards: A });
		expect(v.ok).toBe(false);
		expect(v.errors.join(' ')).toMatch(/same wallet/);
	});
	it('passes a distinct valid pair', () => {
		expect(validateReceivers({ treasury: A, rewards: B }).ok).toBe(true);
	});
	it('prefixes per-role errors', () => {
		expect(validateReceivers({ treasury: '', rewards: B }).errors[0]).toMatch(/^treasury:/);
	});
});

describe('classifyAccount', () => {
	const sys = '11111111111111111111111111111111';
	it('treats a missing account as fine', () => expect(classifyAccount(null).ok).toBe(true));
	it('accepts a system-owned wallet', () => {
		expect(classifyAccount({ owner: sys, executable: false, lamports: 5 })).toMatchObject({ kind: 'system', ok: true });
	});
	it('rejects programs and non-system owners', () => {
		expect(classifyAccount({ owner: sys, executable: true, lamports: 1 }).ok).toBe(false);
		expect(classifyAccount({ owner: 'Tokenz', executable: false, lamports: 1 }).ok).toBe(false);
	});
});

describe('describeConflicts', () => {
	it('is blocking for an armed lane and a warning otherwise', () => {
		const out = describeConflicts(A, [
			{ lane: 'buyback', signer: A, armed: true },
			{ lane: 'microbuy', signer: A, armed: false },
		]);
		expect(out.map((c) => c.severity)).toEqual(['blocking', 'warning']);
	});
});

describe('buildApplyCommand and parseArgs', () => {
	it('uses --update-env-vars, never --set-env-vars', () => {
		const cmd = buildApplyCommand({ treasury: A, rewards: B });
		expect(cmd).toContain('--update-env-vars');
		expect(cmd).not.toContain('--set-env-vars');
		expect(cmd).toContain(`THREE_TREASURY_WALLET=${A},THREE_REWARDS_WALLET=${B}`);
	});
	it('parses both flag forms', () => {
		expect(parseArgs(['--treasury', A, `--rewards=${B}`])).toMatchObject({ treasury: A, rewards: B });
	});
});
