// Gateway mode: this machine becomes the backend of the owner's own Telegram
// bot. It long-polls getUpdates with the owner's bot token, answers only the
// chat ids on an allowlist that must be set, keeps one store session per chat,
// and asks for approvals with inline Approve / Deny buttons (for a financial
// tool the message lists recipient, amount, token and chain first).
//
// It refuses to start while a webhook is set on the bot: polling would race
// it, and calling getUpdates would make Telegram drop that webhook. This is
// the same guard the hosted gateway (workers/agent-gateway) applies in its
// polling mode. The hosted gateway is the managed alternative when the owner
// does not want to keep a machine on.

import { randomBytes } from 'node:crypto';
import { createSession } from './session.js';
import { readStoreFile, writeStoreFile } from './credentials.js';
import { financialFacts } from './approval.js';

export const TELEGRAM_API = 'https://api.telegram.org';
const MAX_MESSAGE = 4000;
const APPROVAL_TIMEOUT_MS = 10 * 60 * 1000;

export class GatewayError extends Error {
	constructor(message, code) {
		super(message);
		this.name = 'GatewayError';
		this.code = code;
	}
}

/** The bot token: env var named by config (TELEGRAM_BOT_TOKEN), then config, then the credential store. */
export function resolveTelegramToken(ctx) {
	const tg = ctx.config.gateway?.telegram || {};
	const fromEnv = ctx.env.vars[tg.tokenEnv || 'TELEGRAM_BOT_TOKEN'];
	if (fromEnv) return { token: fromEnv, source: `env ${tg.tokenEnv || 'TELEGRAM_BOT_TOKEN'}` };
	if (tg.token) return { token: tg.token, source: 'agent.json' };
	const stored = readStoreFile(ctx.env).telegram_bot?.token;
	if (stored) return { token: stored, source: 'credential store' };
	return null;
}

export function saveTelegramToken(token, env) {
	if (!/^\d+:[\w-]{30,}$/.test(String(token || '').trim())) {
		throw new GatewayError('That does not look like a Telegram bot token (it is "<digits>:<35 characters>", from @BotFather).', 'bad_token');
	}
	writeStoreFile((s) => ({ ...s, telegram_bot: { token: String(token).trim(), saved_at: new Date().toISOString() } }), env);
}

/** Parse "123,-100456 789" into chat id strings. */
export function parseAllowlist(...sources) {
	const ids = new Set();
	for (const src of sources) {
		const list = Array.isArray(src) ? src : String(src || '').split(/[\s,]+/);
		for (const raw of list) {
			const v = String(raw).trim();
			if (!v) continue;
			if (!/^-?\d{1,20}$/.test(v)) throw new GatewayError(`"${v}" is not a Telegram chat id (a number such as 123456789 or -1001234567890).`, 'bad_allowlist');
			ids.add(v);
		}
	}
	return [...ids];
}

export function telegramClient({ token, apiBase = TELEGRAM_API, fetchImpl = fetch }) {
	async function call(method, params = {}, { signal, timeoutMs = 40_000 } = {}) {
		const signals = [AbortSignal.timeout(timeoutMs)];
		if (signal) signals.push(signal);
		let res;
		try {
			res = await fetchImpl(`${apiBase}/bot${token}/${method}`, {
				method: 'POST',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify(params),
				signal: AbortSignal.any(signals),
			});
		} catch (err) {
			if (signal?.aborted) throw new GatewayError('stopped', 'aborted');
			throw new GatewayError(`could not reach Telegram (${method}): ${err?.cause?.code || err.message}`, 'network');
		}
		const data = await res.json().catch(() => null);
		if (!data?.ok) {
			const desc = data?.description || `HTTP ${res.status}`;
			throw new GatewayError(`Telegram ${method} failed: ${desc}`, res.status === 401 ? 'unauthorized' : 'telegram_error');
		}
		return data.result;
	}
	return { call };
}

