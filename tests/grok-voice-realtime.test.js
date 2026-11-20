/**
 * Grok Voice realtime client (src/voice/grok-realtime.js).
 *
 * Pinned against the documented realtime protocol (docs.x.ai speech-to-speech):
 * the socket opens with the broker's ephemeral secret as the
 * `xai-client-secret.<secret>` subprotocol, session.update carries the
 * broker's session plus resumption, mic audio goes up as 100 ms base64 PCM16
 * chunks at 16 kHz, reply audio deltas play through StreamSpeechPlayer, barge-in
 * truncates the reply to what was heard, and reconnects resume with
 * ?conversation_id= while reusing the secret inside its TTL.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

let rafQueue = [];
globalThis.requestAnimationFrame = (cb) => {
	rafQueue.push(cb);
	return rafQueue.length;
};
globalThis.cancelAnimationFrame = () => {};
function flushRaf(times = 1) {
	for (let i = 0; i < times; i++) {
		const q = rafQueue;
		rafQueue = [];
		for (const cb of q) cb();
	}
}

const { GrokRealtime, pcm16ToBase64 } = await import('../src/voice/grok-realtime.js');

class FakeWS {
	static all = [];
	constructor(url, protocols) {
		this.url = url;
		this.protocols = protocols;
		this.readyState = 0;
		this.sent = [];
		this.closedWith = null;
		FakeWS.all.push(this);
		queueMicrotask(() => {
			if (this.autoOpen === false) return;
			this.readyState = 1;
			this.onopen?.();
		});
	}
	send(s) {
		this.sent.push(JSON.parse(s));
	}
	close(code) {
		this.closedWith = code;
		this.readyState = 3;
	}
	server(msg) {
		this.onmessage?.({ data: JSON.stringify(msg) });
	}
	drop(code = 1006) {
		this.readyState = 3;
		this.onclose?.({ code });
	}
	types() {
		return this.sent.map((m) => m.type);
	}
}

class FakeMic {
	static last = null;
	constructor({ onFrame }) {
		this.onFrame = onFrame;
		this.sampleRate = 48000;
		this.disposed = false;
		FakeMic.last = this;
	}
	async start() {}
	getLevel() {
		return 0.3;
	}
	dispose() {
		this.disposed = true;
	}
}

class DeniedMic extends FakeMic {
	async start() {
		const e = new Error('Microphone access was blocked.');
		e.code = 'permission-denied';
		throw e;
	}
}

function fakeCtx() {
	const starts = [];
	const node = (extra = {}) => ({ connect: (to) => to, disconnect() {}, ...extra });
	const ctx = {
		currentTime: 0,
		outputLatency: 0.04,
		baseLatency: 0.01,
		state: 'running',
		level: 0,
		starts,
		destination: node(),
		createGain: () => node({ gain: { value: 1 } }),
		createDelay: () => node({ delayTime: { value: 0 } }),
		createAnalyser: () =>
			node({
				frequencyBinCount: 128,
				getByteFrequencyData: (b) => b.fill(ctx.level),
			}),
		createBuffer: (ch, len, rate) => ({ duration: len / rate, copyToChannel() {} }),
		createBufferSource: () =>
			node({
				start: (at) => starts.push(at),
				stop() {},
			}),
		resume: async () => {},
		close: vi.fn(async () => {
			ctx.state = 'closed';
		}),
	};
	return ctx;
}

const SECRET = 'xai-eph-secret-abc';
function brokerSession(overrides = {}) {
	return {
		client_secret: SECRET,
		expires_at: Math.floor(Date.now() / 1000) + 300,
		ws_url: 'wss://api.x.ai/v1/realtime?model=grok-voice-latest',
		model: 'grok-voice-latest',
		session: {
			instructions: 'You are Nova.',
			voice: 'eve',
			turn_detection: { type: 'server_vad' },
			audio: {
				input: { format: { type: 'audio/pcm', rate: 16000 }, transcription: { model: 'grok-transcribe' } },
				output: { format: { type: 'audio/pcm', rate: 24000 } },
			},
		},
		...overrides,
	};
}

function makeFetch(responses) {
	const calls = [];
	const impl = vi.fn(async (url, init) => {
		calls.push({ url, init, body: JSON.parse(init.body) });
		const next = typeof responses === 'function' ? responses(calls.length) : responses;
		return new Response(JSON.stringify(next.body), { status: next.status || 200, headers: { 'content-type': 'application/json' } });
	});
	impl.calls = calls;
	return impl;
}

let clock = 0;
function make(opts = {}) {
	const ctx = opts.ctx || fakeCtx();
	const fetchImpl = opts.fetchImpl || makeFetch({ body: brokerSession() });
	const voice = new GrokRealtime({
		sessionUrl: '/api/voice/grok/session',
		agentId: 'agent-1',
		mode: opts.mode || 'open',
		ctx: opts.ownCtx ? null : ctx,
		fetchImpl,
		WebSocketImpl: FakeWS,
		MicImpl: opts.MicImpl || FakeMic,
		mouth: { setMouthShape() {} },
		now: () => clock,
	});
	const events = [];
	for (const t of ['state', 'transcript', 'latency', 'error', 'interrupted']) {
		voice.addEventListener(t, (e) => events.push({ type: t, ...e.detail }));
	}
	return { voice, ctx, fetchImpl, events };
}

/** 100 ms of 24 kHz PCM16 as a base64 delta. */
const delta100ms = () => pcm16ToBase64(new Int16Array(2400).fill(1000));

