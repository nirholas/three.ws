// Direct platform REST for the chat gateways: which bots are configured, how a
// user reaches them, and a plain send used by server code that runs outside the
// gateway worker (notifications, "this chat was unlinked" notices).

import { cacheGet, cacheSet } from '../cache.js';

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

async function telegramUsername() {
	if (process.env.TELEGRAM_BOT_USERNAME) return process.env.TELEGRAM_BOT_USERNAME.replace(/^@/, '');
	const cached = await cacheGet('gateway:tg:username').catch(() => null);
	if (cached) return cached;
	const r = await fetch(`${TG_API}/bot${process.env.TELEGRAM_BOT_TOKEN}/getMe`, { signal: AbortSignal.timeout(5000) });
	const j = await r.json().catch(() => null);
	const name = j?.ok ? j.result.username : null;
	if (name) await cacheSet('gateway:tg:username', name, 3600).catch(() => {});
	return name;
}

/** How the settings page offers each bot. Unconfigured bots say so. */
export async function gatewayBots() {
	const out = { telegram: { available: false }, discord: { available: false } };
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
	return out;
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
	throw new Error(`unknown platform ${platform}`);
}
