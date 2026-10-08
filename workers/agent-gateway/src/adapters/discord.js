// Discord adapter (discord.js). Two inbound paths land in the same inbox:
//
//   interactions   slash commands and the Approve / Cancel buttons. Discord
//                  posts them to api/gateway/discord.js, which verifies the
//                  Ed25519 signature, defers inside the three-second window and
//                  queues the interaction. The worker answers through that
//                  interaction's webhook: a command's first message replaces the
//                  deferred "thinking...", later ones are followups, and a button
//                  press edits the message the button sits on.
//   messages       DMs to the bot and messages that mention it. These never
//                  reach an HTTP endpoint; the worker holds a gateway connection
//                  and queues each one as {kind:'discord_message'}. Discord
//                  includes message content for DMs and mentions without the
//                  privileged Message Content intent.
//
// Everything else (notifications, the preview sweeper, plain chat replies) is a
// bot-token REST call to the channel.

import {
	Client, DiscordAPIError, Events, GatewayIntentBits, HTTPError, Partials, REST, RateLimitError, Routes,
} from 'discord.js';
import { chunkText, MAX_TEXT } from '../../../../api/_lib/gateway/format.js';
import { parseActionId } from '../../../../api/_lib/gateway/approvals.js';
import { DISCORD_INTERACTION } from '../../../../api/_lib/gateway/webhooks.js';
import { PlatformError, isPermanentStatus } from '../errors.js';

const PLATFORM = 'discord';
const TEXT_LIMIT = MAX_TEXT.discord;
const HARD_LIMIT = 2000;
const EPHEMERAL = 64;
// Interaction tokens live fifteen minutes; stop using one a minute early.
const TOKEN_TTL_MS = 14 * 60 * 1000;
const DISCORD_EPOCH = 1420070400000n;
const STYLE = { primary: 1, secondary: 2, success: 3, danger: 4 };
const NO_MENTIONS = { parse: [] };
const IMAGE_EXT = /\.(png|jpe?g|webp|gif)(\?|$)/i;

export function discordConfigured(env = process.env) {
	const missing = ['DISCORD_BOT_TOKEN', 'DISCORD_APP_ID'].filter((k) => !env[k]);
	return missing.length ? { ok: false, missing } : { ok: true };
}

/** When a snowflake (an interaction id) was minted, in epoch ms. */
export function snowflakeTime(id) {
	try {
		return Number((BigInt(id) >> 22n) + DISCORD_EPOCH);
	} catch {
		return 0;
	}
}

function tokenFresh(interactionId, now = Date.now()) {
	const t = snowflakeTime(interactionId);
	return t > 0 && now - t < TOKEN_TTL_MS;
}

/** Map a discord.js REST failure to a PlatformError the drain knows how to retry. */
export function toPlatformError(err) {
	if (err instanceof PlatformError) return err;
	if (err instanceof DiscordAPIError) {
		return new PlatformError(PLATFORM, err.message, { status: err.status, code: err.code, permanent: isPermanentStatus(err.status), cause: err });
	}
	if (err instanceof RateLimitError) return new PlatformError(PLATFORM, 'rate limited', { status: 429, retryAfterMs: err.retryAfter, cause: err });
	if (err instanceof HTTPError) return new PlatformError(PLATFORM, err.message, { status: err.status, permanent: isPermanentStatus(err.status), cause: err });
	return err;
}

async function call(fn) {
	try {
		return await fn();
	} catch (e) {
		throw toPlatformError(e);
	}
}

/** A typed "/cmd args" in a DM or mention, for users who did not pick the slash command. */
export function parseTypedCommand(text) {
	const m = /^\/([a-z0-9_-]{1,32})(?:\s+([\s\S]*))?$/i.exec(String(text || '').trim());
	if (!m) return null;
	if (m[1].toLowerCase() === 'three') {
		const rest = (m[2] || '').trim();
		const sub = /^([a-z0-9_-]{1,32})(?:\s+([\s\S]*))?$/i.exec(rest);
		return sub ? { command: sub[1].toLowerCase(), args: (sub[2] || '').trim() } : { command: 'help', args: '' };
	}
	return { command: m[1].toLowerCase(), args: (m[2] || '').trim() };
}