beforeEach(() => {
	FakeWS.all = [];
	FakeMic.last = null;
	rafQueue = [];
	clock = 0;
});
afterEach(() => {
	vi.useRealTimers();
});

describe('connect', () => {
	it('mints through the broker and opens the socket with the ephemeral secret subprotocol', async () => {
		const { voice, fetchImpl } = make();
		await voice.connect();
		expect(fetchImpl.calls[0].url).toBe('/api/voice/grok/session');
		expect(fetchImpl.calls[0].init.method).toBe('POST');
		expect(fetchImpl.calls[0].init.credentials).toBe('include');
		expect(fetchImpl.calls[0].body).toEqual({ agent_id: 'agent-1' });
		const ws = FakeWS.all[0];
		expect(ws.url).toBe('wss://api.x.ai/v1/realtime?model=grok-voice-latest');
		expect(ws.protocols).toEqual([`xai-client-secret.${SECRET}`]);
		expect(voice.state).toBe('listening');
	});

	it('sends the broker session with resumption opted in', async () => {
		const { voice } = make();
		await voice.connect();
		const update = FakeWS.all[0].sent[0];
		expect(update.type).toBe('session.update');
		expect(update.session.instructions).toBe('You are Nova.');
		expect(update.session.voice).toBe('eve');
		expect(update.session.turn_detection).toEqual({ type: 'server_vad' });
		expect(update.session.audio.input.format.rate).toBe(16000);
		expect(update.session.resumption).toEqual({ enabled: true });
	});

	it('surfaces the broker 503 code and never opens a socket', async () => {
		const fetchImpl = makeFetch({
			status: 503,
			body: { error: 'grok_voice_not_configured', error_description: 'Grok voice is not enabled on this server yet.' },
		});
		const { voice, events } = make({ fetchImpl });
		await expect(voice.connect()).rejects.toMatchObject({ code: 'grok_voice_not_configured', status: 503 });
		expect(FakeWS.all).toHaveLength(0);
		expect(voice.state).toBe('error');
		expect(events.find((e) => e.type === 'error').message).toMatch(/not enabled/);
	});

	it('reports a blocked microphone with its permission code', async () => {
		const { voice } = make({ MicImpl: DeniedMic });
		await expect(voice.connect()).rejects.toMatchObject({ code: 'permission-denied' });
		expect(FakeWS.all[0].closedWith).toBe(1000);
	});
});

describe('microphone upstream', () => {
	it('sends 100 ms base64 PCM16 chunks at 16 kHz', async () => {
		const { voice } = make();
		await voice.connect();
		const ws = FakeWS.all[0];
		for (let i = 0; i < 40; i++) FakeMic.last.onFrame(new Float32Array(128).fill(0.25)); // 40 x 128 @ 48 kHz = 106.7 ms
		const appends = ws.sent.filter((m) => m.type === 'input_audio_buffer.append');
		expect(appends).toHaveLength(1);
		const bytes = atob(appends[0].audio).length;
		expect(bytes / 2).toBeGreaterThanOrEqual(1600);
		expect(bytes / 2).toBeLessThan(1720);
	});
});

