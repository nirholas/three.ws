// One-time and operator commands for the chat gateway bots.
//
//   node src/setup.js discord-commands [--guild <id>] [--dry-run]
//       Register the slash commands (every command in api/_lib/gateway/commands.js
//       plus /start, each also under /three) globally, or on one guild for an
//       instant test. Needs DISCORD_BOT_TOKEN and DISCORD_APP_ID.
//
//   node src/setup.js telegram-webhook [--url <url>] [--dry-run] [--info] [--delete]
//       Point the bot at https://three.ws/api/gateway/telegram (or --url) with
//       the secret the receiver verifies, and publish the command menu.
//       --info only reads the current webhook; --delete removes it.
//
//   node src/setup.js inbox [--failed <n>]
//       Queue depth, the oldest open delivery, and the most recent dead letters.
//
//   node src/setup.js requeue <id>
//       Put one dead letter back on the queue with a fresh attempt budget.
//
// package.json wires the first two as `npm run register:discord` and
// `npm run webhook:telegram`.

import { Api } from 'grammy';
import { REST, Routes } from 'discord.js';
import { COMMANDS } from '../../../api/_lib/gateway/commands.js';
import { telegramWebhookSecret } from '../../../api/_lib/gateway/webhooks.js';
import { appOrigin } from '../../../api/_lib/gateway/format.js';

const NAME_RE = /^[a-z0-9_-]{1,32}$/;

function flag(argv, name) {
	return argv.includes(`--${name}`);
}

function option(argv, name) {
	const i = argv.indexOf(`--${name}`);
	return i >= 0 && argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[i + 1] : null;
}

function need(env, ...names) {
	const missing = names.filter((n) => !env[n]);
	if (missing.length) throw new Error(`missing ${missing.join(', ')}. Read them with: node scripts/read-service-env.mjs '^(${missing.join('|')})$'`);
}

/** The command list every platform shows: the shared commands plus /start. */
export function gatewayCommands() {
	return [{ name: 'start', description: 'Get a pairing code for this chat' }, ...COMMANDS];
}

function discordOption(cmd) {
	if (!cmd.arg) return [];
	if (cmd.arg === 'on|off') {
		return [{ type: 3, name: 'state', description: 'on or off', required: false, choices: [{ name: 'on', value: 'on' }, { name: 'off', value: 'off' }] }];
	}
	const name = NAME_RE.test(cmd.arg) ? cmd.arg : 'value';
	return [{ type: 3, name, description: cmd.arg === 'agent' ? 'Agent number or name' : cmd.arg === 'code' ? 'Pairing code from the site' : cmd.arg, required: false }];
}

/**
 * The Discord application command set: each command top level, and the same
 * set as subcommands of /three (how the help text names them on Discord).
 * Guild installs, usable in servers and in the bot's DMs.
 */
export function discordCommandSet() {
	const base = gatewayCommands().filter((c) => NAME_RE.test(c.name));
	const shared = { integration_types: [0], contexts: [0, 1] };
	const top = base.map((c) => ({ type: 1, name: c.name, description: c.description.slice(0, 100), options: discordOption(c), ...shared }));
	const three = {
		type: 1,
		name: 'three',
		description: 'Talk to your three.ws agent',
		options: base.map((c) => ({ type: 1, name: c.name, description: c.description.slice(0, 100), options: discordOption(c) })),
		...shared,
	};
	return [...top, three];
}

/** The Telegram command menu (setMyCommands). */
export function telegramCommandSet() {
	return gatewayCommands()
		.filter((c) => /^[a-z0-9_]{1,32}$/.test(c.name))
		.map((c) => ({ command: c.name, description: c.description.slice(0, 256) }));
}

async function discordCommands(argv, env, out) {
	const body = discordCommandSet();
	const guild = option(argv, 'guild');
	if (flag(argv, 'dry-run')) {
		out(JSON.stringify({ route: guild ? `guild ${guild}` : 'global', commands: body }, null, 2));
		return;
	}
	need(env, 'DISCORD_BOT_TOKEN', 'DISCORD_APP_ID');
	const rest = new REST({ version: '10' }).setToken(env.DISCORD_BOT_TOKEN);
	const route = guild ? Routes.applicationGuildCommands(env.DISCORD_APP_ID, guild) : Routes.applicationCommands(env.DISCORD_APP_ID);
	const saved = await rest.put(route, { body });
	out(`Registered ${saved.length} Discord commands ${guild ? `on guild ${guild} (live now)` : 'globally (can take up to an hour to appear)'}: ${saved.map((c) => `/${c.name}`).join(' ')}`);
	out(`Interactions endpoint to set in the developer portal: ${appOrigin()}/api/gateway/discord`);
}

