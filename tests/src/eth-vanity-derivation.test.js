import { describe, it, expect } from 'vitest';
import { keccak_256 } from '@noble/hashes/sha3';
import { getCreate2Address } from 'ethers';
import { eip55Checksum } from '../../src/eth/vanity/validation.js';

/**
 * The grinder worker's derivation must equal ethers.getCreate2Address.
 * We re-implement the worker's hot loop in JS here (without spawning a
 * Web Worker) and assert byte-for-byte parity over many random inputs.
 */

function hexToBytes(hex) {
	const h = hex.startsWith('0x') ? hex.slice(2) : hex;
	const out = new Uint8Array(h.length / 2);
	for (let i = 0; i < out.length; i++) out[i] = parseInt(h.substring(i * 2, i * 2 + 2), 16);
	return out;
}
function bytesToHex(b) {
	let s = ''; for (let i = 0; i < b.length; i++) s += b[i].toString(16).padStart(2, '0');
	return s;
}
function deriveCreate2(deployer, salt, initCodeHash) {
	const buf = new Uint8Array(85);
	buf[0] = 0xff;
	buf.set(hexToBytes(deployer), 1);
	buf.set(hexToBytes(salt), 21);
	buf.set(hexToBytes(initCodeHash), 53);
	return '0x' + bytesToHex(keccak_256(buf).subarray(12));
}

function randomHex(byteLen) {
	const b = new Uint8Array(byteLen);
	crypto.getRandomValues(b);
	return '0x' + bytesToHex(b);
}

describe('eth vanity · CREATE2 derivation parity with ethers', () => {
	it('matches ethers.getCreate2Address across 25 random inputs', () => {
		for (let i = 0; i < 25; i++) {
			const dep  = randomHex(20);
			const salt = randomHex(32);
			const ich  = randomHex(32);
			const ours = deriveCreate2(dep, salt, ich);
			const eth  = getCreate2Address(dep, salt, ich).toLowerCase();
			expect(ours).toBe(eth);
		}
	});

	it('produces a known fixture', () => {
		// Arachnid proxy + zero salt + zero initCodeHash.
		const dep  = '0x4e59b44847b379578588920ca78fbf26c0b4956c';
		const salt = '0x' + '00'.repeat(32);
		const ich  = '0x' + '00'.repeat(32);
		const ours = deriveCreate2(dep, salt, ich);
		const eth  = getCreate2Address(dep, salt, ich).toLowerCase();
		expect(ours).toBe(eth);
	});

	it('eip55Checksum of a derived address matches ethers.getCreate2Address (mixed case)', () => {
		const dep  = randomHex(20);
		const salt = randomHex(32);
		const ich  = randomHex(32);
		const lower = deriveCreate2(dep, salt, ich).slice(2);
		const ours = '0x' + eip55Checksum(lower);
		const eth  = getCreate2Address(dep, salt, ich); // ethers returns checksummed
		expect(ours).toBe(eth);
	});
});
