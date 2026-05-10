import { describe, it, expect } from 'vitest';
import { __test__ } from '../../api/agents/eth-vanity.js';
import { keccak_256 } from '@noble/hashes/sha3';
import { getCreate2Address } from 'ethers';

const { _verifyCreate2 } = __test__;

function bytesToHex(b) { let s=''; for (const x of b) s += x.toString(16).padStart(2,'0'); return s; }

describe('eth vanity · server-side _verifyCreate2', () => {
	it('accepts a correct (deployer, salt, initCodeHash, address)', () => {
		const dep  = '0x4e59b44847b379578588920ca78fbf26c0b4956c';
		const salt = '0x' + '01'.repeat(32);
		const ich  = '0x' + bytesToHex(keccak_256(new Uint8Array([1,2,3])));
		const expected = getCreate2Address(dep, salt, ich).toLowerCase();
		expect(_verifyCreate2(dep, salt, ich, expected)).toBe(true);
	});

	it('rejects an incorrect address', () => {
		const dep  = '0x4e59b44847b379578588920ca78fbf26c0b4956c';
		const salt = '0x' + '01'.repeat(32);
		const ich  = '0x' + '02'.repeat(32);
		// Tamper one nibble
		const correct = getCreate2Address(dep, salt, ich).toLowerCase();
		const tampered = '0x' + (correct[2] === '0' ? 'f' : '0') + correct.slice(3);
		expect(_verifyCreate2(dep, salt, ich, tampered)).toBe(false);
	});

	it('is case-insensitive on the predicted address', () => {
		const dep  = '0x4e59b44847b379578588920ca78fbf26c0b4956c';
		const salt = '0x' + 'ab'.repeat(32);
		const ich  = '0x' + 'cd'.repeat(32);
		const expected = getCreate2Address(dep, salt, ich); // checksummed mixed-case
		expect(_verifyCreate2(dep, salt, ich, expected)).toBe(true);
		expect(_verifyCreate2(dep, salt, ich, expected.toLowerCase())).toBe(true);
		expect(_verifyCreate2(dep, salt, ich, expected.toUpperCase())).toBe(true);
	});
});
