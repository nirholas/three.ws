/**
 * The NVIDIA translation lane: per-language routing, the brand glossary, the
 * quality gate every batch must clear before it is written, the re-queue, the
 * 429 backoff, and resume after a spent quota.
 *
 * Everything here is pure or takes an injected fetch / sleep, so no request
 * leaves the machine.
 */
import { describe, it, expect, vi } from 'vitest';
import { buildMasker } from '../scripts/lib/i18n-shared.mjs';
import {
	chrF,
	corpusChrF,
	tokensIntact,
	lengthSane,
	isEcho,
	gateBatch,
	translateWithRequeue,
	backoffDelay,
	runWithResume,
	BACK_TRANSLATION,
} from '../scripts/lib/i18n-quality.mjs';
import {
	NVIDIA_DEFAULT_MODEL,
	SEGMENT_BATCH_MAX,
	buildSegmentPrompt,
	parseSegmentReply,
	nvidiaMaxKeysPerChunk,
	nvidiaMaxTokens,
	nvidiaRequestExtras,
	nvidiaTranslate,
	promptLanguageName,
	resolveNvidiaModel,
	loadNvidiaRoutes,
} from '../scripts/lib/i18n-nvidia.mjs';
import { chooseRoute, sampleIndices, renderScoreTables } from '../scripts/nvidia-translation-eval.mjs';

const RIVA = 'nvidia/riva-translate-4b-instruct-v2';
const LIGHTNING = 'nvidia/nemotron-3.5-lightning-30b-a3b';
const ULTRA = 'nvidia/nemotron-3-ultra-550b-a55b';

describe('routing', () => {
	const routes = {
		locales: {
			sv: { model: RIVA, eligible: true },
			am: { model: null, eligible: false },
		},
	};

	it('sends a scored locale to its measured model', () => {
		expect(resolveNvidiaModel('sv', routes)).toEqual({ model: RIVA, eligible: true, source: 'eval' });
	});

	it('refuses a locale no model cleared the bar for', () => {
		expect(resolveNvidiaModel('am', routes)).toEqual({ model: null, eligible: false, source: 'eval' });
	});

	it('keeps an unscored locale on the lane default instead of dropping it', () => {
		expect(resolveNvidiaModel('xx', routes)).toEqual({ model: NVIDIA_DEFAULT_MODEL, eligible: true, source: 'default' });
	});

	it('hands back the second qualifying model as the fallback for keys the first keeps failing', () => {
		const r = { locales: { sv: { model: RIVA, eligible: true, fallback: ULTRA } } };
		expect(resolveNvidiaModel('sv', r)).toEqual({ model: RIVA, eligible: true, source: 'eval', fallback: ULTRA });
	});

	it('lets an explicit --model pin override the table, even for a refused locale', () => {
		expect(resolveNvidiaModel('am', routes, { pinned: ULTRA })).toEqual({ model: ULTRA, eligible: true, source: 'pinned' });
	});

	it('reads an empty table when the routes file does not exist yet', () => {
		expect(loadNvidiaRoutes('/nonexistent/routes.json')).toEqual({ locales: {} });
	});

	it('caps Riva requests to its segment batch and its context window', () => {
		expect(nvidiaMaxKeysPerChunk(RIVA)).toBe(SEGMENT_BATCH_MAX);
		expect(nvidiaMaxKeysPerChunk(ULTRA)).toBe(Infinity);
		expect(nvidiaMaxTokens(RIVA)).toBe(4096);
		expect(nvidiaMaxTokens(LIGHTNING)).toBe(8192);
	});

	it('turns Nemotron reasoning off and sends Riva no template kwargs', () => {
		expect(nvidiaRequestExtras(ULTRA)).toEqual({ chat_template_kwargs: { enable_thinking: false } });
		expect(nvidiaRequestExtras(RIVA)).toEqual({});
	});

	it('names the language in English with the native name alongside', () => {
		expect(promptLanguageName('sv', 'Svenska')).toBe('Swedish (Svenska)');
		expect(promptLanguageName('de', 'German')).toBe('German');
	});
});

