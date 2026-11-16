// /api/clips/voice: quota and duration enforcement around the NVIDIA voice and
// face calls. The upstream modules are replaced so no network or key is used;
// the WAV parsing and policy math run for real.

import { describe, it, expect, vi, beforeEach } from 'vitest';

const sqlMock = vi.fn();
vi.mock('../api/_lib/db.js', () => ({
	sql: sqlMock,
	isDbUnavailableError: () => false,
	isDbCapacityError: () => false,
	isStoragePressured: () => false,
}));

const sessionMock = vi.fn();
const bearerMock = vi.fn();
vi.mock('../api/_lib/auth.js', () => ({
	getSessionUser: (...a) => sessionMock(...a),
	authenticateBearer: (...a) => bearerMock(...a),
	extractBearer: () => null,
}));

const clipUserMock = vi.fn();
const clipIpMock = vi.fn();
vi.mock('../api/_lib/rate-limit.js', () => ({
	limits: { clipUser: (...a) => clipUserMock(...a), clipIp: (...a) => clipIpMock(...a) },
	clientIp: () => '203.0.113.7',
}));

const ttsMock = vi.fn();
vi.mock('../api/_lib/tts-nvidia.js', () => ({
	synthesizeNvidiaTts: (...a) => ttsMock(...a),
	nvidiaTtsConfigured: () => true,
}));

const a2fMock = vi.fn();
vi.mock('../api/_lib/a2f-nvidia.js', () => ({
	animateNvidiaA2F: (...a) => a2fMock(...a),
	nvidiaA2fConfigured: () => true,
}));

const { default: handler } = await import('../api/clips/voice.js');
const { CLIP_PLANS } = await import('../api/_lib/clip-policy.js');

function wav(seconds, rate = 44100) {
	const data = Buffer.alloc(Math.round(seconds * rate) * 2);
	const h = Buffer.alloc(44);
	h.write('RIFF', 0);
	h.writeUInt32LE(36 + data.length, 4);
	h.write('WAVE', 8);
	h.write('fmt ', 12);
	h.writeUInt32LE(16, 16);
	h.writeUInt16LE(1, 20);
	h.writeUInt16LE(1, 22);
	h.writeUInt32LE(rate, 24);
	h.writeUInt32LE(rate * 2, 28);
	h.writeUInt16LE(2, 32);
	h.writeUInt16LE(16, 34);
	h.write('data', 36);
	h.writeUInt32LE(data.length, 40);
	return Buffer.concat([h, data]);
}

function mkReq({ method = 'POST', body = null } = {}) {
	return {
		method,
		url: '/api/clips/voice',
		headers: { 'content-type': 'application/json', origin: 'http://localhost:3267' },
		on(event, cb) {
			if (event === 'data' && body != null) {
				queueMicrotask(() => {
					cb(Buffer.from(JSON.stringify(body)));
					this._endCb?.();
				});
			} else if (event === 'end') {
				this._endCb = cb;
				if (body == null) queueMicrotask(() => cb());
			}
		},
		destroy() {},
	};
}

function mkRes() {
	return {
		statusCode: 200,
		headers: {},
		body: undefined,
		writableEnded: false,
		setHeader(k, v) {
			this.headers[k.toLowerCase()] = v;
		},
		getHeader(k) {
			return this.headers[k.toLowerCase()];
		},
		end(b) {
			this.body = b;
			this.writableEnded = true;
		},
	};
}

async function call(opts) {
	const res = mkRes();
	await handler(mkReq(opts), res);
	return { status: res.statusCode, body: res.body ? JSON.parse(res.body) : undefined };
}

const TRACK = { fps: 30, blendShapeNames: ['jawOpen'], frames: [{ t: 0, w: [0.2] }], frameCount: 1, durationSec: 0.03 };
const ok = (remaining) => ({ success: true, limit: 10, remaining, reset: Date.parse('2026-11-17T00:00:00Z') });

beforeEach(() => {
	sqlMock.mockReset().mockResolvedValue([]);
	sessionMock.mockReset().mockResolvedValue(null);
	bearerMock.mockReset().mockResolvedValue(null);
	clipUserMock.mockReset().mockResolvedValue(ok(9));
	clipIpMock.mockReset().mockResolvedValue(ok(2));
	ttsMock.mockReset().mockResolvedValue({ audio: wav(2), contentType: 'audio/wav', sampleRateHz: 44100, voiceName: 'Magpie-Multilingual.EN-US.Aria' });
	a2fMock.mockReset().mockResolvedValue(TRACK);
});

