import { describe, it, expect, beforeAll } from 'vitest';
import { secp256k1 } from '@noble/curves/secp256k1.js';
import { keccak_256 } from '@noble/hashes/sha3.js';
import { computeAddress } from 'ethers';

/**
 * The EOA vanity grinder worker derives a real keypair: it walks a running
 * secp256k1 point by incremental addition (P += G) and, on a match,
 * reconstructs the private key as (k0 + i) mod n. These tests assert two
 * invariants the worker depends on:
 *
 *   1. The address derived from the running point equals the address that
 *      ethers derives from the reconstructed private key (byte-for-byte).
 *   2. Driving the worker for real produces a key whose address actually
 *      matches the requested prefix and round-trips through ethers.
 */

function deriveAddress(uncompressedPub) {
	return '0x' + Buffer.from(keccak_256(uncompressedPub.slice(1)).slice(-20)).toString('hex');
}

describe('EOA vanity — incremental point addition parity', () => {
	it('running point matches reconstructed private key over many steps', () => {
		const Point = secp256k1.Point;
		const N = Point.Fn.ORDER;

		// Deterministic base scalar so the test is reproducible.
		const k0 = 0x1234567890abcdef1234567890abcdefn % N;
		let pt = Point.BASE.multiply(k0);

		for (let i = 0; i < 50; i++) {
			const addrFromPoint = deriveAddress(pt.toBytes(false));

			const k = (k0 + BigInt(i)) % N;
			const privHex = k.toString(16).padStart(64, '0');
			const priv = Uint8Array.from(privHex.match(/../g).map((b) => parseInt(b, 16)));
			const addrFromKey = deriveAddress(secp256k1.getPublicKey(priv, false));

			expect(addrFromPoint).toBe(addrFromKey);
			// ethers is the independent reference implementation.
			expect(addrFromKey.toLowerCase()).toBe(computeAddress('0x' + privHex).toLowerCase());

			pt = pt.add(Point.BASE);
		}
	});
});

describe('EOA vanity — worker grind end-to-end', () => {
	let matched;

	beforeAll(async () => {
		matched = await new Promise((resolve, reject) => {
			const timer = setTimeout(() => reject(new Error('grind timed out')), 30000);
			// Stub the worker globals so the module runs in the node test env.
			globalThis.self = {
				onmessage: null,
				postMessage(msg) {
					if (msg.type === 'match') {
						clearTimeout(timer);
						resolve(msg);
					} else if (msg.type === 'error') {
						clearTimeout(timer);
						reject(new Error(msg.message));
					}
				},
			};
			import('../../src/eth/vanity/eoa-grinder-worker.js').then(() => {
				// 'ab' is a 2-char case-insensitive prefix → ~1-in-256, finishes fast.
				globalThis.self.onmessage({ data: { type: 'start', prefix: 'ab', suffix: '', caseSensitive: false } });
			});
		});
	}, 35000);

	it('returns an address matching the requested prefix', () => {
		expect(matched.address.slice(2).startsWith('ab')).toBe(true);
	});

	it('returns a private key that derives exactly that address', () => {
		expect(computeAddress(matched.privateKey).toLowerCase()).toBe(matched.address.toLowerCase());
	});

	it('returns a valid EIP-55 checksum for the address', () => {
		expect(matched.addressChecksum.toLowerCase()).toBe(matched.address.toLowerCase());
		expect(computeAddress(matched.privateKey)).toBe(matched.addressChecksum);
	});
});
