// Voice on the agent gateway: what the browser voice panel and phone calls share.
//
// Both legs run the ordinary gateway core (./core.js handleEvent) against a
// collecting gateway: instead of posting messages somewhere, every send is kept
// in order, and the leg turns the collected reply into speech afterwards. The
// owner's words reach the core as text (the leg transcribes first), so the core
// never echoes a "Heard:" line into the spoken reply.
//
//   browser   POST /api/gateway/voice (session auth). The chat is the signed-in
//             account itself (chat_id `web:<user id>`), so there is no pairing
//             code. Previews come back as buttons the panel renders.
//   phone     Twilio calls POST /api/gateway/voice?leg=call. Each recording is
//             queued in gateway_inbox; the worker (workers/agent-gateway
//             src/adapters/voice.js) runs the turn and stores the reply and its
//             MP3 here in gateway_voice_turns; the call's poll leg plays it.
//             Caller ID can be forged, so a call can talk to the agent but can
//             never approve a trade: previews are cancelled with a spoken note.

import { randomUUID } from 'node:crypto';
import { sql } from '../db.js';
import { runFfmpeg, spokenText } from './audio.js';
import { cancelPreview } from './store.js';
import { previewIdOfChoice } from './reply-codes.js';
import { appOrigin } from './format.js';

export const PLATFORM = 'voice';
export const POLL_INTERVAL_S = 2;
export const POLL_MAX = 45;
export const RECORD_MAX_S = 30;
const MP3_ARGS = ['-vn', '-ac', '1', '-ar', '22050', '-c:a', 'libmp3lame', '-b:a', '48k', '-f', 'mp3'];

export const PHONE_PREVIEW_NOTE = 'I prepared that, but trades cannot be approved on a phone call, so I discarded it. Ask me again from a paired chat or the three.ws app to approve it.';

export function webVoiceChatId(userId) {
	return `web:${userId}`;
}

/** The telephony leg is opt-in: GATEWAY_VOICE_TELEPHONY=1 plus the Twilio credentials. */
export function telephonyConfigured(env = process.env) {
	const missing = [];
	if (env.GATEWAY_VOICE_TELEPHONY !== '1') missing.push('GATEWAY_VOICE_TELEPHONY');
	if (!env.TWILIO_ACCOUNT_SID) missing.push('TWILIO_ACCOUNT_SID');
	if (!env.TWILIO_AUTH_TOKEN) missing.push('TWILIO_AUTH_TOKEN');
	return missing.length ? { ok: false, missing } : { ok: true };
}

/**
 * A reply as it should be heard: pairing codes spelled letter by letter (a
 * listener cannot read "ABCD-EFGH" off a link), links and addresses dropped.
 */
export function speakable(text) {
	const spelled = String(text || '')
		.replace(/\/settings\/connections\?code=\S+/g, '/settings/connections')
		.replace(/\b([A-Z0-9]{4})-([A-Z0-9]{4})\b/g, (_, a, b) => `${a.split('').join(' ')}, ${b.split('').join(' ')}`)
		.replace(/^Open https?:\/\/\S+$/gm, 'Open three dot w s, settings, connections,');
	return spokenText(spelled, 900);
}

/** Any clip as a small mono MP3: the one container Twilio <Play> and every browser accept. */
export function toMp3(buffer) {
	return runFfmpeg(buffer, MP3_ARGS);
}

/**
 * A gateway that keeps every send instead of delivering it.
 * @param {{ buttons:boolean }} opts  browser leg: true (the panel renders them);
 *   phone leg: false, and every preview is cancelled with PHONE_PREVIEW_NOTE.
 */
