// Slack adapter (Web API over fetch). Every Slack delivery reaches the inbox
// through one HTTP endpoint, api/gateway/slack.js, which verifies the v0 request
// signature (signing secret plus a five-minute timestamp window, so a captured
// request cannot be replayed) and queues three shapes:
//
//   slack_event    a DM to the bot, or a message that mentions it in a channel.
//                  A mention is answered in a thread under it, a DM inline.
//                  Voice clips and images ride along as files.
//   slack_command  the /three slash command: `/three link ABCD-EFGH`,
//                  `/three balance`, `/three` alone for help. Answered
//                  ephemerally through the command's response_url, so it works
//                  in channels the bot was never invited to.
//   slack_action   an Approve / Cancel press on a Block Kit preview.
//
// A chat is `<team id>:<channel id>`, so one worker serves every workspace that
// installed the app: the team half picks the bot token (an OAuth install row in
// gateway_slack_installs, or SLACK_BOT_TOKEN), the channel half is where it
// posts.

import { chunkText, MAX_TEXT } from '../../../../api/_lib/gateway/format.js';
import { parseActionId } from '../../../../api/_lib/gateway/approvals.js';
import { parseApprovalCallback } from '../../../../api/_lib/gateway/approval-buttons.js';
import { slackTokenFor } from '../../../../api/_lib/gateway/slack-installs.js';
import { PlatformError, isPermanentStatus } from '../errors.js';

const PLATFORM = 'slack';
const API = 'https://slack.com/api';
const TEXT_LIMIT = MAX_TEXT.slack;
const RESPONSE_URL_USES = 5;
const MAX_FILE_BYTES = 8 * 1024 * 1024;
// Slack errors that will come back the same however often the call is retried.
const PERMANENT = new Set([
	'channel_not_found', 'not_in_channel', 'is_archived', 'invalid_auth', 'account_inactive', 'token_revoked',
	'not_authed', 'missing_scope', 'msg_too_long', 'no_text', 'invalid_blocks', 'cant_update_message',
	'message_not_found', 'restricted_action', 'team_access_not_granted', 'invalid_arguments', 'user_not_found',
]);
const STYLE = { primary: 'primary', danger: 'danger' };

export function slackConfigured(env = process.env) {
	if (env.SLACK_BOT_TOKEN || (env.SLACK_CLIENT_ID && env.SLACK_CLIENT_SECRET)) return { ok: true };
	return { ok: false, missing: ['SLACK_BOT_TOKEN (or SLACK_CLIENT_ID and SLACK_CLIENT_SECRET for OAuth installs)'] };
}

export function slackChatId(teamId, channel) {
	return `${teamId || '_'}:${channel}`;
}

export function splitChatId(chatId) {
	const s = String(chatId || '');
	const i = s.indexOf(':');
	if (i < 0) return { teamId: null, channel: s };
	const team = s.slice(0, i);
	return { teamId: team === '_' ? null : team, channel: s.slice(i + 1) };
}