function componentRows(choices) {
	if (!choices.length) return [];
	return [{
		type: 1,
		components: choices.slice(0, 5).map((c) => ({ type: 2, style: STYLE[c.style] || STYLE.secondary, label: String(c.label).slice(0, 80), custom_id: String(c.id).slice(0, 100) })),
	}];
}

function userOf(interaction) {
	return interaction.member?.user || interaction.user || null;
}

function commandOf(data) {
	let name = String(data?.name || '').toLowerCase();
	let options = Array.isArray(data?.options) ? data.options : [];
	if (name === 'three') {
		const sub = options[0];
		name = String(sub?.name || 'help').toLowerCase();
		options = Array.isArray(sub?.options) ? sub.options : [];
	}
	const args = options.map((o) => (o?.value == null ? '' : String(o.value))).join(' ').trim();
	return { command: name, args };
}

/**
 * @param {object} [opts]
 * @param {Record<string,string|undefined>} [opts.env]
 * @param {{ get:Function, post:Function, patch:Function, put:Function, delete:Function }} [opts.rest]
 *   a discord.js REST client (tests pass one that answers at the platform boundary)
 * @param {typeof fetch} [opts.fetch]  downloads attachments
 * @param {object} [opts.config]       worker config (discordGateway)
 * @param {object} [opts.log]
 * @param {() => number} [opts.now]
 */
