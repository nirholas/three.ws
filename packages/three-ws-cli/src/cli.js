#!/usr/bin/env node
// three-ws: connect any MCP client to three.ws in one command.
//   npx three-ws setup

import { parseArgs } from 'node:util';
import { realpathSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { systemEnv } from './paths.js';
import { readStore, resolveOrigin } from './store.js';
import { VERSION, ApiError } from './http.js';
import { c, errorLine, line, printJson } from './ui.js';
import { CancelledError } from './commands/common.js';

export const HELP = `${c.bold('three-ws')} ${c.dim(`v${VERSION}`)}: connect any MCP client to three.ws

${c.bold('Usage')}
  npx three-ws <command> [options]

${c.bold('Commands')}
  setup                 Sign in, write the three.ws MCP servers into your clients, verify with tools/list
  login                 Sign in or switch accounts (OAuth by default)
  logout                Remove stored credentials and revoke the OAuth refresh token
  status                Account, plan, wallet balance, token expiry, and every configured client
  whoami                Print the signed-in account
  tools                 Choose which tool groups each server exposes (financial tools are off by default)
  mcp list              Show three.ws servers configured in each client (--available lists all servers)
  mcp add <server>      Add one server to your clients without prompts
  mcp remove <server>   Remove one server from your clients
  skills <sub>          Browse and import community agent skills (list, search, show, import, installed)
  proxy <url>           Run a stdio bridge to a hosted server (written into client configs by setup)
  fund                  Top up credits from an agent wallet (--amount, --agent); mints an inference key once
  provider use three-ws Point this machine's model clients at three.ws, billed to your credits
  provider show         The active model provider
  usage                 Credits, burn rate, days left and recent top-ups (--agent for one agent's budget)
  ask "<prompt>"        One completion through the active provider
  version               Print the version

${c.bold('Sign-in options')} (setup, login)
  --oauth               Browser sign-in with PKCE; tokens refresh automatically
  --device              Approve a code in any browser; yields an API key (works over SSH)
  --key [sk_live_...]   Use an API key (or set THREE_WS_API_KEY)
  --financial           Also request the scopes that let tools spend from your agent wallet

${c.bold('Setup options')}
  --clients a,b         claude-code, claude-desktop, cursor, windsurf, vscode, codex, gemini, hermes, print
  --servers a,b         Server slugs or paths (default: /mcp, the unified server with every tool)
  --packages a,b        Also add stdio @three-ws/*-mcp packages
  --project             Write project-scoped config (.mcp.json, .cursor/, .vscode/, .gemini/) in this directory
  --proxy               Route every server through the local proxy (enforces tool choices in every client)
  --yes                 Never prompt; use defaults

${c.bold('Tools options')}
  --server <slug>       Server to change
  --enable a,b          Tiers (read, write, financial) or tool names to turn on
  --disable a,b         Tiers or tool names to turn off
  --reset               Back to the default (read and write on, financial off)

${c.bold('Inference options')} (fund, provider, usage)
  --amount <usdc>       USDC to move from the agent wallet into credits (fund)
  --agent <id>          The agent whose wallet pays (fund) or whose budget to show (usage)
  --name <label>        Name for the minted inference key (fund)
  --yes                 Approve the printed transfer without a prompt (fund)

${c.bold('Global')}
  --json                Machine-readable output on stdout
  --origin <url>        Talk to another three.ws deployment (or THREE_WS_ORIGIN)
  --no-color            Plain output
  -h, --help            This help

Docs: https://three.ws/docs/cli`;

const OPTIONS = {
	json: { type: 'boolean' },
	origin: { type: 'string' },
	'no-color': { type: 'boolean' },
	help: { type: 'boolean', short: 'h' },
	version: { type: 'boolean', short: 'v' },
	yes: { type: 'boolean', short: 'y' },
	oauth: { type: 'boolean' },
	device: { type: 'boolean' },
	key: { type: 'string' },
	financial: { type: 'boolean' },
	clients: { type: 'string' },
	client: { type: 'string' },
	servers: { type: 'string' },
	packages: { type: 'string' },
	project: { type: 'boolean' },
	proxy: { type: 'boolean' },
	server: { type: 'string' },
	enable: { type: 'string' },
	disable: { type: 'string' },
	reset: { type: 'boolean' },
	available: { type: 'boolean' },
	amount: { type: 'string' },
	agent: { type: 'string' },
	name: { type: 'string' },
};

// `--key` alone (no value) means "prompt for it"; parseArgs needs a value for a
// string option, so a bare --key becomes --key= before parsing.
function normalizeArgv(argv) {
	return argv.map((a, i) => (a === '--key' && (argv[i + 1] === undefined || argv[i + 1].startsWith('-')) ? '--key=' : a));
}

export function parse(argv) {
	const { values, positionals } = parseArgs({ args: normalizeArgv(argv), options: OPTIONS, allowPositionals: true, strict: true });
	if (values.client && !values.clients) values.clients = values.client;
	const [command = values.version ? 'version' : 'help', ...rest] = positionals;
	return { command, positionals: rest, flags: values };
}

const COMMANDS = {
	setup: async (ctx) => (await import('./commands/setup.js')).setup(ctx),
	login: async (ctx) => (await import('./commands/account.js')).login(ctx),
	logout: async (ctx) => (await import('./commands/account.js')).logout(ctx),
	status: async (ctx) => (await import('./commands/account.js')).status(ctx),
	whoami: async (ctx) => (await import('./commands/account.js')).whoami(ctx),
	tools: async (ctx) => (await import('./commands/tools.js')).tools(ctx),
	mcp: async (ctx) => (await import('./commands/mcp.js')).mcp(ctx),
	proxy: async (ctx) => {
		const [url] = ctx.positionals;
		if (!url || !/^https?:\/\//.test(url)) throw new Error('usage: three-ws proxy <https://three.ws/api/mcp> [--server <slug>]');
		const { runProxy } = await import('./proxy.js');
		await runProxy({ url, server: ctx.flags.server || null, env: ctx.env });
		return 0;
	},
	fund: async (ctx) => (await import('./commands/inference.js')).fund(ctx),
	provider: async (ctx) => (await import('./commands/inference.js')).provider(ctx),
	usage: async (ctx) => (await import('./commands/inference.js')).usage(ctx),
	ask: async (ctx) => (await import('./commands/inference.js')).ask(ctx),
	version: async (ctx) => {
		if (ctx.flags.json) printJson({ version: VERSION, node: process.versions.node });
		else line(VERSION);
		return 0;
	},
	help: async () => {
		line(HELP);
		return 0;
	},
};

export async function main(argv = process.argv.slice(2), env = systemEnv()) {
	// `skills` owns its own argument grammar (see commands/skills.js).
	if (argv[0] === 'skills') {
		const { runSkills } = await import('./commands/skills.js');
		const originIdx = argv.indexOf('--origin');
		const { code, output } = await runSkills(argv.slice(1), { env, origin: originIdx > 0 ? argv[originIdx + 1] : undefined });
		if (output) (code === 0 ? process.stdout : process.stderr).write(`${output}\n`);
		return code;
	}
	let parsed;
	try {
		parsed = parse(argv);
	} catch (err) {
		errorLine(`${err.message}. Run \`three-ws --help\`.`);
		return 2;
	}
	const { command, positionals, flags } = parsed;
	if (flags.help && command !== 'help') return COMMANDS.help();
	const run = COMMANDS[command];
	if (!run) {
		errorLine(`unknown command "${command}". Run \`three-ws --help\`.`);
		return 2;
	}
	const origin = resolveOrigin({ flag: flags.origin, env, store: readStore(env) });
	const ctx = { command, positionals, flags, env, origin };
	try {
		return await run(ctx);
	} catch (err) {
		if (err instanceof CancelledError) {
			errorLine('Cancelled. Nothing after the last completed step was changed.');
			return 130;
		}
		if (flags.json) printJson({ error: err.code || 'error', message: err.message, status: err instanceof ApiError ? err.status : undefined });
		else errorLine(err.message);
		if (env.vars.THREE_WS_DEBUG === '1' && err.stack) process.stderr.write(`${err.stack}\n`);
		return 1;
	}
}

const invokedDirectly = (() => {
	try {
		return realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url));
	} catch {
		return false;
	}
})();

if (invokedDirectly) {
	main().then((code) => {
		process.exitCode = code;
	});
}
