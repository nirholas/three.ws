/**
 * Self-check for src/permissions/toolkit.js — pure functions only, no network.
 * Usage: node scripts/test-toolkit.js
 */

import assert from 'assert';
import { CAVEAT_ENFORCERS } from '../src/erc7710/abi.js';
import {
	delegationToManifestEntry,
	encodeScopedDelegation,
	PermissionError,
} from '../src/permissions/toolkit.js';

const CHAIN_ID  = 84532; // Base Sepolia
const DELEGATOR = '0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266'; // EIP-55 checksummed
const DELEGATE  = '0x70997970C51812dc3A010C7d01b50e0d17dc79C8';
const EXPIRY    = Math.floor(Date.now() / 1000) + 3600; // 1 hour from now

// CAVEAT_ENFORCERS is keyed enforcer → { chainId → address }
const caveats = [
	{
		enforcer: CAVEAT_ENFORCERS.AllowedTargetsEnforcer[CHAIN_ID],
		terms:    '0x000000000000000000000000' + DELEGATE.slice(2).toLowerCase(),
		args:     '0x',
	},
];

// ─── encodeScopedDelegation: happy path ──────────────────────────────────────

const delegation = encodeScopedDelegation({ delegator: DELEGATOR, delegate: DELEGATE, caveats, expiry: EXPIRY, chainId: CHAIN_ID });

assert.strictEqual(delegation.delegate,  DELEGATE,  'delegate address');
assert.strictEqual(delegation.delegator, DELEGATOR, 'delegator address');
assert.strictEqual(
	delegation.authority,
	'0xffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff',
	'ROOT_AUTHORITY',
);
assert.strictEqual(typeof delegation.salt,    'bigint', 'salt is bigint');
assert.strictEqual(delegation.caveats.length, 1,       'one caveat');
assert.strictEqual(delegation.caveats[0].args, '0x',   'args default');
assert.strictEqual(delegation.chainId, CHAIN_ID,       'chainId');
console.log('✓ encodeScopedDelegation — happy path');

// ─── encodeScopedDelegation: non-checksummed input is accepted + checksummed ─

const lower = encodeScopedDelegation({
	delegator: DELEGATOR.toLowerCase(),
	delegate:  DELEGATE.toLowerCase(),
	caveats,
	expiry:    EXPIRY,
	chainId:   CHAIN_ID,
});
assert.strictEqual(lower.delegator, DELEGATOR, 'delegator auto-checksummed');
assert.strictEqual(lower.delegate,  DELEGATE,  'delegate auto-checksummed');
console.log('✓ encodeScopedDelegation — address checksumming');

// ─── encodeScopedDelegation: error cases ─────────────────────────────────────

assert.throws(
	() => encodeScopedDelegation({ delegator: DELEGATOR, delegate: DELEGATOR, caveats, expiry: EXPIRY, chainId: CHAIN_ID }),
	(e) => e instanceof PermissionError && e.code === 'signature_invalid',
	'delegate === delegator must throw signature_invalid',
);

assert.throws(
	() => encodeScopedDelegation({ delegator: DELEGATOR, delegate: DELEGATE, caveats: [], expiry: EXPIRY, chainId: CHAIN_ID }),
	(e) => e instanceof PermissionError,
	'empty caveats must throw',
);

assert.throws(
	() => encodeScopedDelegation({ delegator: DELEGATOR, delegate: DELEGATE, caveats, expiry: Math.floor(Date.now() / 1000) + 30, chainId: CHAIN_ID }),
	(e) => e instanceof PermissionError && e.code === 'delegation_expired',
	'near-future expiry must throw delegation_expired',
);

assert.throws(
	() => encodeScopedDelegation({ delegator: DELEGATOR, delegate: DELEGATE, caveats, expiry: EXPIRY, chainId: 999999 }),
	(e) => e instanceof PermissionError && e.code === 'chain_not_supported',
	'unsupported chain (999999) must throw chain_not_supported',
);

assert.throws(
	() => encodeScopedDelegation({ delegator: 'not-an-address', delegate: DELEGATE, caveats, expiry: EXPIRY, chainId: CHAIN_ID }),
	(e) => e instanceof PermissionError && e.code === 'signature_invalid',
	'invalid address must throw signature_invalid',
);
console.log('✓ encodeScopedDelegation — error cases');

// ─── delegationToManifestEntry: with full scope ───────────────────────────────

const signed = {
	...delegation,
	signature: '0x' + 'ab'.repeat(65),
	hash:      '0x' + 'cd'.repeat(32),
	uri:       'ipfs://bafybeigdyrzt5sfp7udm7hu76uh7y26nf3efuylqabf3oclgtqy55fbzdi',
	scope: {
		token:     '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48',
		maxAmount: '1000000',
		period:    'daily',
		targets:   [DELEGATE],
		expiry:    EXPIRY,
	},
};

const entry = delegationToManifestEntry(signed);
assert.strictEqual(entry.chainId,         CHAIN_ID,       'entry.chainId');
assert.strictEqual(entry.delegator,       DELEGATOR,      'entry.delegator');
assert.strictEqual(entry.delegate,        DELEGATE,       'entry.delegate');
assert.strictEqual(entry.hash,            signed.hash,    'entry.hash');
assert.strictEqual(entry.uri,             signed.uri,     'entry.uri');
assert.strictEqual(entry.scope.token,     signed.scope.token, 'entry.scope.token');
assert.strictEqual(entry.scope.maxAmount, '1000000',      'entry.scope.maxAmount');
assert.strictEqual(entry.scope.period,    'daily',        'entry.scope.period');
assert.deepStrictEqual(entry.scope.targets, [DELEGATE],   'entry.scope.targets');
assert.strictEqual(entry.scope.expiry,    EXPIRY,         'entry.scope.expiry');
// signature must NOT be in the manifest entry
assert.strictEqual('signature' in entry, false, 'signature must not appear in manifest entry');
console.log('✓ delegationToManifestEntry — with scope');

// ─── delegationToManifestEntry: without scope (defaults) ─────────────────────

const noScope = delegationToManifestEntry({ ...signed, scope: undefined, uri: undefined });
assert.ok(noScope.scope,                          'default scope present');
assert.strictEqual(noScope.scope.token, 'native', 'default token = native');
assert.strictEqual(noScope.scope.period, 'once',  'default period = once');
assert.strictEqual('uri' in noScope, false,       'no uri when not provided');
console.log('✓ delegationToManifestEntry — defaults');

// ─── PermissionError shape ────────────────────────────────────────────────────

const err = new PermissionError('delegation_revoked', 'test revoke');
assert.ok(err instanceof Error,          'is Error');
assert.ok(err instanceof PermissionError, 'is PermissionError');
assert.strictEqual(err.code,    'delegation_revoked', 'err.code');
assert.strictEqual(err.name,    'PermissionError',    'err.name');
assert.strictEqual(err.message, 'test revoke',        'err.message');
console.log('✓ PermissionError shape');

console.log('\nAll tests passed.');
