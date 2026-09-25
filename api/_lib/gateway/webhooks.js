// Verification and normalisation for the chat gateway webhooks. The receivers
// (api/gateway/{telegram,discord,slack,whatsapp,sms}.js) verify the platform's proof,
// queue the delivery in gateway_inbox and answer at once; the worker does the
// slow part. Kept free of HTTP so the tests can drive every branch.

import { createHash, createHmac, createPublicKey, timingSafeEqual, verify } from 'node:crypto';

// ── Telegram ─────────────────────────────────────────────────────────────────

/**
 * The secret Telegram echoes in X-Telegram-Bot-Api-Secret-Token. Derived from
 * the bot token (so there is no second credential to mint or rotate) unless
 * TELEGRAM_WEBHOOK_SECRET pins one. Telegram allows [A-Za-z0-9_-], 1-256 chars.
 */
export function telegramWebhookSecret(env = process.env) {
	if (env.TELEGRAM_WEBHOOK_SECRET) return env.TELEGRAM_WEBHOOK_SECRET;
	if (!env.TELEGRAM_BOT_TOKEN) return null;
	return createHash('sha256').update(`three-ws-gateway-webhook:${env.TELEGRAM_BOT_TOKEN}`).digest('hex');
}

function safeEqual(a, b) {
	const x = Buffer.from(String(a || ''));
	const y = Buffer.from(String(b || ''));
	return x.length === y.length && x.length > 0 && timingSafeEqual(x, y);
}

export function verifyTelegramSecret(headerValue, env = process.env) {
	const expected = telegramWebhookSecret(env);
	return Boolean(expected) && safeEqual(headerValue, expected);
}

/** The chat an update belongs to, or null for updates the gateway ignores. */
export function telegramChatId(update) {
	const chat = (update?.message || update?.callback_query?.message)?.chat;
	return chat?.id != null ? String(chat.id) : null;
}

/** @returns {{ dedupeKey:string, chatKey:string } | null} */
export function telegramInboxKeys(update) {
	if (!update || update.update_id == null) return null;
	const chatId = telegramChatId(update);
	if (!chatId) return null;
	return { dedupeKey: String(update.update_id), chatKey: `telegram:${chatId}` };
}

// ── Discord ──────────────────────────────────────────────────────────────────

const ED25519_SPKI_PREFIX = Buffer.from('302a300506032b6570032100', 'hex');
const DISCORD_MAX_SKEW_S = 300;

/**
 * Verify Discord's Ed25519 signature over timestamp + raw body. Also refuses a
 * timestamp more than five minutes off, so a captured request cannot be replayed.
 */
export function verifyDiscordSignature({ rawBody, signature, timestamp, publicKey, now = Date.now() }) {
	if (!rawBody || !/^[0-9a-f]{128}$/i.test(String(signature || '')) || !/^\d{1,12}$/.test(String(timestamp || ''))) return false;
	if (!/^[0-9a-f]{64}$/i.test(String(publicKey || ''))) return false;
	if (Math.abs(now / 1000 - Number(timestamp)) > DISCORD_MAX_SKEW_S) return false;
	try {
		const key = createPublicKey({ key: Buffer.concat([ED25519_SPKI_PREFIX, Buffer.from(publicKey, 'hex')]), format: 'der', type: 'spki' });
		const body = Buffer.isBuffer(rawBody) ? rawBody : Buffer.from(String(rawBody));
		return verify(null, Buffer.concat([Buffer.from(String(timestamp)), body]), key, Buffer.from(signature, 'hex'));
	} catch {
		return false;
	}
}

export const DISCORD_INTERACTION = { PING: 1, APPLICATION_COMMAND: 2, MESSAGE_COMPONENT: 3, AUTOCOMPLETE: 4 };
export const DISCORD_RESPONSE = { PONG: 1, DEFERRED_CHANNEL_MESSAGE: 5, DEFERRED_UPDATE_MESSAGE: 6, AUTOCOMPLETE_RESULT: 8 };

