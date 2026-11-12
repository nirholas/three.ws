// /api/gateway/voice: talk to your agent out loud.
//
// Browser leg (the Voice card on /settings/connections; session + CSRF):
//   POST ?leg=web   body: the recorded clip (audio/webm, audio/ogg, audio/mp4 or
//                   audio/wav). Transcribes it, runs the gateway core for the
//                   signed-in account's own voice chat (chat_id `web:<user id>`,
//                   created on first use), and returns
//                   { heard, messages, choices, audio: { mime, base64 } | null }.
//   POST ?leg=web   JSON { choice: 'gw:ap:<id>' | 'gw:cx:<id>' }: press Approve or
//                   Cancel on a preview the panel rendered.
//
// Phone leg (Twilio; off unless GATEWAY_VOICE_TELEPHONY=1 plus credentials).
// Every leg Twilio posts to is checked against X-Twilio-Signature:
//   POST ?leg=call      greet and record (the number's "A call comes in" URL)
//   POST ?leg=recorded  queue the recording for the gateway worker, start polling
//   POST ?leg=poll      play the reply once the worker stored it, else wait
//   GET  ?leg=clip&id=  the reply MP3 (the id is an unguessable uuid)
// Caller ID can be forged, so a call never approves a trade (previews are
// cancelled with a spoken note), and by default only calls the carrier
// attested with STIR/SHAKEN level A are answered at all.
//
// docs/gateways.md has the Twilio setup and env vars.

import { cors, json, method, error, readBody, readForm } from '../_lib/http.js';
import { getSessionUser } from '../_lib/auth.js';
import { requireCsrf } from '../_lib/csrf.js';
import { sql } from '../_lib/db.js';
import { verifyTwilioSignature } from '../_lib/gateway/webhooks.js';
import { enqueueInbox, getLiveLink, createLink, GatewayError } from '../_lib/gateway/store.js';
import { handleEvent } from '../_lib/gateway/core.js';
import { parseActionId } from '../_lib/gateway/approvals.js';
import { transcribeVoice, MediaError } from '../_lib/gateway/media.js';
import { synthesizeReply } from '../_lib/gateway/audio.js';
import { appOrigin } from '../_lib/gateway/format.js';
import {
	PLATFORM, POLL_MAX, collectingGateway, speakable, toMp3, webVoiceChatId, telephonyConfigured,
	twimlGreeting, twimlWait, twimlReply, twimlGoodbye, createVoiceTurn, getVoiceTurn, getVoiceClip,
} from '../_lib/gateway/voice-calls.js';

const AUDIO_TYPES = /^audio\/(webm|ogg|mp4|mpeg|wav|x-wav|aac)$/;
const MAX_CLIP_BYTES = 8 * 1024 * 1024;
const ATTESTED = new Set(['TN-Validation-Passed-A']);
const E164 = /^\+[1-9]\d{6,14}$/;

// ── browser leg ──────────────────────────────────────────────────────────────

async function webLink(user) {
	const chatId = webVoiceChatId(user.id);
	const live = await getLiveLink(PLATFORM, chatId);
	if (live) return live;
	const [agent] = await sql`SELECT id FROM agent_identities WHERE user_id = ${user.id} AND deleted_at IS NULL ORDER BY created_at ASC LIMIT 1`;
	return createLink({
		platform: PLATFORM, platformUserId: user.id, chatId, chatType: 'web', chatTitle: 'Browser voice', userId: user.id, defaultAgentId: agent?.id || null,
	});
}

async function spokenReply(text, link) {
	const said = speakable(text);
	if (!said) return null;
	try {
		const clip = await synthesizeReply(said, { agentId: link.default_agent_id || null });
		if (!clip) return null;
		return { mime: 'audio/mpeg', base64: (await toMp3(clip.buffer)).toString('base64') };
	} catch (e) {
		// The panel still shows the text; it says the reply could not be spoken.
		console.warn('[voice] speech failed', e?.code || e?.message);
		return null;
	}
}

async function webLeg(req, res) {
	const user = await getSessionUser(req, res);
	if (!user) return error(res, 401, 'unauthorized', 'sign in to talk to your agent');
	if (!(await requireCsrf(req, res, user.id))) return;

	const ct = String(req.headers['content-type'] || '').split(';')[0].trim().toLowerCase();
	let raw;
	try {
		raw = await readBody(req, MAX_CLIP_BYTES);
	} catch (e) {
		return error(res, e?.status || 400, e?.status === 413 ? 'audio_too_large' : 'bad_request', e?.status === 413 ? 'Keep each recording under about a minute.' : 'could not read the recording');
	}

	let link;
	try {
		link = await webLink(user);
	} catch (e) {
		if (e instanceof GatewayError) return error(res, e.status, e.code, e.message);
		throw e;
	}
	const base = { platform: PLATFORM, chatId: link.chat_id, chatType: 'web', chatTitle: null, userId: user.id, username: null };
	const gw = collectingGateway({ buttons: true });
	let heard = null;

	if (ct === 'application/json') {
		let body;
		try { body = JSON.parse(raw.toString('utf8')); } catch { return error(res, 400, 'bad_request', 'invalid JSON'); }
		const action = parseActionId(body?.choice);
		if (!action || !/^[0-9a-f-]{36}$/i.test(action.previewId)) return error(res, 400, 'validation_error', 'choice must be an Approve or Cancel button id');
		await handleEvent({ ...base, action, messageRef: null }, gw);
	} else {
		if (!AUDIO_TYPES.test(ct)) return error(res, 415, 'unsupported_media', 'send the recording as audio/webm, audio/ogg, audio/mp4 or audio/wav');
		try {
			heard = await transcribeVoice({ buffer: raw, mimeType: ct });
		} catch (e) {
			if (e instanceof MediaError) return error(res, 422, e.code, e.message);
			throw e;
		}
		await handleEvent({ ...base, text: heard }, gw);
	}

	const transcript = gw.transcript();
	return json(res, 200, {
		heard,
		messages: gw.messages,
		choices: gw.choices,
		audio: await spokenReply(transcript, link),
	}, { 'cache-control': 'no-store' });
}

