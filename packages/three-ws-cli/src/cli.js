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
import { clientsFromFlags } from './commands/quick.js';

export const HELP = `${c.bold('three-ws')} ${c.dim(`v${VERSION}`)}: connect any MCP client to three.ws

${c.bold('Usage')}
  npx three-ws <command> [options]

${c.bold('Commands')}
  setup                 Sign in, write the three.ws MCP servers into your clients, verify with tools/list
  login                 Sign in or switch accounts (OAuth by default)
  link <code>           Link this terminal with a code from three.ws/dashboard/account
  logout                Remove stored credentials and revoke the OAuth refresh token
  doctor                Diagnose a broken setup: bad config, expired sign-in, unreachable server
  status                Account, plan, wallet balance, token expiry, and every configured client
  whoami                Print the signed-in account
  create [name]         Create an agent with its own Solana wallet and a public page
  agent status [id]     Live state of your agents: wallet balance, page, body
  team [status <id>]    Your specialist teams: roster, findings, last error
  launch                Fill in a coin for one of your agents, then review and sign it on three.ws/launch
  launch --intent       Quote a launch paid from the agent's wallet in SOL or USDC, open its page, watch the stages
  launch status <id>    Stages of a funded launch intent (quote, paid, submitted, confirmed, indexed); --watch polls
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

${c.bold('One flag per client')} (whole setup, no prompts, no secrets in the client's config)
  --claude --cursor --codex --vscode --windsurf --gemini --bob --hermes
                        e.g. npx three-ws --claude; Claude Code also gets the three.ws skill

${c.bold('Setup options')}
  --clients a,b         claude-code, claude-desktop, cursor, windsurf, vscode, bob, codex, gemini, hermes, grok-bot, print
  --connector-key       With grok-bot: mint a spend-free API key for Grok Bot's Bot secret
  --no-copy             Do not copy the grok-bot server URL to the clipboard
  --servers a,b         Server slugs or paths (default: /mcp, the unified server with every tool)
  --packages a,b        Also add stdio @three-ws/*-mcp packages
  --project             Write project-scoped config (.mcp.json, .cursor/, .vscode/, .bob/, .gemini/) in this directory
  --proxy               Route every server through the local proxy (enforces tool choices in every client)
  --yes                 Never prompt; use defaults

${c.bold('Tools options')}
  --server <slug>       Server to change
  --enable a,b          Tiers (read, write, financial) or tool names to turn on
  --disable a,b         Tiers or tool names to turn off
  --reset               Back to the default (read and write on, financial off)

${c.bold('Agent options')} (create, launch)
  --name <text>         Agent name (create) or coin name (launch)
  --description <text>  What the agent or coin is
  --avatar <id>         An avatar you own to use as the agent's 3D body (create)
  --agent <id>          The agent that launches the coin (launch)
  --symbol <ticker>     Coin ticker, letters and digits (launch)
  --image <https-url>   Coin image; the agent's portrait when omitted (launch)
  --initial-buy <sol>   SOL for the first buy, prefilled for review (launch)
  --intent              Create a funded launch intent instead of prefilling /launch (launch)
  --quote <sol|usdc>    Asset the launch and first buy are paid in; /api/pump/pairs lists what is live (launch --intent)
  --creator-fee <bps>   Creator fee in basis points within the range the program allows (launch --intent)
  --network <net>       mainnet (default) or devnet, where a dry run never touches mainnet (launch --intent)
  --watch               Keep polling until the intent settles (launch status)

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
	'connector-key': { type: 'boolean' },
	'no-copy': { type: 'boolean' },
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
	description: { type: 'string' },
	avatar: { type: 'string' },
	symbol: { type: 'string' },
	image: { type: 'string' },
	'initial-buy': { type: 'string' },
	intent: { type: 'boolean' },
	quote: { type: 'string' },
	'creator-fee': { type: 'string' },
	network: { type: 'string' },
	watch: { type: 'boolean' },
	claude: { type: 'boolean' },
	cursor: { type: 'boolean' },
	codex: { type: 'boolean' },
	vscode: { type: 'boolean' },
	windsurf: { type: 'boolean' },
	gemini: { type: 'boolean' },
	bob: { type: 'boolean' },
	hermes: { type: 'boolean' },
};

// `--key` alone (no value) means "prompt for it"; parseArgs needs a value for a
// string option, so a bare --key becomes --key= before parsing.
function normalizeArgv(argv) {
	return argv.map((a, i) => (a === '--key' && (argv[i + 1] === undefined || argv[i + 1].startsWith('-')) ? '--key=' : a));
}

export function parse(argv) {
	const { values, positionals } = parseArgs({ args: normalizeArgv(argv), options: OPTIONS, allowPositionals: true, strict: true });
	if (values.client && !values.clients) values.clients = values.client;
	const perClient = clientsFromFlags(values).length > 0;
	// A per-client flag with no command is the whole setup for that client.
	const fallback = values.version ? 'version' : perClient ? 'quick' : 'help';
	let [command = fallback, ...rest] = positionals;
	if (perClient && command === 'setup') command = 'quick';
	return { command, positionals: rest, flags: values };
}

const COMMANDS = {
	setup: async (ctx) => (await import('./commands/setup.js')).setup(ctx),
	login: async (ctx) => (await import('./commands/account.js')).login(ctx),
	link: async (ctx) => (await import('./commands/account.js')).link(ctx),
	logout: async (ctx) => (await import('./commands/account.js')).logout(ctx),
	status: async (ctx) => (await import('./commands/account.js')).status(ctx),
	whoami: async (ctx) => (await import('./commands/account.js')).whoami(ctx),
	tools: async (ctx) => (await import('./commands/tools.js')).tools(ctx),
	quick: async (ctx) => (await import('./commands/quick.js')).quick(ctx),
	doctor: async (ctx) => (await import('./commands/doctor.js')).doctor(ctx),
	team: async (ctx) => (await import('./commands/live.js')).team(ctx),
	agent: async (ctx) => {
		const [sub, ...rest] = ctx.positionals;
		const next = { ...ctx, positionals: rest };
		if (sub === 'status') return (await import('./commands/live.js')).agentStatus(next);
		if (sub === 'create') return (await import('./commands/agent.js')).create(next);
		if (sub === 'launch') return (await import('./commands/agent.js')).launch(next);
		throw new Error('usage: three-ws agent <status [id]|create [name]|launch [status <id>]>');
	},
	create: async (ctx) => (await import('./commands/agent.js')).create(ctx),
	launch: async (ctx) => (await import('./commands/agent.js')).launch(ctx),
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