/**
 * The immediate answer to an interaction, sent inside Discord's three-second
 * window. Commands get "thinking..." and buttons a silent deferred update; the
 * worker fills both in through the interaction webhook.
 */
export function discordImmediateResponse(interaction) {
	switch (interaction?.type) {
		case DISCORD_INTERACTION.PING: return { type: DISCORD_RESPONSE.PONG };
		case DISCORD_INTERACTION.APPLICATION_COMMAND: return { type: DISCORD_RESPONSE.DEFERRED_CHANNEL_MESSAGE };
		case DISCORD_INTERACTION.MESSAGE_COMPONENT: return { type: DISCORD_RESPONSE.DEFERRED_UPDATE_MESSAGE };
		case DISCORD_INTERACTION.AUTOCOMPLETE: return { type: DISCORD_RESPONSE.AUTOCOMPLETE_RESULT, data: { choices: [] } };
		default: return null;
	}
}

/** @returns {{ dedupeKey:string, chatKey:string } | null} */
export function discordInboxKeys(interaction) {
	if (!interaction?.id || !interaction.channel_id) return null;
	if (interaction.type !== DISCORD_INTERACTION.APPLICATION_COMMAND && interaction.type !== DISCORD_INTERACTION.MESSAGE_COMPONENT) return null;
	return { dedupeKey: String(interaction.id), chatKey: `discord:${interaction.channel_id}` };
}

// ── Slack ────────────────────────────────────────────────────────────────────

const SLACK_MAX_SKEW_S = 300;

/**
 * Verify Slack's v0 request signature: HMAC-SHA256 of `v0:<timestamp>:<raw body>`
 * keyed with the app's signing secret, sent as `v0=<hex>` in X-Slack-Signature.
 * A timestamp more than five minutes off is refused so a capture cannot be replayed.
 */
export function verifySlackSignature({ rawBody, signature, timestamp, signingSecret, now = Date.now() }) {
	if (!signingSecret || !rawBody) return false;
	if (!/^\d{1,12}$/.test(String(timestamp || ''))) return false;
	if (Math.abs(now / 1000 - Number(timestamp)) > SLACK_MAX_SKEW_S) return false;
	const body = Buffer.isBuffer(rawBody) ? rawBody : Buffer.from(String(rawBody));
	const expected = `v0=${createHmac('sha256', signingSecret).update(`v0:${timestamp}:`).update(body).digest('hex')}`;
	return safeEqual(signature, expected);
}

/**
 * Classify a verified Slack delivery. The one endpoint receives three shapes:
 * Events API JSON, slash commands (form fields) and interactivity (a form field
 * `payload` holding JSON). Returns what the receiver should do with it.
 * @param {{ contentType:string, rawBody:Buffer|string }} req
 * @returns {{ type:'challenge', challenge:string }
 *   | { type:'enqueue', dedupeKey:string, chatKey:string, payload:object }
 *   | { type:'ignore' }}
 */
export function classifySlackDelivery({ contentType, rawBody }) {
	const text = Buffer.isBuffer(rawBody) ? rawBody.toString('utf8') : String(rawBody || '');
	if (/application\/json/i.test(contentType || '')) {
		let body;
		try { body = JSON.parse(text); } catch { return { type: 'ignore' }; }
		if (body?.type === 'url_verification' && typeof body.challenge === 'string') return { type: 'challenge', challenge: body.challenge };
		if (body?.type !== 'event_callback' || !body.event) return { type: 'ignore' };
		const ev = body.event;
		// The bot's own posts, edits and joins come back as events too.
		if (ev.bot_id || ev.subtype) return { type: 'ignore' };
		const direct = ev.type === 'message' && ev.channel_type === 'im';
		if (!direct && ev.type !== 'app_mention') return { type: 'ignore' };
		if (!ev.channel || !ev.user) return { type: 'ignore' };
		return { type: 'enqueue', dedupeKey: `event:${body.event_id || ev.client_msg_id || ev.ts}`, chatKey: `slack:${ev.channel}`, payload: { kind: 'slack_event', team_id: body.team_id, event: ev } };
	}
	const form = Object.fromEntries(new URLSearchParams(text));
	if (form.payload) {
		let p;
		try { p = JSON.parse(form.payload); } catch { return { type: 'ignore' }; }
		if (p?.type !== 'block_actions' || !Array.isArray(p.actions) || !p.actions.length) return { type: 'ignore' };
		const channel = p.channel?.id || p.container?.channel_id;
		if (!channel) return { type: 'ignore' };
		const a = p.actions[0];
		return { type: 'enqueue', dedupeKey: `action:${p.trigger_id || `${a.action_id}:${a.action_ts}`}`, chatKey: `slack:${channel}`, payload: { kind: 'slack_action', action: p } };
	}
	if (form.command && form.channel_id && form.user_id) {
		return { type: 'enqueue', dedupeKey: `command:${form.trigger_id || `${form.channel_id}:${form.user_id}:${Date.now()}`}`, chatKey: `slack:${form.channel_id}`, payload: { kind: 'slack_command', command: form } };
	}
	return { type: 'ignore' };
}

