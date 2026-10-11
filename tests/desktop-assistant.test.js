import { describe, it, expect } from 'vitest';
import { HISTORY_MAX, SUGGESTIONS, THREE_CA, hidePartialTag, parseActions, renderMarkdown, systemPrompt, trimHistory } from '../src/desktop/assistant/logic.js';
import { ALL_APPS } from '../src/desktop/apps.js';

describe('assistant prompt', () => {
	it('fits the API limit with the full app list and names $THREE', () => {
		const p = systemPrompt(ALL_APPS);
		expect(p.length).toBeLessThanOrEqual(2000);
		expect(p).toContain(THREE_CA);
		expect(p).toContain('create: Create');
		expect(p.endsWith('Do not use any other app id.')).toBe(true);
	});
	it('drops apps rather than overflow', () => {
		const many = Array.from({ length: 200 }, (_, i) => ({ id: `app${i}`, title: `App ${i}`, desc: 'x'.repeat(40) }));
		const p = systemPrompt(many);
		expect(p.length).toBeLessThanOrEqual(2000);
		expect(p).toContain('app0: App 0');
		expect(p).not.toContain('app199');
	});
	it('speaks as a chosen agent', () => {
		const p = systemPrompt([], { agent: { name: 'Nova' } });
		expect(p).toMatch(/^You are Nova/);
		expect(p).not.toContain('[[open:');
	});
});

describe('assistant actions', () => {
	it('keeps known app ids once and strips every tag', () => {
		const r = parseActions('Try Forge.\n\n[[open:forge]] [[open:forge]] [[open:nope]]', ['forge', 'create']);
		expect(r).toEqual({ text: 'Try Forge.', actions: ['forge'] });
	});
	it('hides a tag still streaming in', () => {
		expect(hidePartialTag('Open it [[open:for')).toBe('Open it ');
		expect(hidePartialTag('Done [[open:forge]]')).toBe('Done [[open:forge]]');
	});
});

describe('assistant history', () => {
	it('keeps the last 20 valid turns', () => {
		const msgs = [{ role: 'system', content: 'x' }, { role: 'user', content: '  ' }, ...Array.from({ length: 30 }, (_, i) => ({ role: i % 2 ? 'assistant' : 'user', content: `m${i}`, extra: 1 }))];
		const h = trimHistory(msgs);
		expect(h).toHaveLength(HISTORY_MAX);
		expect(h[0]).toEqual({ role: 'user', content: 'm10' });
		expect(trimHistory(null)).toEqual([]);
	});
});

describe('assistant markdown', () => {
	it('escapes html and formats the basics', () => {
		expect(renderMarkdown('<img src=x onerror=alert(1)> **bold** `a<b`')).toBe('<p>&lt;img src=x onerror=alert(1)&gt; <strong>bold</strong> <code>a&lt;b</code></p>');
	});
	it('renders lists, headings and code fences', () => {
		expect(renderMarkdown('## Steps\n1. One\n2. Two\n\n- a\n- b')).toBe('<h4>Steps</h4><ol><li>One</li><li>Two</li></ol><ul><li>a</li><li>b</li></ul>');
		expect(renderMarkdown('```\n<x>\n```')).toBe('<pre><code>&lt;x&gt;</code></pre>');
	});
	it('links only http(s) and same-site paths', () => {
		expect(renderMarkdown('[go](/forge)')).toContain('<a href="/forge"');
		expect(renderMarkdown('[x](javascript:alert(1))')).not.toContain('<a');
		expect(renderMarkdown('[x](//evil.example)')).not.toContain('<a');
		expect(renderMarkdown('see https://three.ws.')).toContain('<a href="https://three.ws"');
	});
	it('ships starter prompts', () => {
		expect(SUGGESTIONS.length).toBeGreaterThan(2);
	});
});
