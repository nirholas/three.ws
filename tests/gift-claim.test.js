import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { claimErrorMessage } from '../src/shared/gift-claim.js';

describe('gift claim card', () => {
	it('maps every claim failure to an actionable message', () => {
		expect(claimErrorMessage(401)).toMatch(/sign in/i);
		expect(claimErrorMessage(409)).toMatch(/not opened/i);
		expect(claimErrorMessage(410)).toMatch(/closed/i);
		expect(claimErrorMessage(429)).toMatch(/wait/i);
		expect(claimErrorMessage(500, { error_description: 'db down' })).toBe('db down');
		expect(claimErrorMessage(0, null)).toMatch(/try again/i);
	});

	it('is mounted on settings, classic home and play', () => {
		expect(readFileSync('public/settings/index.html', 'utf8')).toContain('gift-claim.js');
		expect(readFileSync('pages/home.html', 'utf8')).toContain('/src/home-gifts.js');
		expect(readFileSync('pages/play.html', 'utf8')).toContain('/src/game/gift-claim-play.js');
	});
});

describe('easter eggs', () => {
	it('ships as valid standalone JS and is injected by the build', () => {
		const src = readFileSync('public/easter-eggs.js', 'utf8');
		expect(() => new Function(src)).not.toThrow();
		expect(readFileSync('vite.config.js', 'utf8')).toContain('withEasterEggs(next)');
	});
});
