import { describe, it, expect } from 'vitest';
import { parseArgs, stratify, guardProblems } from '../scripts/x-mention-review-sample.mjs';

describe('x-mention-review-sample', () => {
	it('parses limit, out and json flags with a 30 row default', () => {
		expect(parseArgs([])).toEqual({ limit: 30, json: false, out: null });
		expect(parseArgs(['--limit', '12', '--out', 'a.md', '--json'])).toEqual({ limit: 12, json: true, out: 'a.md' });
		expect(parseArgs(['--limit', 'abc']).limit).toBe(30);
	});

	it('spreads the sample over intents so one chatty intent cannot crowd the rest out', () => {
		const byIntent = {
			chat: Array.from({ length: 50 }, (_, i) => ({ intent: 'chat', i })),
			make: [{ intent: 'make', i: 0 }],
			help: [{ intent: 'help', i: 0 }, { intent: 'help', i: 1 }],
		};
		const picked = stratify(byIntent, 6);
		expect(picked).toHaveLength(6);
		const intents = picked.map((r) => r.intent);
		expect(intents).toContain('make');
		expect(intents.filter((i) => i === 'help')).toHaveLength(2);
		expect(intents.filter((i) => i === 'chat')).toHaveLength(3);
	});

	it('returns fewer rows than asked when the ledger has fewer', () => {
		expect(stratify({ make: [{ intent: 'make' }] }, 30)).toHaveLength(1);
		expect(stratify({}, 30)).toEqual([]);
	});

	it('flags replies that break the live-reply rules', () => {
		expect(guardProblems({ decision: 'reply', reply_text: 'ok', dry_run: true })).toEqual([]);
		expect(guardProblems({ decision: 'reply', reply_text: 'x'.repeat(281) })[0]).toMatch(/281 chars/);
		expect(guardProblems({ decision: 'reply', reply_text: 'a \u2014 b' })).toContain('reply contains a dash glyph');
		expect(guardProblems({ decision: 'reply', reply_text: '' })).toContain('decision is reply but there is no reply text');
		expect(guardProblems({ decision: 'reply', reply_text: 'hi', dry_run: false })).toContain('live row without a reply tweet id');
		expect(guardProblems({ decision: 'unsafe', reply_text: 'hi' })).toContain('unsafe decision carries reply text');
	});
});
