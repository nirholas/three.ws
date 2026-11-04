// three-ws-agent: argument parsing and dispatch. Every command is a function
// in src/commands/ that returns a result object, and a printer that turns it
// into text; this file only wires argv to them and the result to stdout.

import { parseArgs } from 'node:util';
import { VERSION } from './http.js';
import { systemEnv } from './paths.js';
import { createAgentContext } from './session.js';
import { login, logout, printLogin, printLoginCode, printLogout, printWhoami, whoami } from './commands/auth.js';
import { exportSession, listSessions, printExport, printSearch, printSessions, searchSessions } from './commands/sessions.js';
import { addCron, listCrons, printCron, printCronEvent, printCrons, removeCron, runCronDaemon, runCronOnce, setCronEnabled, setCronMode } from './commands/cron.js';
import { doctor, printDoctor } from './commands/doctor.js';
import { printGatewayLog, runGateway, saveToken } from './commands/gateway.js';

export class UsageError extends Error {
	constructor(message, command = null) {
		super(message);
		this.name = 'UsageError';
		this.command = command;
	}
}

const GLOBAL = `Global options:
  --cwd <dir>        workspace root for file and shell tools (default: current directory)
  --model <id>       model for this run (does not change agent.json)
  --agent <id>       three.ws agent for this run (persona, wallet, skills)
  -h, --help         help for a command
  -v, --version      print the version`;

export const HELP = {
	main: `three-ws-agent ${VERSION}: run a three.ws agent on your own machine.

Usage:
  three-ws-agent [--resume <id>] [--avatar [<source>]] [global options]   open the terminal UI
  three-ws-agent <command> [options]

Commands:
  login              sign this machine in to three.ws (browser code)
  logout             remove this machine's agent key
  whoami             show the account, key and scopes in use
  sessions           list, search and export saved sessions
  cron               schedules in plain language, run here or on three.ws
  gateway            answer your own Telegram bot from this machine
  doctor             check config, credential, model, tools, SQLite and the sandbox
  help [<command>]   help for a command

TUI options:
  -r, --resume <id>  continue a saved session (an id prefix is enough)
  --avatar [<src>]   show the agent's 3D body beside the chat (terminals 110+ columns);
                     <src> is a .glb path, a URL, or a three.ws avatar or agent id

${GLOBAL}

Docs: https://three.ws/docs/agent-cli`,
	login: `Usage: three-ws-agent login [--scope <scope>]...

Opens a device link: visit the URL shown, confirm the code, and the agent key
is saved to ~/.config/three-ws/credentials.json. Default scopes: profile,
agents:read, agents:write, memory:read, memory:write, wallet:read, inference.
Add a money-moving scope only if you want the agent able to request it, e.g.
--scope wallet:write (every payment still asks you first).`,
	logout: `Usage: three-ws-agent logout

Removes this machine's agent key. Credentials other tools own (the three-ws
CLI, THREE_WS_API_KEY) are left alone and reported.`,
	whoami: `Usage: three-ws-agent whoami

Shows the signed-in account, which credential is used, its scopes and the
selected agent.`,
	sessions: `Usage:
  three-ws-agent sessions [list] [--limit <n>]
  three-ws-agent sessions search <words>
  three-ws-agent sessions export <id> [--out <file> | --out -]

Sessions live in a SQLite file on this machine with full-text search.
Export writes JSON (format three-ws-agent-session, version 1).`,
	cron: `Usage:
  three-ws-agent cron [list]
  three-ws-agent cron add "<when>" "<prompt>" [--server | --local]
  three-ws-agent cron rm <id>
  three-ws-agent cron mode <id> local|server
  three-ws-agent cron on|off <id>
  three-ws-agent cron run [--once]

<when> is plain language ("every weekday at 9am", "every 15 minutes",
"monthly on the 1st at 8:30", "every mon, wed and fri at 6pm utc") or a
5-field cron expression. Local schedules fire while the TUI, the gateway or
\`cron run\` is running, exactly once even with several running. --server
creates a three.ws automation for the selected agent (UTC, at most every
5 minutes) that runs whether this machine is on or not.`,
	gateway: `Usage:
  three-ws-agent gateway --allow <chat id>[,<chat id>...] [--no-cron]
  three-ws-agent gateway --save-telegram-token < token.txt

Answers your own Telegram bot from this machine by long polling. The bot token
comes from TELEGRAM_BOT_TOKEN, or is saved once with --save-telegram-token
(read from stdin; never printed). Only the allowlisted chats get answers
(also gateway.telegram.allowChats in agent.json or TELEGRAM_ALLOWED_CHATS).
Refuses to start with an empty allowlist or while the bot has a webhook set.
Approvals arrive as Approve / Deny buttons. Local schedules run alongside
unless --no-cron.`,
	doctor: `Usage: three-ws-agent doctor

Checks Node, the config file, the credential, the model endpoint (lists its
models), the three.ws MCP tools, node:sqlite with FTS5 and the shell sandbox,
and says how to fix anything that fails.`,
};

