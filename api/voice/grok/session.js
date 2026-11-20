// /api/voice/grok/session: Grok Voice realtime session broker.
//
// GET   public status: is Grok voice enabled on this server, which model, the
//       live voice roster and the audio rates. Holds nothing secret, so the
//       /voice/grok demo can decide between Grok and the existing voice chain
//       before it ever asks for the microphone.
// POST  signed-in users only, rate limited. Body: { agent_id?, voice? }.
//       Mints a short-lived xAI client secret with the server key and returns
//       { client_secret, expires_at, ws_url, model, session }. The server key
//       never leaves this process; the browser opens the realtime socket with
//       the secret as its `xai-client-secret.<secret>` subprotocol.
//
// Without GROK_API_KEY (or XAI_API_KEY) POST answers 503
// grok_voice_not_configured and GET says configured: false. Never a fake
// session. Every mint attempt is recorded in usage_events as client_id
// `xai-voice` (meta.client_id, since usage_events.client_id only resolves
// registered OAuth clients).

import { env } from '../../_lib/env.js';
import { sql } from '../../_lib/db.js';
import { cors, json, method, readJson, error, wrap, rateLimited } from '../../_lib/http.js';
import { getRequestUser } from '../../_lib/auth.js';
import { limits } from '../../_lib/rate-limit.js';
import { isUuid } from '../../_lib/validate.js';
import { recordEvent } from '../../_lib/usage.js';
import {
	GROK_VOICE_DEFAULT_VOICE,
	GROK_VOICE_INPUT_RATE,
	GROK_VOICE_MODEL,
	GROK_VOICE_OUTPUT_RATE,
	GROK_VOICE_PRICE_PER_MINUTE,
} from '../../_lib/chat-models.js';
import {
	GROK_VOICE_SECRET_TTL_S,
	GrokVoiceError,
	buildSessionConfig,
	buildVoiceInstructions,
	isValidVoiceId,
	listVoices,
	mintClientSecret,
	realtimeUrl,
} from '../../_lib/grok-voice.js';

export const GROK_VOICE_CLIENT_ID = 'xai-voice';

async function loadAgent(agentId) {
	const [row] = await sql`
		SELECT id, user_id, name, description, persona_prompt, voice_provider, voice_id, meta
		FROM agent_identities
		WHERE id = ${agentId} AND deleted_at IS NULL
	`;
	return row || null;
}

function pickVoice(requested, agent) {
	if (isValidVoiceId(requested)) return requested.toLowerCase();
	if (agent?.voice_provider === 'grok' && isValidVoiceId(agent.voice_id)) return agent.voice_id.toLowerCase();
	return GROK_VOICE_DEFAULT_VOICE;
}

async function handleStatus(res) {
	const apiKey = env.GROK_API_KEY;
	const base = {
		configured: Boolean(apiKey),
		model: GROK_VOICE_MODEL,
		default_voice: GROK_VOICE_DEFAULT_VOICE,
		input_rate: GROK_VOICE_INPUT_RATE,
		output_rate: GROK_VOICE_OUTPUT_RATE,
		ttl_seconds: GROK_VOICE_SECRET_TTL_S,
		price_per_minute_usd: GROK_VOICE_PRICE_PER_MINUTE,
	};
	if (!apiKey) return json(res, 200, { ...base, voices: [] }, { 'cache-control': 'public, max-age=60' });
	const voices = await listVoices({ apiKey });
	return json(res, 200, { ...base, voices }, { 'cache-control': 'public, max-age=300' });
}

async function handleMint(req, res) {
	const apiKey = env.GROK_API_KEY;
	if (!apiKey) {
		return error(
			res,
			503,
			'grok_voice_not_configured',
			'Grok voice is not enabled on this server yet. The standard voice chain is still available.',
		);
	}

	const user = await getRequestUser(req, res);
	if (!user) return error(res, 401, 'unauthorized', 'sign in to start a Grok voice session');

	const rl = await limits.grokVoiceSessionUser(user.id);
	if (!rl.success) return rateLimited(res, rl, 'Grok voice session limit reached, try again later');

	let body;
	try {
		body = await readJson(req, 8_000);
	} catch (e) {
		return error(res, e.status || 400, 'bad_request', e.message);
	}

	let agent = null;
	if (body?.agent_id != null && body.agent_id !== '') {
		if (!isUuid(String(body.agent_id))) return error(res, 400, 'bad_request', 'agent_id must be a uuid');
		agent = await loadAgent(String(body.agent_id));
		if (!agent) return error(res, 404, 'not_found', 'agent not found');
	}

	const voice = pickVoice(body?.voice, agent);
	const instructions = buildVoiceInstructions(agent, { owner: Boolean(agent && agent.user_id === user.id) });
	const started = Date.now();
	const meta = { client_id: GROK_VOICE_CLIENT_ID, voice, agent_id: agent?.id ?? null, ttl_seconds: GROK_VOICE_SECRET_TTL_S };

	let secret;
	try {
		secret = await mintClientSecret({ apiKey });
	} catch (err) {
		const e = err instanceof GrokVoiceError ? err : new GrokVoiceError('grok_voice_upstream_error', String(err?.message || err));
		recordEvent({
			userId: user.id,
			clientId: GROK_VOICE_CLIENT_ID,
			agentId: agent?.id ?? null,
			kind: 'voice_session',
			tool: 'grok_voice',
			status: 'error',
			provider: 'xai',
			model: GROK_VOICE_MODEL,
			latencyMs: Date.now() - started,
			meta: { ...meta, error: e.code, upstream_status: e.upstreamStatus },
		});
		return error(res, e.status, e.code, e.message);
	}

	recordEvent({
		userId: user.id,
		clientId: GROK_VOICE_CLIENT_ID,
		agentId: agent?.id ?? null,
		kind: 'voice_session',
		tool: 'grok_voice',
		provider: 'xai',
		model: GROK_VOICE_MODEL,
		latencyMs: Date.now() - started,
		meta: { ...meta, expires_at: secret.expiresAt },
	});

	return json(
		res,
		200,
		{
			client_secret: secret.value,
			expires_at: secret.expiresAt,
			ws_url: realtimeUrl(),
			model: GROK_VOICE_MODEL,
			session: buildSessionConfig({ instructions, voice }),
		},
		{ 'cache-control': 'no-store' },
	);
}

export default wrap(async function handler(req, res) {
	if (cors(req, res, { methods: 'GET,POST,OPTIONS', credentials: true })) return;
	if (!method(req, res, ['GET', 'POST'])) return;
	if (req.method === 'GET') return handleStatus(res);
	return handleMint(req, res);
});
