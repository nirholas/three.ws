// Telegram adapter (grammY). Turns a queued Bot API update into a gateway event
// and implements the gateway send surface over the Bot API.
//
// Production delivery is the webhook: api/gateway/telegram.js verifies the
// secret header and queues the raw update in gateway_inbox. For local
// development without a public URL, GATEWAY_TELEGRAM_POLLING=1 pulls updates
// with getUpdates and queues them the same way, so both paths drain through the
// same loop. Polling refuses to start while a webhook is set, because
// getUpdates only works after deleting it and that would cut production off.

import { Api, Bot, GrammyError, HttpError, InputFile } from 'grammy';
import { chunkText, MAX_TEXT } from '../../../../api/_lib/gateway/format.js';
import { parseActionId } from '../../../../api/_lib/gateway/approvals.js';
import { parseApprovalCallback } from '../../../../api/_lib/gateway/approval-buttons.js';
import { telegramInboxKeys } from '../../../../api/_lib/gateway/webhooks.js';
import { PlatformError, isPermanentStatus } from '../errors.js';

const PLATFORM = 'telegram';
const TEXT_LIMIT = MAX_TEXT.telegram;
const HARD_LIMIT = 4096;
const CAPTION_LIMIT = 1024;
const FILE_API = 'https://api.telegram.org/file';
const ALLOWED_UPDATES = ['message', 'callback_query'];
const IMAGE_EXT = /\.(png|jpe?g|webp|gif)(\?|$)/i;
const VIDEO_EXT = /\.(mp4|mov|webm)(\?|$)/i;

export function telegramConfigured(env = process.env) {
	return env.TELEGRAM_BOT_TOKEN ? { ok: true } : { ok: false, missing: ['TELEGRAM_BOT_TOKEN'] };
}

/** Map a grammY failure to a PlatformError the drain knows how to retry. */
export function toPlatformError(err) {
	if (err instanceof PlatformError) return err;
	if (err instanceof GrammyError) {
		const retryAfter = Number(err.parameters?.retry_after);
		return new PlatformError(PLATFORM, err.description || err.message, {
			status: err.error_code,
			code: err.error_code,
			permanent: isPermanentStatus(err.error_code),
			retryAfterMs: Number.isFinite(retryAfter) ? retryAfter * 1000 : null,
			cause: err,
		});
	}
	if (err instanceof HttpError) return new PlatformError(PLATFORM, `network: ${err.message}`, { cause: err });
	return err;
}

async function call(fn) {
	try {
		return await fn();
	} catch (e) {
		throw toPlatformError(e);
	}
}

/**
 * A command as Telegram delivers it: "/cmd", "/cmd args" or "/cmd@bot args".
 * Returns null for ordinary text and for a command addressed to another bot.
 */
export function parseTelegramCommand(text, botUsername = null) {
	const m = /^\/([A-Za-z0-9_]{1,32})(?:@([A-Za-z0-9_]{3,64}))?(?:\s+([\s\S]*))?$/.exec(String(text || '').trim());
	if (!m) return null;
	if (m[2] && botUsername && m[2].toLowerCase() !== String(botUsername).toLowerCase()) return { foreign: true };
	return { command: m[1].toLowerCase(), args: (m[3] || '').trim() };
}

/**
 * A message whose words are not the sender's own: forwarded from anyone,
 * auto-forwarded from a linked channel, or posted through an inline bot.
 * Bot API 7.0+ sends forward_origin; the older forward_* fields are still
 * checked so a client on either shape is caught.
 */
export function isForwarded(m) {
	return Boolean(m.forward_origin || m.forward_from || m.forward_from_chat || m.forward_sender_name || m.forward_date || m.is_automatic_forward || m.via_bot);
}

function keyboard(choices) {
	return { inline_keyboard: choices.length ? [choices.map((c) => ({ text: String(c.label).slice(0, 64), callback_data: String(c.id).slice(0, 64) }))] : [] };
}

function refOf(msg) {
	return { chatId: String(msg.chat.id), messageId: msg.message_id };
}

