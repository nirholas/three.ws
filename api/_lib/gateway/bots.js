// Direct platform REST for the chat gateways: which bots are configured, how a
// user reaches them, and a plain send used by server code that runs outside the
// gateway worker (notifications, "this chat was unlinked" notices).

import { cacheGet, cacheSet } from '../cache.js';
import { slackOAuthConfigured, slackTokenFor, countSlackInstalls } from './slack-installs.js';
import { telephonyConfigured } from './voice-calls.js';
import { speechConfigured, ttsLanes } from './audio.js';

const TG_API = 'https://api.telegram.org';
const DISCORD_API = 'https://discord.com/api/v10';
// View Channel, Send Messages, Embed Links, Attach Files, Read Message History.
export const DISCORD_BOT_PERMISSIONS = String(1024 + 2048 + 16384 + 32768 + 65536);

export function telegramConfigured(env = process.env) {
	return Boolean(env.TELEGRAM_BOT_TOKEN);
}

export function discordConfigured(env = process.env) {
	return Boolean(env.DISCORD_BOT_TOKEN && env.DISCORD_APP_ID && env.DISCORD_PUBLIC_KEY);
}

export async function telegramUsername() {
	if (process.env.TELEGRAM_BOT_USERNAME) return process.env.TELEGRAM_BOT_USERNAME.replace(/^@/, '');
	const cached = await cacheGet('gateway:tg:username').catch(() => null);
	if (cached) return cached;
	const r = await fetch(`${TG_API}/bot${process.env.TELEGRAM_BOT_TOKEN}/getMe`, { signal: AbortSignal.timeout(5000) });
	const j = await r.json().catch(() => null);
	const name = j?.ok ? j.result.username : null;
	if (name) await cacheSet('gateway:tg:username', name, 3600).catch(() => {});
	return name;
}

export function slackConfigured(env = process.env) {
	return Boolean(env.SLACK_SIGNING_SECRET && (env.SLACK_BOT_TOKEN || (env.SLACK_CLIENT_ID && env.SLACK_CLIENT_SECRET)));
}

export function whatsappConfigured(env = process.env) {
	return Boolean(env.WHATSAPP_ACCESS_TOKEN && env.WHATSAPP_PHONE_NUMBER_ID && env.WHATSAPP_APP_SECRET);
}

/** The business number people message, as digits, for a wa.me link. */
function whatsappNumber(env = process.env) {
	const digits = String(env.WHATSAPP_DISPLAY_NUMBER || '').replace(/\D/g, '');
	return digits.length >= 8 ? digits : null;
}

/** How the settings page offers each bot. Unconfigured bots say so. */
export async function gatewayBots() {
	const out = {
		telegram: { available: false },
		discord: { available: false },
		slack: { available: false },
		whatsapp: { available: false },
		voice: { available: false },
	};
	if (telegramConfigured()) {
		const username = await telegramUsername().catch(() => null);
		out.telegram = username
			? { available: true, username, url: `https://t.me/${username}` }
			: { available: false, reason: 'unreachable' };
	}
	if (discordConfigured()) {
		out.discord = {
			available: true,
			invite_url: `https://discord.com/oauth2/authorize?client_id=${process.env.DISCORD_APP_ID}&scope=bot+applications.commands&permissions=${DISCORD_BOT_PERMISSIONS}`,
			dm_url: `https://discord.com/users/${process.env.DISCORD_APP_ID}`,
		};
	}
	if (slackConfigured()) {
		const oauth = slackOAuthConfigured();
		out.slack = {
			available: true,
			install_url: oauth ? '/api/gateway/slack?leg=install' : null,
			workspaces: oauth ? await countSlackInstalls().catch(() => null) : null,
			single_workspace: !oauth,
		};
	}
	if (whatsappConfigured()) {
		const number = whatsappNumber();
		out.whatsapp = { available: true, number: number ? `+${number}` : null, url: number ? `https://wa.me/${number}?text=%2Fstart` : null };
	}
	// The browser leg needs speech in and out; the phone leg is opt-in on top.
	const listens = speechConfigured();
	const speaks = ttsLanes().length > 0;
	if (listens && speaks) {
		const phone = telephonyConfigured().ok && process.env.GATEWAY_VOICE_NUMBER ? process.env.GATEWAY_VOICE_NUMBER : null;
		out.voice = { available: true, browser: true, phone_number: phone };
	} else {
		out.voice = { available: false, reason: listens ? 'no_tts' : 'no_asr' };
	}
	return out;
}

