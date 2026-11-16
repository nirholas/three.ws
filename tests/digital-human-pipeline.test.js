// The digital human's turn pipeline: segments are voiced while the LLM is still
// writing, and every stage fails over instead of leaving the avatar silent.
//
// The HTTP client is replaced by an in-process stand-in that keeps the real
// call order and timing shape (tokens arrive over time, a spoken line takes
// time); the live round trip is scripts/digital-human-latency-bench.mjs.

import { describe, it, expect } from 'vitest';
import {
	SentenceChunker,
	speakable,
	percentile,
	summarizeTimings,
	LaneHealth,
	readSSE,
	runTurn,
} from '../src/voice/digital-human-pipeline.js';

const tick = (ms = 5) => new Promise((r) => setTimeout(r, ms));

function streamOf(text) {
	const bytes = new TextEncoder().encode(text);
	return new ReadableStream({
		start(c) {
			// Split mid-frame to prove the parser buffers across reads.
			for (let i = 0; i < bytes.length; i += 7) c.enqueue(bytes.subarray(i, i + 7));
			c.close();
		},
	});
}

describe('SentenceChunker', () => {
	it('releases the first sentence as soon as it ends', () => {
		const c = new SentenceChunker();
		expect(c.push('Hello there')).toEqual([]);
		expect(c.push('. How are')).toEqual(['Hello there.']);
	});

	it('cuts a long first clause at a comma so the voice starts early', () => {
		const c = new SentenceChunker({ firstSoftMin: 20 });
		const out = c.push('NVIDIA Audio2Face turns any voice into facial motion, frame by frame');
		expect(out).toEqual(['NVIDIA Audio2Face turns any voice into facial motion,']);
	});

	it('groups later sentences so a reply is a few requests, not one per sentence', () => {
		const c = new SentenceChunker({ groupMin: 40 });
		c.push('First. ');
		expect(c.push('Two words. Three more words here. And a fourth one now. ')).toEqual([
			'Two words. Three more words here. And a fourth one now.',
		]);
	});

	it('does not split on abbreviations', () => {
		const c = new SentenceChunker();
		expect(c.push('Ask Dr. Smith about it. ')).toEqual(['Ask Dr. Smith about it.']);
	});

	it('flushes the tail and strips markdown', () => {
		const c = new SentenceChunker();
		c.push('See **the** [docs](https://x.y) and `code`');
		expect(c.flush()).toBe('See the docs and code');
		expect(c.flush()).toBe(null);
	});

	it('speakable replaces bare links', () => {
		expect(speakable('Go to https://three.ws/audio2face now')).toBe('Go to the link now');
	});
});

describe('percentile and summarizeTimings', () => {
	it('interpolates p50 and p95 and ignores missing values', () => {
		const xs = Array.from({ length: 20 }, (_, i) => (i + 1) * 100);
		expect(percentile(xs, 50)).toBe(1050);
		expect(percentile(xs, 95)).toBe(1905);
		expect(percentile([null, undefined], 50)).toBe(null);
		const s = summarizeTimings([{ total: 100 }, { total: 300 }, {}], ['total']);
		expect(s.total).toEqual({ p50: 200, p95: 290, n: 2 });
	});
});

describe('LaneHealth', () => {
	it('skips a failed lane for a doubling cooldown, then lets it be probed', () => {
		let t = 0;
		const h = new LaneHealth({ now: () => t, baseMs: 1000 });
		h.fail('stream', 'provider_error');
		expect(h.allow('stream')).toBe(false);
		t = 1000;
		expect(h.allow('stream')).toBe(true);
		h.fail('stream');
		t = 2500;
		expect(h.allow('stream')).toBe(false);
		t = 3000;
		expect(h.allow('stream')).toBe(true);
		h.ok('stream');
		expect(h.snapshot()).toEqual({});
	});
});

