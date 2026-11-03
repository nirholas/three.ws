import { describe, it, expect } from 'vitest';
import { assertMandateAllows } from '../api/_lib/a2a/mandate.js';

const base = (resources) => ({
	mandate: { perCallAtomics: '1000', currency: 'USDC', resources, expiresAt: 0 },
	amountAtomics: '10',
	network: undefined,
});

describe('mandate resource scoping', () => {
	it('allows the same origin and a deeper path', () => {
		expect(() =>
			assertMandateAllows({ ...base(['https://peer.com/a2a']), resource: 'https://peer.com/a2a/task?x=1' }),
		).not.toThrow();
	});
	it('rejects a host that merely starts with the authorized origin', () => {
		expect(() =>
			assertMandateAllows({ ...base(['https://peer.com']), resource: 'https://peer.com.evil.io/a2a' }),
		).toThrow(/does not authorize/);
	});
	it('rejects a sibling path sharing a string prefix', () => {
		expect(() =>
			assertMandateAllows({ ...base(['https://peer.com/a2a']), resource: 'https://peer.com/a2a-evil' }),
		).toThrow(/does not authorize/);
	});
	it('rejects userinfo tricks', () => {
		expect(() =>
			assertMandateAllows({ ...base(['https://peer.com/']), resource: 'https://peer.com@evil.io/' }),
		).toThrow(/does not authorize/);
	});
});
