// Name-resolution routing for `ens_sns_resolve`: which lane a given input is
// dispatched to, and what a caller sees when no lane can answer.
//
// The lanes themselves are live chain reads (ENS over ETH_RPC_URL, SNS over the
// SPL Name Service accounts on SOLANA_RPC_URL), so this file covers what the
// module decides before any request is made: routing, normalization, the
// shared timeout budget, and the refusal shape. Nothing here mocks a chain.
//
// Run: node --test packages/avatar-agent-mcp/test/ens-sns.test.mjs

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { classifyName, resolveName } from '../src/lib/ens-sns.js';
import { NAME_RESOLVE_TIMEOUT_MS } from '../src/config.js';

test('the shared per-lane timeout leaves room for a cold multi-hop lookup', () => {
	// A cold ENS resolution (registry → resolver → addr) measured ~4.4s against a
	// public RPC, and the SNS resolver adds its own account reads. A low-seconds
	// budget reports "timed out" for names that resolve fine.
	assert.equal(NAME_RESOLVE_TIMEOUT_MS, 15000);
	assert.ok(NAME_RESOLVE_TIMEOUT_MS >= 10000, 'budget must survive a cold public RPC');
});

test('a .eth name routes to ENS only', () => {
	for (const input of ['vitalik.eth', 'sub.domain.eth', 'EXAMPLE.ETH']) {
		const { isEns, isSol } = classifyName(input);
		assert.equal(isEns, true, `${input} should be an ENS name`);
		assert.equal(isSol, false, `${input} must not be dispatched to SNS`);
	}
});

test('a .sol name and a bare label both route to SNS only', () => {
	for (const input of ['bonfida.sol', 'toly.sol', 'bonfida']) {
		const { isEns, isSol } = classifyName(input);
		assert.equal(isSol, true, `${input} should be an SNS name`);
		assert.equal(isEns, false, `${input} must not be dispatched to ENS`);
	}
});

test('classification normalizes case and surrounding whitespace', () => {
	assert.equal(classifyName('  BONFIDA.SOL  ').trimmed, 'bonfida.sol');
	assert.equal(classifyName('  Vitalik.ETH ').trimmed, 'vitalik.eth');
});

test('an unroutable input matches no lane', () => {
	for (const input of ['not a name!!', '', '   ', null, undefined, 'foo.bar']) {
		const { isEns, isSol } = classifyName(input);
		assert.equal(isEns || isSol, false, `${JSON.stringify(input)} should match no lane`);
	}
});

test('an unroutable input is refused without touching a chain', async () => {
	const started = Date.now();
	const out = await resolveName('not a name!!');
	assert.equal(out.ok, false);
	assert.equal(out.error, 'invalid_name');
	assert.ok(Date.now() - started < 1000, 'refusal must not wait on any network call');
});

test('an SNS label longer than 63 characters is declined locally', async () => {
	const started = Date.now();
	const out = await resolveName(`${'a'.repeat(64)}.sol`);
	assert.equal(out.ok, false);
	assert.equal(out.error, 'not_found');
	// The lane ran and rejected the label on shape rather than erroring upstream.
	assert.equal(out.sns, null);
	assert.equal(out.ens, null);
	assert.ok(typeof out.fetchedAt === 'string' && !Number.isNaN(Date.parse(out.fetchedAt)));
	assert.ok(Date.now() - started < 1000, 'an invalid label must not reach the chain');
});

// The SNS lane against the REAL @bonfida/spl-name-service over an in-memory
// RPC that serves registry accounts (tests/helpers/fake-sns-rpc.js). SDK v4
// rejects ".sol" and bare names in resolve() once mainnet passed its TLD cutoff
// slot and renamed getFavoriteDomain / getAllDomains, so in production every
// ens_sns_resolve call for a .sol name failed as an upstream error.
import { Keypair } from '@solana/web3.js';
import { snsResolve, snsFavoriteDomain, snsOwnedDomains } from '../src/lib/ens-sns.js';
import { createFakeSnsRpc } from '../../../tests/helpers/fake-sns-rpc.js';

test('the SNS lane resolves a registered .sol label to its owner', async () => {
	const rpc = createFakeSnsRpc();
	const owner = Keypair.generate().publicKey;
	rpc.register('threews', owner);
	const out = await snsResolve(rpc.connection, 'threews');
	assert.equal(out?.toBase58(), owner.toBase58());
});

test('the SNS lane reports the owner primary domain with a .sol suffix', async () => {
	const rpc = createFakeSnsRpc();
	const owner = Keypair.generate().publicKey;
	rpc.register('threews', owner);
	rpc.setPrimary(owner, 'threews');
	assert.equal(await snsFavoriteDomain(rpc.connection, owner), 'threews.sol');
});

test('the SNS lane lists owned domains without calling a removed SDK export', async () => {
	const rpc = createFakeSnsRpc();
	const owner = Keypair.generate().publicKey;
	assert.deepEqual(await snsOwnedDomains(rpc.connection, owner), []);
});
