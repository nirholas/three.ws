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
import { CliError, EXIT_CODES, exitCodeFor, isNonInteractive } from './automation.js';

export const HELP = `${c.bold('three-ws')} ${c.dim(`v${VERSION}`)}: connect any MCP client to three.ws

${c.bold('Usage')}
  npx three-ws <command> [options]

${c.bold('Commands')}
  setup                 Sign in, write the three.ws MCP servers into your clients, verify with tools/list
  login                 Sign in or switch accounts (OAuth by default)
  link <code>           Link this terminal with a code from three.ws/dashboard/account
  signup --agent        An autonomous agent signs itself up: local Solana key, no email, no browser
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
  skills <sub>          Browse and install community agent skills (list, search, show, import|install, installed)
  agents list|get       Your agents, for scripts: ids, names, pages and wallets
  runs list|get         An agent's runs (--agent), or one run with its steps, tool calls and receipt chain
  orders list           An agent's programmable orders (--agent, --network)
  report run <id>       One run as a single self-contained HTML file (--out report.html)
  proxy <url>           Run a stdio bridge to a hosted server (written into client configs by setup)
  fund                  Top up credits from an agent wallet (--amount, --agent); mints an inference key once
  provider use three-ws Point this machine's model clients at three.ws, billed to your credits
  provider show         The active model provider
  usage                 Credits, burn rate, days left and recent top-ups (--agent for one agent's budget)
  ask "<prompt>"        One completion through the active provider
  pay <url>             Pay an x402 or MPP challenge from a local Solana key, inside pay-permissions.json
  pay init|permissions|mcp  Write the default limits, show them, or run the stdio MCP payer
  wallet <sub>          The local pay key: init, address, export-public, balance (never prints the private key)
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
  --servers a,b         Server slugs or paths (default: /mcp, the unified server with every tool)
  --packages a,b        Also add stdio @three-ws/*-mcp packages
  --project             Write project-scoped config (.mcp.json, .cursor/, .vscode/, .bob/, .gemini/) in this directory
  --proxy               Route every server through the local proxy (enforces tool choices in every client)
  --yes                 Never prompt; use defaults

${c.bold('Grok Bot options')} (setup --client grok-bot; Grok Bot keeps connectors in xAI's cloud)
  --auth <mode>         none (free), install (free, a quota that survives reconnects),
                        key (a connector key that can never spend) or oauth
  --connector-key <key> Use this key for --auth key instead of minting one
  --servers <slug>      Connect another server than the recommended three-ws-grok

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

${c.bold('Pay options')} (pay, wallet)
  --dry-run             Print the decision, exact amount and payee; sign and send nothing
  --max <amount>        Refuse anything above this many whole units (e.g. 0.05)
  --network <net>       Only consider mainnet, devnet or a CAIP-2 network id
  --method <verb>       HTTP method (default GET, POST with --data)
  --data <text>         Request body, resent after payment
  -H, --header <h>      Extra request header "Name: value" (repeatable)
  --yes                 Approve a payment above confirmAbove without a prompt
  --storage <where>     auto (keychain, else sealed file), keychain or file (wallet init)
  Exit codes: 10 outside permissions, 11 needs confirmation, 12 no payable option,
              13 payment rejected, 14 wallet missing or locked. Reason string in --json.

${c.bold('Automation')} (every command)
  --json                One JSON document on stdout; diagnostics and errors' text go to stderr
  --non-interactive     Never prompt (also THREE_WS_NON_INTERACTIVE=1); missing input exits 2
  Exit codes: 0 ok, 1 error, 2 usage, 3 auth, 4 refused by a guard, 5 payment required, 6 network.
              (\`pay\` keeps its own 10 to 14, listed above.) Full table: docs/cli.md

${c.bold('Global')}
  --json                Machine-readable output on stdout
  --origin <url>        Talk to another three.ws deployment (or THREE_WS_ORIGIN)
  --no-color            Plain output
  -h, --help            This help

Docs: https://three.ws/docs/cli`;