describe('reply playback, transcripts and latency', () => {
	it('plays audio deltas, emits transcripts and measures end of speech to first audio', async () => {
		const { voice, ctx, events } = make();
		await voice.connect();
		const ws = FakeWS.all[0];
		ws.server({ type: 'input_audio_buffer.speech_started' });
		ws.server({ type: 'conversation.item.input_audio_transcription.updated', item_id: 'u1', transcript: 'hello the' });
		ws.server({ type: 'conversation.item.input_audio_transcription.completed', item_id: 'u1', transcript: 'hello there' });
		clock = 1000;
		ws.server({ type: 'input_audio_buffer.speech_stopped' });
		expect(voice.state).toBe('thinking');
		clock = 1420;
		ws.server({ type: 'response.output_audio.delta', item_id: 'a1', delta: delta100ms() });
		ws.server({ type: 'response.output_audio_transcript.delta', item_id: 'a1', delta: 'Hi!' });
		ws.server({ type: 'response.output_audio_transcript.done', item_id: 'a1', transcript: 'Hi!' });
		expect(ctx.starts).toHaveLength(1);
		expect(voice.state).toBe('speaking');
		expect(events.filter((e) => e.type === 'latency' && e.kind === 'response')).toEqual([{ type: 'latency', kind: 'response', ms: 420 }]);
		const t = events.filter((e) => e.type === 'transcript');
		expect(t.map((e) => [e.role, e.text, e.final])).toEqual([
			['user', 'hello the', false],
			['user', 'hello there', true],
			['assistant', 'Hi!', false],
			['assistant', 'Hi!', true],
		]);
	});

	it('measures first audio frame to first viseme and the residual A/V offset', async () => {
		const { voice, ctx, events } = make();
		await voice.connect();
		const ws = FakeWS.all[0];
		clock = 100;
		ws.server({ type: 'response.output_audio.delta', item_id: 'a1', delta: delta100ms() });
		const start = ctx.starts[0];
		// Before the audio is audible the delayed tap is still silent.
		flushRaf();
		expect(events.some((e) => e.kind === 'mouth')).toBe(false);
		// The sample reaches the listener at start + output latency; the delayed analyser now hears it.
		ctx.currentTime = start + 0.05;
		ctx.level = 200;
		clock = 214;
		flushRaf();
		const mouth = events.find((e) => e.kind === 'mouth');
		expect(mouth.ms).toBe(114);
		expect(mouth.output_latency_ms).toBe(50);
		expect(mouth.av_offset_ms).toBe(0);
	});
});

describe('barge-in', () => {
	it('cuts playback, truncates the reply to what was heard and drops its late audio', async () => {
		const { voice, ctx, events } = make();
		await voice.connect();
		const ws = FakeWS.all[0];
		for (let i = 0; i < 5; i++) ws.server({ type: 'response.output_audio.delta', item_id: 'a1', delta: delta100ms() });
		const first = ctx.starts[0];
		ctx.currentTime = first + 0.05 + 0.2; // 200 ms heard
		ws.server({ type: 'input_audio_buffer.speech_started' });
		const trunc = ws.sent.find((m) => m.type === 'conversation.item.truncate');
		expect(trunc).toEqual({ type: 'conversation.item.truncate', item_id: 'a1', content_index: 0, audio_end_ms: 200 });
		expect(voice.player.pending).toBe(0);
		expect(events.find((e) => e.type === 'interrupted')).toMatchObject({ itemId: 'a1', heardMs: 200 });
		const before = ctx.starts.length;
		ws.server({ type: 'response.output_audio.delta', item_id: 'a1', delta: delta100ms() });
		expect(ctx.starts).toHaveLength(before);
		expect(voice.state).toBe('listening');
	});
});

describe('push-to-talk', () => {
	it('disables server VAD, sends audio only while held and commits on release', async () => {
		const { voice } = make({ mode: 'ptt' });
		await voice.connect();
		const ws = FakeWS.all[0];
		expect(ws.sent[0].session.turn_detection).toEqual({ type: null });
		expect(voice.state).toBe('idle');
		for (let i = 0; i < 40; i++) FakeMic.last.onFrame(new Float32Array(128).fill(0.2));
		expect(ws.types()).not.toContain('input_audio_buffer.append');
		voice.pressTalk();
		expect(voice.state).toBe('listening');
		for (let i = 0; i < 20; i++) FakeMic.last.onFrame(new Float32Array(128).fill(0.2));
		clock = 500;
		voice.releaseTalk();
		expect(ws.types().slice(1)).toEqual(['input_audio_buffer.clear', 'input_audio_buffer.append', 'input_audio_buffer.commit', 'response.create']);
		expect(voice.state).toBe('thinking');
	});

	it('pressing while the avatar speaks cancels and truncates the reply', async () => {
		const { voice, ctx } = make({ mode: 'ptt' });
		await voice.connect();
		const ws = FakeWS.all[0];
		ws.server({ type: 'response.output_audio.delta', item_id: 'a9', delta: delta100ms() });
		ctx.currentTime = ctx.starts[0] + 0.05 + 0.04;
		voice.pressTalk();
		expect(ws.types()).toContain('response.cancel');
		expect(ws.sent.find((m) => m.type === 'conversation.item.truncate')).toMatchObject({ item_id: 'a9', audio_end_ms: 40 });
	});
});