export function createDiscordAdapter({ env = process.env, rest = null, fetch: fetchImpl = globalThis.fetch, config = {}, log = null, now = Date.now } = {}) {
	const token = env.DISCORD_BOT_TOKEN;
	const appId = env.DISCORD_APP_ID;
	const api = rest || new REST({ version: '10' }).setToken(token);
	let client = null;

	async function fetchAttachment(att) {
		const r = await fetchImpl(att.url, { signal: AbortSignal.timeout(20_000) });
		if (!r.ok) throw new PlatformError(PLATFORM, `attachment download ${r.status}`, { status: r.status, permanent: isPermanentStatus(r.status) });
		return { buffer: Buffer.from(await r.arrayBuffer()), mimeType: att.content_type || r.headers.get('content-type') || 'application/octet-stream' };
	}

	function interactionEvent(i) {
		const user = userOf(i);
		if (!user?.id || !i.channel_id) return null;
		const base = {
			platform: PLATFORM,
			chatId: String(i.channel_id),
			chatType: i.guild_id ? 'guild' : 'dm',
			chatTitle: i.channel?.name || null,
			userId: String(user.id),
			username: user.username || null,
			interaction: { id: String(i.id), token: i.token, applicationId: String(i.application_id || appId), type: i.type, messageId: i.message?.id ? String(i.message.id) : null },
		};
		if (i.type === DISCORD_INTERACTION.APPLICATION_COMMAND) return { ...base, ...commandOf(i.data) };
		if (i.type === DISCORD_INTERACTION.MESSAGE_COMPONENT) {
			const action = parseActionId(i.data?.custom_id);
			if (!action || !i.message?.id) return null;
			return { ...base, action, messageRef: { kind: 'channel', channelId: String(i.channel_id), messageId: String(i.message.id) } };
		}
		return null;
	}

	function messageEvent(payload) {
		const m = payload.message;
		if (!m?.author?.id || m.author.bot || !m.channel_id) return null;
		const base = {
			platform: PLATFORM,
			chatId: String(m.channel_id),
			chatType: m.guild_id ? 'guild' : 'dm',
			chatTitle: payload.channel_name || null,
			userId: String(m.author.id),
			username: m.author.username || null,
		};
		const botId = payload.botUserId ? String(payload.botUserId) : null;
		const text = String(m.content || '').replace(botId ? new RegExp(`<@!?${botId}>`, 'g') : /$^/, '').trim();
		const attachments = Array.isArray(m.attachments) ? m.attachments : [];
		const audio = attachments.find((a) => String(a.content_type || '').startsWith('audio/'));
		if (audio) return { ...base, voice: { fetch: () => fetchAttachment(audio) } };
		const image = attachments.find((a) => String(a.content_type || '').startsWith('image/'));
		if (image) return { ...base, photo: { fetch: () => fetchAttachment(image), caption: text } };
		if (!text) return null;
		const cmd = parseTypedCommand(text);
		return cmd ? { ...base, ...cmd } : { ...base, text };
	}

	/** @returns {object|null} a GatewayEvent, or null for deliveries the gateway does not answer */
	function normalize(payload) {
		if (!payload || typeof payload !== 'object') return null;
		if (payload.kind === 'discord_message') return messageEvent(payload);
		if (payload.type === DISCORD_INTERACTION.APPLICATION_COMMAND || payload.type === DISCORD_INTERACTION.MESSAGE_COMPONENT) return interactionEvent(payload);
		return null;
	}

	function channelRef(msg) {
		return { kind: 'channel', channelId: String(msg.channel_id), messageId: String(msg.id) };
	}

	/**
	 * One gateway per event. It holds the interaction being answered, if any, and
	 * whether the deferred original response has been filled yet.
	 */
	function gateway(event) {
		const interaction = event?.interaction || null;
		let originalFilled = false;
		const live = () => interaction && tokenFresh(interaction.id, now());

		async function post(chatId, body, files) {
			const payload = { ...body, allowed_mentions: NO_MENTIONS };
			if (live() && String(chatId) === String(event.chatId)) {
				const { applicationId: app, token: tok } = interaction;
				const opts = { body: payload, files, auth: false };
				const fillOriginal = interaction.type === DISCORD_INTERACTION.APPLICATION_COMMAND && !originalFilled;
				const msg = await call(() => (fillOriginal
					? api.patch(Routes.webhookMessage(app, tok, '@original'), opts)
					: api.post(Routes.webhook(app, tok), opts)));
				if (fillOriginal) originalFilled = true;
				return { kind: 'interaction', applicationId: app, token: tok, interactionId: interaction.id, channelId: String(msg.channel_id || chatId), messageId: String(msg.id) };
			}
			const msg = await call(() => api.post(Routes.channelMessages(chatId), { body: payload, files }));
			return channelRef(msg);
		}

		async function edit(ref, body) {
			const payload = { ...body, allowed_mentions: NO_MENTIONS };
			// The press being answered sits on this message: its own token edits it.
			if (live() && interaction.type === DISCORD_INTERACTION.MESSAGE_COMPONENT && String(ref.messageId) === interaction.messageId) {
				return call(() => api.patch(Routes.webhookMessage(interaction.applicationId, interaction.token, '@original'), { body: payload, auth: false }));
			}
			if (ref.kind === 'interaction' && tokenFresh(ref.interactionId, now())) {
				try {
					return await call(() => api.patch(Routes.webhookMessage(ref.applicationId, ref.token, ref.messageId), { body: payload, auth: false }));
				} catch (e) {
					if (!(e instanceof PlatformError) || !e.permanent) throw e;
				}
			}
			return call(() => api.patch(Routes.channelMessage(ref.channelId, ref.messageId), { body: payload }));
		}

		return {
			platform: PLATFORM,
			buttons: true,
			canEdit: true,
			async sendText(chatId, text) {
				let ref = null;
				for (const part of chunkText(text, TEXT_LIMIT)) ref = await post(chatId, { content: part });
				return ref;
			},
			sendChoice(chatId, text, choices) {
				return post(chatId, { content: String(text).slice(0, HARD_LIMIT), components: componentRows(choices || []) });
			},
			async editMessage(ref, text, opts = {}) {
				const body = { content: String(text).slice(0, HARD_LIMIT) };
				if (Array.isArray(opts.choices)) body.components = componentRows(opts.choices);
				await edit(ref, body);
			},
			sendMedia(chatId, media) {
				const caption = media.caption ? String(media.caption).slice(0, HARD_LIMIT) : undefined;
				const image = media.kind ? media.kind === 'image' : (IMAGE_EXT.test(media.url) || /\/api\/render\//.test(media.url));
				return image
					? post(chatId, { content: caption, embeds: [{ image: { url: media.url } }] })
					: post(chatId, { content: [caption, media.url].filter(Boolean).join('\n') });
			},
			sendVoice(chatId, clip) {
				return post(chatId, { content: '' }, [{ name: clip.filename || 'reply.ogg', data: clip.buffer, contentType: clip.mimeType || 'audio/ogg' }]);
			},
			async typing(chatId) {
				// A deferred command already shows "thinking..."; typing into a
				// channel the bot is not a member of would only be refused.
				if (live()) return;
				await call(() => api.post(Routes.channelTyping(chatId)));
			},
			async ackAction(_event, text) {
				if (!text || !live() || interaction.type !== DISCORD_INTERACTION.MESSAGE_COMPONENT) return;
				await call(() => api.post(Routes.webhook(interaction.applicationId, interaction.token), {
					body: { content: String(text).slice(0, HARD_LIMIT), flags: EPHEMERAL, allowed_mentions: NO_MENTIONS },
					auth: false,
				}));
			},
			/** Whether the deferred "thinking..." still needs resolving. */
			pendingOriginal() {
				return Boolean(live() && interaction.type === DISCORD_INTERACTION.APPLICATION_COMMAND && !originalFilled);
			},
			async clearOriginal() {
				await call(() => api.delete(Routes.webhookMessage(interaction.applicationId, interaction.token, '@original'), { auth: false }));
				originalFilled = true;
			},
		};
	}

	return {
		platform: PLATFORM,
		normalize,
		gateway,
		/** A command that produced no message would leave "thinking..." forever; remove it. */
		async finish(_event, gw) {
			if (typeof gw.pendingOriginal === 'function' && gw.pendingOriginal()) await gw.clearOriginal().catch(() => {});
		},
		async start({ enqueue }) {
			if (config.discordGateway === false) return;
			client = new Client({
				intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages, GatewayIntentBits.DirectMessages],
				partials: [Partials.Channel],
			});
			client.on(Events.MessageCreate, (m) => {
				if (m.author?.bot) return;
				const direct = !m.guildId;
				if (!direct && !m.mentions?.users?.has(client.user.id)) return;
				enqueue({
					platform: PLATFORM,
					dedupeKey: `message:${m.id}`,
					chatKey: `${PLATFORM}:${m.channelId}`,
					payload: {
						kind: 'discord_message',
						botUserId: client.user.id,
						channel_name: m.channel?.name || null,
						message: {
							id: m.id,
							channel_id: m.channelId,
							guild_id: m.guildId || null,
							content: m.content || '',
							author: { id: m.author.id, username: m.author.username, bot: Boolean(m.author.bot) },
							attachments: [...m.attachments.values()].map((a) => ({ url: a.url, content_type: a.contentType || null, size: a.size, filename: a.name })),
						},
					},
				}).catch((e) => log?.error('discord message not queued', { error: e.message }));
			});
			client.on(Events.Error, (e) => log?.warn('discord gateway error', { error: e.message }));
			client.once(Events.ClientReady, (c) => log?.info('discord gateway connected', { bot: c.user.tag }));
			await client.login(token);
		},
		async stop() {
			if (client) await client.destroy().catch(() => {});
			client = null;
		},
		describe() {
			return { app: appId, gateway: client?.isReady?.() ? 'connected' : (config.discordGateway === false ? 'off' : 'connecting') };
		},
	};
}