const OPTIONS = {
	json: { type: 'boolean' },
	'non-interactive': { type: 'boolean' },
	out: { type: 'string' },
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
	auth: { type: 'string' },
	'connector-key': { type: 'string' },
	intent: { type: 'boolean' },
	quote: { type: 'string' },
	'creator-fee': { type: 'string' },
	network: { type: 'string' },
	watch: { type: 'boolean' },
	'dry-run': { type: 'boolean' },
	max: { type: 'string' },
	method: { type: 'string' },
	data: { type: 'string' },
	header: { type: 'string', short: 'H', multiple: true },
	storage: { type: 'string' },
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
// `signup --agent` is a mode switch, but `agent` is a string option elsewhere
// (`--agent <id>`), so on the signup command a bare --agent becomes --agent=.
function normalizeArgv(argv) {
	const bare = (i) => argv[i + 1] === undefined || argv[i + 1].startsWith('-');
	return argv.map((a, i) => {
		if (a === '--key' && bare(i)) return '--key=';
		if (a === '--agent' && argv[0] === 'signup' && bare(i)) return '--agent=';
		return a;
	});
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
	signup: async (ctx) => (await import('./commands/signup.js')).signup(ctx),
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
		throw new CliError(EXIT_CODES.USAGE, 'usage', 'usage: three-ws agent <status [id]|create [name]|launch [status <id>]>');
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
	agents: async (ctx) => (await import('./commands/automation.js')).agents(ctx),
	runs: async (ctx) => (await import('./commands/automation.js')).runs(ctx),
	orders: async (ctx) => (await import('./commands/automation.js')).orders(ctx),
	report: async (ctx) => (await import('./commands/automation.js')).report(ctx),
	pay: async (ctx) => (await import('./commands/pay.js')).payCommand(ctx),
	wallet: async (ctx) => (await import('./commands/wallet.js')).wallet(ctx),
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

/**
 * Print a failure and return its exit code. Under --json stdout carries exactly
 * one JSON document (the error object) and the human sentence goes to stderr;
 * otherwise the sentence goes to stderr alone.
 */
function failure(err, { json, env }) {
	const exit = exitCodeFor(err);
	if (json) {
		printJson({ error: err.code || 'error', message: err.message, exit, detail: err.detail, status: err instanceof ApiError ? err.status : undefined });
	}
	errorLine(err.message);
	if (env.vars.THREE_WS_DEBUG === '1' && err.stack) process.stderr.write(`${err.stack}\n`);
	return exit;
}

export async function main(argv = process.argv.slice(2), env = systemEnv()) {
	// `skills` (alias `skill`) owns its own argument grammar (see commands/skills.js).
	if (argv[0] === 'skills' || argv[0] === 'skill') {
		const rest = argv.slice(1);
		const json = rest.includes('--json');
		try {
			const { runSkills } = await import('./commands/skills.js');
			const originIdx = rest.indexOf('--origin');
			const { code, output } = await runSkills(rest, { env, origin: originIdx >= 0 ? rest[originIdx + 1] : undefined });
			if (json && code !== 0) {
				printJson({ error: code === EXIT_CODES.USAGE ? 'usage' : code === EXIT_CODES.GUARD ? 'refused_by_guard' : 'error', message: output, exit: code });
				return code;
			}
			if (output) (code === 0 ? process.stdout : process.stderr).write(`${output}\n`);
			return code;
		} catch (err) {
			return failure(err, { json, env });
		}
	}
	let parsed;
	try {
		parsed = parse(argv);
	} catch (err) {
		if (argv.includes('--json')) printJson({ error: 'usage', message: err.message, exit: EXIT_CODES.USAGE });
		errorLine(`${err.message}. Run \`three-ws --help\`.`);
		return EXIT_CODES.USAGE;
	}
	const { command, positionals, flags } = parsed;
	if (flags.help && command !== 'help') return COMMANDS.help();
	const run = COMMANDS[command];
	if (!run) {
		if (flags.json) printJson({ error: 'usage', message: `unknown command "${command}"`, exit: EXIT_CODES.USAGE });
		errorLine(`unknown command "${command}". Run \`three-ws --help\`.`);
		return EXIT_CODES.USAGE;
	}
	const origin = resolveOrigin({ flag: flags.origin, env, store: readStore(env) });
	const ctx = { command, positionals, flags, env, origin, nonInteractive: isNonInteractive(flags, env) };
	try {
		return await run(ctx);
	} catch (err) {
		if (err instanceof CancelledError) {
			errorLine('Cancelled. Nothing after the last completed step was changed.');
			return 130;
		}
		return failure(err, { json: flags.json, env });
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
