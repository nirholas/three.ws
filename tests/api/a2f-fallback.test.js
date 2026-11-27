// POST /api/a2f when NVIDIA's Audio2Face-3D service is down, slow, refusing or
// answering garbage. A talking avatar must still speak with a moving mouth, so
// the endpoint answers a lower-fidelity track computed from the audio itself
// (amplitude + zero-crossing mouth shapes) instead of an error, inside a firm
// time budget, and stops calling a failing service for a while (a breaker)
// before probing it again.
//
// Only the network boundary is stubbed: animateNvidiaA2F (the gRPC call to
// NVCF) and Magpie synthesis. Audio decoding, validation, the fallback track,
// the track checks and the breaker are the real code.

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { Readable } from 'node:stream';
import { readFileSync } from 'node:fs';

const animate = vi.fn();
const synthesize = vi.fn();

vi.mock('../../api/_lib/a2f-nvidia.js', async (orig) => ({
	...(await orig()),
	animateNvidiaA2F: (...a) => animate(...a),
}));
vi.mock('../../api/_lib/tts-nvidia.js', async (orig) => ({
	...(await orig()),
	nvidiaTtsConfigured: () => true,
	synthesizeNvidiaTts: (...a) => synthesize(...a),
}));
vi.mock('../../api/_lib/auth.js', () => ({
	getSessionUser: vi.fn(async () => null),
	authenticateBearer: vi.fn(async () => null),
	extractBearer: vi.fn(() => null),
}));
const rl = vi.fn(async () => ({ success: true }));
vi.mock('../../api/_lib/rate-limit.js', () => ({
	limits: {
		a2fIp: (...a) => rl(...a),
		a2fUser: (...a) => rl(...a),
		a2fSegment: (...a) => rl(...a),
		digitalHumanKiosk: (...a) => rl(...a),
	},
	clientIp: () => '203.0.113.9',
}));

process.env.NVIDIA_API_KEY = 'nvapi-test';

const handler = (await import('../../api/a2f.js')).default;
const {
	a2fBreaker,
	createA2fBreaker,
	amplitudeTrack,
	validateA2fTrack,
	a2fBudgetMs,
	FALLBACK_BLENDSHAPES,
} = await import('../../api/_lib/a2f-fallback.js');

const FIXTURE = JSON.parse(
	readFileSync(new URL('../fixtures/a2f-emotion-response.json', import.meta.url), 'utf8'),
);

// ── Real-shaped audio: a 16 kHz mono 16-bit WAV with syllable-like bursts ───
function speechLikePcm(seconds, rate = 16000) {
	const n = Math.round(seconds * rate);
	const out = new Int16Array(n);
	for (let i = 0; i < n; i++) {
		const t = i / rate;
		// 4 syllables per second: a raised-sine envelope with silent gaps.
		const env = Math.max(0, Math.sin(Math.PI * 4 * t)) ** 2;
		const voiced = Math.sin(2 * Math.PI * 180 * t) + 0.4 * Math.sin(2 * Math.PI * 720 * t);
		out[i] = Math.round(env * voiced * 9000);
	}
	return out;
}
function wav(pcm, rate = 16000, { bits = 16, format = 1, channels = 1 } = {}) {
	const data = Buffer.from(pcm.buffer, pcm.byteOffset, pcm.byteLength);
	const h = Buffer.alloc(44);
	h.write('RIFF', 0);
	h.writeUInt32LE(36 + data.length, 4);
	h.write('WAVE', 8);
	h.write('fmt ', 12);
	h.writeUInt32LE(16, 16);
	h.writeUInt16LE(format, 20);
	h.writeUInt16LE(channels, 22);
	h.writeUInt32LE(rate, 24);
	h.writeUInt32LE(rate * channels * (bits / 8), 28);
	h.writeUInt16LE(channels * (bits / 8), 32);
	h.writeUInt16LE(bits, 34);
	h.write('data', 36);
	h.writeUInt32LE(data.length, 40);
	return Buffer.concat([h, data]);
}