async function telegramWebhook(argv, env, out) {
	need(env, 'TELEGRAM_BOT_TOKEN');
	const api = new Api(env.TELEGRAM_BOT_TOKEN);
	const describe = (info) => ({
		url: info.url || '(none)',
		pending_update_count: info.pending_update_count,
		last_error: info.last_error_message || null,
		last_error_at: info.last_error_date ? new Date(info.last_error_date * 1000).toISOString() : null,
		allowed_updates: info.allowed_updates || null,
	});
	if (flag(argv, 'info')) {
		out(JSON.stringify(describe(await api.getWebhookInfo()), null, 2));
		return;
	}
	if (flag(argv, 'delete')) {
		await api.deleteWebhook({ drop_pending_updates: false });
		out('Webhook removed. Updates now wait for getUpdates (GATEWAY_TELEGRAM_POLLING=1).');
		return;
	}
	const url = option(argv, 'url') || `${appOrigin()}/api/gateway/telegram`;
	const commands = telegramCommandSet();
	if (flag(argv, 'dry-run')) {
		out(JSON.stringify({ setWebhook: { url, allowed_updates: ['message', 'callback_query'], secret_token: '(derived from TELEGRAM_BOT_TOKEN or TELEGRAM_WEBHOOK_SECRET)' }, setMyCommands: commands }, null, 2));
		return;
	}
	await api.setWebhook(url, {
		secret_token: telegramWebhookSecret(env),
		allowed_updates: ['message', 'callback_query'],
		max_connections: 40,
		drop_pending_updates: false,
	});
	await api.setMyCommands(commands);
	const me = await api.getMe();
	out(`@${me.username} now delivers to ${url} with ${commands.length} commands in its menu.`);
	out(JSON.stringify(describe(await api.getWebhookInfo()), null, 2));
}

async function inbox(argv, out) {
	const { inboxBacklog, listFailedInbox } = await import('../../../api/_lib/gateway/store.js');
	const backlog = await inboxBacklog();
	out(`Open deliveries: ${backlog.open}, oldest ${backlog.oldestSeconds}s old.`);
	const failed = await listFailedInbox({ limit: Number(option(argv, 'failed')) || 20 });
	if (!failed.length) {
		out('No dead letters.');
		return;
	}
	out('Dead letters (newest first):');
	for (const f of failed) out(`  #${f.id} ${f.chat_key} attempts=${f.attempts} at ${new Date(f.finished_at || f.created_at).toISOString()}: ${f.last_error || ''}`);
	out('Requeue one with: npm run setup -- requeue <id>');
}

async function requeue(argv, out) {
	const id = argv.find((a) => /^\d+$/.test(a));
	if (!id) throw new Error('usage: requeue <id>');
	const { requeueInbox } = await import('../../../api/_lib/gateway/store.js');
	const row = await requeueInbox(id);
	out(row ? `Requeued #${row.id} (${row.chat_key}).` : `#${id} is not a dead letter.`);
}

export async function run(argv, { env = process.env, out = (s) => console.log(s) } = {}) {
	const [cmd, ...rest] = argv;
	switch (cmd) {
		case 'discord-commands': return discordCommands(rest, env, out);
		case 'telegram-webhook': return telegramWebhook(rest, env, out);
		case 'inbox': return inbox(rest, out);
		case 'requeue': return requeue(rest, out);
		default:
			throw new Error(`unknown command "${cmd || ''}". Use discord-commands, telegram-webhook, inbox or requeue.`);
	}
}

if (import.meta.url === `file://${process.argv[1]}`) {
	run(process.argv.slice(2)).then(() => process.exit(0), (e) => {
		console.error(`setup failed: ${e.message}`);
		process.exit(1);
	});
}