async function telegramCall(method, payload) {
	if (!telegramConfigured()) throw new Error('telegram not configured');
	const r = await fetch(`${TG_API}/bot${process.env.TELEGRAM_BOT_TOKEN}/${method}`, {
		method: 'POST',
		headers: { 'content-type': 'application/json' },
		body: JSON.stringify(payload),
		signal: AbortSignal.timeout(8000),
	});
	const j = await r.json().catch(() => ({}));
	if (!j.ok) throw Object.assign(new Error(j.description || `telegram ${r.status}`), { status: r.status, code: j.error_code });
	return j.result;
}

/** Send a message with one row of inline buttons: `buttons` is [{ text, data }]. */
export function sendTelegramButtons(chatId, text, buttons) {
	return telegramCall('sendMessage', {
		chat_id: chatId,
		text: String(text).slice(0, 4000),
		disable_web_page_preview: true,
		reply_markup: { inline_keyboard: [buttons.map((b) => ({ text: b.text, callback_data: b.data }))] },
	});
}

/** Acknowledge a button press so the client stops its spinner; `text` shows as a toast. */
export function answerTelegramCallback(callbackQueryId, text = '') {
	return telegramCall('answerCallbackQuery', { callback_query_id: callbackQueryId, text: String(text).slice(0, 190) });
}

/** Send one plain-text message to a paired chat. Throws on a platform refusal. */
export async function sendPlatformText(platform, chatId, text) {
	if (platform === 'telegram') {
		if (!telegramConfigured()) throw new Error('telegram not configured');
		const r = await fetch(`${TG_API}/bot${process.env.TELEGRAM_BOT_TOKEN}/sendMessage`, {
			method: 'POST',
			headers: { 'content-type': 'application/json' },
			body: JSON.stringify({ chat_id: chatId, text: String(text).slice(0, 4000), disable_web_page_preview: true }),
			signal: AbortSignal.timeout(8000),
		});
		const j = await r.json().catch(() => ({}));
		if (!j.ok) throw Object.assign(new Error(j.description || `telegram ${r.status}`), { status: r.status, code: j.error_code });
		return j.result;
	}
	if (platform === 'discord') {
		if (!process.env.DISCORD_BOT_TOKEN) throw new Error('discord not configured');
		const r = await fetch(`${DISCORD_API}/channels/${chatId}/messages`, {
			method: 'POST',
			headers: { 'content-type': 'application/json', authorization: `Bot ${process.env.DISCORD_BOT_TOKEN}` },
			body: JSON.stringify({ content: String(text).slice(0, 1900), allowed_mentions: { parse: [] } }),
			signal: AbortSignal.timeout(8000),
		});
		if (!r.ok) {
			const j = await r.json().catch(() => ({}));
			throw Object.assign(new Error(j.message || `discord ${r.status}`), { status: r.status, code: j.code });
		}
		return r.json();
	}
	if (platform === 'slack') {
		const [teamId, channel] = String(chatId).split(':');
		const token = await slackTokenFor(teamId && teamId !== '_' ? teamId : null);
		if (!token || !channel) throw new Error('slack not configured');
		const r = await fetch('https://slack.com/api/chat.postMessage', {
			method: 'POST',
			headers: { 'content-type': 'application/json; charset=utf-8', authorization: `Bearer ${token}` },
			body: JSON.stringify({ channel, text: String(text).slice(0, 3900), unfurl_links: false }),
			signal: AbortSignal.timeout(8000),
		});
		const j = await r.json().catch(() => ({}));
		if (!j.ok) throw Object.assign(new Error(`slack ${j.error || r.status}`), { status: r.status, code: j.error });
		return j;
	}
	if (platform === 'whatsapp') {
		if (!process.env.WHATSAPP_ACCESS_TOKEN || !process.env.WHATSAPP_PHONE_NUMBER_ID) throw new Error('whatsapp not configured');
		const version = process.env.WHATSAPP_GRAPH_VERSION || 'v21.0';
		const r = await fetch(`https://graph.facebook.com/${version}/${process.env.WHATSAPP_PHONE_NUMBER_ID}/messages`, {
			method: 'POST',
			headers: { 'content-type': 'application/json', authorization: `Bearer ${process.env.WHATSAPP_ACCESS_TOKEN}` },
			body: JSON.stringify({ messaging_product: 'whatsapp', to: String(chatId), type: 'text', text: { body: String(text).slice(0, 4000), preview_url: false } }),
			signal: AbortSignal.timeout(8000),
		});
		const j = await r.json().catch(() => ({}));
		if (!r.ok || j.error) throw Object.assign(new Error(j.error?.message || `whatsapp ${r.status}`), { status: r.status, code: j.error?.code });
		return j;
	}
	// Voice has nowhere to deliver text: a call is over and the browser panel
	// shows the connection state itself.
	if (platform === 'voice') return null;
	throw new Error(`unknown platform ${platform}`);
}
