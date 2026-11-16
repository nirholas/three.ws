// How a caller's emotion request (label, channel map, "off", strength, or just
// the reply text) becomes the A2F emotion options, and how the streamed
// digital-human path forwards the emotion A2F applied. Uses the real captured
// emotion_aggregate payloads from tests/fixtures/a2f-emotion-response.json.

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolveEmotionRequest } from '../api/_lib/a2f-emotion-wire.js';
import { streamSpeechAnimation } from '../api/_lib/digital-human-stream.js';

const FIXTURE = JSON.parse(readFileSync(new URL('./fixtures/a2f-emotion-response.json', import.meta.url), 'utf8'));
const anyOf = (a) => ({ type_url: a.type_url, value: Buffer.from(a.value_b64, 'base64') });

describe('resolveEmotionRequest', () => {
	it('an explicit label wins over the text', () => {
		const r = resolveEmotionRequest({ emotion: 'sad', text: 'This is wonderful, I love it!' });
		expect(r.intent).toMatchObject({ label: 'sad', source: 'request' });
		expect(r.a2f).toMatchObject({ enabled: true, input: { sadness: 0.75, grief: 0.2 } });
	});

	it('derives the intent from the reply text when none is given', () => {
		const r = resolveEmotionRequest({ text: 'Wow, that is amazing news! I love it!' });
		expect(r.intent.source).toBe('text');
		expect(r.intent.label).toBe('joy');
		expect(r.a2f.input.joy).toBeGreaterThan(0.4);
	});

	it('"auto" is the same as omitting it', () => {
		expect(resolveEmotionRequest({ emotion: 'auto', text: 'I am so sorry for your loss.' }).intent.source).toBe('text');
	});

	it('neutral text, or an explicit neutral, lets A2F read the voice alone', () => {
		const a = resolveEmotionRequest({ text: 'The meeting is at three.' });
		expect(a.intent).toMatchObject({ label: 'neutral', source: 'audio' });
		expect(a.a2f).toEqual({ enabled: true, strength: undefined, input: undefined });
		const b = resolveEmotionRequest({ emotion: 'neutral', text: 'Wow, amazing!' });
		expect(b.intent).toMatchObject({ label: 'neutral', source: 'request' });
		expect(b.a2f.input).toBeUndefined();
	});

	it('off, or strength 0, turns emotion off entirely', () => {
		expect(resolveEmotionRequest({ emotion: 'off', text: 'Amazing!' })).toEqual({
			intent: { label: 'off', source: 'request' },
			a2f: { enabled: false },
		});
		expect(resolveEmotionRequest({ emotion: 'joy', emotionStrength: 0 }).a2f).toEqual({ enabled: false });
		expect(resolveEmotionRequest({ emotion: 'joy', emotionStrength: '0' }).a2f).toEqual({ enabled: false });
	});

	it('strength is clamped and passed through; a channel map is accepted', () => {
		const r = resolveEmotionRequest({ emotion: { anger: 2, nonsense: 1 }, emotionStrength: 1.7 });
		expect(r.a2f).toEqual({ enabled: true, strength: 1, input: { anger: 1 } });
		expect(r.intent.label).toBe('anger');
	});
});

describe('streamSpeechAnimation forwards emotion', () => {
	function deps(captured) {
		return {
			synthesize: async ({ onChunk }) => {
				onChunk(Buffer.alloc(4410 * 2));
				return { voiceName: 'v' };
			},
			openSession: async (opts) => {
				captured.opts = opts;
				let finish;
				const done = new Promise((r) => (finish = r));
				return {
					write() {},
					end() {
						opts.onHeader(['jawOpen']);
						FIXTURE.aggregates.forEach((a, i) => {
							opts.onFrames([{ t: i / 30, w: [0.1] }]);
							opts.onAnimationData?.({ metadata: { emotion_aggregate: anyOf(a) } });
						});
						finish({ functionId: 'f', healedFrom: null });
					},
					cancel() {},
					done,
				};
			},
		};
	}

	it('passes the emotion to A2F, streams the applied emotion and summarizes it in done', async () => {
		const captured = {};
		const events = [];
		const summary = await streamSpeechAnimation(
			{ text: 'hi', emotion: { input: { joy: 0.9 }, strength: 0.8 }, emit: (type, data) => events.push({ type, data }) },
			deps(captured),
		);
		expect(captured.opts.emotion).toEqual({ input: { joy: 0.9 }, strength: 0.8 });
		const emo = events.filter((e) => e.type === 'emotion');
		expect(emo.length).toBeGreaterThan(0);
		expect(emo[0].data.names).toContain('joy');
		expect(emo[0].data.frames[0].v.length).toBe(emo[0].data.names.length);
		const total = emo.reduce((n, e) => n + e.data.frames.length, 0);
		expect(summary.emotion.frameCount).toBe(total);
		expect(summary.emotion.dominant).toBe('joy');
		expect(summary.emotion.input).toEqual({ joy: 0.9 });
		expect(events.at(-1)).toMatchObject({ type: 'done', data: { emotion: summary.emotion } });
	});

	it('emotion off streams no emotion events', async () => {
		const events = [];
		const summary = await streamSpeechAnimation(
			{ text: 'hi', emotion: { enabled: false }, emit: (type, data) => events.push({ type, data }) },
			deps({}),
		);
		expect(events.some((e) => e.type === 'emotion')).toBe(false);
		expect(summary.emotion).toBe(null);
	});
});

describe('StreamSpeechPlayer lays streamed emotion onto the turn clock', async () => {
	const { StreamSpeechPlayer } = await import('../src/voice/stream-speech-player.js');
	const node = () => ({ connect() {}, getByteFrequencyData() {}, frequencyBinCount: 128 });
	function ctx() {
		return {
			currentTime: 0,
			destination: {},
			createGain: node,
			createAnalyser: node,
			createBuffer: (ch, len, rate) => ({ duration: len / rate, copyToChannel() {} }),
			createBufferSource: () => ({ connect() {}, start() {}, stop() {} }),
		};
	}

	it('maps emotion frames through the segment clock and hands the growing track to the A2F player', () => {
		globalThis.requestAnimationFrame ??= () => 1;
		const calls = [];
		const a2f = { reset() {}, setTrack() {}, setEmotionTrack: (t) => calls.push(t) };
		const p = new StreamSpeechPlayer({ ctx: ctx(), a2f, mouth: { setMouthShape() {} } });
		p.line(0, 'meta', { sampleRateHz: 16000 });
		p.line(0, 'audio', { pcm: Buffer.alloc(16000 * 2).toString('base64') }); // 1 s
		p.line(0, 'emotion', { names: ['joy', 'sadness'], frames: [{ t: 0.1, v: [0.8, 0] }, { t: 0.5, v: [0.9, 0] }] });
		p.line(0, 'emotion', { names: ['joy', 'sadness'], frames: [{ t: 0.5, v: [0.9, 0] }, { t: 0.9, v: [0.7, 0.1] }] });
		const track = calls.at(-1);
		expect(track.names).toEqual(['joy', 'sadness']);
		expect(track.frames.map((f) => +f.t.toFixed(3))).toEqual([0.1, 0.5, 0.9]);
		expect(calls.every((t) => t === track)).toBe(true);
		p.reset();
		p.line(1, 'audio', { pcm: Buffer.alloc(3200).toString('base64') });
		p.line(1, 'emotion', { names: ['joy', 'sadness'], frames: [{ t: 0, v: [0.2, 0] }] });
		expect(calls.at(-1)).not.toBe(track);
	});
});