function mediaKind(media) {
	if (media.kind) return media.kind;
	if (IMAGE_EXT.test(media.url) || /\/api\/render\//.test(media.url)) return 'image';
	if (VIDEO_EXT.test(media.url)) return 'video';
	return 'document';
}

/**
 * @param {object} [opts]
 * @param {Record<string,string|undefined>} [opts.env]
 * @param {Api} [opts.api]            a grammY Api (tests pass one whose transformer answers at the platform boundary)
 * @param {typeof fetch} [opts.fetch] downloads voice notes and photos from the file endpoint
 * @param {object} [opts.config]      worker config (telegramPolling)
 * @param {object} [opts.log]
 */
export function createTelegramAdapter({ env = process.env, api = null, fetch: fetchImpl = globalThis.fetch, config = {}, log = null } = {}) {
	const token = env.TELEGRAM_BOT_TOKEN;
	const client = api || new Api(token);
	let botUsername = env.TELEGRAM_BOT_USERNAME ? env.TELEGRAM_BOT_USERNAME.replace(/^@/, '') : null;
	let poller = null;

	async function download(fileId, fallbackMime) {
		const file = await call(() => client.getFile(fileId));
		if (!file?.file_path) throw new PlatformError(PLATFORM, 'file has no download path', { permanent: true });
		const r = await fetchImpl(`${FILE_API}/bot${token}/${file.file_path}`, { signal: AbortSignal.timeout(20_000) });
		if (!r.ok) throw new PlatformError(PLATFORM, `file download ${r.status}`, { status: r.status, permanent: isPermanentStatus(r.status) });
		return { buffer: Buffer.from(await r.arrayBuffer()), mimeType: r.headers.get('content-type')?.startsWith('application/octet') ? fallbackMime : (r.headers.get('content-type') || fallbackMime) };
	}

	function normalizeCallback(q) {
		const msg = q.message;
		if (!msg?.chat || !q.from) return null;
		const approvalAction = parseApprovalCallback(q.data);
		const action = approvalAction ? null : parseActionId(q.data);
		if (!approvalAction && !action) return null;
		return {
			platform: PLATFORM,
			chatId: String(msg.chat.id),
			chatType: msg.chat.type || null,
			chatTitle: msg.chat.title || msg.chat.username || null,
			userId: String(q.from.id),
			username: q.from.username || null,
			...(approvalAction ? { approvalAction } : { action }),
			messageRef: refOf(msg),
			callbackQueryId: q.id,
		};
	}

	function normalizeMessage(m) {
		if (!m?.chat || !m.from || m.from.is_bot) return null;
		const base = {
			platform: PLATFORM,
			chatId: String(m.chat.id),
			chatType: m.chat.type || null,
			chatTitle: m.chat.title || m.chat.username || null,
			userId: String(m.from.id),
			username: m.from.username || null,
		};
		if (isForwarded(m)) return { ...base, forwarded: true };
		if (typeof m.text === 'string') {
			const cmd = parseTelegramCommand(m.text, botUsername);
			if (cmd?.foreign) return null;
			if (cmd) return { ...base, command: cmd.command, args: cmd.args };
			const mention = botUsername ? new RegExp(`@${botUsername}\\b`, 'ig') : null;
			const text = (mention ? m.text.replace(mention, '') : m.text).trim();
			return text ? { ...base, text } : null;
		}
		const audio = m.voice || m.audio;
		if (audio?.file_id) {
			const mime = audio.mime_type || 'audio/ogg';
			return { ...base, voice: { fetch: () => download(audio.file_id, mime) } };
		}
		const photo = Array.isArray(m.photo) && m.photo.length ? m.photo[m.photo.length - 1] : null;
		const imageDoc = m.document?.mime_type?.startsWith('image/') ? m.document : null;
		if (photo || imageDoc) {
			const fileId = (photo || imageDoc).file_id;
			const mime = imageDoc?.mime_type || 'image/jpeg';
			return { ...base, photo: { fetch: () => download(fileId, mime), caption: m.caption || '' } };
		}
		return null;
	}

	/** @returns {object|null} a GatewayEvent, or null for updates the gateway does not answer */
	function normalize(update) {
		if (!update || typeof update !== 'object') return null;
		if (update.callback_query) return normalizeCallback(update.callback_query);
		if (update.message) return normalizeMessage(update.message);
		return null;
	}

	async function sendText(chatId, text) {
		let ref = null;
		for (const part of chunkText(text, TEXT_LIMIT)) {
			const msg = await call(() => client.sendMessage(chatId, part, { link_preview_options: { is_disabled: true } }));
			ref = refOf(msg);
		}
		return ref;
	}

	/** One gateway per event; Telegram needs no per-event state beyond the callback id. */
	function gateway() {
		return {
			platform: PLATFORM,
			buttons: true,
			canEdit: true,
			sendText,
			async sendChoice(chatId, text, choices) {
				const msg = await call(() => client.sendMessage(chatId, String(text).slice(0, HARD_LIMIT), {
					reply_markup: keyboard(choices || []),
					link_preview_options: { is_disabled: true },
				}));
				return refOf(msg);
			},
			async editMessage(ref, text, opts = {}) {
				const other = { link_preview_options: { is_disabled: true } };
				if (Array.isArray(opts.choices)) other.reply_markup = keyboard(opts.choices);
				try {
					await call(() => client.editMessageText(ref.chatId, ref.messageId, String(text).slice(0, HARD_LIMIT), other));
				} catch (e) {
					// Editing to identical text is a no-op Telegram reports as an error.
					if (e instanceof PlatformError && /message is not modified/i.test(e.message)) return;
					throw e;
				}
			},
			async sendMedia(chatId, media) {
				const caption = media.caption ? String(media.caption).slice(0, CAPTION_LIMIT) : undefined;
				const kind = mediaKind(media);
				const msg = await call(() => (kind === 'image'
					? client.sendPhoto(chatId, media.url, { caption })
					: kind === 'video'
						? client.sendVideo(chatId, media.url, { caption })
						: client.sendDocument(chatId, media.url, { caption })));
				return refOf(msg);
			},
			async sendVoice(chatId, clip) {
				const msg = await call(() => client.sendVoice(chatId, new InputFile(clip.buffer, clip.filename || 'reply.ogg')));
				return refOf(msg);
			},
			async typing(chatId) {
				await call(() => client.sendChatAction(chatId, 'typing'));
			},
			async ackAction(event, text) {
				if (!event?.callbackQueryId) return;
				try {
					await call(() => client.answerCallbackQuery(event.callbackQueryId, text ? { text: String(text).slice(0, 200) } : {}));
				} catch (e) {
					// A press answered late ("query is too old") changes nothing for the
					// owner; the preview message itself carries the outcome.
					if (e instanceof PlatformError && e.status === 400) return;
					throw e;
				}
			},
		};
	}

	return {
		platform: PLATFORM,
		normalize,
		gateway,
		async start({ enqueue }) {
			if (!botUsername) {
				const me = await call(() => client.getMe()).catch((e) => {
					log?.warn('telegram getMe failed; commands addressed to other bots cannot be told apart', { error: e.message });
					return null;
				});
				botUsername = me?.username || null;
			}
			if (!config.telegramPolling) return;
			const info = await call(() => client.getWebhookInfo());
			if (info?.url) {
				log?.error('telegram polling refused: a webhook is set, and polling would delete it', { webhookHost: new URL(info.url).host });
				return;
			}
			poller = new Bot(token);
			poller.use(async (ctx) => {
				const keys = telegramInboxKeys(ctx.update);
				if (!keys) return;
				await enqueue({ platform: PLATFORM, ...keys, payload: ctx.update });
			});
			poller.catch((e) => log?.warn('telegram polling update failed', { error: e.message }));
			poller.start({ allowed_updates: ALLOWED_UPDATES, drop_pending_updates: false })
				.catch((e) => log?.error('telegram polling stopped', { error: e.message }));
			log?.info('telegram polling started', { bot: botUsername });
		},
		async stop() {
			if (poller) await poller.stop().catch(() => {});
			poller = null;
		},
		describe() {
			return { bot: botUsername, mode: poller ? 'polling' : 'webhook' };
		},
	};
}
