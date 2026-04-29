import { describe, it, expect } from 'vitest';
import { generateVanityKey } from '../src/pump/vanity-keygen.js';

describe('generateVanityKey', () => {
	it('returns a key whose base58 address ends with the requested suffix', async () => {
		const result = await generateVanityKey({ suffix: 'a' });
		expect(result).not.toBeNull();
		expect(result.publicKey.toLowerCase()).toMatch(/a$/);
		expect(result.attempts).toBeGreaterThan(0);
		expect(result.ms).toBeGreaterThanOrEqual(0);
		expect(result.secretKey).toBeInstanceOf(Uint8Array);
		expect(result.secretKey).toHaveLength(64);
	});

	it('returns a key whose base58 address starts with the requested prefix', async () => {
		const result = await generateVanityKey({ prefix: 'a' });
		expect(result).not.toBeNull();
		expect(result.publicKey.toLowerCase()).toMatch(/^a/);
	});

	it('respects caseSensitive flag for suffix', async () => {
		// Generate without case sensitivity, then verify the address ends with suffix
		// in a case-insensitive comparison.
		const result = await generateVanityKey({ suffix: 'A', caseSensitive: false });
		expect(result).not.toBeNull();
		expect(result.publicKey.toLowerCase()).toMatch(/a$/);
	});

	it('returns null when maxAttempts is 0', async () => {
		const result = await generateVanityKey({ suffix: 'zzz', maxAttempts: 0 });
		expect(result).toBeNull();
	});

	it('throws when neither suffix nor prefix is provided', async () => {
		await expect(generateVanityKey({})).rejects.toThrow();
	});

	it('respects abort signal', async () => {
		const ac = new AbortController();
		ac.abort();
		const result = await generateVanityKey({ suffix: 'a', signal: ac.signal });
		expect(result).toBeNull();
	});
});
