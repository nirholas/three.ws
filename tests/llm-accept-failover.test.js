// llmComplete returned the first NON-EMPTY completion. For a caller that needs
// structured output, that is not the same as the first USABLE one: a lane that
// answers prose, a code-fenced half object, or JSON cut off at max_tokens (a
// reasoning model spends part of the budget thinking) won the race, the
// healthy lanes behind it were never asked, and the caller had nothing to do
// but fail. /api/agents/suggest-spec answered 502 "The generator returned an
// unreadable result" three times on 2026-11-24/25 this way while every lane it
// would have reached next was up.
//
// A caller can now pass `accept(text)`: a completion it rejects counts as a
// failed attempt and the chain fails over, exactly as for an empty one.

import { describe, it, expect, vi, afterEach } from 'vitest';

vi.mock('../api/_lib/usage.js', () => ({ recordEvent: vi.fn() }));
vi.mock('../api/_lib/db.js', () => ({ sql: vi.fn(async () => []) }));

const { llmComplete } = await import('../api/_lib/llm.js');

function rung(name, model) {
	const url = `https://${name}.lane.test/v1/chat/completions`;
	return {
		name,
		model,
		url,
		headers: { 'content-type': 'application/json' },
		buildBody: (system, user, maxTokens) => ({ model, max_tokens: maxTokens, messages: [{ role: 'user', content: user }] }),
		extractText: (r) => r.choices?.[0]?.message?.content || '',
		extractUsage: () => ({ input: 0, output: 0 }),
	};
}

const answer = (text) => new Response(JSON.stringify({ choices: [{ message: { content: text } }] }), { status: 200, headers: { 'content-type': 'application/json' } });

const realFetch = globalThis.fetch;
afterEach(() => {
	globalThis.fetch = realFetch;
});

const isJson = (t) => {
	try {
		JSON.parse(t);
		return true;
	} catch {
		return false;
	}
};

describe('llmComplete accept()', () => {
	it('fails over past a completion the caller cannot use', async () => {
		const asked = [];
		globalThis.fetch = vi.fn(async (url, init) => {
			const { model } = JSON.parse(init.body);
			asked.push(model);
			if (model === 'truncating') return answer('{"name": "Nova", "description": "A calm guide who');
			return answer('{"name": "Nova"}');
		});
		const out = await llmComplete({
			system: 's',
			user: 'u',
			accept: isJson,
			timeoutMs: 20_000,
			chain: [rung('first', 'truncating'), rung('second', 'healthy')],
		});
		expect(out.provider).toBe('second');
		expect(out.text).toBe('{"name": "Nova"}');
		expect(asked).toEqual(['truncating', 'healthy']);
	});

	it('throws an unusable_completion error when no lane produces usable text', async () => {
		globalThis.fetch = vi.fn(async () => answer('Sure! Here is your agent: Nova, a calm guide.'));
		const err = await llmComplete({
			system: 's',
			user: 'u',
			accept: isJson,
			timeoutMs: 20_000,
			chain: [rung('first', 'a'), rung('second', 'b')],
		}).catch((e) => e);
		expect(err).toBeInstanceOf(Error);
		expect(err.code).toBe('unusable_completion');
		expect(err.attempts.map((a) => a.error)).toEqual(['unusable completion', 'unusable completion']);
	});

	it('keeps returning the first non-empty completion when no accept() is given', async () => {
		globalThis.fetch = vi.fn(async () => answer('plain prose'));
		const out = await llmComplete({ system: 's', user: 'u', timeoutMs: 20_000, chain: [rung('first', 'a'), rung('second', 'b')] });
		expect(out.provider).toBe('first');
	});
});
