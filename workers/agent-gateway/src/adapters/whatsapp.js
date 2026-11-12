// WhatsApp adapter (Meta Cloud API over fetch). api/gateway/whatsapp.js answers
// Meta's subscription handshake, verifies X-Hub-Signature-256 on every delivery
// and queues each message as {kind:'whatsapp_message'}; status receipts are
// dropped there.
//
// The chat is the sender's WhatsApp id (their number without the plus). Text,
// voice notes, images and the two reply-button shapes are understood; Approve
// and Cancel render as interactive reply buttons (at most three, titles up to
// 20 characters). WhatsApp cannot edit a sent message, so outcomes arrive as
// new messages.
//
// The 24-hour customer service window: a free-form message only reaches someone
// who wrote to the number in the last 24 hours. A reply to their message is
// always inside it. A notification outside it is refused by Meta (error 131047);
// when WHATSAPP_NOTIFY_TEMPLATE names an approved template with one body
// variable, the message is resent through it, otherwise the refusal is permanent
// and the owner reads the notification on their other channels.

import { chunkText, MAX_TEXT } from '../../../../api/_lib/gateway/format.js';
import { parseActionId } from '../../../../api/_lib/gateway/approvals.js';
import { parseApprovalCallback } from '../../../../api/_lib/gateway/approval-buttons.js';
import { PlatformError, isPermanentStatus } from '../errors.js';

const PLATFORM = 'whatsapp';
const TEXT_LIMIT = MAX_TEXT.whatsapp;
const BODY_LIMIT = 1024;
const BUTTON_TITLE = 20;
const MAX_BUTTONS = 3;
const MAX_MEDIA_BYTES = 16 * 1024 * 1024;
const TEMPLATE_PARAM_LIMIT = 1000;
export const OUTSIDE_WINDOW = 131047;
// Meta's throughput and pair rate limits: wait and retry.
const RATE_LIMIT_CODES = new Set([4, 80007, 130429, 131048, 131056]);

export function whatsappConfigured(env = process.env) {
	const missing = ['WHATSAPP_ACCESS_TOKEN', 'WHATSAPP_PHONE_NUMBER_ID'].filter((k) => !env[k]);
	return missing.length ? { ok: false, missing } : { ok: true };
}

export function toWhatsAppError(status, body) {
	const err = body?.error || {};
	const code = Number(err.code) || null;
	const message = err.error_data?.details || err.message || `http_${status}`;
	if (status === 429 || RATE_LIMIT_CODES.has(code)) {
		return new PlatformError(PLATFORM, `rate limited: ${message}`, { status, code, retryAfterMs: 5000 });
	}
	return new PlatformError(PLATFORM, message, { status, code, permanent: isPermanentStatus(status) });
}

function buttonsFrom(choices) {
	return choices.slice(0, MAX_BUTTONS).map((c) => ({ type: 'reply', reply: { id: String(c.id).slice(0, 256), title: String(c.label).slice(0, BUTTON_TITLE) } }));
}

