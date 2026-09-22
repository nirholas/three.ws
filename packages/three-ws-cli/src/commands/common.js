// Pieces every command shares: cancellation, the sign-in step, and the rule
// for when the CLI may prompt at all.

import * as p from '@clack/prompts';
import { c, line, sym } from '../ui.js';
import { loginOAuth, loginDevice, loginKey, looksLikeKey } from '../auth.js';

export class CancelledError extends Error {
	constructor() {
		super('cancelled');
		this.name = 'CancelledError';
	}
}

/** Unwrap a clack answer, turning Ctrl-C into a CancelledError. */
export function answer(value) {
	if (p.isCancel(value)) throw new CancelledError();
	return value;
}

/** Prompts are allowed only on a TTY, and never with --json or --yes. */
export function canPrompt(ctx) {
	return Boolean(process.stdin.isTTY && process.stdout.isTTY && !ctx.flags.json && !ctx.flags.yes);
}

export function authModeFromFlags(flags) {
	if (flags.key !== undefined) return 'key';
	if (flags.device) return 'device';
	if (flags.oauth) return 'oauth';
	return null;
}

function say(ctx, text) {
	if (!ctx.flags.json) line(text);
}

/**
 * Sign in by the chosen mode. `mode` null means ask (or default to OAuth when
 * prompting is not allowed). Returns the whoami payload.
 */
export async function signIn(ctx, { mode = null, financial = false } = {}) {
	const { origin, env } = ctx;
	let chosen = mode;
	if (!chosen && canPrompt(ctx)) {
		chosen = answer(await p.select({
			message: 'How should this machine sign in to three.ws?',
			options: [
				{ value: 'oauth', label: 'Browser sign-in (OAuth)', hint: 'recommended; tokens refresh automatically' },
				{ value: 'device', label: 'API key, approved in a browser', hint: 'works over SSH; approve on any device' },
				{ value: 'key', label: 'Paste an API key', hint: 'from three.ws/dashboard/api' },
			],
			initialValue: 'oauth',
		}));
	}
	chosen = chosen || 'oauth';

	if (chosen === 'key') {
		let key = typeof ctx.flags.key === 'string' && ctx.flags.key ? ctx.flags.key : env.vars.THREE_WS_API_KEY || '';
		if (!key && canPrompt(ctx)) {
			key = answer(await p.password({
				message: `Paste your API key ${c.dim('(create one at ' + origin + '/dashboard/api)')}`,
				validate: (v) => (looksLikeKey(v) ? undefined : 'Keys start with sk_live_ and are about 45 characters.'),
			}));
		}
		if (!key) throw new Error('pass the key with --key <sk_live_...> or THREE_WS_API_KEY');
		return loginKey({ origin, key, env });
	}

	if (chosen === 'device') {
		const spin = !ctx.flags.json && canPrompt(ctx) ? p.spinner() : null;
		const me = await loginDevice({
			origin,
			financial,
			env,
			onCode: (link, opened) => {
				say(ctx, '');
				say(ctx, `  ${c.bold('Your code:')} ${c.cyan(c.bold(link.user_code))}`);
				say(ctx, `  ${opened ? 'Opened' : 'Open'} ${c.cyan(link.verification_uri_complete)}`);
				say(ctx, `  ${c.dim('and approve it there. Any device works; the code expires in 10 minutes.')}`);
				say(ctx, '');
				spin?.start('Waiting for approval in the browser');
			},
		}).finally(() => spin?.stop('Browser step finished'));
		return me;
	}

	const spin = !ctx.flags.json && canPrompt(ctx) ? p.spinner() : null;
	const me = await loginOAuth({
		origin,
		financial,
		env,
		onUrl: (url, opened) => {
			if (!opened) {
				say(ctx, `  ${sym.arrow} Open this URL to sign in:`);
				say(ctx, `    ${c.cyan(url)}`);
				say(ctx, `  ${c.dim('No browser here? Press Ctrl-C and run with --device instead.')}`);
			}
			spin?.start(opened ? 'Finish signing in in the browser window that just opened' : 'Waiting for the browser sign-in');
		},
	}).finally(() => spin?.stop('Browser step finished'));
	return me;
}