describe('readSSE', () => {
	it('parses data-only frames and named event frames split across reads', async () => {
		const got = [];
		await readSSE(
			streamOf(
				'data: {"type":"chunk","text":"Hi"}\n\nevent: audio\ndata: {"seq":0}\n\n: comment\n\nevent: done\r\ndata: {"ok":true}\r\n\r\n',
			),
			(e, d) => got.push([e, d]),
		);
		expect(got).toEqual([
			['message', { type: 'chunk', text: 'Hi' }],
			['audio', { seq: 0 }],
			['done', { ok: true }],
		]);
	});
});

// A stand-in for createDigitalHumanClient with the real call surface.
function fakeClient(log, { tokens, failStream = false, failClip = false, failChat = false } = {}) {
	return {
		async transcribe() {
			log.push('asr');
			await tick();
			return { text: 'What is Audio2Face?' };
		},
		async chat({ onToken }) {
			if (failChat)
				throw Object.assign(new Error('down'), { stage: 'llm', code: 'upstream_error' });
			let reply = '';
			for (const t of tokens) {
				await tick();
				log.push(`token:${t.trim()}`);
				reply += t;
				onToken(t);
			}
			log.push('llm:done');
			return { reply };
		},
		async speakLine({ text, onEvent }) {
			log.push(`line:${text}`);
			if (failStream) {
				throw Object.assign(new Error('tts down'), {
					stage: 'tts',
					code: 'provider_unreachable',
				});
			}
			await tick();
			onEvent('meta', { sampleRateHz: 22050 });
			onEvent('audio', { seq: 0, pcm: '' });
			onEvent('frames', { frames: [{ t: 0, w: [0.2] }] });
			await tick();
			return { frameCount: 1, degraded: null };
		},
		async speakClip({ text }) {
			log.push(`clip:${text}`);
			if (failClip)
				throw Object.assign(new Error('all tts lanes down'), { code: 'tts_unavailable' });
			return new Uint8Array(4);
		},
		async speakBlocking({ text }) {
			log.push(`blocking:${text}`);
			await tick(20);
			return { audio: { base64: '' }, animation: { frames: [{ t: 0, w: [0] }] } };
		},
	};
}

describe('runTurn pipelining', () => {
	it('starts voicing the first sentence before the LLM has finished', async () => {
		const log = [];
		const client = fakeClient(log, {
			tokens: ['Audio2Face ', 'animates faces. ', 'It runs ', 'on NVIDIA. ', 'Ask me more.'],
		});
		const out = await runTurn({ client, audio: new Uint8Array(8), sink: {} });
		const firstLine = log.findIndex((l) => l.startsWith('line:'));
		expect(firstLine).toBeGreaterThan(-1);
		expect(firstLine).toBeLessThan(log.indexOf('llm:done'));
		expect(log[firstLine]).toBe('line:Audio2Face animates faces.');
		expect(out.lanes.every((l) => l === 'stream')).toBe(true);
		for (const k of ['asrText', 'llmFirstToken', 'ttsFirstAudio', 'a2fFirstFrame', 'total']) {
			expect(typeof out.timings[k]).toBe('number');
		}
		expect(out.timings.ttsFirstAudio).toBeLessThan(out.timings.llmDone);
		expect(out.degraded).toBe(null);
	});

	it('serial strategy waits for the whole reply (the measured baseline)', async () => {
		const log = [];
		const client = fakeClient(log, { tokens: ['One. ', 'Two.'] });
		const out = await runTurn({ client, text: 'hi', strategy: 'serial' });
		expect(log.indexOf('blocking:One. Two.')).toBeGreaterThan(log.indexOf('llm:done'));
		expect(out.lanes).toEqual(['blocking']);
	});
});

