// Pure helpers behind the /create-agent template gallery: search, tag ranking
// and how a chosen template merges into what the user already typed.

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { searchTemplates, topTags, fillFromTemplate } from '../src/create-agent-templates.js';

const { templates } = JSON.parse(
	readFileSync(join(import.meta.dirname, '..', 'data/agent-templates.json'), 'utf8'),
);

describe('searchTemplates', () => {
	it('returns the whole catalog for an empty query', () => {
		expect(searchTemplates(templates)).toHaveLength(templates.length);
		expect(searchTemplates(templates, '   ')).toHaveLength(templates.length);
	});

	it('matches every word, case-insensitively, across name, tagline, tags and tools', () => {
		const hits = searchTemplates(templates, 'WHALE');
		expect(hits.length).toBeGreaterThan(0);
		expect(hits.map((t) => t.id)).toContain('whale-watcher');
		expect(searchTemplates(templates, 'whale zzzznomatch')).toEqual([]);
	});

	it('narrows by tag and combines with the query', () => {
		const tag = templates[0].tags[0];
		const tagged = searchTemplates(templates, '', tag);
		expect(tagged.length).toBeGreaterThan(0);
		for (const t of tagged) expect(t.tags).toContain(tag);
		expect(searchTemplates(templates, templates[0].name, tag).map((t) => t.id)).toContain(
			templates[0].id,
		);
	});
});

describe('topTags', () => {
	it('ranks by frequency, skips the excluded tag and honours the limit', () => {
		const tags = topTags(templates, 5);
		expect(tags).toHaveLength(5);
		expect(tags).not.toContain('solana');
		expect(topTags(templates, 100, [])).toContain('solana');
	});
});

describe('fillFromTemplate', () => {
	const t = templates[0];
	const base = { name: '', description: '', tags: [], skills: new Set(['chat']) };

	it('fills everything on an empty form', () => {
		const out = fillFromTemplate(t, base);
		expect(out.name).toBe(t.name);
		expect(out.description).toBe(t.tagline);
		expect(out.persona).toBe(t.persona);
		expect(out.greeting).toBe(t.greeting);
		expect(out.category).toBe('finance');
		expect(out.tags).toEqual(t.tags);
		for (const s of t.skills) expect(out.skills.has(s)).toBe(true);
		expect(out.skills.has('chat')).toBe(true);
	});

	it('keeps the name and description the user already wrote, merges tags up to 8', () => {
		const out = fillFromTemplate(t, {
			...base,
			name: 'My Agent',
			description: 'Mine',
			tags: ['a', 'b', 'c', 'd', 'e', 'f', 'g'],
		});
		expect(out.name).toBe('My Agent');
		expect(out.description).toBe('Mine');
		expect(out.tags).toHaveLength(8);
		expect(out.tags.slice(0, 7)).toEqual(['a', 'b', 'c', 'd', 'e', 'f', 'g']);
	});

	it('does not mutate the current state', () => {
		const current = { ...base, tags: ['x'], skills: new Set(['chat']) };
		fillFromTemplate(t, current);
		expect(current.tags).toEqual(['x']);
		expect([...current.skills]).toEqual(['chat']);
	});
});
