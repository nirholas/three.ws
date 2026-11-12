// Agora deliverable verifier — unit tests for the honest core. The whole trust
// surface rests on these: re-hash the deliverable, compare to the on-chain
// proofHash. We test against real Web Crypto digests and known SHA-256 vectors,
// plus the normalization/compare rules that must never produce a false ✓ or ✗.

import { describe, it, expect } from 'vitest';
import { createHash } from 'node:crypto';
import { sha256Hex, compareHash, VerifyError } from '../src/agora/verify.js';
import { normalizeHex, formatThree, shortId, formatBytes } from '../src/agora/format.js';

const enc = (s) => new TextEncoder().encode(s);

describe('sha256Hex', () => {
	it('matches the canonical SHA-256 vector for "abc"', async () => {
		expect(await sha256Hex(enc('abc'))).toBe(
			'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad',
		);
	});

	it('matches the empty-input vector', async () => {
		expect(await sha256Hex(new Uint8Array(0))).toBe(
			'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
		);
	});

	it('agrees with node crypto over random-ish bytes', async () => {
		const bytes = Uint8Array.from({ length: 5000 }, (_, i) => (i * 37 + 11) & 0xff);
		const expected = createHash('sha256').update(Buffer.from(bytes)).digest('hex');
		expect(await sha256Hex(bytes)).toBe(expected);
	});

	it('hashes only the view range, not the backing buffer', async () => {
		const backing = new Uint8Array([9, 9, 1, 2, 3, 9, 9]);
		const view = backing.subarray(2, 5); // [1,2,3]
		const expected = createHash('sha256').update(Buffer.from([1, 2, 3])).digest('hex');
		expect(await sha256Hex(view)).toBe(expected);
	});
});

describe('compareHash', () => {
	it('matches identical hashes', () => {
		const r = compareHash('abc123', 'abc123');
		expect(r.match).toBe(true);
		expect(r.haveExpected).toBe(true);
	});

	it('ignores 0x prefix and case', () => {
		const r = compareHash('0xABC123', 'abc123');
		expect(r.match).toBe(true);
		expect(r.computed).toBe('abc123');
		expect(r.expected).toBe('abc123');
	});

	it('reports a mismatch when bytes differ (the tamper case)', () => {
		const r = compareHash('deadbeef', 'feedface');
		expect(r.match).toBe(false);
	});

	it('never claims a match when there is no on-chain proofHash', () => {
		const r = compareHash('deadbeef', '');
		expect(r.match).toBe(false);
		expect(r.haveExpected).toBe(false);
	});

	it('never claims a match for an empty computed hash', () => {
		const r = compareHash('', 'deadbeef');
		expect(r.match).toBe(false);
	});

	it('end-to-end: a real digest matches its own proofHash and a tampered copy does not', async () => {
		const good = enc('a verified forge GLB, byte-for-byte');
		const proof = await sha256Hex(good);
		expect(compareHash(await sha256Hex(good), proof).match).toBe(true);

		const tampered = enc('a verified forge GLB, byte-for-bytX'); // one byte changed
		expect(compareHash(await sha256Hex(tampered), proof).match).toBe(false);
	});
});

describe('VerifyError', () => {
	it('carries a code for honest UI messaging', () => {
		const e = new VerifyError('cors', 'blocked');
		expect(e).toBeInstanceOf(Error);
		expect(e.code).toBe('cors');
		expect(e.name).toBe('VerifyError');
	});
});

describe('format helpers', () => {
	it('normalizeHex strips 0x and lowercases', () => {
		expect(normalizeHex('0xDEADbeef')).toBe('deadbeef');
		expect(normalizeHex(null)).toBe('');
	});

	it('formatThree renders 6-decimal atomic $THREE amounts', () => {
		expect(formatThree('25000000000')).toBe('25,000');
		expect(formatThree('0')).toBe('0');
		expect(formatThree('1500000')).toBe('1.5');
	});

	it('shortId truncates long ids and leaves short ones', () => {
		expect(shortId('FeMbDoX7R1Psc4GEcvJdsbNbZA3bfztcyDCatJVJpump')).toBe('FeMb…pump');
		expect(shortId('abc')).toBe('abc');
	});

	it('formatBytes is human-readable', () => {
		expect(formatBytes(512)).toBe('512 B');
		expect(formatBytes(1536)).toBe('1.5 KB');
	});
});

import { parseDioramaDeliverable } from '../src/agora/verify.js';
describe('parseDioramaDeliverable', () => {
	const enc = (o) => new TextEncoder().encode(JSON.stringify(o));
	const plan = { title: 'Harbor', mood: 'dusk', objects: [{ label: 'boat', prompt: 'a boat', position: [1, 0, 2] }] };
	const id = '123e4567-e89b-42d3-a456-426614174000';
	it('reads a map and keeps a well-formed permalink', () => {
		const m = parseDioramaDeliverable(enc({ kind: 'agora.diorama.v1', prompt: 'p', diorama: plan, permalink: `https://three.ws/diorama?id=${id}` }));
		expect(m.title).toBe('Harbor');
		expect(m.permalink).toBe(`https://three.ws/diorama?id=${id}`);
	});
	it('drops a hostile permalink and rejects non-map bytes', () => {
		const m = parseDioramaDeliverable(enc({ kind: 'agora.diorama.v1', diorama: plan, permalink: 'javascript:alert(1)' }));
		expect(m.permalink).toBeNull();
		expect(parseDioramaDeliverable(enc({ kind: 'other' }))).toBeNull();
		expect(parseDioramaDeliverable(new Uint8Array([1, 2, 3]))).toBeNull();
	});
});
