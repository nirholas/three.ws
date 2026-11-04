// `three-ws-agent gateway`: answer the owner's own Telegram bot from this
// machine. The token is read from TELEGRAM_BOT_TOKEN (or saved once with
// --save-telegram-token, which reads it from stdin) and is never printed.

import { GatewayError, parseAllowlist, resolveTelegramToken, saveTelegramToken, startTelegramGateway } from '../gateway.js';
import { cronRunner } from './cron.js';
import { startScheduler } from '../scheduler.js';

export function saveToken({ env, token }) {
	saveTelegramToken(token, env);
	return { saved: true };
}

/**
 * Run the gateway until `signal` aborts. The local scheduler runs alongside
 * it, so one long-lived process covers chat and schedules.
 */
export async function runGateway({ ctx, allow, signal, apiBase, fetchImpl, onLog, withScheduler = true }) {
	const resolved = resolveTelegramToken(ctx);
	const tg = ctx.config.gateway?.telegram || {};
	const allowlist = parseAllowlist(allow, tg.allowChats, ctx.env.vars.TELEGRAM_ALLOWED_CHATS);
	if (!resolved) throw new GatewayError('No Telegram bot token. Set TELEGRAM_BOT_TOKEN, or save one with `three-ws-agent gateway --save-telegram-token` (reads it from stdin).', 'no_token');
	const gw = await startTelegramGateway({ ctx, token: resolved.token, allow: allowlist, apiBase, fetchImpl, log: onLog });
	const scheduler = withScheduler ? startScheduler({ store: ctx.store, runPrompt: cronRunner(ctx), catchUp: ctx.config.cron?.catchUp !== false, onEvent: onLog }) : null;
	onLog?.({ kind: 'token', source: resolved.source });
	await new Promise((resolve) => {
		if (signal.aborted) resolve();
		else signal.addEventListener('abort', resolve, { once: true });
		gw.done.then(resolve);
	});
	await scheduler?.stop();
	await gw.stop();
	return { bot: gw.bot.username, allow: gw.allow };
}

export function printGatewayLog(e) {
	const t = new Date().toISOString();
	if (e.kind === 'started') return `[${t}] gateway up as @${e.bot}, answering ${e.allow.length} chat${e.allow.length === 1 ? '' : 's'}: ${e.allow.join(', ')}`;
	if (e.kind === 'token') return `[${t}] bot token from ${e.source}`;
	if (e.kind === 'reply') return `[${t}] replied in ${e.chatId} (session ${e.session})`;
	if (e.kind === 'ignored') return `[${t}] ignored a message from chat ${e.chatId}, which is not on the allowlist`;
	if (e.kind === 'retry') return `[${t}] ${e.error}; retrying in 3s`;
	if (e.kind === 'fatal') return `[${t}] ${e.error}`;
	if (e.kind === 'error') return `[${t}] error${e.chatId ? ` in ${e.chatId}` : ''}: ${e.error}`;
	if (e.kind?.startsWith('cron_')) return `[${t}] cron ${e.id || ''} ${e.kind.slice(5)}${e.status ? ` ${e.status}` : ''}${e.error ? `: ${e.error}` : ''}`;
	return null;
}