export function collectingGateway({ buttons }) {
	const messages = [];
	const choices = [];
	let seq = 0;
	const push = (text) => {
		const ref = { chatId: null, messageId: ++seq };
		messages.push({ id: ref.messageId, text: String(text || '') });
		return ref;
	};
	return {
		platform: PLATFORM,
		buttons,
		canEdit: false,
		messages,
		choices,
		async sendText(_chatId, text) {
			return push(text);
		},
		async sendChoice(_chatId, text, opts = []) {
			if (buttons) {
				const ref = push(text);
				choices.push({ messageId: ref.messageId, choices: opts.map((c) => ({ id: c.id, label: c.label, style: c.style || null })) });
				return ref;
			}
			const previewId = opts.map((c) => previewIdOfChoice(c.id)).find(Boolean);
			if (previewId) await cancelPreview(previewId);
			return push(PHONE_PREVIEW_NOTE);
		},
		async editMessage(_ref, text) {
			push(text);
		},
		async sendMedia(_chatId, media) {
			const target = media?.url ? 'a link in your three.ws thread' : 'a file';
			return push(media?.caption ? `${media.caption} I put ${target} for you.` : `I put ${target} for you.`);
		},
		async typing() {},
		async ackAction(_event, text) {
			if (text) push(text);
		},
		/** Everything said this turn, as one transcript. */
		transcript() {
			return messages.map((m) => m.text).filter(Boolean).join('\n\n');
		},
	};
}

// ── TwiML ────────────────────────────────────────────────────────────────────

export function xmlEscape(s) {
	return String(s ?? '').replace(/[<>&'"]/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', "'": '&apos;', '"': '&quot;' }[c]));
}

export function voiceUrl(params) {
	return `${appOrigin()}/api/gateway/voice?${new URLSearchParams(params).toString()}`;
}

function twiml(body) {
	return `<?xml version="1.0" encoding="UTF-8"?><Response>${body}</Response>`;
}

function record() {
	return `<Record action="${xmlEscape(voiceUrl({ leg: 'recorded' }))}" method="POST" maxLength="${RECORD_MAX_S}" timeout="3" playBeep="true" trim="trim-silence" finishOnKey="#"/>`
		+ `<Say>I did not hear anything. Goodbye.</Say><Hangup/>`;
}

export function twimlGreeting() {
	return twiml(`<Say>three dot w s. Ask your agent anything after the beep, then pause.</Say>${record()}`);
}

export function twimlWait(turnId, n) {
	const lead = n === 0 ? '<Say>One moment.</Say>' : '';
	return twiml(`${lead}<Pause length="${POLL_INTERVAL_S}"/><Redirect method="POST">${xmlEscape(voiceUrl({ leg: 'poll', turn: turnId, n: String(n + 1) }))}</Redirect>`);
}

export function twimlReply({ clipId, text }) {
	const speak = clipId ? `<Play>${xmlEscape(voiceUrl({ leg: 'clip', id: clipId }))}</Play>` : `<Say>${xmlEscape(text || 'I have nothing to add.')}</Say>`;
	return twiml(`${speak}${record()}`);
}

export function twimlGoodbye(text) {
	return twiml(`<Say>${xmlEscape(text)}</Say><Hangup/>`);
}

// ── phone turns ──────────────────────────────────────────────────────────────

export async function createVoiceTurn({ id, callSid, caller }) {
	await sql`
		INSERT INTO gateway_voice_turns (id, call_sid, caller)
		VALUES (${id}, ${callSid}, ${caller})
		ON CONFLICT (id) DO NOTHING`;
}

/** Store the turn's outcome. A clip is optional: without one the call reads the text with <Say>. */
export async function finishVoiceTurn({ id, text, clip = null, failed = false }) {
	const clipId = clip ? randomUUID() : null;
	await sql`
		UPDATE gateway_voice_turns
		SET status = ${failed ? 'failed' : 'ready'}, reply_text = ${text}, clip_id = ${clipId},
		    clip = ${clip}, clip_mime = ${clip ? 'audio/mpeg' : null}, finished_at = now()
		WHERE id = ${id}`;
	return clipId;
}

export async function getVoiceTurn(id) {
	const [row] = await sql`SELECT id, call_sid, status, reply_text, clip_id FROM gateway_voice_turns WHERE id = ${id} LIMIT 1`;
	return row || null;
}

export async function getVoiceClip(clipId) {
	const [row] = await sql`SELECT clip, clip_mime FROM gateway_voice_turns WHERE clip_id = ${clipId} AND clip IS NOT NULL LIMIT 1`;
	return row ? { buffer: Buffer.from(row.clip), mimeType: row.clip_mime || 'audio/mpeg' } : null;
}

export async function pruneVoiceTurns({ olderThanHours = 24 } = {}) {
	const rows = await sql`DELETE FROM gateway_voice_turns WHERE created_at < now() - make_interval(hours => ${olderThanHours}) RETURNING id`;
	return rows.length;
}
