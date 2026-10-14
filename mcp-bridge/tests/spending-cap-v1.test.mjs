// Regression test: buildSpendingCapHook must enforce the per-call cap against
// a v1 x402 requirement too, not just v2.
//
// v2 requirements name the price `amount`; v1 requirements (the wire format
// most of the open x402 bazaar and the owner's x402-suite still speak) name
// it `maxAmountRequired`. Before this fix the hook only ever read
// `selectedRequirements?.amount`, which is `undefined` on a v1 requirement:
// `BigInt(undefined ?? '0')` silently resolved to 0, so a v1 payment of ANY
// size passed the per-call and session caps for free. This is a real
// spend-cap bypass once v1 sellers are registered, not a cosmetic bug.
//
// All addresses/assets are clearly-synthetic placeholders, no real mints or
// wallets appear in fixtures.

import test from 'node:test';
import assert from 'node:assert/strict';

import { buildSpendingCapHook } from '../src/x402-axios-client.js';

const SYNTH_ASSET_SOLANA = 'THREEsynthetic1111111111111111111111111111';
const SYNTH_PAYEE_SOLANA = 'THREEsynthetic2222222222222222222222222222';

async function withEnv(overrides, fn) {
	const saved = {};
	for (const k of Object.keys(overrides)) {
		saved[k] = process.env[k];
		if (overrides[k] === undefined) delete process.env[k];
		else process.env[k] = overrides[k];
	}
	try {
		return await fn();
	} finally {
		for (const k of Object.keys(overrides)) {
			if (saved[k] === undefined) delete process.env[k];
			else process.env[k] = saved[k];
		}
	}
}

const BASE_ENV = {
	MCP_BRIDGE_MAX_PRICE_PER_CALL_ATOMIC: undefined,
	MCP_BRIDGE_MAX_TOTAL_ATOMIC: undefined,
	MCP_BRIDGE_ALLOWED_PAYTO: undefined,
};

test('spending-cap hook: v1 requirements (maxAmountRequired) are capped like v2', async () => {
	await withEnv(BASE_ENV, async () => {
		const hook = buildSpendingCapHook();
		// A v1-shaped selected requirement: flat network string, no `amount`
		// field at all, price carried in `maxAmountRequired` instead. Far above
		// the default $0.10 per-call cap (100_000 atomic).
		const verdict = await hook({
			selectedRequirements: {
				scheme: 'exact',
				network: 'solana',
				maxAmountRequired: '5000000',
				asset: SYNTH_ASSET_SOLANA,
				payTo: SYNTH_PAYEE_SOLANA,
			},
		});
		assert.equal(verdict?.abort, true, 'an over-cap v1 payment must be refused, not silently treated as free');
		assert.match(verdict.reason, /exceeds per-call cap/);
	});
});

test('spending-cap hook: a v1 requirement within cap is still accepted', async () => {
	await withEnv(BASE_ENV, async () => {
		const hook = buildSpendingCapHook();
		const verdict = await hook({
			selectedRequirements: {
				scheme: 'exact',
				network: 'solana',
				maxAmountRequired: '1000',
				asset: SYNTH_ASSET_SOLANA,
				payTo: SYNTH_PAYEE_SOLANA,
			},
		});
		assert.equal(verdict, undefined, 'an in-cap v1 payment must be allowed');
	});
});