function chunk(text) {
	const out = [];
	let rest = String(text || '').trim() || '(no reply)';
	while (rest.length > MAX_MESSAGE) {
		let cut = rest.lastIndexOf('\n', MAX_MESSAGE);
		if (cut < MAX_MESSAGE / 2) cut = MAX_MESSAGE;
		out.push(rest.slice(0, cut));
		rest = rest.slice(cut).trimStart();
	}
	out.push(rest);
	return out;
}

/** The approval text sent to the chat; financial calls lead with the money facts. */
export function approvalText({ tool, args }) {
	const lines = [`Approve ${tool.toolClass} tool ${tool.name}?`];
	if (tool.toolClass === 'financial') {
		const facts = financialFacts(args);
		for (const [k, v] of facts) lines.push(`${k}: ${v}`);
	}
	const json = JSON.stringify(args, null, 1);
	lines.push('', json.length > 1500 ? `${json.slice(0, 1500)}...` : json);
	return lines.join('\n');
}

/**
 * Start the gateway. Resolves once polling has begun; `stop()` ends it.
 * @param {object} o
 * @param {ReturnType<import('./session.js').createAgentContext>} o.ctx
 * @param {string[]} o.allow   chat ids allowed to talk to the agent
 */
export async function startTelegramGateway({ ctx, token, allow, apiBase = TELEGRAM_API, fetchImpl = fetch, log = () => {}, pollTimeoutS = 30 }) {
	if (!token) throw new GatewayError('No Telegram bot token. Set TELEGRAM_BOT_TOKEN, or save one with `three-ws-agent gateway --save-telegram-token` (reads it from stdin).', 'no_token');
	if (!allow?.length) {
		throw new GatewayError('Refusing to start with an empty allowlist: anyone who finds the bot could drive this machine. Pass --allow <chat id>[,<chat id>] or set gateway.telegram.allowChats in agent.json.', 'empty_allowlist');
	}
	const tg = telegramClient({ token, apiBase, fetchImpl });
	const hook = await tg.call('getWebhookInfo');
	if (hook?.url) {
		throw new GatewayError(
			`Refusing to poll: this bot has a webhook set (${new URL(hook.url).host}), and polling would delete it. Use a separate bot for the local gateway, or remove the webhook yourself with deleteWebhook if you mean to move the bot here.`,
			'webhook_set',
		);
	}
	const me = await tg.call('getMe');
	const allowed = new Set(allow.map(String));
	const controller = new AbortController();
	const pendingApprovals = new Map();
	const chatQueues = new Map();
	let offset = 0;

	async function send(chatId, text, extra = {}) {
		let last = null;
		for (const part of chunk(text)) last = await tg.call('sendMessage', { chat_id: chatId, text: part, ...extra });
		return last;
	}

	function sessionFor(chatId) {
		const channel = `telegram:${chatId}`;
		const existing = ctx.store.sessionForChannel(channel);
		return existing ? createSession(ctx, { resume: existing.id }) : createSession(ctx, { kind: 'gateway', channel, title: `Telegram chat ${chatId}` });
	}

	function approverFor(chatId) {
		return async ({ tool, args }) => {
			const nonce = randomBytes(6).toString('hex');
			await send(chatId, approvalText({ tool, args }), {
				reply_markup: { inline_keyboard: [[{ text: 'Approve', callback_data: `ap:${nonce}:y` }, { text: 'Deny', callback_data: `ap:${nonce}:n` }]] },
			});
			return new Promise((resolve) => {
				const timer = setTimeout(() => {
					pendingApprovals.delete(nonce);
					resolve({ ok: false, reason: `Nobody approved ${tool.name} within 10 minutes, so it did not run.` });
				}, APPROVAL_TIMEOUT_MS);
				pendingApprovals.set(nonce, { chatId: String(chatId), resolve: (ok) => (clearTimeout(timer), resolve({ ok })) });
			});
		};
	}

	async function handleMessage(msg) {
		const chatId = String(msg.chat.id);
		const text = String(msg.text || '').trim();
		if (!text) return;
		if (text === '/start' || text === '/help') {
			await send(chatId, `This is ${me.first_name}, a three.ws agent running on its owner's machine. Send a message to talk to it. /new starts a fresh conversation.`);
			return;
		}
		if (text === '/new') {
			const s = createSession(ctx, { kind: 'gateway', channel: `telegram:${chatId}`, title: `Telegram chat ${chatId}` });
			await send(chatId, `New conversation started (${s.id}).`);
			return;
		}
		const session = sessionFor(chatId);
		await tg.call('sendChatAction', { chat_id: chatId, action: 'typing' }).catch(() => {});
		try {
			const result = await session.send(text, { approve: approverFor(chatId), signal: controller.signal });
			await send(chatId, result.answer);
			log({ kind: 'reply', chatId, session: session.id, tokens: result.usage });
		} catch (err) {
			if (controller.signal.aborted) return;
			await send(chatId, `That failed: ${err.message}`).catch(() => {});
			log({ kind: 'error', chatId, error: err.message });
		}
	}

	async function handleCallback(cb) {
		const m = String(cb.data || '').match(/^ap:([0-9a-f]+):([yn])$/);
		const pending = m && pendingApprovals.get(m[1]);
		const chatId = String(cb.message?.chat?.id ?? '');
		if (!pending || pending.chatId !== chatId || !allowed.has(chatId)) {
			await tg.call('answerCallbackQuery', { callback_query_id: cb.id, text: 'This approval is no longer open.' }).catch(() => {});
			return;
		}
		pendingApprovals.delete(m[1]);
		const ok = m[2] === 'y';
		pending.resolve(ok);
		await tg.call('answerCallbackQuery', { callback_query_id: cb.id, text: ok ? 'Approved' : 'Denied' }).catch(() => {});
		if (cb.message?.message_id) {
			await tg
				.call('editMessageText', { chat_id: chatId, message_id: cb.message.message_id, text: `${cb.message.text || ''}\n\n${ok ? 'Approved.' : 'Denied.'}` })
				.catch(() => {});
		}
	}

	/** One turn at a time per chat, in arrival order; callbacks bypass the queue so approvals land mid-turn. */
	function enqueue(chatId, job) {
		const prev = chatQueues.get(chatId) || Promise.resolve();
		const next = prev.then(job, job).catch((err) => log({ kind: 'error', chatId, error: err.message }));
		chatQueues.set(chatId, next);
		return next;
	}

	async function poll() {
		while (!controller.signal.aborted) {
			let updates;
			try {
				updates = await tg.call('getUpdates', { offset, timeout: pollTimeoutS, allowed_updates: ['message', 'callback_query'] }, { signal: controller.signal, timeoutMs: (pollTimeoutS + 10) * 1000 });
			} catch (err) {
				if (controller.signal.aborted) return;
				if (err.code === 'unauthorized') {
					log({ kind: 'fatal', error: 'the bot token was rejected (401); the gateway stopped' });
					return;
				}
				log({ kind: 'retry', error: err.message });
				await new Promise((r) => setTimeout(r, 3000));
				continue;
			}
			for (const u of updates) {
				offset = Math.max(offset, u.update_id + 1);
				if (u.callback_query) {
					handleCallback(u.callback_query).catch((err) => log({ kind: 'error', error: err.message }));
					continue;
				}
				const msg = u.message;
				if (!msg?.chat) continue;
				const chatId = String(msg.chat.id);
				if (!allowed.has(chatId)) {
					log({ kind: 'ignored', chatId, from: msg.from?.username || msg.from?.id || null });
					continue;
				}
				enqueue(chatId, () => handleMessage(msg));
			}
		}
	}

	const loop = poll();
	log({ kind: 'started', bot: me.username, allow: [...allowed] });
	return {
		bot: me,
		allow: [...allowed],
		done: loop,
		async stop() {
			controller.abort();
			for (const p of pendingApprovals.values()) p.resolve(false);
			pendingApprovals.clear();
			await loop;
			await Promise.all([...chatQueues.values()]);
		},
	};
}