describe('choosing a route from evaluation cells', () => {
	const cell = (model, chrF, integrity = 1, parse = 1) => ({ model, chrF, integrity, parse });

	it('picks the highest-scoring model that clears the bar', () => {
		const r = chooseRoute('de', [cell(RIVA, 60), cell(LIGHTNING, 62), cell(ULTRA, 68)]);
		expect(r).toMatchObject({ model: ULTRA, eligible: true, chrF: 68 });
	});

	it('prefers the smaller model inside the tie band', () => {
		const r = chooseRoute('sv', [cell(RIVA, 67.8), cell(ULTRA, 68.2)]);
		expect(r.model).toBe(RIVA);
	});

	it('records the best other qualifier as the fallback, and none when only one qualifies', () => {
		const r = chooseRoute('sv', [cell(RIVA, 67.8), cell(LIGHTNING, 62, 0.9), cell(ULTRA, 68.2)]);
		expect(r.fallback).toBe(ULTRA);
		expect(chooseRoute('de', [cell(ULTRA, 68), cell(RIVA, 10)]).fallback).toBeNull();
	});

	it('disqualifies a model that breaks placeholders, however fluent', () => {
		const r = chooseRoute('de', [cell(ULTRA, 70, 0.8), cell(LIGHTNING, 62)]);
		expect(r.model).toBe(LIGHTNING);
	});

	it('marks a language ineligible and records the best attempt when every model fails', () => {
		const r = chooseRoute('am', [cell(RIVA, 0.5, 0.97), cell(ULTRA, 0, 1, 0.5)]);
		expect(r).toEqual({ model: null, eligible: false, floor: 30, best: { model: RIVA, chrF: 0.5, integrity: 0.97 } });
	});

	it('uses the lower floor for scripts written without spaces', () => {
		expect(chooseRoute('ja', [cell(ULTRA, 25)]).eligible).toBe(true);
		expect(chooseRoute('de', [cell(ULTRA, 25)]).eligible).toBe(false);
	});

	it('renders the report table with the route in bold and refused locales explained', () => {
		const byLocale = { sv: [cell(RIVA, 67.8), cell(LIGHTNING, 62.2, 0.967), cell(ULTRA, 68.2)], am: [cell(RIVA, 0.5, 0.97)] };
		const routes = {
			sv: chooseRoute('sv', byLocale.sv),
			am: { model: null, eligible: false, floor: 30, best: { model: RIVA, chrF: 0.5, integrity: 0.97 } },
		};
		const md = renderScoreTables(['sv', 'am', 'de'], byLocale, routes).split('\n');
		expect(md).toHaveLength(4);
		expect(md[2]).toBe('| sv | **67.8 / 1 / 1** | 62.2 / 0.967 / 1 | 68.2 / 1 / 1 | Riva 4B | Ultra 550B |');
		expect(md[3]).toBe('| am | 0.5 / 0.97 / 1 | not run | not run | none (best 0.5 < 30) | - |');
	});

	it('samples evenly across the whole devtest file', () => {
		expect(sampleIndices(1012, 4)).toEqual([0, 253, 506, 759]);
	});
});

describe('Riva tagged segments', () => {
	it('addresses values by position so keys never reach the model', () => {
		const prompt = buildSegmentPrompt('Swedish', { 'nav.home': 'Home', 'nav.docs': 'Read the [[T0]] docs' });
		expect(prompt).toBe('Translate the following text from English to Swedish:\n<s0>Home</s0>\n<s1>Read the [[T0]] docs</s1>');
		expect(prompt).not.toContain('nav.home');
	});

	it('maps a reply back onto keys and leaves dropped segments absent', () => {
		const out = parseSegmentReply('Översättning:\n<s0>Hem</s0>\n<s2> Läs [[T0]] </s2>\n<s9>extra</s9>', ['a', 'b', 'c']);
		expect(out).toEqual({ a: 'Hem', c: 'Läs [[T0]]' });
	});

	it('routes a Riva call through segments and a Nemotron call through JSON', async () => {
		const seen = [];
		const fetchImpl = vi.fn(async (_url, init) => {
			const body = JSON.parse(init.body);
			seen.push(body);
			const content = body.model === RIVA ? '<s0>Hej</s0>' : '{"greet":"Hej"}';
			return new Response(JSON.stringify({ choices: [{ message: { content } }] }), { status: 200 });
		});
		for (const model of [RIVA, ULTRA]) {
			const out = await nvidiaTranslate({ model, langName: 'Swedish', payload: { greet: 'Hello' }, key: 'k', fetchImpl });
			expect(out).toEqual({ greet: 'Hej' });
		}
		expect(seen[0].messages[0].content).toContain('<s0>Hello</s0>');
		expect(seen[0].max_tokens).toBe(4096);
		expect(seen[1].messages[0].content).toContain('{"greet":"Hello"}');
		expect(seen[1].chat_template_kwargs).toEqual({ enable_thinking: false });
	});

	it('surfaces a 429 with its Retry-After so the caller can back off', async () => {
		const fetchImpl = async () => new Response('slow down', { status: 429, headers: { 'retry-after': '7' } });
		await expect(nvidiaTranslate({ model: ULTRA, langName: 'Swedish', payload: { a: 'b' }, key: 'k', fetchImpl })).rejects.toMatchObject({
			status: 429,
			retryAfter: 7,
		});
	});

	it('treats a reply with no segments as a failure, not an empty success', async () => {
		const fetchImpl = async () => new Response(JSON.stringify({ choices: [{ message: { content: 'Jedes Segment ist...' } }] }));
		await expect(nvidiaTranslate({ model: RIVA, langName: 'German', payload: { a: 'b' }, key: 'k', fetchImpl })).rejects.toThrow(
			'no tagged segments',
		);
	});
});

