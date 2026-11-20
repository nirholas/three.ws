/**
 * StreamSpeechPlayer amplitude lipsync must not lead the audio.
 *
 * Bug: the analyser that drives the amplitude mouth sat directly on the output
 * bus, so it read each sample the moment Web Audio rendered it, while the
 * listener hears that sample `outputLatency + baseLatency` later (40 to 150 ms
 * on real hardware, more on Bluetooth). The A2F path already compensated for
 * that latency; the amplitude path, which is the only path for Grok realtime
 * audio, did not, so the mouth opened before the sound.
 *
 * Fix pinned here: the audible path goes straight to the speakers and the
 * analyser is fed through a DelayNode set to the context's output latency
 * (kept current, since browsers report outputLatency late), with its own
 * output muted so the tap is never heard.
 */
import { describe, it, expect, beforeAll } from 'vitest';

function graph({ outputLatency = 0.04, baseLatency = 0.01 } = {}) {
	const edges = [];
	let id = 0;
	const node = (kind, extra = {}) => {
		const n = {
			kind,
			id: id++,
			connect(to) {
				edges.push([n, to]);
				return to;
			},
			disconnect() {},
			...extra,
		};
		return n;
	};
	const ctx = {
		currentTime: 0,
		outputLatency,
		baseLatency,
		destination: node('destination'),
		createGain: () => node('gain', { gain: { value: 1 } }),
		createAnalyser: () => node('analyser', { frequencyBinCount: 128, getByteFrequencyData(b) { b.fill(0); } }),
		createDelay: (max) => node('delay', { maxDelayTime: max, delayTime: { value: 0 } }),
		createBuffer: (ch, len, rate) => ({ duration: len / rate, copyToChannel() {} }),
		createBufferSource: () => node('source', { start() {}, stop() {} }),
	};
	const from = (n) => edges.filter(([a]) => a === n).map(([, b]) => b);
	const into = (n) => edges.filter(([, b]) => b === n).map(([a]) => a);
	return { ctx, edges, from, into };
}

let StreamSpeechPlayer;
beforeAll(async () => {
	globalThis.requestAnimationFrame ??= () => 1;
	globalThis.cancelAnimationFrame ??= () => {};
	({ StreamSpeechPlayer } = await import('../src/voice/stream-speech-player.js'));
});

describe('amplitude lipsync is delayed to what the listener hears', () => {
	it('feeds the analyser through a delay equal to outputLatency + baseLatency', () => {
		const g = graph({ outputLatency: 0.04, baseLatency: 0.01 });
		const p = new StreamSpeechPlayer({ ctx: g.ctx, a2f: null, mouth: { setMouthShape() {} } });
		const feeders = g.into(p.analyser);
		expect(feeders).toHaveLength(1);
		expect(feeders[0].kind).toBe('delay');
		expect(feeders[0].delayTime.value).toBeCloseTo(0.05, 6);
		expect(g.into(feeders[0])).toEqual([p.out]);
		expect(p.lipsyncDelaySec).toBeCloseTo(0.05, 6);
	});

	it('plays the audible path straight to the speakers, never through the delay', () => {
		const g = graph();
		const p = new StreamSpeechPlayer({ ctx: g.ctx, a2f: null, mouth: { setMouthShape() {} } });
		expect(g.from(p.out)).toContain(g.ctx.destination);
	});

	it('never lets the delayed analysis tap reach the speakers audibly', () => {
		const g = graph();
		const p = new StreamSpeechPlayer({ ctx: g.ctx, a2f: null, mouth: { setMouthShape() {} } });
		for (const next of g.from(p.analyser)) {
			if (next === g.ctx.destination) throw new Error('analyser connects straight to the speakers');
			expect(next.kind).toBe('gain');
			expect(next.gain.value).toBe(0);
		}
	});

	it('tracks an outputLatency the browser reports late', () => {
		const g = graph({ outputLatency: 0, baseLatency: 0.005 });
		const p = new StreamSpeechPlayer({ ctx: g.ctx, a2f: null, mouth: { setMouthShape() {} } });
		expect(p.lipsyncDelaySec).toBeCloseTo(0.005, 6);
		g.ctx.outputLatency = 0.12; // a Bluetooth sink reports in after playback starts
		p.line(0, 'meta', { sampleRateHz: 24000 });
		p.line(0, 'audio', { pcm: Buffer.alloc(2400 * 2).toString('base64') });
		p._frame();
		expect(p.lipsyncDelaySec).toBeCloseTo(0.125, 6);
		expect(g.into(p.analyser)[0].delayTime.value).toBeCloseTo(0.125, 6);
	});
});