function mkReq({ body, contentType = 'application/json', url = '/api/a2f' }) {
	const payload = Buffer.isBuffer(body) ? body : Buffer.from(JSON.stringify(body), 'utf8');
	const stream = Readable.from([payload]);
	stream.method = 'POST';
	stream.url = url;
	stream.headers = { 'content-type': contentType, host: 'localhost' };
	stream.socket = { remoteAddress: '203.0.113.9' };
	return stream;
}
function mkRes() {
	return {
		statusCode: 200,
		headers: {},
		body: '',
		setHeader(k, v) {
			this.headers[String(k).toLowerCase()] = v;
		},
		getHeader(k) {
			return this.headers[String(k).toLowerCase()];
		},
		removeHeader(k) {
			delete this.headers[String(k).toLowerCase()];
		},
		writeHead(s, h = {}) {
			this.statusCode = s;
			for (const [k, v] of Object.entries(h)) this.setHeader(k, v);
		},
		end(chunk) {
			if (chunk !== undefined) this.body += String(chunk);
			this.writableEnded = true;
		},
	};
}
async function post(body, opts = {}) {
	const res = mkRes();
	await handler(mkReq({ body, ...opts }), res);
	return { status: res.statusCode, headers: res.headers, body: JSON.parse(res.body || '{}') };
}
const audioBody = (seconds = 2, extra = {}) => ({
	audio: wav(speechLikePcm(seconds)).toString('base64'),
	...extra,
});
const fail = (code, message = `simulated ${code}`) =>
	Object.assign(new Error(message), { code });

// A real A2F answer, re-timed to the clip it is supposed to animate.
function realTrackFor(seconds) {
	const j = FIXTURE.joy;
	const frames = [];
	const n = Math.round(seconds * 30) + 1;
	for (let i = 0; i < n; i++) frames.push({ t: i / 30, w: j.frames[i % j.frames.length].w });
	return {
		fps: 30,
		blendShapeNames: j.blendShapeNames,
		frames,
		frameCount: frames.length,
		durationSec: seconds,
		model: 'audio2face-3d',
		functionId: j.functionId,
		healedFrom: null,
		emotion: null,
	};
}

beforeEach(() => {
	animate.mockReset();
	synthesize.mockReset();
	rl.mockClear();
	a2fBreaker.reset();
});
afterEach(() => {
	vi.useRealTimers();
});

describe('POST /api/a2f falls back when the NVIDIA service fails', () => {
	for (const code of ['provider_unreachable', 'timeout', 'rate_limited', 'function_not_found', 'provider_error', 'invalid_key']) {
		it(`answers a valid fallback track, not an error, on ${code}`, async () => {
			animate.mockRejectedValueOnce(fail(code));
			const r = await post(audioBody(2));
			expect(r.status).toBe(200);
			expect(r.headers['x-a2f-source']).toBe('fallback');
			const a = r.body.animation;
			expect(a.source).toBe('fallback');
			expect(a.fallback).toMatchObject({ reason: 'provider_failed', code });
			// The fallback passes the very checks a real A2F track must pass.
			expect(validateA2fTrack(a, 2)).toEqual({ ok: true });
			expect(a.blendShapeNames).toContain('JawOpen');
			// The mouth actually moves with the syllables: open and closed frames.
			const jaw = a.blendShapeNames.indexOf('JawOpen');
			const jw = a.frames.map((f) => f.w[jaw]);
			expect(Math.max(...jw)).toBeGreaterThan(0.3);
			expect(Math.min(...jw)).toBeLessThan(0.05);
		});
	}

	it('the text path keeps the synthesized audio when A2F fails', async () => {
		const clip = wav(speechLikePcm(1.5));
		synthesize.mockResolvedValueOnce({
			audio: clip,
			contentType: 'audio/wav',
			format: 'wav',
			voiceName: 'Magpie-Multilingual.EN-US.Aria',
			sampleRateHz: 16000,
		});
		animate.mockRejectedValueOnce(fail('provider_unreachable'));
		const r = await post({ text: 'Hello there, nice to meet you.' });
		expect(r.status).toBe(200);
		expect(r.body.audio.base64).toBe(clip.toString('base64'));
		expect(r.body.animation.source).toBe('fallback');
		expect(validateA2fTrack(r.body.animation, 1.5).ok).toBe(true);
	});

	it('a malformed track from the service is rejected and the fallback used', async () => {
		const bad = realTrackFor(2);
		bad.frames[10] = { t: bad.frames[10].t, w: bad.frames[10].w.map(() => 7) };
		animate.mockResolvedValueOnce(bad);
		const r = await post(audioBody(2));
		expect(r.status).toBe(200);
		expect(r.body.animation.source).toBe('fallback');
		expect(r.body.animation.fallback).toMatchObject({ reason: 'malformed_track' });
	});

	it('a healthy real track passes through untouched and is marked nvidia', async () => {
		animate.mockResolvedValueOnce(realTrackFor(2));
		const r = await post(audioBody(2));
		expect(r.status).toBe(200);
		expect(r.headers['x-a2f-source']).toBe('nvidia');
		expect(r.body.animation.source).toBe('nvidia');
		expect(r.body.animation.blendShapeNames).toEqual(FIXTURE.joy.blendShapeNames);
		expect(r.body.animation.fallback).toBeUndefined();
	});

	it('fallback: false keeps the honest provider error for callers that want it', async () => {
		animate.mockRejectedValueOnce(fail('provider_unreachable'));
		const r = await post(audioBody(2, { fallback: false }));
		expect(r.status).toBe(502);
		expect(r.body.error).toBe('provider_unreachable');
	});
});