describe('brand glossary', () => {
	const { mask, unmask } = buildMasker(['$THREE', 'three.ws', 'Solana']);

	it('hides three.ws and $THREE from the model and restores them byte for byte', () => {
		const src = 'Buy $THREE on three.ws, settled on Solana.';
		const { masked, tokens } = mask(src);
		expect(masked).not.toMatch(/three\.ws|\$THREE|Solana/);
		const translated = masked.replace('Buy', 'Köp').replace('settled on', 'avräknat på');
		expect(unmask(translated, tokens)).toBe('Köp $THREE on three.ws, avräknat på Solana.');
	});

	it('rejects a translation that translated a glossary token away', () => {
		const src = 'Hold $THREE on three.ws for the drop.';
		const { masked, tokens } = mask(src);
		const r = gateBatch({
			code: 'sv',
			masked: { k: masked },
			sources: { k: src },
			out: { k: 'Håll TRE på tre.ws för släppet.' },
			unmask: (_k, v) => unmask(v, tokens),
		});
		expect(r.passed).toEqual({});
		expect(r.failed.k[0]).toMatch(/^token drift/);
	});

	it('masks a dotted or numbered identifier at the start of a title in any case', () => {
		// Measured on the 2026-11-16 Swedish run: titles that open with a
		// capitalized brand ("Three.ws ...") reached the model unmasked (the
		// glossary spells it three.ws), so the reply echoed it and the gate
		// rejected the key.
		const m = buildMasker(['three.ws', 'watsonx.ai', 'x402', 'Forge']);
		const { masked, tokens } = m.mask('Three.ws runs Watsonx.ai, X402 ready');
		expect(masked).toMatch(/^\[\[T\d\]\] runs \[\[T\d\]\], \[\[T\d\]\] ready$/);
		expect(m.unmask(masked, tokens)).toBe('Three.ws runs Watsonx.ai, X402 ready');
	});

	it('keeps a plain-word term case-sensitive, so the verb "forge" still translates', () => {
		const m = buildMasker(['Forge']);
		expect(m.mask('Open Forge to forge a sword').masked).toBe('Open [[T0]] to forge a sword');
	});
});