// ── WhatsApp (Cloud API) ─────────────────────────────────────────────────────

/**
 * Verify Meta's X-Hub-Signature-256: `sha256=` + HMAC-SHA256 of the raw body
 * keyed with the app secret.
 */
export function verifyWhatsAppSignature({ rawBody, signature, appSecret }) {
	if (!appSecret || !rawBody) return false;
	const body = Buffer.isBuffer(rawBody) ? rawBody : Buffer.from(String(rawBody));
	const expected = `sha256=${createHmac('sha256', appSecret).update(body).digest('hex')}`;
	return safeEqual(String(signature || '').toLowerCase(), expected);
}

/**
 * Answer Meta's subscription handshake (GET ?hub.mode=subscribe&hub.verify_token=
 * &hub.challenge=). Returns the challenge to echo, or null to refuse.
 */
export function whatsappChallenge(query, verifyToken) {
	if (!verifyToken) return null;
	if (query?.['hub.mode'] !== 'subscribe') return null;
	if (!safeEqual(query?.['hub.verify_token'], verifyToken)) return null;
	const challenge = String(query?.['hub.challenge'] || '');
	return /^[\w-]{1,128}$/.test(challenge) ? challenge : null;
}

/**
 * One Cloud API webhook can batch several messages (and status receipts, which
 * the gateway ignores). Each message becomes its own inbox row.
 * @returns {Array<{ dedupeKey:string, chatKey:string, payload:object }>}
 */
export function whatsappInboxEntries(body) {
	const out = [];
	if (body?.object !== 'whatsapp_business_account') return out;
	for (const entry of body.entry || []) {
		for (const change of entry.changes || []) {
			const value = change?.value;
			if (change?.field !== 'messages' || !value) continue;
			for (const message of value.messages || []) {
				if (!message?.id || !message.from) continue;
				const contact = (value.contacts || []).find((c) => c.wa_id === message.from) || null;
				out.push({
					dedupeKey: String(message.id),
					chatKey: `whatsapp:${message.from}`,
					payload: { kind: 'whatsapp_message', phone_number_id: value.metadata?.phone_number_id || null, contact, message },
				});
			}
		}
	}
	return out;
}

// ── SMS (Twilio) ─────────────────────────────────────────────────────────────

/**
 * Verify X-Twilio-Signature: base64 HMAC-SHA1, keyed with the auth token, of the
 * exact public URL Twilio posted to followed by every form field as key+value,
 * keys sorted.
 */
export function verifyTwilioSignature({ url, params, signature, authToken }) {
	if (!authToken || !url || !signature) return false;
	const data = Object.keys(params || {}).sort().reduce((s, k) => s + k + String(params[k] ?? ''), String(url));
	const expected = createHmac('sha1', authToken).update(Buffer.from(data, 'utf8')).digest('base64');
	return safeEqual(signature, expected);
}

/** @returns {{ dedupeKey:string, chatKey:string } | null} */
export function smsInboxKeys(params) {
	if (!params?.MessageSid || !params.From) return null;
	return { dedupeKey: String(params.MessageSid), chatKey: `sms:${params.From}` };
}
