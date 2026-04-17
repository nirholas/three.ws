import { describe, it, expect } from 'vitest';
import { parseSiweMessage } from '../../api/_lib/siwe.js';

const VALID_MSG = [
	'localhost wants you to sign in with your Ethereum account:',
	'0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045',
	'',
	'URI: https://localhost/login',
	'Version: 1',
	'Chain ID: 1',
	'Nonce: abc123xyz',
	'Issued At: 2024-01-01T00:00:00.000Z',
].join('\n');

describe('parseSiweMessage', () => {
	it('parses a valid SIWE message', () => {
		const result = parseSiweMessage(VALID_MSG);
		expect(result).not.toBeNull();
		expect(result.domain).toBe('localhost');
		expect(result.address).toBe('0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045');
		expect(result.uri).toBe('https://localhost/login');
		expect(result.version).toBe('1');
		expect(result.chainId).toBe(1);
		expect(result.nonce).toBe('abc123xyz');
		expect(result.issuedAt).toBe('2024-01-01T00:00:00.000Z');
	});

	it('returns null for message with too few lines', () => {
		expect(parseSiweMessage('line1\nline2')).toBeNull();
	});

	it('returns null for missing URI', () => {
		const msg = [
			'localhost wants you to sign in with your Ethereum account:',
			'0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045',
			'',
			'Version: 1',
			'Nonce: abc123xyz',
		].join('\n');
		expect(parseSiweMessage(msg)).toBeNull();
	});

	it('returns null for missing Nonce', () => {
		const msg = [
			'localhost wants you to sign in with your Ethereum account:',
			'0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045',
			'',
			'URI: https://localhost/login',
			'Version: 1',
		].join('\n');
		expect(parseSiweMessage(msg)).toBeNull();
	});

	it('returns null for missing Version', () => {
		const msg = [
			'localhost wants you to sign in with your Ethereum account:',
			'0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045',
			'',
			'URI: https://localhost/login',
			'Nonce: abc123xyz',
		].join('\n');
		expect(parseSiweMessage(msg)).toBeNull();
	});

	it('returns null for invalid Ethereum address', () => {
		const msg = [
			'localhost wants you to sign in with your Ethereum account:',
			'not-an-address',
			'',
			'URI: https://localhost/login',
			'Version: 1',
			'Nonce: abc123xyz',
		].join('\n');
		expect(parseSiweMessage(msg)).toBeNull();
	});

	it('returns null for malformed header', () => {
		const msg = [
			'bad header line',
			'0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045',
			'',
			'URI: https://localhost/login',
			'Version: 1',
			'Nonce: abc123xyz',
		].join('\n');
		expect(parseSiweMessage(msg)).toBeNull();
	});

	it('parses optional fields when present', () => {
		const msg = [
			'example.com wants you to sign in with your Ethereum account:',
			'0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045',
			'',
			'URI: https://example.com/login',
			'Version: 1',
			'Chain ID: 137',
			'Nonce: nonce42',
			'Issued At: 2024-06-01T12:00:00Z',
			'Expiration Time: 2024-06-01T13:00:00Z',
			'Not Before: 2024-06-01T11:00:00Z',
			'Request ID: req-001',
		].join('\n');
		const result = parseSiweMessage(msg);
		expect(result.chainId).toBe(137);
		expect(result.expirationTime).toBe('2024-06-01T13:00:00Z');
		expect(result.notBefore).toBe('2024-06-01T11:00:00Z');
		expect(result.requestId).toBe('req-001');
	});

	it('handles Chain ID of 0 as null', () => {
		const msg = [
			'localhost wants you to sign in with your Ethereum account:',
			'0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045',
			'',
			'URI: https://localhost/login',
			'Version: 1',
			'Chain ID: 0',
			'Nonce: abc123xyz',
		].join('\n');
		const result = parseSiweMessage(msg);
		// parseInt('0', 10) is 0, which is falsy → null per the parser logic
		expect(result.chainId).toBeNull();
	});
});