describe('quality gate', () => {
	const { mask, unmask } = buildMasker(['three.ws']);
	function batch(entries) {
		const masked = {};
		const sources = {};
		const tokens = {};
		for (const [k, v] of Object.entries(entries)) {
			const m = mask(v);
			masked[k] = m.masked;
			sources[k] = v;
			tokens[k] = m.tokens;
		}
		return { masked, sources, unmask: (k, v) => unmask(v, tokens[k]) };
	}

	it('passes a clean batch and returns unmasked values ready to write', () => {
		const b = batch({ a: 'Open <b>{{count}}</b> agents on three.ws' });
		const r = gateBatch({ code: 'sv', ...b, out: { a: 'Öppna [[T1]][[T0]][[T2]] agenter på [[T3]]' } });
		expect(r.failed).toEqual({});
		expect(r.passed.a).toBe('Öppna <b>{{count}}</b> agenter på three.ws');
	});

	it('rejects a dropped key, an empty value, markup drift, a truncation and an echo', () => {
		const b = batch({
			gone: 'This one never came back from the model',
			empty: 'This one came back as nothing at all',
			tags: 'Click <a href="/x">here</a> to continue',
			short: 'A long sentence about configuring your agent wallet safely',
			echo: 'Connect your wallet to start trading now',
		});
		const r = gateBatch({
			code: 'de',
			...b,
			out: {
				empty: '   ',
				tags: 'Klicken Sie [[T0]]hier[[T1]] <i>weiter</i>',
				short: 'Ein',
				echo: 'Connect your wallet to start trading now',
			},
		});
		expect(r.passed).toEqual({});
		expect(r.failed.gone).toEqual(['missing from reply']);
		expect(r.failed.empty).toEqual(['empty value']);
		expect(r.failed.tags).toContain('markup drift');
		expect(r.failed.short).toContain('length out of range');
		expect(r.failed.echo).toContain('untranslated echo');
	});

	it('drops a key whose back-translation lost the meaning', () => {
		const b = batch({
			ok: 'Your agent can now accept payments from other agents',
			bad: 'Download the rigged avatar as a binary GLB file',
		});
		const r = gateBatch({
			code: 'sv',
			...b,
			out: { ok: 'Din agent kan nu ta emot betalningar från andra agenter', bad: 'Ladda ner den riggade avataren som en binär GLB-fil' },
			back: { ok: 'Your agent can now receive payments from other agents', bad: 'The weather in Stockholm is cold this week' },
			bar: { minBatchChrF: 0 },
		});
		expect(Object.keys(r.passed)).toEqual(['ok']);
		expect(r.failed.bad[0]).toMatch(/^back-translation chrF/);
	});

	it('re-queues a whole batch whose average back-translation is weak', () => {
		const b = batch({ a: 'Start a new conversation with your agent', b: 'Share the model link with your team' });
		const r = gateBatch({
			code: 'sv',
			...b,
			out: { a: 'Starta en ny konversation med din agent', b: 'Dela modellänken med ditt team' },
			back: { a: 'Begin a fresh chat alongside the agent', b: 'Give your group the link for the model' },
			bar: { minKeyChrF: 0, minBatchChrF: 90, minBatchKeys: 0 },
		});
		expect(r.passed).toEqual({});
		expect(r.batchChrF).toBeLessThan(90);
		expect(r.failed.a[0]).toMatch(/^batch back-translation chrF/);
	});

	it('rejects a key whose back-translation never came back without dragging the batch mean to zero', () => {
		const b = batch({
			a: 'Your agent can now accept payments from other agents',
			b: 'Share the rigged model link with your whole team today',
			c: 'Download the finished avatar as a binary GLB file',
			d: 'Open the dashboard to review every receipt your agent paid',
			e: 'Pick a voice for your agent before the meetup starts',
			lost: 'This key was dropped from the back-translation reply',
		});
		const out = Object.fromEntries(Object.keys(b.masked).map((k) => [k, `sv ${b.masked[k]}`]));
		const back = Object.fromEntries(Object.keys(b.masked).filter((k) => k !== 'lost').map((k) => [k, b.masked[k]]));
		const r = gateBatch({ code: 'sv', ...b, out, back });
		expect(r.failed).toEqual({ lost: ['back-translation missing'] });
		expect(r.batchChrF).toBe(100);
	});

	it('leaves a small batch to the per-key floor instead of the noisy batch mean', () => {
		const b = batch({ a: 'Outbound spend, across every Payment Session', c: 'Re-fetch outbound receipts now' });
		const r = gateBatch({
			code: 'sv',
			...b,
			out: { a: 'Utgående utgifter, över varje betalningssession', c: 'Hämta utgående kvitton igen nu' },
			back: { a: 'Money spent outward in all payment sessions', c: 'Get the outgoing receipts again' },
		});
		expect(r.batchChrF).toBeLessThan(BACK_TRANSLATION.minBatchChrF);
		expect(Object.keys(r.passed)).toEqual(['a', 'c']);
	});

	it('does not score short labels on back-translation, where a synonym swings chrF', () => {
		const b = batch({ go: 'Start' });
		const r = gateBatch({ code: 'sv', ...b, out: { go: 'Börja' }, back: { go: 'Begin' } });
		expect(r.passed.go).toBe('Börja');
		expect(r.batchChrF).toBeNull();
	});

	it('allows compact scripts to come out far shorter than English', () => {
		const src = 'Generate a textured 3D model from a short text description';
		expect(lengthSane(src, '從簡短的文字描述生成帶紋理的3D模型', 'zh-TW')).toBe(true);
		expect(lengthSane(src, 'Erzeuge 3D', 'de')).toBe(false);
		expect(lengthSane('OK', 'Aceptar', 'es')).toBe(true);
	});

	it('only calls a short identical label an echo when it is a real sentence', () => {
		expect(isEcho('API key', 'API key')).toBe(false);
		expect(isEcho('Save your changes before leaving', 'save your changes before leaving')).toBe(true);
	});

	it('does not call a code sample an echo, since code must come back unchanged', () => {
		const src = '<strong>iframe</strong> - <code>&lt;iframe src="/agents/:id/embed"&gt;</code>';
		const { mask: m } = buildMasker([]);
		const masked = m(src).masked;
		expect(isEcho(masked, masked, src)).toBe(false);
		const prose = 'Embed the agent on any page with one line';
		expect(isEcho(prose, prose, prose)).toBe(true);
	});

	it('compares token multisets, so a duplicated or renumbered token fails', () => {
		expect(tokensIntact('[[T0]] and [[T1]]', '[[T1]] und [[T0]]')).toBe(true);
		expect(tokensIntact('[[T0]] and [[T1]]', '[[T0]] und [[T0]]')).toBe(false);
	});
});

