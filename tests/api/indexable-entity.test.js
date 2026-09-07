// A third of the public agents on three.ws are onboarding rows nobody edited:
// same name, same description, different uuid. They are duplicates of each
// other by construction, so they stay out of the sitemap and their crawler page
// is served noindex. This is the predicate that decides, and it is shared by
// both so the two can never disagree.

import { describe, it, expect } from 'vitest';
import { isIndexableAgent, isIndexableAvatar } from '../../api/_lib/indexable-entity.js';

// The exact copy onboarding writes, escaped so the dash glyph the database
// stores does not have to be typed into this repo.
const STARTER =
	'A friendly starter agent. Edit the personality and attach a 3D avatar \u2014 it goes live immediately.';

describe('isIndexableAgent', () => {
	it('rejects the untouched onboarding row', () => {
		expect(isIndexableAgent({ name: 'My First Agent', description: STARTER })).toBe(false);
		expect(isIndexableAgent({ name: 'my first agent', description: STARTER })).toBe(false);
		expect(isIndexableAgent({ name: '  My  First   Agent ', description: STARTER })).toBe(false);
		expect(isIndexableAgent({ name: 'My First Agent', description: null })).toBe(false);
		expect(isIndexableAgent({ name: 'Untitled Agent', description: '' })).toBe(false);
	});

	it('accepts a row where the owner supplied either half', () => {
		expect(isIndexableAgent({ name: 'Atlas', description: STARTER })).toBe(true);
		expect(isIndexableAgent({ name: 'My First Agent', description: 'Reads Solana mempools.' })).toBe(
			true,
		);
		expect(isIndexableAgent({ name: 'Atlas', description: 'Reads Solana mempools.' })).toBe(true);
	});

	it('rejects a row with no name at all', () => {
		expect(isIndexableAgent({ name: '', description: 'Something real.' })).toBe(false);
		expect(isIndexableAgent({ name: null, description: 'Something real.' })).toBe(false);
		expect(isIndexableAgent({})).toBe(false);
		expect(isIndexableAgent(null)).toBe(false);
	});
});

describe('isIndexableAvatar', () => {
	it('keeps a generated avatar: the description and tags still tell it apart', () => {
		expect(
			isIndexableAvatar({
				name: 'Shaw',
				description: 'Rigged, walk-ready avatar, forged on three.ws.',
			}),
		).toBe(true);
		// A distinctive name is enough on its own.
		expect(isIndexableAvatar({ name: 'Roman Legionary', description: null })).toBe(true);
	});

	it('rejects a default name with nothing written about it', () => {
		expect(isIndexableAvatar({ name: 'My First Agent', description: null, alt_text: null })).toBe(
			false,
		);
		expect(isIndexableAvatar({ name: 'Avatar', description: '', alt_text: '' })).toBe(false);
		expect(isIndexableAvatar({ name: 'Untitled', description: null })).toBe(false);
	});

	it('accepts a default name once someone describes it', () => {
		expect(isIndexableAvatar({ name: 'Avatar', description: 'My studio mascot.' })).toBe(true);
		expect(isIndexableAvatar({ name: 'Avatar', alt_text: 'A chrome fox in a raincoat.' })).toBe(true);
	});
});
