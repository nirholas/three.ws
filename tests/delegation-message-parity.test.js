// The owner's browser never imports packages/agent-guards/src/delegation.js
// (it pulls in node:crypto for the signature-verification path, which has no
// browser build). src/agent-wallet-hub/tabs/delegation.js instead carries a
// local copy of delegationMessage() for building the bytes the owner's wallet
// signs. This test is the tripwire that keeps the two in byte-for-byte sync:
// if either format ever drifts, a delegation signed in the browser would fail
// server-side signature verification with no obvious cause.
import { describe, it, expect } from 'vitest';
import { delegationMessage as canonicalDelegationMessage } from '../packages/agent-guards/src/delegation.js';
import { delegationMessage as browserDelegationMessage } from '../src/agent-wallet-hub/tabs/delegation.js';

describe('delegation message format parity (browser tab vs. agent-guards spec)', () => {
	const cases = [
		{
			agent: '11111111111111111111111111111111',
			owner: 'FeMbDoX7R1Psc4GEcvJdsbNbZA3bfztcyDCatJVJpump',
			cap_lamports_per_epoch: '500000000',
			epoch_seconds: '86400',
			not_after: String(Math.floor(Date.now() / 1000) + 30 * 86400),
			nonce: 'a1b2c3d4-e5f6-7890-aaaa-bbbbccccdddd',
		},
		{
			agent: 'So11111111111111111111111111111111111111112',
			owner: 'So11111111111111111111111111111111111111112',
			cap_lamports_per_epoch: '1',
			epoch_seconds: '3600',
			not_after: '0',
			nonce: 'x',
		},
	];

	it('produces byte-identical signing bytes for the same fields', () => {
		for (const d of cases) {
			expect(browserDelegationMessage(d)).toBe(canonicalDelegationMessage(d));
		}
	});

	it('leads with the shared domain tag', () => {
		expect(browserDelegationMessage(cases[0]).split('\n')[0]).toBe('three.ws/agent-spend-delegation/v1');
	});
});