// ── phone leg ────────────────────────────────────────────────────────────────

function xml(res, body) {
	res.statusCode = 200;
	res.setHeader('content-type', 'text/xml; charset=utf-8');
	res.setHeader('cache-control', 'no-store');
	res.end(body);
}

async function verifiedTwilioParams(req, res) {
	if (!telephonyConfigured().ok) {
		error(res, 503, 'not_configured', 'phone calls are not enabled on this deployment');
		return null;
	}
	let params;
	try {
		params = await readForm(req, 200_000);
	} catch {
		error(res, 400, 'bad_request', 'invalid form body');
		return null;
	}
	const ok = verifyTwilioSignature({
		url: `${appOrigin()}${req.url}`,
		params,
		signature: req.headers['x-twilio-signature'],
		authToken: process.env.TWILIO_AUTH_TOKEN,
	});
	if (!ok) {
		error(res, 401, 'unauthorized', 'invalid Twilio signature');
		return null;
	}
	return params;
}

export function callRefusal(params, env = process.env) {
	if (!E164.test(String(params.From || ''))) return 'This number only answers calls that show a caller ID. Goodbye.';
	if (env.GATEWAY_VOICE_REQUIRE_ATTESTATION !== '0' && !ATTESTED.has(String(params.StirVerstat || ''))) {
		return 'Your carrier did not verify this caller ID, so I cannot connect you to an agent. Use the three.ws app instead. Goodbye.';
	}
	return null;
}

async function phoneLeg(req, res, q) {
	const leg = q.get('leg');
	if (leg === 'clip') {
		const id = q.get('id') || '';
		if (!/^[0-9a-f-]{36}$/i.test(id)) return error(res, 404, 'not_found', 'no such clip');
		const clip = await getVoiceClip(id);
		if (!clip) return error(res, 404, 'not_found', 'no such clip');
		res.statusCode = 200;
		res.setHeader('content-type', clip.mimeType);
		res.setHeader('cache-control', 'private, max-age=600');
		return res.end(clip.buffer);
	}
	if (req.method !== 'POST') return error(res, 405, 'method_not_allowed', 'POST only');
	const params = await verifiedTwilioParams(req, res);
	if (!params) return;

	if (leg === 'call') {
		const refusal = callRefusal(params);
		return xml(res, refusal ? twimlGoodbye(refusal) : twimlGreeting());
	}
	if (leg === 'recorded') {
		const { RecordingSid, RecordingUrl, CallSid, From } = params;
		if (!RecordingSid || !RecordingUrl || Number(params.RecordingDuration || 0) < 1) {
			return xml(res, twimlReply({ text: 'I did not catch that. Try again after the beep.' }));
		}
		await createVoiceTurn({ id: RecordingSid, callSid: CallSid, caller: From });
		await enqueueInbox({
			platform: PLATFORM,
			dedupeKey: `turn:${RecordingSid}`,
			chatKey: `voice:${From}`,
			payload: { kind: 'voice_call_turn', turnId: RecordingSid, callSid: CallSid, caller: From, recordingUrl: RecordingUrl },
		});
		return xml(res, twimlWait(RecordingSid, 0));
	}
	if (leg === 'poll') {
		const turnId = q.get('turn') || '';
		const n = Math.max(0, Number.parseInt(q.get('n') || '0', 10) || 0);
		const turn = await getVoiceTurn(turnId);
		// A turn only plays on the call that recorded it.
		if (!turn || turn.call_sid !== params.CallSid) return xml(res, twimlGoodbye('I lost track of that call. Please call again.'));
		if (turn.status !== 'pending') return xml(res, twimlReply({ clipId: turn.clip_id, text: turn.reply_text }));
		if (n >= POLL_MAX) return xml(res, twimlGoodbye('Your agent is taking too long to answer. Please try again in a minute.'));
		return xml(res, twimlWait(turnId, n));
	}
	return error(res, 400, 'bad_request', 'unknown leg');
}

export default async function handler(req, res) {
	if (cors(req, res, { methods: 'GET,POST,OPTIONS', credentials: true })) return;
	if (!method(req, res, ['GET', 'POST'])) return;
	const q = new URL(req.url, 'http://x').searchParams;
	if (q.get('leg') === 'web') {
		if (req.method !== 'POST') return error(res, 405, 'method_not_allowed', 'POST only');
		return webLeg(req, res);
	}
	return phoneLeg(req, res, q);
}
