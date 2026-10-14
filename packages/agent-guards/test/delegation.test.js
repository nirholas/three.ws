import { test } from 'node:test';
import assert from 'node:assert/strict';
import { generateKeyPairSync, sign as cryptoSign } from 'node:crypto';
import {
	DELEGATION_DOMAIN,
	delegationMessage,
	verifyDelegationSignature,
	checkDelegationCap,
} from '../src/delegation.js';

// Real Ed25519 keypairs end to end, no stubs, no mocked crypto. Mirrors how
// an actual Solana wallet (Phantom, Backpack, a hardware signer) would sign
// the exact bytes `delegationMessage` produces.

const B58 = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';
function b58encode(buf) {
	let num = 0n;
	for (const b of buf) num = num * 256n + BigInt(b);
	let out = '';
	while (num > 0n) {
		out = B58[Number(num % 58n)] + out;
		num /= 58n;
	}
	let leadingZeros = 0;
	for (const b of buf) {
		if (b === 0) leadingZeros++;
		else break;
	}
	return B58[0].repeat(leadingZeros) + (out || '');
}

function makeSigner() {
	const { publicKey, privateKey } = generateKeyPairSync('ed25519');
	const raw = publicKey.export({ type: 'spki', format: 'der' }).subarray(-32);
	return { address: b58encode(raw), sign: (msg) => cryptoSign(null, Buffer.from(msg, 'utf8'), privateKey) };
}

function baseDelegation(owner, overrides = {}) {
	return {
		agent: 'THREEsynthetic1111111111111111111111111111',
		owner,
		cap_lamports_per_epoch: '1000000000', // 1 SOL per epoch
		epoch_seconds: '86400',
		not_after: String(Math.floor(Date.now() / 1000) + 3600),
		nonce: 'nonce-' + Math.random().toString(36).slice(2),
		...overrides,
	};
}

test('delegationMessage is domain-separated and field-ordered', () => {
	const owner = makeSigner();
	const d = baseDelegation(owner.address, { nonce: 'fixed-nonce' });
	const msg = delegationMessage(d);
	assert.equal(msg.split('\n')[0], DELEGATION_DOMAIN);
	assert.deepEqual(msg.split('\n').slice(1), [
		`agent: ${d.agent}`,
		`owner: ${d.owner}`,
		`cap_lamports_per_epoch: ${d.cap_lamports_per_epoch}`,
		`epoch_seconds: ${d.epoch_seconds}`,
		`not_after: ${d.not_after}`,
		`nonce: fixed-nonce`,
	]);
});

test('verifyDelegationSignature accepts a real signature from the claimed owner', () => {
	const owner = makeSigner();
	const d = baseDelegation(owner.address);
	const sig = owner.sign(delegationMessage(d)).toString('base64');
	assert.equal(verifyDelegationSignature(d, sig), true);
});

test('verifyDelegationSignature rejects a wrong signer (signature from a different key)', () => {
	const owner = makeSigner();
	const impostor = makeSigner();
	const d = baseDelegation(owner.address); // claims to be `owner`...
	const sig = impostor.sign(delegationMessage(d)).toString('base64'); // ...but signed by someone else
	assert.equal(verifyDelegationSignature(d, sig), false);
});

test('verifyDelegationSignature rejects a tampered field (signature no longer matches the message)', () => {
	const owner = makeSigner();
	const d = baseDelegation(owner.address);
	const sig = owner.sign(delegationMessage(d)).toString('base64');
	const tampered = { ...d, cap_lamports_per_epoch: String(BigInt(d.cap_lamports_per_epoch) * 100n) };
	assert.equal(verifyDelegationSignature(tampered, sig), false);
});

test('checkDelegationCap allows a debit within the remaining epoch headroom', () => {
	const d = baseDelegation('owner-address-placeholder');
	const out = checkDelegationCap({ delegation: d, epochSpentLamports: 0n, debitLamports: 500_000_000n });
	assert.equal(out.allow, true);
});

test('checkDelegationCap rejects a debit measured from realized spend that would exceed the cap', () => {
	const d = baseDelegation('owner-address-placeholder');
	// Already spent 900M lamports (realized, from the ledger) this epoch; a further
	// 500M debit would land the epoch total at 1.4B against a 1B cap.
	const out = checkDelegationCap({ delegation: d, epochSpentLamports: 900_000_000n, debitLamports: 500_000_000n });
	assert.equal(out.allow, false);
	assert.equal(out.code, 'DELEGATION_CAP_EXCEEDED');
});

test('checkDelegationCap rejects once not_after has passed', () => {
	const d = baseDelegation('owner-address-placeholder', { not_after: String(Math.floor(Date.now() / 1000) - 10) });
	const out = checkDelegationCap({ delegation: d, epochSpentLamports: 0n, debitLamports: 1n });
	assert.equal(out.allow, false);
	assert.equal(out.code, 'DELEGATION_EXPIRED');
});

test('canonicalDelegationFields requires every field', async () => {
	const { canonicalDelegationFields } = await import('../src/delegation.js');
	assert.throws(() => canonicalDelegationFields({ agent: 'a' }), TypeError);
});