const COMMANDS = new Set(['login', 'logout', 'whoami', 'sessions', 'cron', 'gateway', 'doctor', 'help']);

const OPTIONS = {
	help: { type: 'boolean', short: 'h' },
	version: { type: 'boolean', short: 'v' },
	cwd: { type: 'string' },
	model: { type: 'string' },
	agent: { type: 'string' },
	resume: { type: 'string', short: 'r' },
	avatar: { type: 'string' },
	scope: { type: 'string', multiple: true },
	limit: { type: 'string' },
	out: { type: 'string' },
	server: { type: 'boolean' },
	local: { type: 'boolean' },
	once: { type: 'boolean' },
	allow: { type: 'string', multiple: true },
	'save-telegram-token': { type: 'boolean' },
	'no-cron': { type: 'boolean' },
};

/** `--avatar` may be given without a value: mark that as `true`. */
function normalizeAvatar(argv) {
	const out = [...argv];
	const i = out.indexOf('--avatar');
	if (i >= 0 && (i === out.length - 1 || out[i + 1].startsWith('-'))) out.splice(i + 1, 0, '\u0000default');
	return out;
}

/**
 * Parse argv into { command, args, values }. Throws UsageError on bad input.
 * @param {string[]} argv  process.argv.slice(2)
 */
export function parseCli(argv) {
	let parsed;
	try {
		parsed = parseArgs({ args: normalizeAvatar(argv), options: OPTIONS, allowPositionals: true, strict: true });
	} catch (err) {
		throw new UsageError(`${err.message.replace(/^.*?: /, '')}. Run \`three-ws-agent --help\`.`);
	}
	const { values, positionals } = parsed;
	if (values.avatar === '\u0000default') values.avatar = true;
	let command = 'chat';
	let args = positionals;
	if (positionals.length && COMMANDS.has(positionals[0])) {
		command = positionals[0];
		args = positionals.slice(1);
	} else if (positionals.length) {
		throw new UsageError(`Unknown command "${positionals[0]}". Commands: ${[...COMMANDS].join(', ')}. To chat, open the TUI with no arguments.`);
	}
	if (values.limit !== undefined && !/^\d+$/.test(values.limit)) throw new UsageError('--limit takes a whole number.', command);
	return { command, args, values };
}

function helpFor(command) {
	return HELP[command] || HELP.main;
}

function makeEnv(values, env) {
	return values.cwd ? { ...env, cwd: values.cwd } : env;
}

function overridesOf(values) {
	const o = {};
	if (values.model) o.model = values.model;
	if (values.agent) o.agentId = values.agent;
	return o;
}

async function readStdin(stdin) {
	const chunks = [];
	for await (const c of stdin) chunks.push(Buffer.from(c));
	return Buffer.concat(chunks).toString('utf8').trim();
}

function untilSignal() {
	const controller = new AbortController();
	const stop = () => controller.abort();
	process.once('SIGINT', stop);
	process.once('SIGTERM', stop);
	return controller.signal;
}

async function withContext(values, env, fn, { mcp = true } = {}) {
	const ctx = createAgentContext({ env: makeEnv(values, env), mcp, overrides: overridesOf(values) });
	try {
		return await fn(ctx);
	} finally {
		await ctx.close();
	}
}

/**
 * Run a parsed command. Resolves the process exit code.
 * @param {string[]} argv
 * @param {{ stdout?: NodeJS.WritableStream, stderr?: NodeJS.WritableStream, stdin?: NodeJS.ReadableStream, env?: object }} [io]
 */
