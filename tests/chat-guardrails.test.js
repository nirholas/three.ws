// Tests for api/_lib/chat-guardrails.js: the owner-opt-in NemoGuard checks on
// agent chat. Pins settings defaults, input-check ordering, the latency budget,
// fail-open on every failure mode, and the streaming output gate (ordered
// release, nothing unsafe ever emitted, stop on a hit).

import { describe, it, expect, vi } from 'vitest';

import {
	CHECK_IDS,
	GUARD_MODELS,
	JAILBREAK_URL,
	createOutputGate,
	enabledChecks,
	guardSummary,
	guardrailsActive,
	normalizeGuardrails,
	parseSafetyVerdict,
	parseTopicVerdict,
	refusalFor,
	runInputChecks,
	topicRedirect,
	topicSystemPrompt,
} from '../api/_lib/chat-guardrails.js';

const NIM = 'https://integrate.api.nvidia.com/v1/chat/completions';

function jsonRes(body, status = 200) {
	return { ok: status < 400, status, json: async () => body, text: async () => JSON.stringify(body) };
}
const nim = (content) => jsonRes({ choices: [{ message: { content } }] });

/** A fetch that answers per endpoint/model after an optional delay, honouring abort. */
function routedFetch(routes) {
	const calls = [];
	const impl = vi.fn((url, init) => {
		const body = JSON.parse(init.body);
		const routeKey = url === JAILBREAK_URL ? 'jailbreak' : body.model;
		calls.push({ routeKey, body });
		const route = routes[routeKey];
		if (!route) return Promise.reject(new Error(`unrouted ${routeKey}`));
		return new Promise((resolve, reject) => {
			const t = setTimeout(() => {
				if (route.throws) reject(route.throws);
				else resolve(route.res());
			}, route.delay ?? 0);
			init.signal?.addEventListener('abort', () => {
				clearTimeout(t);
				reject(Object.assign(new Error('aborted'), { name: init.signal.reason?.name || 'AbortError' }));
			});
		});
	});
	return { impl, calls };
}

const ALL_ON = normalizeGuardrails({ jailbreak: true, safety: true, topics: { enabled: true, allowed: ['our bakery menu', 'opening hours'] } });

describe('settings', () => {
	it('every check is off by default', () => {
		const s = normalizeGuardrails(undefined);
		expect(s).toEqual({ jailbreak: false, safety: false, topics: { enabled: false, allowed: [], redirect: '' } });
		expect(guardrailsActive(s)).toBe(false);
		expect(enabledChecks(s)).toEqual([]);
	});

	it('malformed settings fall back to all-off instead of throwing', () => {
		expect(guardrailsActive(normalizeGuardrails({ jailbreak: 'yes', topics: 7 }))).toBe(false);
		expect(guardrailsActive(normalizeGuardrails('garbage'))).toBe(false);
	});

	it('topic control with no topics listed enforces nothing', () => {
		const s = normalizeGuardrails({ topics: { enabled: true, allowed: [] } });
		expect(s.topics.enabled).toBe(false);
	});

	it('maps settings to check ids, safety covering input and output', () => {
		expect(enabledChecks(ALL_ON)).toEqual(['jailbreak', 'input_safety', 'output_safety', 'topic']);
	});

	it('dedupes topics', () => {
		expect(normalizeGuardrails({ topics: { enabled: true, allowed: ['a', 'a', 'b'] } }).topics.allowed).toEqual(['a', 'b']);
	});
});

describe('visitor-facing replies', () => {
	it('builds a polite redirect from the topic list', () => {
		const r = topicRedirect(ALL_ON);
		expect(r).toContain('our bakery menu and opening hours');
		expect(r).not.toMatch(/blocked|violat|flag/i);
	});

	it('uses the owner redirect verbatim when set', () => {
		const s = normalizeGuardrails({ topics: { enabled: true, allowed: ['x'], redirect: 'Ask me about cakes!' } });
		expect(refusalFor('topic', s)).toBe('Ask me about cakes!');
	});

	it('has a distinct refusal per check', () => {
		const set = new Set(['jailbreak', 'input_safety', 'output_safety'].map((c) => refusalFor(c, ALL_ON)));
		expect(set.size).toBe(3);
	});

	it('the topic prompt ends with the model contract', () => {
		expect(topicSystemPrompt(['cakes'], 'Bun')).toMatch(/You must respond with "on-topic" or "off-topic"\.$/);
	});
});

