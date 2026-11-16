// The spoken-line stream overlaps synthesis, playback and Audio2Face.
//
// Pins two behaviours of api/_lib/digital-human-stream.js:
//   1. Pipelining: audio reaches the browser and Audio2Face while Magpie is
//      still synthesizing (the old path waited for the whole clip first).
//   2. Degrade, don't die: an A2F failure keeps the audio flowing and emits
//      `degraded` so the browser falls back to amplitude lipsync.
// The NVIDIA transports are replaced with in-process stand-ins that follow the
// real call order; the live round trip is scripts/digital-human-latency-bench.mjs.

import { describe, it, expect } from 'vitest';
import { streamSpeechAnimation } from '../api/_lib/digital-human-stream.js';

function chunk(samples, value = 1000) {
	const b = Buffer.alloc(samples * 2);
	for (let i = 0; i < samples; i++) b.writeInt16LE(value, i * 2);
	return b;
}

// Magpie stand-in: emits `n` chunks, recording the order of events in `log`.
function fakeTts(log, n = 4, { failAfter = null } = {}) {
	return async ({ onChunk }) => {
		for (let i = 0; i < n; i++) {
			if (failAfter !== null && i === failAfter) {
				throw Object.assign(new Error('UNAVAILABLE'), { code: 'provider_unreachable' });
			}
			log.push(`tts:${i}`);
			onChunk(chunk(2205));
			await new Promise((r) => setImmediate(r));
		}
		log.push('tts:end');
		return { voiceName: 'Magpie-Multilingual.EN-US.Aria', sampleRateHz: 22050 };
	};
}

function fakeA2f(log, { failOpen = false, failDone = false } = {}) {
	return async ({ onHeader, onFrames }) => {
		if (failOpen) throw Object.assign(new Error('NOT_FOUND'), { code: 'function_not_found' });
		let written = 0;
		let resolveDone;
		let rejectDone;
		const done = new Promise((res, rej) => {
			resolveDone = res;
			rejectDone = rej;
		});
		done.catch(() => {});
		return {
			write(int16) {
				written += int16.length;
				log.push(`a2f:write`);
				if (written === int16.length) onHeader(['JawOpen']);
				onFrames([{ t: written / 16000, w: [0.5] }]);
			},
			end() {
				log.push('a2f:end');
				if (failDone)
					rejectDone(
						Object.assign(new Error('RESOURCE_EXHAUSTED'), { code: 'rate_limited' }),
					);
				else
					resolveDone({
						functionId: 'fn-active',
						healedFrom: null,
						blendShapeNames: ['JawOpen'],
						frameCount: 4,
					});
			},
			cancel() {
				log.push('a2f:cancel');
			},
			done,
		};
	};
}

function collect() {
	const events = [];
	return { events, emit: (type, data) => events.push({ type, data }) };
}

describe('streamSpeechAnimation pipelining', () => {
	it('forwards audio and feeds A2F before synthesis has finished', async () => {
		const log = [];
		const { events, emit } = collect();
		const out = await streamSpeechAnimation(
			{ text: 'Hello there.', emit },
			{ synthesize: fakeTts(log), openSession: fakeA2f(log) },
		);
		// A2F received audio and produced frames while Magpie still had chunks to go.
		expect(log.indexOf('a2f:write')).toBeLessThan(log.indexOf('tts:end'));
		const firstFrames = events.findIndex((e) => e.type === 'frames');
		const lastAudio = events.map((e) => e.type).lastIndexOf('audio');
		expect(firstFrames).toBeGreaterThan(-1);
		expect(firstFrames).toBeLessThan(lastAudio);
		expect(events[0].type).toBe('meta');
		expect(events.filter((e) => e.type === 'audio')).toHaveLength(4);
		expect(out.degraded).toBe(null);
		expect(out.functionId).toBe('fn-active');
		expect(out.frameCount).toBe(4);
		expect(events.at(-1).type).toBe('done');
	});

	it('resamples 22.05 kHz playback audio to 16 kHz for A2F', async () => {
		let written = 0;
		const openSession = async () => ({
			write: (a) => {
				written += a.length;
			},
			end() {},
			cancel() {},
			done: Promise.resolve({ functionId: 'f', healedFrom: null }),
		});
		await streamSpeechAnimation(
			{ text: 'x', emit: () => {} },
			{ synthesize: fakeTts([], 10), openSession },
		);
		// 10 chunks x 2205 samples = 1 s at 22050 Hz -> ~16000 samples.
		expect(Math.abs(written - 16000)).toBeLessThanOrEqual(2);
	});
});

describe('streamSpeechAnimation degrades instead of failing', () => {
	it('keeps the audio when the A2F session cannot open', async () => {
		const { events, emit } = collect();
		const out = await streamSpeechAnimation(
			{ text: 'Hi.', emit },
			{ synthesize: fakeTts([]), openSession: fakeA2f([], { failOpen: true }) },
		);
		expect(events.filter((e) => e.type === 'audio')).toHaveLength(4);
		expect(events.find((e) => e.type === 'degraded').data).toMatchObject({
			stage: 'a2f',
			code: 'function_not_found',
		});
		expect(out.degraded).toBe('function_not_found');
	});

	it('keeps the audio when A2F fails at the end of the clip', async () => {
		const { events, emit } = collect();
		const out = await streamSpeechAnimation(
			{ text: 'Hi.', emit },
			{ synthesize: fakeTts([]), openSession: fakeA2f([], { failDone: true }) },
		);
		expect(events.filter((e) => e.type === 'audio')).toHaveLength(4);
		expect(out.degraded).toBe('rate_limited');
		expect(events.at(-1).type).toBe('done');
	});

	it('throws with stage tts when synthesis fails, and cancels A2F', async () => {
		const log = [];
		await expect(
			streamSpeechAnimation(
				{ text: 'Hi.', emit: () => {} },
				{ synthesize: fakeTts(log, 4, { failAfter: 2 }), openSession: fakeA2f(log) },
			),
		).rejects.toMatchObject({ stage: 'tts', partial: true, code: 'provider_unreachable' });
		expect(log).toContain('a2f:cancel');
	});
});