describe('chrF', () => {
	it('scores identity 100 and disjoint text 0', () => {
		expect(chrF('the agent wallet', 'the agent wallet')).toBe(100);
		expect(chrF('xyz', 'abc')).toBe(0);
	});

	it('ignores whitespace and ranks a close paraphrase above an unrelated sentence', () => {
		expect(chrF('theagent wallet', 'the agent wallet')).toBe(100);
		const ref = 'Your agent can now accept payments';
		expect(chrF('Your agent can now receive payments', ref)).toBeGreaterThan(chrF('The weather is cold today', ref));
	});

	it('sums statistics across segments for a corpus score', () => {
		const c = corpusChrF(['a cat sat', 'on the mat'], ['a cat sat', 'on the mat']);
		expect(c).toBe(100);
	});
});

describe('re-queue', () => {
	it('retries only the failed keys and never returns a rejected key as accepted', async () => {
		const calls = [];
		const attempt = async (keys, round) => {
			calls.push([...keys]);
			const passed = {};
			const failed = {};
			for (const k of keys) {
				if (k === 'never' || (k === 'second' && round === 1)) failed[k] = ['token drift 0 -> ∅'];
				else passed[k] = `${k}-sv`;
			}
			return { passed, failed };
		};
		const r = await translateWithRequeue(['first', 'second', 'never'], attempt, { maxRounds: 3 });
		expect(calls).toEqual([['first', 'second', 'never'], ['second', 'never'], ['never']]);
		expect(r.accepted).toEqual({ first: 'first-sv', second: 'second-sv' });
		expect(r.rejected).toEqual({ never: ['token drift 0 -> ∅'] });
	});
});

describe('backoff', () => {
	it('honours the server Retry-After', () => {
		expect(backoffDelay(0, { retryAfterSec: 12 })).toBe(12_000);
	});

	it('grows exponentially with jitter and stops at the cap', () => {
		const lo = { random: () => 0 };
		const hi = { random: () => 1 };
		expect(backoffDelay(0, lo)).toBe(1000);
		expect(backoffDelay(0, hi)).toBe(2000);
		expect(backoffDelay(3, hi)).toBe(16_000);
		expect(backoffDelay(20, hi)).toBe(60_000);
	});
});

describe('resume', () => {
	it('waits out a spent quota and continues, then stops on any other error', async () => {
		const quota = Object.assign(new Error('quota'), { quota: true });
		const slept = [];
		let runs = 0;
		const result = await runWithResume(
			async () => {
				runs++;
				if (runs < 3) throw quota;
				return 'done';
			},
			{ waitMs: 600_000, maxResumes: 5, isResumable: (e) => e.quota === true, sleep: async (ms) => slept.push(ms) },
		);
		expect(result).toBe('done');
		expect(slept).toEqual([600_000, 600_000]);

		await expect(
			runWithResume(
				async () => {
					throw new Error('bad key');
				},
				{ waitMs: 1, maxResumes: 5, isResumable: (e) => e.quota === true, sleep: async () => {} },
			),
		).rejects.toThrow('bad key');
	});

	it('gives up after the resume budget', async () => {
		const quota = Object.assign(new Error('quota'), { quota: true });
		let runs = 0;
		await expect(
			runWithResume(
				async () => {
					runs++;
					throw quota;
				},
				{ waitMs: 1, maxResumes: 2, isResumable: () => true, sleep: async () => {} },
			),
		).rejects.toBe(quota);
		expect(runs).toBe(3);
	});
});