export async function main(argv, { stdout = process.stdout, stderr = process.stderr, stdin = process.stdin, env = systemEnv() } = {}) {
	const out = (s) => s != null && stdout.write(`${s}\n`);
	let parsed;
	try {
		parsed = parseCli(argv);
	} catch (err) {
		stderr.write(`${err.message}\n`);
		return 2;
	}
	const { command, args, values } = parsed;
	if (values.version) {
		out(VERSION);
		return 0;
	}
	if (values.help || command === 'help') {
		out(helpFor(command === 'help' ? args[0] : command === 'chat' ? 'main' : command));
		return 0;
	}

	try {
		switch (command) {
			case 'chat': {
				const { runTui } = await import('./tui/index.js');
				if (!stdin.isTTY) throw new UsageError('The TUI needs an interactive terminal. For scripts use `cron run --once`, `sessions` or `doctor`.');
				const info = await withContext(values, env, (ctx) => runTui({ ctx, resume: values.resume || null, avatar: values.avatar ?? null, overrides: overridesOf(values) }));
				out(`Session ${info.sessionId} saved. Resume it with: three-ws-agent --resume ${info.sessionId}`);
				return 0;
			}
			case 'login': {
				const r = await login({ env, extraScopes: values.scope || [], onCode: (link) => out(printLoginCode(link)), signal: untilSignal() });
				out(printLogin(r));
				return 0;
			}
			case 'logout':
				out(printLogout(logout({ env })));
				return 0;
			case 'whoami':
				out(printWhoami(await whoami({ env })));
				return 0;
			case 'doctor': {
				const r = await doctor({ env: makeEnv(values, env), mcp: true });
				out(printDoctor(r));
				return r.ok ? 0 : 1;
			}
			case 'sessions':
				return await withContext(values, env, (ctx) => sessionsCommand(ctx, args, values, out), { mcp: false });
			case 'cron':
				return await withContext(values, env, (ctx) => cronCommand(ctx, args, values, out));
			case 'gateway': {
				if (values['save-telegram-token']) {
					saveToken({ env, token: await readStdin(stdin) });
					out('Telegram bot token saved to the credential store.');
					return 0;
				}
				return await withContext(values, env, async (ctx) => {
					const r = await runGateway({ ctx, allow: values.allow || [], signal: untilSignal(), withScheduler: !values['no-cron'], onLog: (e) => out(printGatewayLog(e)) });
					out(`Gateway for @${r.bot} stopped.`);
					return 0;
				});
			}
			default:
				throw new UsageError(`Unknown command "${command}".`);
		}
	} catch (err) {
		stderr.write(`${err.message || err}\n`);
		return err instanceof UsageError ? 2 : 1;
	}
}

function sessionsCommand(ctx, args, values, out) {
	const [sub = 'list', ...rest] = args;
	const limit = values.limit ? Number(values.limit) : 20;
	if (sub === 'list') out(printSessions(listSessions({ store: ctx.store, limit })));
	else if (sub === 'search') out(printSearch(searchSessions({ store: ctx.store, query: rest.join(' '), limit })));
	else if (sub === 'export') {
		if (!rest[0]) throw new UsageError('Usage: three-ws-agent sessions export <id> [--out <file> | --out -]', 'sessions');
		out(printExport(exportSession({ store: ctx.store, id: rest[0], out: values.out ?? null, cwd: ctx.cwd })));
	} else throw new UsageError(`Unknown sessions option "${sub}". Use list, search or export.`, 'sessions');
	return 0;
}

async function cronCommand(ctx, args, values, out) {
	const [sub = 'list', ...rest] = args;
	if (sub === 'list') out(printCrons(listCrons({ ctx })));
	else if (sub === 'add') {
		if (rest.length < 2) throw new UsageError('Usage: three-ws-agent cron add "<when>" "<prompt>" [--server | --local]', 'cron');
		const [when, ...prompt] = rest;
		out(printCron(await addCron({ ctx, when, prompt: prompt.join(' '), mode: values.server ? 'server' : values.local ? 'local' : undefined })));
	} else if (sub === 'rm' || sub === 'remove') {
		if (!rest[0]) throw new UsageError('Usage: three-ws-agent cron rm <id>', 'cron');
		out(printCron(await removeCron({ ctx, id: rest[0] }), 'Removed'));
	} else if (sub === 'mode') {
		const [id, mode] = rest;
		if (!id || !['local', 'server'].includes(mode)) throw new UsageError('Usage: three-ws-agent cron mode <id> local|server', 'cron');
		out(printCron(await setCronMode({ ctx, id, mode }), 'Moved'));
	} else if (sub === 'on' || sub === 'off') {
		if (!rest[0]) throw new UsageError(`Usage: three-ws-agent cron ${sub} <id>`, 'cron');
		out(printCron(setCronEnabled({ ctx, id: rest[0], enabled: sub === 'on' }), sub === 'on' ? 'Resumed' : 'Paused'));
	} else if (sub === 'run') {
		const onEvent = (e) => out(printCronEvent(e));
		if (values.once) {
			const r = await runCronOnce({ ctx, onEvent });
			if (!r.fired.length) out('Nothing was due.');
			return r.fired.some((f) => f.status === 'error') ? 1 : 0;
		}
		out(`Scheduler running (${ctx.store.listCrons().filter((c) => c.mode === 'local' && c.enabled).length} local schedules). Ctrl+C stops it.`);
		await runCronDaemon({ ctx, signal: untilSignal(), onEvent });
		out('Scheduler stopped.');
	} else throw new UsageError(`Unknown cron option "${sub}". Use list, add, rm, mode, on, off or run.`, 'cron');
	return 0;
}