describe('time budget: face animation never holds speech hostage', () => {
	it('a hung service yields the fallback inside the budget', async () => {
		vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] });
		animate.mockImplementation(() => new Promise(() => {}));
		const budget = a2fBudgetMs(2);
		const res = mkRes();
		const done = handler(mkReq({ body: audioBody(2) }), res);
		await vi.advanceTimersByTimeAsync(budget - 50);
		expect(res.writableEnded).toBeFalsy();
		await vi.advanceTimersByTimeAsync(100);
		await done;
		const body = JSON.parse(res.body);
		expect(res.statusCode).toBe(200);
		expect(body.animation.source).toBe('fallback');
		expect(body.animation.fallback).toMatchObject({ reason: 'provider_failed', code: 'timeout' });
		// The library's own deadline is the same budget, so the call ends too.
		expect(animate.mock.calls[0][0].timeoutMs).toBe(budget);
	});

	it('the budget is firm and bounded for every clip length', () => {
		expect(a2fBudgetMs(0)).toBeGreaterThanOrEqual(5000);
		expect(a2fBudgetMs(2)).toBeLessThan(a2fBudgetMs(20));
		expect(a2fBudgetMs(60)).toBeLessThanOrEqual(40_000);
		expect(a2fBudgetMs(NaN)).toBeGreaterThanOrEqual(5000);
	});
});

describe('breaker: stop calling a failing service, then probe again', () => {
	it('opens after 3 failures in a row, serving the fallback without calling NVIDIA', async () => {
		animate.mockRejectedValue(fail('provider_unreachable'));
		for (let i = 0; i < 3; i++) await post(audioBody(1));
		expect(animate).toHaveBeenCalledTimes(3);
		const r = await post(audioBody(1));
		expect(animate).toHaveBeenCalledTimes(3);
		expect(r.status).toBe(200);
		expect(r.body.animation.fallback).toMatchObject({ reason: 'breaker_open' });
		expect(r.body.animation.fallback.retryAfterSec).toBeGreaterThan(0);
		expect(validateA2fTrack(r.body.animation, 1).ok).toBe(true);
	});

	it('bad input does not count against the service', async () => {
		for (let i = 0; i < 4; i++) {
			const r = await post({ audio: Buffer.from('not a wav at all, just text').toString('base64') });
			expect(r.status).toBe(400);
		}
		expect(animate).not.toHaveBeenCalled();
		expect(a2fBreaker.state().state).toBe('closed');
	});

	it('probes once after the cooldown; success closes it, failure re-opens it longer', () => {
		let now = 1_000_000;
		const b = createA2fBreaker({ threshold: 3, cooldownMs: 30_000, maxCooldownMs: 120_000, now: () => now });
		for (let i = 0; i < 3; i++) {
			expect(b.allow()).toBe(true);
			b.failure('timeout');
		}
		expect(b.state().state).toBe('open');
		expect(b.allow()).toBe(false);
		now += 29_999;
		expect(b.allow()).toBe(false);
		now += 2;
		// Half-open: exactly one probe goes through, concurrent callers wait.
		expect(b.allow()).toBe(true);
		expect(b.state().state).toBe('half_open');
		expect(b.allow()).toBe(false);
		b.failure('timeout');
		expect(b.state()).toMatchObject({ state: 'open', cooldownMs: 60_000 });
		now += 60_001;
		expect(b.allow()).toBe(true);
		b.success();
		expect(b.state()).toMatchObject({ state: 'closed', failures: 0, cooldownMs: 30_000 });
		expect(b.allow()).toBe(true);
	});

	it('a probe that never reports back does not wedge the breaker half-open', () => {
		let now = 0;
		const b = createA2fBreaker({ threshold: 1, cooldownMs: 10_000, probeTimeoutMs: 45_000, now: () => now });
		b.failure('timeout');
		now += 10_001;
		expect(b.allow()).toBe(true);
		now += 45_001;
		expect(b.allow()).toBe(true);
	});

	it('the endpoint closes the breaker when the probe succeeds', async () => {
		vi.useFakeTimers({ toFake: ['Date'] });
		animate.mockRejectedValue(fail('provider_unreachable'));
		for (let i = 0; i < 3; i++) await post(audioBody(1));
		expect(a2fBreaker.state().state).toBe('open');
		vi.setSystemTime(Date.now() + a2fBreaker.state().cooldownMs + 1);
		animate.mockReset();
		animate.mockResolvedValueOnce(realTrackFor(1));
		const r = await post(audioBody(1));
		expect(r.body.animation.source).toBe('nvidia');
		expect(a2fBreaker.state().state).toBe('closed');
	});

	it('the capability probe reports the breaker', async () => {
		const res = mkRes();
		const req = mkReq({ body: {} });
		req.method = 'GET';
		await handler(req, res);
		const body = JSON.parse(res.body);
		expect(body.breaker).toMatchObject({ state: 'closed' });
		expect(body.fallback).toMatchObject({ model: 'amplitude-fallback' });
	});
});