describe('runTurn fallbacks', () => {
	it('falls back to the clip lane when the stream lane fails, and remembers it', async () => {
		const log = [];
		const health = new LaneHealth();
		const played = [];
		const client = fakeClient(log, {
			tokens: ['Hello there. ', 'This is a much longer second sentence that follows.'],
			failStream: true,
		});
		const out = await runTurn({
			client,
			text: 'hi',
			health,
			sink: { playClip: async (i, wav, text) => played.push(text) },
		});
		expect(out.lanes).toEqual(['clip', 'clip']);
		expect(played).toEqual([
			'Hello there.',
			'This is a much longer second sentence that follows.',
		]);
		// The breaker kept the second segment from paying the stream failure again.
		expect(log.filter((l) => l.startsWith('line:'))).toHaveLength(1);
		expect(out.degraded).toBe('tts:clip');
		expect(health.snapshot().stream.reason).toBe('provider_unreachable');
	});

	it('falls back to the browser voice when every server voice is down', async () => {
		const spoken = [];
		const client = fakeClient([], { tokens: ['Hi.'], failStream: true, failClip: true });
		const out = await runTurn({
			client,
			text: 'hi',
			sink: { speakBrowser: async (i, t) => spoken.push(t) },
		});
		expect(spoken).toEqual(['Hi.']);
		expect(out.lanes).toEqual(['browser']);
		expect(out.degraded).toBe('tts:browser');
	});

	it('captions when no voice exists at all', async () => {
		const captions = [];
		const client = fakeClient([], { tokens: ['Hi.'], failStream: true, failClip: true });
		const out = await runTurn({
			client,
			text: 'hi',
			sink: { caption: (i, t) => captions.push(t) },
		});
		expect(captions).toEqual(['Hi.']);
		expect(out.lanes).toEqual(['text']);
	});

	it('speaks an honest error when the LLM is down', async () => {
		const log = [];
		let replaced = null;
		const client = fakeClient(log, { tokens: [], failChat: true });
		const out = await runTurn({ client, text: 'hi', sink: { replace: (t) => (replaced = t) } });
		expect(replaced).toMatch(/language model/);
		expect(log.some((l) => l.startsWith('line:Sorry'))).toBe(true);
		expect(out.degraded).toBe('llm');
	});

	it('reports an ASR failure instead of guessing', async () => {
		const client = {
			...fakeClient([], { tokens: [] }),
			transcribe: async () => {
				throw Object.assign(new Error('asr down'), {
					stage: 'asr',
					code: 'provider_unreachable',
				});
			},
		};
		const out = await runTurn({ client, audio: new Uint8Array(4) });
		expect(out.failedStage).toBe('asr');
		expect(out.errors[0]).toMatchObject({ stage: 'asr', code: 'provider_unreachable' });
	});

	it('does not replay a segment that already played partly before the stream cut', async () => {
		const log = [];
		const client = {
			...fakeClient(log, { tokens: ['Hello there.'] }),
			speakLine: async ({ onEvent }) => {
				onEvent('audio', { seq: 0, pcm: '' });
				throw Object.assign(new Error('cut'), {
					stage: 'tts',
					code: 'stream_cut',
					partial: true,
				});
			},
		};
		const out = await runTurn({
			client,
			text: 'hi',
			sink: { playClip: async () => log.push('clip-played') },
		});
		expect(log).not.toContain('clip-played');
		expect(out.errors[0]).toMatchObject({ lane: 'stream', code: 'stream_cut' });
	});
});

describe('runTurn say mode', () => {
	it('voices a given line through the stream lane without calling the LLM', async () => {
		const log = [];
		const client = fakeClient(log, { tokens: ['never'] });
		const out = await runTurn({ client, say: 'Hello there. I am a digital human.' });
		expect(log.some((l) => l.startsWith('token:'))).toBe(false);
		expect(log.filter((l) => l.startsWith('line:'))).toEqual([
			'line:Hello there.',
			'line:I am a digital human.',
		]);
		expect(out.reply).toBe('Hello there. I am a digital human.');
	});
});

describe('runTurn timings', () => {
	it('records no ASR stage for a typed question', async () => {
		const out = await runTurn({
			client: fakeClient([], { tokens: ['Hi there.'] }),
			text: 'hi',
		});
		expect(out.timings.asrText).toBeUndefined();
		expect(typeof out.timings.llmFirstToken).toBe('number');
	});
});