describe('reconnect within the token TTL', () => {
	it('reuses a valid secret and resumes the conversation', async () => {
		vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
		const { voice, fetchImpl, events } = make();
		await voice.connect();
		FakeWS.all[0].server({ type: 'conversation.created', conversation: { id: 'conv_1' } });
		FakeWS.all[0].drop(1006);
		expect(voice.state).toBe('reconnecting');
		await vi.advanceTimersByTimeAsync(400);
		await Promise.resolve();
		const ws2 = FakeWS.all[1];
		expect(ws2.url).toBe('wss://api.x.ai/v1/realtime?model=grok-voice-latest&conversation_id=conv_1');
		expect(ws2.protocols).toEqual([`xai-client-secret.${SECRET}`]);
		expect(fetchImpl.calls).toHaveLength(1);
		expect(ws2.sent[0].session.resumption).toEqual({ enabled: true });
		expect(voice.state).toBe('listening');
		expect(events.some((e) => e.type === 'error')).toBe(false);
	});

	it('mints a fresh secret when the old one has expired', async () => {
		vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
		const fetchImpl = makeFetch((n) => ({
			body: brokerSession(n === 1 ? { expires_at: Math.floor(Date.now() / 1000) + 2 } : { client_secret: 'second-secret' }),
		}));
		const { voice } = make({ fetchImpl });
		await voice.connect();
		FakeWS.all[0].drop(1006);
		await vi.advanceTimersByTimeAsync(400);
		await Promise.resolve();
		expect(fetchImpl.calls).toHaveLength(2);
		expect(FakeWS.all[1].protocols).toEqual(['xai-client-secret.second-secret']);
	});

	it('gives up with an error after three failed attempts', async () => {
		vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
		const { voice, events } = make();
		await voice.connect();
		FakeWS.all[0].drop(1006);
		for (let i = 0; i < 3; i++) {
			await vi.advanceTimersByTimeAsync(400 * 2 ** i);
			await Promise.resolve();
			FakeWS.all[FakeWS.all.length - 1].drop(1006);
		}
		expect(voice.state).toBe('error');
		expect(events.find((e) => e.type === 'error')).toMatchObject({ code: 'connection_lost', fatal: true });
	});
});

describe('a connection that stayed up', () => {
	it('earns a fresh retry budget after a drop', async () => {
		vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] });
		const { voice } = make();
		await voice.connect();
		for (let round = 0; round < 5; round++) {
			vi.setSystemTime(Date.now() + 20_000);
			FakeWS.all[FakeWS.all.length - 1].drop(1006);
			await vi.advanceTimersByTimeAsync(400);
			await Promise.resolve();
			expect(voice.state).toBe('listening');
		}
		expect(FakeWS.all).toHaveLength(6);
	});
});

describe('teardown', () => {
	it('closes the socket with 1000, releases the mic and the owned audio context, and never reconnects', async () => {
		vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
		const ctx = fakeCtx();
		const OrigAC = globalThis.AudioContext;
		globalThis.AudioContext = function AudioContext() {
			return ctx;
		};
		try {
			const { voice } = make({ ownCtx: true });
			await voice.connect();
			const ws = FakeWS.all[0];
			voice.close();
			expect(ws.closedWith).toBe(1000);
			expect(FakeMic.last.disposed).toBe(true);
			expect(ctx.close).toHaveBeenCalled();
			expect(voice.state).toBe('closed');
			ws.drop(1006);
			await vi.advanceTimersByTimeAsync(5000);
			expect(FakeWS.all).toHaveLength(1);
		} finally {
			globalThis.AudioContext = OrigAC;
		}
	});

	it('leaves a caller-owned audio context open', async () => {
		const { voice, ctx } = make();
		await voice.connect();
		voice.close();
		expect(ctx.close).not.toHaveBeenCalled();
	});
});