describe('verdict parsing', () => {
	it('reads the user and response fields separately', () => {
		const c = '{"User Safety": "safe", "Response Safety": "unsafe", "Safety Categories": "Violence, Guns"}';
		expect(parseSafetyVerdict(c, 'user')).toEqual({ unsafe: false, categories: [] });
		expect(parseSafetyVerdict(c, 'response')).toEqual({ unsafe: true, categories: ['Violence', 'Guns'] });
	});

	it('returns null when the asked-for field is missing or the reply is junk', () => {
		expect(parseSafetyVerdict('{"User Safety": "safe"}', 'response')).toBeNull();
		expect(parseSafetyVerdict('no idea', 'user')).toBeNull();
	});

	it('reads topic verdicts, off-topic winning', () => {
		expect(parseTopicVerdict('off-topic')).toBe(false);
		expect(parseTopicVerdict(' on-topic ')).toBe(true);
		expect(parseTopicVerdict('maybe')).toBeNull();
	});
});

describe('runInputChecks', () => {
	const ctx = { message: 'hello there' };

	it('makes no call when nothing is on', async () => {
		const { impl } = routedFetch({});
		const r = await runInputChecks(normalizeGuardrails({}), ctx, { key: 'k', fetchImpl: impl });
		expect(r.blocked).toBeNull();
		expect(impl).not.toHaveBeenCalled();
	});

	it('runs every enabled check in parallel and passes a clean turn', async () => {
		const { impl, calls } = routedFetch({
			jailbreak: { delay: 30, res: () => jsonRes({ jailbreak: false, score: -0.9 }) },
			[GUARD_MODELS.contentSafety]: { delay: 30, res: () => nim('{"User Safety": "safe"}') },
			[GUARD_MODELS.topicControl]: { delay: 30, res: () => nim('on-topic') },
		});
		const t = Date.now();
		const r = await runInputChecks(ALL_ON, ctx, { key: 'k', fetchImpl: impl });
		expect(Date.now() - t).toBeLessThan(80); // parallel: ~30 ms, not ~90
		expect(r.blocked).toBeNull();
		expect(calls.map((c) => c.routeKey).sort()).toEqual(['jailbreak', GUARD_MODELS.contentSafety, GUARD_MODELS.topicControl].sort());
		expect(r.results.every((x) => x.ok && !x.flagged)).toBe(true);
	});

	it('blocks on the first flag without waiting for slower checks', async () => {
		const { impl } = routedFetch({
			jailbreak: { delay: 5, res: () => jsonRes({ jailbreak: true, score: 0.8 }) },
			[GUARD_MODELS.contentSafety]: { delay: 1000, res: () => nim('{"User Safety": "safe"}') },
			[GUARD_MODELS.topicControl]: { delay: 1000, res: () => nim('on-topic') },
		});
		const t = Date.now();
		const r = await runInputChecks(ALL_ON, ctx, { key: 'k', fetchImpl: impl });
		expect(Date.now() - t).toBeLessThan(200);
		expect(r.blocked.check).toBe('jailbreak');
		expect(r.blocked.reply).toBe(refusalFor('jailbreak', ALL_ON));
		expect(r.results.filter((x) => x.error === 'skipped').map((x) => x.check).sort()).toEqual(['input_safety', 'topic']);
	});

	it('waits for a pending higher-priority check before blocking on a lower one', async () => {
		// Live 2026-11-16: a DAN prompt was flagged by topic in ~400 ms and the
		// still-pending jailbreak check was aborted, so the owner's stats counted
		// a jailbreak attempt as an off-topic redirect.
		const { impl } = routedFetch({
			jailbreak: { delay: 120, res: () => jsonRes({ jailbreak: true, score: 0.7 }) },
			[GUARD_MODELS.contentSafety]: { delay: 1000, res: () => nim('{"User Safety": "safe"}') },
			[GUARD_MODELS.topicControl]: { delay: 5, res: () => nim('off-topic') },
		});
		const t = Date.now();
		const r = await runInputChecks(ALL_ON, ctx, { key: 'k', fetchImpl: impl });
		expect(r.blocked.check).toBe('jailbreak');
		// The jailbreak flag outranks safety, so the slow safety check is not awaited.
		expect(Date.now() - t).toBeLessThan(500);
		expect(r.results.find((x) => x.check === 'input_safety').error).toBe('skipped');
	});

	it('blocks on a lower-priority flag once the higher checks pass', async () => {
		const { impl } = routedFetch({
			jailbreak: { delay: 60, res: () => jsonRes({ jailbreak: false, score: -0.9 }) },
			[GUARD_MODELS.contentSafety]: { delay: 80, res: () => nim('{"User Safety": "safe"}') },
			[GUARD_MODELS.topicControl]: { delay: 5, res: () => nim('off-topic') },
		});
		const r = await runInputChecks(ALL_ON, ctx, { key: 'k', fetchImpl: impl });
		expect(r.blocked.check).toBe('topic');
		expect(r.results.every((x) => x.ok)).toBe(true);
	});

	it('reports the highest-priority check when several flag together', async () => {
		const { impl } = routedFetch({
			jailbreak: { res: () => jsonRes({ jailbreak: true, score: 0.5 }) },
			[GUARD_MODELS.contentSafety]: { res: () => nim('{"User Safety": "unsafe", "Safety Categories": "Violence"}') },
			[GUARD_MODELS.topicControl]: { res: () => nim('off-topic') },
		});
		const r = await runInputChecks(ALL_ON, ctx, { key: 'k', fetchImpl: impl });
		expect(CHECK_IDS.indexOf(r.blocked.check)).toBe(0);
	});

	it('redirects an off-topic turn with the topic message', async () => {
		const s = normalizeGuardrails({ topics: { enabled: true, allowed: ['cakes'] } });
		const { impl } = routedFetch({ [GUARD_MODELS.topicControl]: { res: () => nim('off-topic') } });
		const r = await runInputChecks(s, { message: 'write me a python script' }, { key: 'k', fetchImpl: impl });
		expect(r.blocked.check).toBe('topic');
		expect(r.blocked.reply).toBe(topicRedirect(s));
	});

	it('falls back to the second topic model when the first errors', async () => {
		const s = normalizeGuardrails({ topics: { enabled: true, allowed: ['cakes'] } });
		const { impl, calls } = routedFetch({
			[GUARD_MODELS.topicControl]: { res: () => jsonRes({ error: 'cuda' }, 500) },
			[GUARD_MODELS.topicFallback]: { res: () => nim('off-topic') },
		});
		const r = await runInputChecks(s, { message: 'tell me about stocks' }, { key: 'k', fetchImpl: impl });
		expect(r.blocked.check).toBe('topic');
		expect(r.results[0].model).toBe(GUARD_MODELS.topicFallback);
		expect(calls[1].body.chat_template_kwargs).toEqual({ enable_thinking: false });
	});

	it('fails open when a check exceeds the budget', async () => {
		const s = normalizeGuardrails({ safety: true });
		const { impl } = routedFetch({ [GUARD_MODELS.contentSafety]: { delay: 5000, res: () => nim('{"User Safety": "unsafe"}') } });
		const t = Date.now();
		const r = await runInputChecks(s, ctx, { key: 'k', fetchImpl: impl, budgetMs: 50 });
		expect(Date.now() - t).toBeLessThan(500);
		expect(r.blocked).toBeNull();
		expect(r.results[0]).toMatchObject({ check: 'input_safety', ok: false, error: 'timeout' });
	});

	it.each([
		['an http error', { res: () => jsonRes({ error: 'gone' }, 410) }, /http 410/],
		['a network error', { throws: new Error('ECONNRESET') }, /network/],
		['an unreadable verdict', { res: () => nim('I cannot classify that') }, /no verdict/],
	])('fails open on %s', async (_name, route, errRe) => {
		const s = normalizeGuardrails({ safety: true });
		const { impl } = routedFetch({ [GUARD_MODELS.contentSafety]: route });
		const r = await runInputChecks(s, ctx, { key: 'k', fetchImpl: impl });
		expect(r.blocked).toBeNull();
		expect(r.results[0].error).toMatch(errRe);
	});

	it('fails open with no key, recording every check as not configured', async () => {
		const { impl } = routedFetch({});
		const r = await runInputChecks(ALL_ON, ctx, { key: null, env: {}, fetchImpl: impl });
		expect(r.blocked).toBeNull();
		expect(r.results.map((x) => x.error)).toEqual(['not configured', 'not configured', 'not configured']);
		expect(impl).not.toHaveBeenCalled();
	});
});

