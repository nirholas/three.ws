/**
 * src/onchain — chain-ref + adapter factory smoke tests.
 *
 * Pure-logic only — no wallet I/O, no fetch. The deploy orchestrator and
 * adapters are integration-tested via Playwright (see test:pages).
 */

import { describe, it, expect } from 'vitest';
import {
	evm,
	solana,
	toCaip2,
	fromCaip2,
	eqRef,
	buildRegistry,
	groupRegistry,
	entryByCaip2,
} from '../../src/onchain/chain-ref.js';

describe('chain-ref', () => {
	it('round-trips EVM through CAIP-2', () => {
		const r = evm(8453);
		expect(toCaip2(r)).toBe('eip155:8453');
		expect(eqRef(r, fromCaip2('eip155:8453'))).toBe(true);
	});

	it('round-trips Solana mainnet through CAIP-2', () => {
		const r = solana('mainnet');
		expect(toCaip2(r)).toBe('solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp');
		expect(fromCaip2(toCaip2(r))).toEqual(r);
	});

	it('round-trips Solana devnet through CAIP-2', () => {
		const r = solana('devnet');
		expect(toCaip2(r)).toBe('solana:EtWTRABZaYq6iMfeYKouRu166VU2xqa1');
	});

	it('rejects bad inputs', () => {
		expect(() => evm(0)).toThrow();
		expect(() => evm(-1)).toThrow();
		expect(() => evm(1.5)).toThrow();
		expect(() => solana('testnet')).toThrow();
		expect(() => fromCaip2('eip155:0')).toThrow();
		expect(() => fromCaip2('cosmos:1')).toThrow();
		expect(() => fromCaip2('solana:nope')).toThrow();
	});

	it('eqRef compares by canonical CAIP-2', () => {
		expect(eqRef(evm(1), evm(1))).toBe(true);
		expect(eqRef(evm(1), evm(8453))).toBe(false);
		expect(eqRef(solana('devnet'), solana('mainnet'))).toBe(false);
		expect(eqRef(null, evm(1))).toBe(false);
	});

	it('buildRegistry includes EVM with deployments + both Solana clusters', () => {
		const meta = {
			8453: { name: 'Base', shortName: 'Base', explorer: 'https://basescan.org', testnet: false },
			84532: {
				name: 'Base Sepolia',
				shortName: 'BaseSep',
				explorer: 'https://sepolia.basescan.org',
				testnet: true,
			},
			999: { name: 'NoDeploy', shortName: 'X', explorer: '', testnet: false },
		};
		const deployments = { 8453: { identityRegistry: '0xabc' }, 84532: { identityRegistry: '0xdef' } };
		const reg = buildRegistry(meta, deployments);

		const caip2s = reg.map((e) => toCaip2(e.ref));
		expect(caip2s).toContain('eip155:8453');
		expect(caip2s).toContain('eip155:84532');
		expect(caip2s).toContain('solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp');
		expect(caip2s).toContain('solana:EtWTRABZaYq6iMfeYKouRu166VU2xqa1');
		expect(caip2s).not.toContain('eip155:999'); // gated by deployments
	});

	it('groupRegistry splits mainnet vs testnet', () => {
		const reg = buildRegistry(
			{ 8453: { name: 'Base', shortName: 'B', explorer: '', testnet: false } },
			{ 8453: { identityRegistry: '0xabc' } },
		);
		const { mainnets, testnets } = groupRegistry(reg);
		expect(mainnets.some((e) => toCaip2(e.ref) === 'eip155:8453')).toBe(true);
		expect(mainnets.some((e) => toCaip2(e.ref) === 'solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp')).toBe(true);
		expect(testnets.some((e) => toCaip2(e.ref) === 'solana:EtWTRABZaYq6iMfeYKouRu166VU2xqa1')).toBe(true);
	});

	it('entryByCaip2 finds and returns null', () => {
		const reg = buildRegistry({}, {});
		expect(entryByCaip2(reg, 'solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp')?.name).toBe('Solana');
		expect(entryByCaip2(reg, 'eip155:1')).toBeNull();
	});

	it('explorer URLs differ between EVM and Solana', () => {
		const reg = buildRegistry(
			{ 8453: { name: 'Base', shortName: 'B', explorer: 'https://basescan.org', testnet: false } },
			{ 8453: { identityRegistry: '0xabc' } },
		);
		const evmEntry = entryByCaip2(reg, 'eip155:8453');
		const solEntry = entryByCaip2(reg, 'solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp');
		expect(evmEntry.explorerTx('0xdead')).toBe('https://basescan.org/tx/0xdead');
		expect(solEntry.explorerTx('sigZ')).toBe('https://solscan.io/tx/sigZ');
	});
});

describe('adapter factory', () => {
	it('returns the correct family adapter and caches', async () => {
		const { getAdapter, _resetAdapters } = await import('../../src/onchain/adapters/index.js');
		_resetAdapters();
		const e1 = getAdapter('evm');
		const e2 = getAdapter('evm');
		expect(e1).toBe(e2);
		expect(e1.family).toBe('evm');

		const s1 = getAdapter('solana');
		expect(s1.family).toBe('solana');
		expect(s1).not.toBe(e1);

		expect(() => getAdapter('cosmos')).toThrow();
	});
});
