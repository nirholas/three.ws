import { describe, it, expect } from 'vitest';

// Regression for the outage that took /play/agent-wallet down end to end: the
// hosted bridge treated `extra.feePayer` as an admission test, so the moment
// three.ws's own paid endpoints started advertising SELF-PAY accepts (which
// x402-paid-endpoint.js does whenever the sponsor wallet cannot co-sign), the
// bridge found no payable accept, answered every ?quote=1 with a 502, and the
// page never got past its connecting state. A fee payer picks the SIGNING MODE;
// it does not decide whether an accept is payable.

const { isSolanaExactAccept, pickSolanaAccept } = await import('../api/agent-wallet-bridge.js');

const SOLANA = 'solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp';
const USDC = 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v';
const THREE = 'FeMbDoX7R1Psc4GEcvJdsbNbZA3bfztcyDCatJVJpump';

const sponsoredUsdc = {
	scheme: 'exact', network: SOLANA, asset: USDC, amount: '10000',
	payTo: 'wwwwwDxFWRn7grgr3Esrsg5C6NvDoDHSA4gaCffccrU',
	extra: { name: 'USDC', decimals: 6, feePayer: 'WwwuGbqHrwF5RG89KhUbmRWEvjnRH9k5kVM5p7T3WwW' },
};
const selfPayUsdc = {
	scheme: 'exact', network: SOLANA, asset: USDC, amount: '10000',
	payTo: 'wwwwwDxFWRn7grgr3Esrsg5C6NvDoDHSA4gaCffccrU',
	extra: { name: 'USDC', decimals: 6 },
};
const selfPayThree = {
	scheme: 'exact', network: SOLANA, asset: THREE, amount: '10000000',
	payTo: 'wwwwwDxFWRn7grgr3Esrsg5C6NvDoDHSA4gaCffccrU',
	extra: { name: 'THREE', decimals: 6 },
};
const base = {
	scheme: 'exact', network: 'eip155:8453', asset: '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913',
	amount: '10000', payTo: '0x4022de2d36c334e73c7a108805cea11c0564f402',
	extra: { name: 'USD Coin', version: '2', decimals: 6 },
};

describe('agent-wallet bridge accept selection', () => {
	it('accepts a sponsored Solana exact entry', () => {
		expect(isSolanaExactAccept(sponsoredUsdc)).toBe(true);
	});

	it('accepts a self-pay Solana exact entry (no advertised fee payer)', () => {
		expect(isSolanaExactAccept(selfPayUsdc)).toBe(true);
	});

	it('rejects non-Solana and non-exact entries', () => {
		expect(isSolanaExactAccept(base)).toBe(false);
		expect(isSolanaExactAccept({ ...selfPayUsdc, scheme: 'upto' })).toBe(false);
		expect(isSolanaExactAccept(null)).toBe(false);
		expect(isSolanaExactAccept({})).toBe(false);
	});

	it('picks USDC over the platform token even when USDC comes second', () => {
		expect(pickSolanaAccept([selfPayThree, selfPayUsdc])).toBe(selfPayUsdc);
	});

	it('picks the self-pay USDC entry out of a mixed real-world challenge', () => {
		expect(pickSolanaAccept([selfPayUsdc, selfPayThree, base])).toBe(selfPayUsdc);
	});

	it('returns null when nothing on Solana is payable', () => {
		expect(pickSolanaAccept([base])).toBeNull();
		expect(pickSolanaAccept([])).toBeNull();
	});
});
