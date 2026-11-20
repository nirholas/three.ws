/**
 * Grok Voice realtime session broker (api/voice/grok/session.js +
 * api/_lib/grok-voice.js).
 *
 * The contract pinned here: the browser gets a short-lived client secret and
 * the session config, never the server key; no key means a clear 503 and never
 * a fake session; upstream failures map to stable codes. Upstream bodies use
 * the documented shapes (docs.x.ai/developers/rest-api-reference/inference/
 * voice): POST /v1/realtime/client_secrets answers { value, expires_at } and
 * GET /v1/tts/voices answers { voices: [{ voice_id, name, language }] }.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Readable } from 'node:stream';

const SERVER_KEY = 'xai-server-key-never-leaves-the-server';

const state = vi.hoisted(() => ({ key: null, user: null, rl: { success: true }, agent: null, events: [] }));

vi.mock('../api/_lib/env.js', async (orig) => {
	const real = await orig();
	return {
		...real,
		env: new Proxy(real.env, {
			get(target, prop) {
				if (prop === 'GROK_API_KEY') return state.key;
				return Reflect.get(target, prop);
			},
		}),
	};
});
vi.mock('../api/_lib/auth.js', async (orig) => ({
	...(await orig()),
	getRequestUser: async () => state.user,
}));
vi.mock('../api/_lib/rate-limit.js', async (orig) => ({
	...(await orig()),
	limits: { grokVoiceSessionUser: vi.fn(async () => ({ ...state.rl, reset: Date.now() + 1000 })) },
}));
vi.mock('../api/_lib/db.js', () => ({
	sql: async () => (state.agent ? [state.agent] : []),
}));
vi.mock('../api/_lib/usage.js', () => ({
	recordEvent: (evt) => state.events.push(evt),
}));

const lib = await import('../api/_lib/grok-voice.js');
const models = await import('../api/_lib/chat-models.js');
const { default: handler, GROK_VOICE_CLIENT_ID } = await import('../api/voice/grok/session.js');

function makeRes() {
	return {
		statusCode: 200,
		headers: {},
		body: null,
		setHeader(n, v) {
			this.headers[String(n).toLowerCase()] = v;
		},
		getHeader(n) {
			return this.headers[String(n).toLowerCase()];
		},
		end(b) {
			this.body = b ?? null;
		},
	};
}
function makeReq({ method = 'POST', body = null } = {}) {
	const payload = body == null ? '' : JSON.stringify(body);
	const req = Readable.from(payload ? [Buffer.from(payload)] : []);
	req.method = method;
	req.url = '/api/voice/grok/session';
	req.query = {};
	req.headers = { 'content-type': 'application/json', host: 'three.ws', 'x-forwarded-proto': 'https' };
	return req;
}
async function call(opts) {
	const res = makeRes();
	await handler(makeReq(opts), res);
	return { status: res.statusCode, body: res.body ? JSON.parse(String(res.body)) : null, raw: String(res.body ?? ''), res };
}

const fetchCalls = [];
function upstream(responder) {
	globalThis.fetch = vi.fn(async (url, init) => {
		fetchCalls.push({ url: String(url), init });
		return responder(String(url), init);
	});
}
const jsonRes = (status, body) =>
	new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

beforeEach(() => {
	state.key = SERVER_KEY;
	state.user = { id: 'user-1' };
	state.rl = { success: true };
	state.agent = null;
	state.events.length = 0;
	fetchCalls.length = 0;
	lib.resetVoicesCache();
	upstream((url) =>
		url.endsWith('/realtime/client_secrets')
			? jsonRes(200, { value: 'xai-eph-secret-abc', expires_at: 1795000000 })
			: jsonRes(200, { voices: [{ voice_id: 'eve', name: 'Eve', language: 'en' }, { voice_id: 'Ara', name: 'Ara', language: 'en' }] }),
	);
});

describe('no server key: a clear 503, never a fake session', () => {
	it('POST answers 503 grok_voice_not_configured and never calls xAI', async () => {
		state.key = null;
		const r = await call({ body: {} });
		expect(r.status).toBe(503);
		expect(r.body.error).toBe('grok_voice_not_configured');
		expect(fetchCalls).toHaveLength(0);
	});

	it('GET reports configured:false with no voices so the demo can offer the existing chain', async () => {
		state.key = null;
		const r = await call({ method: 'GET' });
		expect(r.status).toBe(200);
		expect(r.body.configured).toBe(false);
		expect(r.body.voices).toEqual([]);
		expect(r.body.model).toBe(models.GROK_VOICE_MODEL);
	});
});

describe('minting a session', () => {
	it('requires a signed-in user', async () => {
		state.user = null;
		const r = await call({ body: {} });
		expect(r.status).toBe(401);
		expect(fetchCalls).toHaveLength(0);
	});

	it('is rate limited per user', async () => {
		state.rl = { success: false };
		const r = await call({ body: {} });
		expect(r.status).toBe(429);
		expect(fetchCalls).toHaveLength(0);
	});

	it('returns the client secret, its expiry and the session config, never the server key', async () => {
		const r = await call({ body: {} });
		expect(r.status).toBe(200);
		expect(r.body.client_secret).toBe('xai-eph-secret-abc');
		expect(r.body.expires_at).toBe(1795000000);
		expect(r.body.ws_url).toBe(`${models.GROK_VOICE_REALTIME_URL}?model=${models.GROK_VOICE_MODEL}`);
		expect(r.body.session.voice).toBe(models.GROK_VOICE_DEFAULT_VOICE);
		expect(r.body.session.turn_detection).toEqual({ type: 'server_vad' });
		expect(r.body.session.audio.input.format).toEqual({ type: 'audio/pcm', rate: models.GROK_VOICE_INPUT_RATE });
		expect(r.body.session.audio.output.format).toEqual({ type: 'audio/pcm', rate: models.GROK_VOICE_OUTPUT_RATE });
		expect(r.raw).not.toContain(SERVER_KEY);
		expect(r.res.headers['cache-control']).toBe('no-store');
	});

	it('mints with the server key and the documented expires_after body', async () => {
		await call({ body: {} });
		expect(fetchCalls).toHaveLength(1);
		expect(fetchCalls[0].url).toBe(models.GROK_VOICE_CLIENT_SECRETS_URL);
		expect(fetchCalls[0].init.headers.authorization).toBe(`Bearer ${SERVER_KEY}`);
		expect(JSON.parse(fetchCalls[0].init.body)).toEqual({ expires_after: { seconds: lib.GROK_VOICE_SECRET_TTL_S } });
	});

	it('records usage under client_id xai-voice', async () => {
		await call({ body: {} });
		expect(state.events).toHaveLength(1);
		const evt = state.events[0];
		expect(evt.clientId).toBe(GROK_VOICE_CLIENT_ID);
		expect(GROK_VOICE_CLIENT_ID).toBe('xai-voice');
		expect(evt.meta.client_id).toBe('xai-voice');
		expect(evt.userId).toBe('user-1');
		expect(evt.provider).toBe('xai');
		expect(evt.status ?? 'ok').toBe('ok');
	});

	it('honours a valid requested voice and ignores an unsafe one', async () => {
		let r = await call({ body: { voice: 'Ara' } });
		expect(r.body.session.voice).toBe('ara');
		r = await call({ body: { voice: '../../etc' } });
		expect(r.body.session.voice).toBe(models.GROK_VOICE_DEFAULT_VOICE);
	});
});

describe('agent persona as instructions', () => {
	const agentId = '7b0f3a5e-1c2d-4e5f-8a9b-0c1d2e3f4a5b';

	it('uses the private persona only for the agent owner', async () => {
		state.agent = { id: agentId, user_id: 'user-1', name: 'Nova', description: 'A guide.', persona_prompt: 'You are Nova, a calm museum guide.', meta: {} };
		const r = await call({ body: { agent_id: agentId } });
		expect(r.body.session.instructions).toContain('You are Nova, a calm museum guide.');
	});

	it('gives a non-owner only the public name and description', async () => {
		state.agent = { id: agentId, user_id: 'someone-else', name: 'Nova', description: 'A guide.', persona_prompt: 'SECRET persona', meta: {} };
		const r = await call({ body: { agent_id: agentId } });
		expect(r.body.session.instructions).not.toContain('SECRET');
		expect(r.body.session.instructions).toContain('You are Nova');
	});

	it("uses the agent's bound Grok voice when the caller names none", async () => {
		state.agent = { id: agentId, user_id: 'user-1', name: 'Nova', voice_provider: 'grok', voice_id: 'rex', meta: {} };
		const r = await call({ body: { agent_id: agentId } });
		expect(r.body.session.voice).toBe('rex');
	});

	it('rejects a malformed agent_id and 404s an unknown one', async () => {
		expect((await call({ body: { agent_id: 'nope' } })).status).toBe(400);
		state.agent = null;
		expect((await call({ body: { agent_id: agentId } })).status).toBe(404);
	});
});

describe('upstream failures map to stable codes', () => {
	it('a rejected server key (the live no-credential 401) is 503 grok_voice_key_rejected', async () => {
		upstream(() =>
			jsonRes(401, {
				code: 'The request does not have valid authentication credentials',
				error: 'No credentials presented. [WKE=unauthenticated:no-credentials]',
			}),
		);
		const r = await call({ body: {} });
		expect(r.status).toBe(503);
		expect(r.body.error).toBe('grok_voice_key_rejected');
		expect(state.events[0].status).toBe('error');
		expect(state.events[0].meta.upstream_status).toBe(401);
	});

	it('the live wrong-key 400 is also grok_voice_key_rejected', async () => {
		upstream(() => jsonRes(400, { code: 'Client specified an invalid argument', error: 'Incorrect API key provided.' }));
		expect((await call({ body: {} })).body.error).toBe('grok_voice_key_rejected');
	});

	it('an xAI 429 is grok_voice_rate_limited', async () => {
		upstream(() => jsonRes(429, { error: 'slow down' }));
		expect((await call({ body: {} })).body.error).toBe('grok_voice_rate_limited');
	});

	it('a body without value or expires_at is grok_voice_upstream_error, never a half session', async () => {
		upstream(() => jsonRes(200, { value: 'x' }));
		const r = await call({ body: {} });
		expect(r.status).toBe(502);
		expect(r.body.error).toBe('grok_voice_upstream_error');
	});

	it('an unreachable token endpoint is grok_voice_upstream_error', async () => {
		globalThis.fetch = vi.fn(async () => {
			throw new TypeError('fetch failed');
		});
		expect((await call({ body: {} })).body.error).toBe('grok_voice_upstream_error');
	});
});

describe('voice roster', () => {
	it('GET lists the live roster lowercased when configured', async () => {
		const r = await call({ method: 'GET' });
		expect(r.body.configured).toBe(true);
		expect(r.body.voices.map((v) => v.id)).toEqual(['eve', 'ara']);
		expect(r.raw).not.toContain(SERVER_KEY);
	});

	it('falls back to the documented default when the roster call fails', async () => {
		upstream(() => jsonRes(500, {}));
		const voices = await lib.listVoices({ apiKey: SERVER_KEY });
		expect(voices).toEqual([{ id: models.GROK_VOICE_DEFAULT_VOICE, name: 'Eve', language: null }]);
	});
});

describe('spoken persona', () => {
	it('asks for short spoken replies with no markdown', () => {
		const text = lib.buildVoiceInstructions(null, { owner: false });
		expect(text).toMatch(/speaking out loud/);
		expect(text).toMatch(/markdown/);
	});
});