/** Slack mrkdwn treats &, < and > as control characters; everything else renders as typed. */
export function slackEscape(text) {
	return String(text ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

/** Drop the bot's own `<@U123>` mention from a message. */
export function stripMentions(text, botUserId = null) {
	const re = botUserId ? new RegExp(`<@${botUserId}(\\|[^>]*)?>`, 'g') : /^\s*<@[UW][A-Z0-9]+(\|[^>]*)?>/;
	return String(text || '').replace(re, '').trim();
}

/** `/three link ABCD` -> { command:'link', args:'ABCD' }; a bare `/three` is help. */
export function parseSlashCommand(text) {
	const m = /^\s*\/?([A-Za-z0-9_]{1,32})(?:\s+([\s\S]*))?$/.exec(String(text || ''));
	if (!m) return { command: 'help', args: '' };
	return { command: m[1].toLowerCase(), args: (m[2] || '').trim() };
}

export function toSlackError(status, body, retryAfterHeader = null) {
	const code = body?.error || `http_${status}`;
	if (status === 429 || code === 'ratelimited') {
		const s = Number(retryAfterHeader);
		return new PlatformError(PLATFORM, 'rate limited', { status: 429, code, retryAfterMs: Number.isFinite(s) ? s * 1000 : 1000 });
	}
	return new PlatformError(PLATFORM, code, { status, code, permanent: PERMANENT.has(code) || isPermanentStatus(status) });
}

function blocksFor(text, choices) {
	const blocks = [{ type: 'section', text: { type: 'plain_text', text: String(text).slice(0, 2900), emoji: false } }];
	if (choices?.length) {
		blocks.push({
			type: 'actions',
			elements: choices.map((c) => ({
				type: 'button',
				action_id: String(c.id).slice(0, 255),
				value: String(c.id).slice(0, 2000),
				text: { type: 'plain_text', text: String(c.label).slice(0, 75) },
				...(STYLE[c.style] ? { style: STYLE[c.style] } : {}),
			})),
		});
	}
	return blocks;
}

function isImage(media) {
	return media.kind === 'image' || /\.(png|jpe?g|webp|gif)(\?|$)/i.test(media.url) || /\/api\/render\//.test(media.url);
}

/**
 * @param {object} [opts]
 * @param {Record<string,string|undefined>} [opts.env]
 * @param {typeof fetch} [opts.fetch]                   every Slack call and file download
 * @param {(teamId:string|null) => Promise<string|null>} [opts.tokenFor]  bot token per workspace
 */
export function createSlackAdapter({ env = process.env, fetch: fetchImpl = globalThis.fetch, tokenFor = null } = {}) {
	const resolveToken = tokenFor || ((teamId) => slackTokenFor(teamId, env));
	const botUserId = env.SLACK_BOT_USER_ID || null;

	async function token(teamId) {
		const t = await resolveToken(teamId);
		if (!t) throw new PlatformError(PLATFORM, `no bot token for workspace ${teamId || '(default)'}`, { permanent: true, code: 'no_token' });
		return t;
	}

	// The file upload methods take form arguments only; the rest take JSON.
	async function call(teamId, method, payload, { form = false } = {}) {
		let r;
		try {
			const body = form
				? new URLSearchParams(Object.entries(payload).map(([k, v]) => [k, typeof v === 'object' ? JSON.stringify(v) : String(v)]))
				: JSON.stringify(payload);
			r = await fetchImpl(`${API}/${method}`, {
				method: 'POST',
				headers: {
					'content-type': form ? 'application/x-www-form-urlencoded' : 'application/json; charset=utf-8',
					authorization: `Bearer ${await token(teamId)}`,
				},
				body,
				signal: AbortSignal.timeout(10_000),
			});
		} catch (e) {
			if (e instanceof PlatformError) throw e;
			throw new PlatformError(PLATFORM, `network: ${e.message}`, { cause: e });
		}
		const body = await r.json().catch(() => ({}));
		if (!r.ok || !body.ok) throw toSlackError(r.status, body, r.headers.get('retry-after'));
		return body;
	}

	async function download(teamId, file) {
		const url = file.url_private_download || file.url_private;
		if (!url) throw new PlatformError(PLATFORM, 'file has no download url', { permanent: true });
		if (file.size > MAX_FILE_BYTES) throw new PlatformError(PLATFORM, 'file too large', { permanent: true });
		const auth = `Bearer ${await token(teamId)}`;
		let r;
		try {
			r = await fetchImpl(url, { headers: { authorization: auth }, signal: AbortSignal.timeout(20_000) });
		} catch (e) {
			throw new PlatformError(PLATFORM, `network: ${e.message}`, { cause: e });
		}
		if (!r.ok) throw new PlatformError(PLATFORM, `file download ${r.status}`, { status: r.status, permanent: isPermanentStatus(r.status) });
		return { buffer: Buffer.from(await r.arrayBuffer()), mimeType: file.mimetype || r.headers.get('content-type') || 'application/octet-stream' };
	}

	function normalizeEvent(p) {
		const ev = p.event;
		if (!ev?.channel || !ev.user || ev.bot_id) return null;
		const teamId = p.team_id || ev.team || null;
		const direct = ev.channel_type === 'im';
		const base = {
			platform: PLATFORM,
			chatId: slackChatId(teamId, ev.channel),
			chatType: direct ? 'dm' : 'channel',
			chatTitle: null,
			userId: ev.user,
			username: null,
			teamId,
			threadTs: direct ? (ev.thread_ts || null) : (ev.thread_ts || ev.ts),
		};
		// A shared message carries someone else's words.
		if ((ev.attachments || []).some((a) => a?.is_share)) return { ...base, forwarded: true };
		const files = Array.isArray(ev.files) ? ev.files : [];
		const audio = files.find((f) => f?.subtype === 'slack_audio' || /^audio\//.test(f?.mimetype || ''));
		if (audio) return { ...base, voice: { fetch: () => download(teamId, audio) } };
		const image = files.find((f) => /^image\//.test(f?.mimetype || ''));
		const text = stripMentions(ev.text, botUserId);
		if (image) return { ...base, photo: { fetch: () => download(teamId, image), caption: text } };
		return text ? { ...base, text } : null;
	}

	function normalizeCommand(p) {
		const c = p.command;
		if (!c?.channel_id || !c.user_id) return null;
		const { command, args } = parseSlashCommand(c.text);
		return {
			platform: PLATFORM,
			chatId: slackChatId(c.team_id, c.channel_id),
			chatType: c.channel_name === 'directmessage' || /^D/.test(c.channel_id) ? 'dm' : 'channel',
			chatTitle: c.channel_name && c.channel_name !== 'directmessage' ? `#${c.channel_name}` : null,
			userId: c.user_id,
			username: c.user_name || null,
			teamId: c.team_id || null,
			command,
			args,
			responseUrl: /^https:\/\/hooks\.slack\.com\//.test(c.response_url || '') ? c.response_url : null,
		};
	}

	function normalizeAction(p) {
		const a = p.action;
		const pressed = a?.actions?.[0];
		const channel = a?.channel?.id || a?.container?.channel_id;
		if (!pressed || !channel || !a.user?.id) return null;
		const id = pressed.value || pressed.action_id;
		const approvalAction = parseApprovalCallback(id);
		const action = approvalAction ? null : parseActionId(id);
		if (!approvalAction && !action) return null;
		const teamId = a.team?.id || a.user?.team_id || null;
		const ts = a.message?.ts || a.container?.message_ts || null;
		return {
			platform: PLATFORM,
			chatId: slackChatId(teamId, channel),
			chatType: a.channel?.name === 'directmessage' ? 'dm' : 'channel',
			userId: a.user.id,
			username: a.user.username || null,
			teamId,
			threadTs: a.message?.thread_ts || null,
			...(approvalAction ? { approvalAction } : { action }),
			messageRef: ts ? { chatId: slackChatId(teamId, channel), ts } : null,
		};
	}

	/** @returns {object|null} a GatewayEvent, or null for deliveries nobody answers */
	function normalize(payload) {
		if (!payload || typeof payload !== 'object') return null;
		if (payload.kind === 'slack_event') return normalizeEvent(payload);
		if (payload.kind === 'slack_command') return normalizeCommand(payload);
		if (payload.kind === 'slack_action') return normalizeAction(payload);
		return null;
	}

	async function postResponse(url, payload) {
		let r;
		try {
			r = await fetchImpl(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(payload), signal: AbortSignal.timeout(10_000) });
		} catch (e) {
			throw new PlatformError(PLATFORM, `network: ${e.message}`, { cause: e });
		}
		if (!r.ok) throw toSlackError(r.status, { error: (await r.text().catch(() => '')).slice(0, 60) || `http_${r.status}` });
	}

	function gateway(event) {
		const threadTs = event?.threadTs || null;
		let responseUses = 0;
		const viaResponseUrl = () => Boolean(event?.responseUrl) && responseUses < RESPONSE_URL_USES;

		async function post(chatId, payload) {
			const { teamId, channel } = splitChatId(chatId);
			const body = await call(teamId, 'chat.postMessage', { channel, unfurl_links: false, unfurl_media: false, ...(threadTs ? { thread_ts: threadTs } : {}), ...payload });
			return { chatId: slackChatId(teamId, channel), ts: body.ts || body.message?.ts };
		}

		return {
			platform: PLATFORM,
			buttons: true,
			canEdit: true,
			async sendText(chatId, text) {
				let ref = null;
				for (const part of chunkText(text, TEXT_LIMIT)) {
					if (viaResponseUrl()) {
						responseUses++;
						await postResponse(event.responseUrl, { response_type: 'ephemeral', text: slackEscape(part) });
						continue;
					}
					ref = await post(chatId, { text: slackEscape(part) });
				}
				return ref;
			},
			async sendChoice(chatId, text, choices) {
				return post(chatId, { text: slackEscape(String(text).slice(0, 2900)), blocks: blocksFor(text, choices || []) });
			},
			async editMessage(ref, text, opts = {}) {
				if (!ref?.ts) return;
				const { teamId, channel } = splitChatId(ref.chatId);
				const payload = { channel, ts: ref.ts, text: slackEscape(String(text).slice(0, 2900)) };
				// Slack keeps the old blocks unless new ones are sent, so an edit
				// always restates them: with the remaining buttons, or none.
				payload.blocks = blocksFor(text, Array.isArray(opts.choices) ? opts.choices : []);
				await call(teamId, 'chat.update', payload);
			},
			async sendMedia(chatId, media) {
				const caption = media.caption ? String(media.caption).slice(0, 1900) : '';
				if (isImage(media)) {
					return post(chatId, {
						text: slackEscape(caption || media.url),
						blocks: [{ type: 'image', image_url: media.url, alt_text: (caption || 'image').slice(0, 1900), ...(caption ? { title: { type: 'plain_text', text: caption.slice(0, 1900) } } : {}) }],
					});
				}
				return post(chatId, { text: `${slackEscape(caption)}${caption ? '\n' : ''}<${media.url}>` });
			},
			async sendVoice(chatId, clip) {
				const { teamId, channel } = splitChatId(chatId);
				const filename = clip.filename || 'reply.ogg';
				const up = await call(teamId, 'files.getUploadURLExternal', { filename, length: clip.buffer.length }, { form: true });
				let r;
				try {
					r = await fetchImpl(up.upload_url, { method: 'POST', headers: { 'content-type': clip.mimeType || 'audio/ogg' }, body: clip.buffer, signal: AbortSignal.timeout(20_000) });
				} catch (e) {
					throw new PlatformError(PLATFORM, `network: ${e.message}`, { cause: e });
				}
				if (!r.ok) throw new PlatformError(PLATFORM, `file upload ${r.status}`, { status: r.status, permanent: isPermanentStatus(r.status) });
				await call(teamId, 'files.completeUploadExternal', {
					files: [{ id: up.file_id, title: 'Spoken reply' }],
					channel_id: channel,
					...(threadTs ? { thread_ts: threadTs } : {}),
				}, { form: true });
				return { chatId: slackChatId(teamId, channel), fileId: up.file_id };
			},
			// Slack's Web API has no typing indicator for bots.
			async typing() {},
			// The receiver already answered Slack inside its three-second window; an
			// outcome lands by editing the preview, so a press needs no second ack.
			async ackAction() {},
		};
	}

	return {
		platform: PLATFORM,
		normalize,
		gateway,
		describe() {
			return { mode: 'events_api', oauth: Boolean(env.SLACK_CLIENT_ID && env.SLACK_CLIENT_SECRET), single_workspace_token: Boolean(env.SLACK_BOT_TOKEN) };
		},
	};
}