describe('validation and limits', () => {
	it('rejects a WAV that is not 16-bit PCM with a clear message', async () => {
		const pcm8 = new Int16Array(8000);
		const r = await post({ audio: wav(pcm8, 16000, { bits: 8 }).toString('base64') });
		expect(r.status).toBe(400);
		expect(r.body.error_description || r.body.message || JSON.stringify(r.body)).toMatch(/16-bit/);
		expect(animate).not.toHaveBeenCalled();
	});

	it('rejects audio longer than 60 seconds before calling the service', async () => {
		const r = await post({ audio: wav(new Int16Array(61 * 8000), 8000).toString('base64') });
		expect(r.status).toBe(400);
		expect(JSON.stringify(r.body)).toMatch(/60s/);
		expect(animate).not.toHaveBeenCalled();
	});

	it('rejects a raw PCM sample rate outside 8-48 kHz', async () => {
		for (const sampleRate of [100, 192000]) {
			const r = await post({
				audio: Buffer.from(new Int16Array(1600).buffer).toString('base64'),
				format: 'pcm',
				sampleRate,
			});
			expect(r.status).toBe(400);
			expect(JSON.stringify(r.body)).toMatch(/8000.*48000/);
		}
		expect(animate).not.toHaveBeenCalled();
	});

	it('rejects an unsupported format name instead of guessing', async () => {
		const r = await post({ audio: Buffer.from('ID3....').toString('base64'), format: 'mp3' });
		expect(r.status).toBe(400);
		expect(JSON.stringify(r.body)).toMatch(/wav.*pcm/i);
	});

	it('the rate limit still guards the shared key on the fallback path', async () => {
		rl.mockResolvedValueOnce({ success: false, reset: Date.now() + 60_000, limit: 10, remaining: 0 });
		const r = await post(audioBody(1));
		expect(r.status).toBe(429);
		expect(animate).not.toHaveBeenCalled();
	});
});

describe('amplitudeTrack and validateA2fTrack', () => {
	it('builds a 30 fps track whose length matches the audio', () => {
		const t = amplitudeTrack(speechLikePcm(3), 16000);
		expect(t.fps).toBe(30);
		expect(t.blendShapeNames).toEqual(FALLBACK_BLENDSHAPES);
		expect(Math.abs(t.frameCount - 90)).toBeLessThanOrEqual(1);
		expect(t.durationSec).toBeCloseTo(3, 3);
		for (const f of t.frames) for (const v of f.w) expect(v >= 0 && v <= 1).toBe(true);
	});

	it('silence stays a closed, resting mouth', () => {
		const t = amplitudeTrack(new Int16Array(16000), 16000);
		const jaw = t.blendShapeNames.indexOf('JawOpen');
		expect(Math.max(...t.frames.map((f) => f.w[jaw]))).toBe(0);
		expect(validateA2fTrack(t, 1).ok).toBe(true);
	});

	it('accepts the real captured A2F track', () => {
		expect(validateA2fTrack(FIXTURE.joy, FIXTURE.joy.durationSec)).toEqual({ ok: true });
	});

	it('rejects missing names, a row of the wrong width, NaN, and a track far shorter than the audio', () => {
		const good = realTrackFor(2);
		expect(validateA2fTrack({ ...good, blendShapeNames: [] }, 2).ok).toBe(false);
		expect(validateA2fTrack({ ...good, blendShapeNames: good.blendShapeNames.filter((n) => n !== 'JawOpen') }, 2).ok).toBe(false);
		const narrow = structuredClone(good);
		narrow.frames[3].w = narrow.frames[3].w.slice(1);
		expect(validateA2fTrack(narrow, 2).reason).toMatch(/width/);
		const nan = structuredClone(good);
		nan.frames[3].w[0] = null;
		expect(validateA2fTrack(nan, 2).ok).toBe(false);
		expect(validateA2fTrack(good, 6).reason).toMatch(/frames/);
		const backwards = structuredClone(good);
		backwards.frames[5].t = 0;
		expect(validateA2fTrack(backwards, 2).reason).toMatch(/time/);
	});
});
