// Verification and normalisation for the chat gateway webhooks. The receivers
// (api/gateway/telegram.js, api/gateway/discord.js) verify the platform's proof,
// queue the delivery in gateway_inbox and answer at once; the worker does the
// slow part. Kept free of HTTP so the tests can drive every branch.

import { createHash, createPublicKey, timingSafeEqual, verify } from 'node:crypto';

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
