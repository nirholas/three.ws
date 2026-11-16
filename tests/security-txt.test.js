// RFC 9116 validation (scripts/lib/security-txt.mjs) and the shipped
// /.well-known/security.txt itself.

import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { validateSecurityTxt } from '../scripts/lib/security-txt.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const now = new Date('2026-11-16T00:00:00Z');

describe('validateSecurityTxt', () => {
	it('accepts a minimal valid file', () => {
		const body = 'Contact: mailto:security@example.com\nExpires: 2027-06-01T00:00:00.000Z\n';
		expect(validateSecurityTxt(body, { now })).toEqual([]);
	});

	it('requires Contact and exactly one Expires', () => {
		const problems = validateSecurityTxt('# nothing\n', { now });
		expect(problems).toContain('Contact is required');
		expect(problems).toContain('Expires must appear exactly once (found 0)');
	});

	it('rejects an expired or far-future Expires', () => {
		expect(validateSecurityTxt('Contact: mailto:a@b.c\nExpires: 2026-01-01T00:00:00Z', { now })[0]).toMatch(/in the past/);
		expect(validateSecurityTxt('Contact: mailto:a@b.c\nExpires: 2029-01-01T00:00:00Z', { now })[0]).toMatch(/more than a year/);
	});

	it('rejects a non-https Canonical or one for another origin', () => {
		const body = 'Contact: mailto:a@b.c\nExpires: 2027-01-01T00:00:00Z\nCanonical: https://evil.example/.well-known/security.txt';
		expect(validateSecurityTxt(body, { now, origin: 'https://three.ws' })[0]).toMatch(/does not match/);
	});
});

describe('the shipped security.txt', () => {
	it('is valid RFC 9116 for three.ws', () => {
		const body = readFileSync(path.join(ROOT, 'public/.well-known/security.txt'), 'utf8');
		expect(validateSecurityTxt(body, { now: new Date(), origin: 'https://three.ws' })).toEqual([]);
	});
});
