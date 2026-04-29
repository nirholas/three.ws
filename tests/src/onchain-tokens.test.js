/**
 * Tests for the token-launch facade. Pure-logic only — wallet I/O and the
 * Pump.fun SDK are exercised in integration tests.
 */

import { describe, it, expect } from 'vitest';
import {
	getTokenAdapter,
	listProviders,
	_resetTokenAdapters,
} from '../../src/onchain/tokens/index.js';

describe('TokenAdapter factory', () => {
	it('lists known providers', () => {
		expect(listProviders()).toContain('pumpfun');
	});

	it('returns and caches the pumpfun adapter', () => {
		_resetTokenAdapters();
		const a = getTokenAdapter('pumpfun');
		const b = getTokenAdapter('pumpfun');
		expect(a).toBe(b);
		expect(a.provider).toBe('pumpfun');
		expect(a.family).toBe('solana');
	});

	it('throws for unknown providers', () => {
		expect(() => getTokenAdapter('zora')).toThrow(/no token adapter/i);
	});
});

describe('PumpfunTokenAdapter.validatePreconditions', () => {
	const adapter = getTokenAdapter('pumpfun');

	it('rejects an agent that is not deployed on-chain', () => {
		const r = adapter.validatePreconditions({ agent: { id: 'a' } });
		expect(r.ok).toBe(false);
		expect(r.reason).toMatch(/deployed/i);
	});

	it('rejects an agent deployed on EVM', () => {
		const r = adapter.validatePreconditions({
			agent: { id: 'a', onchain: { family: 'evm', chain: 'eip155:8453' } },
		});
		expect(r.ok).toBe(false);
		expect(r.reason).toMatch(/solana/i);
	});

	it('rejects an agent that already launched a token', () => {
		const r = adapter.validatePreconditions({
			agent: {
				id: 'a',
				onchain: { family: 'solana', cluster: 'mainnet' },
				token: { mint: 'AbC' },
			},
		});
		expect(r.ok).toBe(false);
		expect(r.reason).toMatch(/already/i);
	});

	it('accepts a Solana-deployed agent without a token', () => {
		const r = adapter.validatePreconditions({
			agent: { id: 'a', onchain: { family: 'solana', cluster: 'devnet' } },
		});
		expect(r.ok).toBe(true);
	});
});