describe('createOutputGate', () => {
	const tick = () => new Promise((r) => setTimeout(r, 0));

	function harness({ verdictFor = () => ({ flagged: false }), delay = 0, maxInFlight } = {}) {
		const out = [];
		const blocks = [];
		const calls = [];
		const gate = createOutputGate({
			userMessage: 'q',
			emitText: (t) => out.push(['text', t]),
			emitRaw: (x) => out.push(['raw', x]),
			onBlock: (v) => blocks.push(v),
			maxInFlight,
			classify: (input) => {
				calls.push(input.assistant);
				return new Promise((resolve, reject) =>
					setTimeout(() => {
						const v = verdictFor(input.assistant);
						if (v instanceof Error) reject(v);
						else resolve(v);
					}, delay),
				);
			},
		});
		return { gate, out, blocks, calls };
	}

	it('releases nothing before a verdict, then everything in order', async () => {
		const { gate, out } = harness({ delay: 20 });
		gate.text('The shop opens at nine every weekday morning. ');
		gate.raw({ type: 'tool', name: 'x' });
		gate.text('We close at five. Weekends are noon to four.');
		expect(out).toEqual([]);
		const r = await gate.finish();
		expect(out.map((o) => o[0])).toEqual(['text', 'raw', 'text']);
		expect(out[0][1] + out[2][1]).toBe('The shop opens at nine every weekday morning. We close at five. Weekends are noon to four.');
		expect(r.blocked).toBeNull();
		expect(r.released).toBe(out[0][1] + out[2][1]);
	});

	it('cuts at sentence ends and judges the reply so far', async () => {
		const { gate, calls } = harness();
		gate.text('First sentence is long enough to judge on its own. Second');
		await tick();
		expect(calls[0]).toBe('First sentence is long enough to judge on its own. ');
		gate.text(' sentence ends here.');
		await gate.finish();
		expect(calls[calls.length - 1]).toBe('First sentence is long enough to judge on its own. Second sentence ends here.');
	});

	it('streams: the first safe sentence goes out before the model finishes', async () => {
		const { gate, out } = harness({ delay: 5 });
		gate.text('Here is the first full sentence of a reply. ');
		await new Promise((r) => setTimeout(r, 20));
		expect(out.length).toBe(1);
		gate.text('And a second one arrives later.');
		await gate.finish();
		expect(out.length).toBe(2);
	});

	it('stops on an unsafe verdict: nothing unsafe or later is emitted, onBlock fires once', async () => {
		const { gate, out, blocks } = harness({
			verdictFor: (a) => (a.includes('BAD') ? { flagged: true, categories: ['Violence'], model: 'm' } : { flagged: false }),
		});
		gate.text('This opening sentence is entirely harmless. ');
		await tick();
		await tick();
		gate.text('Then the BAD sentence comes along here. ');
		gate.raw({ type: 'tool' });
		gate.text('And more after it.');
		const r = await gate.finish();
		expect(out).toEqual([['text', 'This opening sentence is entirely harmless. ']]);
		expect(blocks).toEqual([{ check: 'output_safety', categories: ['Violence'], model: 'm' }]);
		expect(r.blocked.check).toBe('output_safety');
		gate.text('ignored after block.');
		expect(out.length).toBe(1);
	});

	it('fails open per buffer when the classifier errors, counting it unchecked', async () => {
		const { gate, out } = harness({ verdictFor: () => new Error('http 503') });
		gate.text('A reply the classifier never got to see.');
		const r = await gate.finish();
		expect(out).toEqual([['text', 'A reply the classifier never got to see.']]);
		expect(r.unchecked).toBe(1);
		expect(r.blocked).toBeNull();
	});

	it('caps classifier calls in flight; later text buffers into fewer, larger checks', async () => {
		let live = 0;
		let peak = 0;
		const out = [];
		const gate = createOutputGate({
			userMessage: 'q',
			emitText: (t) => out.push(t),
			maxInFlight: 1,
			classify: () => {
				live++;
				peak = Math.max(peak, live);
				return new Promise((r) => setTimeout(() => {
					live--;
					r({ flagged: false });
				}, 10));
			},
		});
		const sentences = Array.from({ length: 10 }, (_, i) => `Sentence number ${i} is plenty long to count. `);
		for (const s of sentences) gate.text(s);
		const r = await gate.finish();
		expect(peak).toBe(1);
		expect(r.checks).toBeLessThan(10);
		expect(out.join('')).toBe(sentences.join(''));
	});

	it('an empty reply finishes immediately', async () => {
		const { gate } = harness();
		const r = await gate.finish();
		expect(r).toMatchObject({ blocked: null, released: '', checks: 0 });
	});
});

describe('guardSummary', () => {
	it('is null when nothing is on', () => {
		expect(guardSummary(normalizeGuardrails({}), {})).toBeNull();
	});

	it('records ids only: what ran, what blocked, what failed open', () => {
		const s = guardSummary(ALL_ON, {
			input: {
				blocked: null,
				latencyMs: 312,
				results: [
					{ check: 'jailbreak', ok: true },
					{ check: 'input_safety', ok: false, error: 'timeout' },
					{ check: 'topic', ok: false, error: 'skipped' },
				],
			},
			output: { blocked: { check: 'output_safety' }, checks: 3, unchecked: 0 },
		});
		expect(s).toEqual({
			on: ['jailbreak', 'input_safety', 'output_safety', 'topic'],
			blocked: 'output_safety',
			unchecked: ['input_safety'],
			input_ms: 312,
			output_checks: 3,
		});
		expect(JSON.stringify(s)).not.toMatch(/hello|reply/);
	});
});