describe('GET /api/clips/voice', () => {
	it('reports the plan allowance without consuming quota', async () => {
		sessionMock.mockResolvedValue({ id: 'u1', plan: 'pro' });
		const { status, body } = await call({ method: 'GET' });
		expect(status).toBe(200);
		expect(body).toMatchObject({ configured: true, signedIn: true, plan: 'pro', perDay: CLIP_PLANS.pro.perDay, maxSeconds: CLIP_PLANS.pro.maxSeconds });
		expect(body.voices.length).toBeGreaterThan(0);
		expect(clipUserMock).not.toHaveBeenCalled();
		expect(clipIpMock).not.toHaveBeenCalled();
	});
});

describe('POST /api/clips/voice', () => {
	it('voices and animates a line, charging one clip to the signed-in plan', async () => {
		sessionMock.mockResolvedValue({ id: 'u1', plan: 'free' });
		const { status, body } = await call({ body: { text: 'Hello from three.ws.', voice: 'nova' } });
		expect(status).toBe(200);
		expect(body.ok).toBe(true);
		expect(body.audio.durationSec).toBeCloseTo(2, 3);
		expect(body.animation).toEqual(TRACK);
		expect(body.quota).toMatchObject({ plan: 'free', perDay: CLIP_PLANS.free.perDay, remaining: 9, resetAt: '2026-11-17T00:00:00.000Z' });
		expect(clipUserMock).toHaveBeenCalledWith('u1', 'free', CLIP_PLANS.free.perDay);
		expect(a2fMock.mock.calls[0][0].wav).toBeInstanceOf(Buffer);
	});

	it('rejects an over-long line before touching quota or NVIDIA', async () => {
		const { status, body } = await call({ body: { text: 'a'.repeat(CLIP_PLANS.anonymous.maxSeconds * 18 + 1) } });
		expect(status).toBe(400);
		expect(body.error).toBe('too_long');
		expect(clipIpMock).not.toHaveBeenCalled();
		expect(ttsMock).not.toHaveBeenCalled();
	});

	it('returns clip_quota with the reset time once the daily allowance is spent', async () => {
		clipIpMock.mockResolvedValue({ success: false, limit: 3, remaining: 0, reset: Date.parse('2026-11-17T00:00:00Z') });
		const { status, body } = await call({ body: { text: 'Hi.' } });
		expect(status).toBe(429);
		expect(body.code).toBe('clip_quota');
		expect(body.quota).toMatchObject({ plan: 'anonymous', remaining: 0, resetAt: '2026-11-17T00:00:00.000Z' });
		expect(ttsMock).not.toHaveBeenCalled();
		expect(a2fMock).not.toHaveBeenCalled();
	});

	it('enforces the duration cap on the measured speech, not just the text length', async () => {
		ttsMock.mockResolvedValue({ audio: wav(CLIP_PLANS.anonymous.maxSeconds + 1, 16000), contentType: 'audio/wav', sampleRateHz: 16000, voiceName: 'x' });
		const { status, body } = await call({ body: { text: 'A short line spoken very slowly.' } });
		expect(status).toBe(400);
		expect(body.error).toBe('too_long');
		expect(a2fMock).not.toHaveBeenCalled();
	});

	it('animates an uploaded recording and rejects one past the cap', async () => {
		const pcm = Buffer.alloc(16000 * 2 * 3).toString('base64');
		const good = await call({ body: { audio: pcm, sampleRate: 16000 } });
		expect(good.status).toBe(200);
		expect(good.body.audio).toBeUndefined();
		expect(a2fMock.mock.calls[0][0]).toMatchObject({ sampleRateHz: 16000 });

		const long = Buffer.alloc(16000 * 2 * (CLIP_PLANS.anonymous.maxSeconds + 1)).toString('base64');
		const bad = await call({ body: { audio: long, sampleRate: 16000 } });
		expect(bad.status).toBe(400);
		expect(bad.body.error).toBe('too_long');
		expect(clipIpMock).toHaveBeenCalledTimes(1);
	});

	it('names the failing stage when NVIDIA is unavailable', async () => {
		a2fMock.mockRejectedValue(Object.assign(new Error('deadline exceeded'), { code: 'timeout' }));
		const face = await call({ body: { text: 'Hi.' } });
		expect(face.status).toBe(504);
		expect(face.body).toMatchObject({ stage: 'face' });

		ttsMock.mockRejectedValue(Object.assign(new Error('busy'), { code: 'rate_limited' }));
		const voice = await call({ body: { text: 'Hi.' } });
		expect(voice.status).toBe(429);
		expect(voice.body).toMatchObject({ stage: 'voice', error: 'rate_limited' });
	});
});