function mediaType(media) {
	if (media.kind) return media.kind === 'video' ? 'video' : media.kind === 'image' ? 'image' : 'document';
	if (/\.(png|jpe?g|webp)(\?|$)/i.test(media.url) || /\/api\/render\//.test(media.url)) return 'image';
	if (/\.(mp4|3gp)(\?|$)/i.test(media.url)) return 'video';
	return 'document';
}

/**
 * @param {object} [opts]
 * @param {Record<string,string|undefined>} [opts.env]
 * @param {typeof fetch} [opts.fetch]   every Graph call and media download
 */
export function createWhatsAppAdapter({ env = process.env, fetch: fetchImpl = globalThis.fetch } = {}) {
	const version = env.WHATSAPP_GRAPH_VERSION || 'v21.0';
	const graph = `https://graph.facebook.com/${version}`;
	const phoneNumberId = env.WHATSAPP_PHONE_NUMBER_ID;
	const auth = { authorization: `Bearer ${env.WHATSAPP_ACCESS_TOKEN}` };

	async function request(url, init) {
		let r;
		try {
			r = await fetchImpl(url, { ...init, headers: { ...auth, ...(init.headers || {}) }, signal: AbortSignal.timeout(15_000) });
		} catch (e) {
			throw new PlatformError(PLATFORM, `network: ${e.message}`, { cause: e });
		}
		const body = await r.json().catch(() => ({}));
		if (!r.ok || body.error) throw toWhatsAppError(r.status, body);
		return body;
	}

	function send(to, message) {
		return request(`${graph}/${phoneNumberId}/messages`, {
			method: 'POST',
			headers: { 'content-type': 'application/json' },
			body: JSON.stringify({ messaging_product: 'whatsapp', recipient_type: 'individual', to: String(to), ...message }),
		}).then((b) => ({ chatId: String(to), messageId: b.messages?.[0]?.id || null }));
	}

	async function sendTextOnce(to, body) {
		try {
			return await send(to, { type: 'text', text: { body, preview_url: false } });
		} catch (e) {
			if (!(e instanceof PlatformError) || e.code !== OUTSIDE_WINDOW) throw e;
			const template = env.WHATSAPP_NOTIFY_TEMPLATE;
			if (!template) throw new PlatformError(PLATFORM, 'outside the 24-hour window and no WHATSAPP_NOTIFY_TEMPLATE is set', { code: OUTSIDE_WINDOW, permanent: true });
			return send(to, {
				type: 'template',
				template: {
					name: template,
					language: { code: env.WHATSAPP_NOTIFY_TEMPLATE_LANG || 'en' },
					components: [{ type: 'body', parameters: [{ type: 'text', text: body.replace(/\s*\n+\s*/g, ' ').slice(0, TEMPLATE_PARAM_LIMIT) }] }],
				},
			});
		}
	}

	async function download(mediaId, fallbackMime) {
		const meta = await request(`${graph}/${mediaId}`, { method: 'GET' });
		if (!meta.url) throw new PlatformError(PLATFORM, 'media has no download url', { permanent: true });
		if (meta.file_size > MAX_MEDIA_BYTES) throw new PlatformError(PLATFORM, 'media too large', { permanent: true });
		let r;
		try {
			r = await fetchImpl(meta.url, { headers: auth, signal: AbortSignal.timeout(20_000) });
		} catch (e) {
			throw new PlatformError(PLATFORM, `network: ${e.message}`, { cause: e });
		}
		if (!r.ok) throw new PlatformError(PLATFORM, `media download ${r.status}`, { status: r.status, permanent: isPermanentStatus(r.status) });
		return { buffer: Buffer.from(await r.arrayBuffer()), mimeType: (meta.mime_type || fallbackMime).split(';')[0].trim() };
	}

	/** @returns {object|null} a GatewayEvent, or null for messages nobody answers */
	function normalize(payload) {
		if (payload?.kind !== 'whatsapp_message') return null;
		const m = payload.message;
		if (!m?.from || !m.id) return null;
		const base = {
			platform: PLATFORM,
			chatId: String(m.from),
			chatType: 'dm',
			chatTitle: null,
			userId: String(m.from),
			username: payload.contact?.profile?.name || null,
			messageId: m.id,
		};
		if (m.context?.forwarded || m.context?.frequently_forwarded) return { ...base, forwarded: true };
		const pressedId = m.type === 'interactive' ? m.interactive?.button_reply?.id : m.type === 'button' ? m.button?.payload : null;
		if (pressedId) {
			const approvalAction = parseApprovalCallback(pressedId);
			const action = approvalAction ? null : parseActionId(pressedId);
			if (!approvalAction && !action) return null;
			return { ...base, ...(approvalAction ? { approvalAction } : { action }), messageRef: m.context?.id ? { chatId: base.chatId, messageId: m.context.id } : null };
		}
		if (m.type === 'text') {
			const text = String(m.text?.body || '').trim();
			if (!text) return null;
			const cmd = /^\/([A-Za-z0-9_]{1,32})(?:\s+([\s\S]*))?$/.exec(text);
			return cmd ? { ...base, command: cmd[1].toLowerCase(), args: (cmd[2] || '').trim() } : { ...base, text };
		}
		if (m.type === 'audio' && m.audio?.id) return { ...base, voice: { fetch: () => download(m.audio.id, m.audio.mime_type || 'audio/ogg') } };
		if (m.type === 'image' && m.image?.id) return { ...base, photo: { fetch: () => download(m.image.id, m.image.mime_type || 'image/jpeg'), caption: m.image.caption || '' } };
		return null;
	}

	function gateway(event) {
		return {
			platform: PLATFORM,
			buttons: true,
			canEdit: false,
			async sendText(chatId, text) {
				let ref = null;
				for (const part of chunkText(text, TEXT_LIMIT)) ref = await sendTextOnce(chatId, part);
				return ref;
			},
			async sendChoice(chatId, text, choices) {
				if (!choices?.length) return sendTextOnce(chatId, String(text).slice(0, TEXT_LIMIT));
				return send(chatId, {
					type: 'interactive',
					interactive: { type: 'button', body: { text: String(text).slice(0, BODY_LIMIT) }, action: { buttons: buttonsFrom(choices) } },
				});
			},
			// WhatsApp cannot edit; the core sends outcomes as new messages on
			// channels with canEdit false, and this keeps any direct edit honest.
			async editMessage(ref, text) {
				if (ref?.chatId) await sendTextOnce(ref.chatId, String(text).slice(0, TEXT_LIMIT));
			},
			async sendMedia(chatId, media) {
				const type = mediaType(media);
				const caption = media.caption ? String(media.caption).slice(0, BODY_LIMIT) : undefined;
				return send(chatId, { type, [type]: { link: media.url, ...(caption ? { caption } : {}) } });
			},
			async sendVoice(chatId, clip) {
				const form = new FormData();
				form.append('messaging_product', 'whatsapp');
				form.append('type', clip.mimeType || 'audio/ogg');
				form.append('file', new Blob([clip.buffer], { type: clip.mimeType || 'audio/ogg' }), clip.filename || 'reply.ogg');
				const uploaded = await request(`${graph}/${phoneNumberId}/media`, { method: 'POST', body: form });
				return send(chatId, { type: 'audio', audio: { id: uploaded.id } });
			},
			// Marking the owner's message read with a typing indicator shows
			// "typing..." for up to 25 seconds or until the reply lands.
			async typing() {
				if (!event?.messageId) return;
				await request(`${graph}/${phoneNumberId}/messages`, {
					method: 'POST',
					headers: { 'content-type': 'application/json' },
					body: JSON.stringify({ messaging_product: 'whatsapp', status: 'read', message_id: event.messageId, typing_indicator: { type: 'text' } }),
				});
			},
			async ackAction() {},
		};
	}

	return {
		platform: PLATFORM,
		normalize,
		gateway,
		describe() {
			return { mode: 'cloud_api', phone_number_id: phoneNumberId, notify_template: env.WHATSAPP_NOTIFY_TEMPLATE || null };
		},
	};
}
