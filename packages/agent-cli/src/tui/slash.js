// Slash commands for the TUI. One registry drives dispatch, Tab autocomplete
// and /help, so a command added here is documented everywhere at once.
//
// A command is { name, args, description, run(argv, api) } and resolves
// { text } to print, { error } to print as an error, or nothing. `api` is the
// host (the TUI, or a test): see the typedef below.

import { saveConfig, THREE_WS_MODEL } from '../config.js';
import { gateCall, serializeToolResult } from '../loop.js';
import { exportSession, listSessions, printExport, printSearch, printSessions, searchSessions } from '../commands/sessions.js';
import { addCron, listCrons, printCron, printCrons, removeCron, setCronEnabled, setCronMode } from '../commands/cron.js';
import { ago, table, truncate, usd } from '../commands/format.js';

/**
 * @typedef {object} SlashApi
 * @property {object} ctx                      createAgentContext()
 * @property {object} session                  the current createSession()
 * @property {object} pool                     createSubagentPool()
 * @property {Function} approve                the TUI approver ({ tool, args }) => { ok }
 * @property {(o?: object) => object} newSession
 * @property {(id: string) => object} resumeSession
 * @property {(key?: string) => void} reload    reload config; drops the CLI override for `key`
 * @property {() => void} clear
 * @property {() => void} exit
 */

/** Split a command line into words; "double" or 'single' quotes group words. */
export function splitArgs(line) {
	const out = [];
	const re = /"((?:[^"\\]|\\.)*)"|'([^']*)'|(\S+)/g;
	let m;
	while ((m = re.exec(line))) out.push(m[1] !== undefined ? m[1].replace(/\\(.)/g, '$1') : m[2] !== undefined ? m[2] : m[3]);
	return out;
}

function needSignIn(api) {
	const platform = api.ctx.platform;
	if (!platform) throw new Error('This needs a three.ws sign-in. Run `three-ws-agent login` in another terminal, then /model three-ws or restart.');
	return platform;
}

async function callTool(api, name, args) {
	const toolset = await api.ctx.ensureTools();
	const tool = toolset.get(name);
	if (!tool) {
		throw new Error(
			api.ctx.credential
				? `The three.ws tool ${name} is not mounted. Check \`three-ws-agent doctor\` for the MCP servers.`
				: `${name} is a three.ws tool; sign in with \`three-ws-agent login\` to use it.`,
		);
	}
	const refused = await gateCall({ tool, args, approvals: api.ctx.config.approvals, approve: api.approve });
	if (refused) return { error: refused };
	const result = await tool.run(args, {});
	return { text: serializeToolResult(result) };
}

export const COMMANDS = [
	{
		name: 'model',
		args: '[<id> | openai <base-url> <model> [<key-env>] | three-ws]',
		description: 'Show or switch the model. With no argument, lists what the endpoint offers.',
		async run(argv, api) {
			const [first, ...rest] = argv;
			if (!first) {
				const lines = [`Current: ${api.ctx.modelLabel}`];
				if (api.ctx.modelError) return { error: `${api.ctx.modelError.message}` };
				const models = await api.ctx.model.listModels();
				lines.push(models.length ? table(models.map((m) => [m.id === api.ctx.model.target.model ? `* ${m.id}` : `  ${m.id}`, truncate(m.description || m.owner || '', 70)])) : 'The endpoint lists no models.');
				return { text: lines.join('\n') };
			}
			if (first === 'three-ws') saveConfig({ model: { provider: 'three-ws', baseUrl: null, apiKeyEnv: null, model: THREE_WS_MODEL } }, api.ctx.env);
			else if (first === 'openai') {
				const [baseUrl, model, keyEnv] = rest;
				if (!baseUrl || !model) return { error: 'Usage: /model openai <base-url> <model> [<env var holding the key>], e.g. /model openai http://127.0.0.1:11434/v1 llama3.1' };
				try {
					new URL(baseUrl);
				} catch {
					return { error: `"${baseUrl}" is not a URL.` };
				}
				saveConfig({ model: { provider: 'openai', baseUrl, model, apiKeyEnv: keyEnv || null } }, api.ctx.env);
			} else saveConfig({ model: { model: first } }, api.ctx.env);
			api.reload('model');
			if (api.ctx.modelError) return { error: `Saved, but the model is not usable yet: ${api.ctx.modelError.message}` };
			return { text: `Model: ${api.ctx.modelLabel}. Saved to agent.json; the next message uses it.` };
		},
	},
	{
		name: 'agent',
		args: '[<id> | none]',
		description: 'List your three.ws agents, or pick the one whose persona, wallet and skills this session uses.',
		async run(argv, api) {
			const platform = needSignIn(api);
			const [id] = argv;
			if (!id) {
				const agents = await platform.listAgents({ limit: 50 });
				if (!agents.length) return { text: 'You have no three.ws agents yet. Create one at https://three.ws/create, then /agent <id>.' };
				return {
					text: table([
						['', 'ID', 'NAME', 'WALLET'],
						...agents.map((a) => [a.id === api.ctx.config.agentId ? '*' : '', a.id, truncate(a.name, 32), a.wallet?.solana || a.wallet?.address || '']),
					]),
				};
			}
			if (id === 'none') {
				saveConfig({ agentId: null }, api.ctx.env);
				api.reload('agentId');
				return { text: 'No agent selected; the session runs as your account.' };
			}
			const agent = await platform.getAgent(id);
			saveConfig({ agentId: agent.id }, api.ctx.env);
			api.reload('agentId');
			return { text: `Agent: ${agent.name} (${agent.id}). Saved; /new starts a session with its persona.` };
		},
	},
	{
		name: 'wallet',
		args: '[all | call <tool> <json>]',
		description: 'The selected agent\'s wallet (wallet_status). `all` summarizes every wallet; `call` runs any wallet tool through the approval gate.',
		async run(argv, api) {
			const [sub, ...rest] = argv;
			if (!sub) {
				const args = api.ctx.config.agentId ? { agent_id: api.ctx.config.agentId } : {};
				return callTool(api, 'wallet_status', args);
			}
			if (sub === 'all') return callTool(api, 'get_wallet_summaries', {});
			if (sub === 'call') {
				const [tool, ...json] = rest;
				if (!tool) return { error: 'Usage: /wallet call <tool> <json arguments>' };
				let args = {};
				if (json.length) {
					try {
						args = JSON.parse(json.join(' '));
					} catch (err) {
						return { error: `The arguments are not valid JSON: ${err.message}` };
					}
				}
				return callTool(api, tool, args);
			}
			return { error: `Unknown /wallet option "${sub}". Use /wallet, /wallet all, or /wallet call <tool> <json>.` };
		},
	},
	{
		name: 'skills',
		args: '',
		description: 'Skills installed on the selected agent, and the tools this session can use.',
		async run(_argv, api) {
			const lines = [];
			if (api.ctx.config.agentId && api.ctx.platform) {
				const agent = await api.ctx.platform.getAgent(api.ctx.config.agentId);
				const skills = agent.skills || [];
				lines.push(skills.length ? `${agent.name} has ${skills.length} skill${skills.length === 1 ? '' : 's'}:` : `${agent.name} has no skills installed. Add them at https://three.ws/marketplace.`);
				for (const s of skills) lines.push(`  ${typeof s === 'string' ? s : `${s.name || s.slug || s.id}${s.description ? `: ${truncate(s.description, 70)}` : ''}`}`);
			} else lines.push('No agent selected (/agent <id>), so no agent skills.');
			const toolset = await api.ctx.ensureTools();
			const all = toolset.all();
			const local = all.filter((t) => t.source !== 'remote').map((t) => t.name);
			const remote = all.filter((t) => t.source === 'remote');
			lines.push('', `Local tools: ${local.join(', ')}`);
			lines.push(remote.length ? `three.ws tools: ${remote.length} mounted, the most relevant offered each turn.` : 'three.ws tools: none mounted (sign in to add them).');
			return { text: lines.join('\n') };
		},
	},
	{
		name: 'runs',
		args: '',
		description: 'Recent runs: subagents and schedules on this machine, and the selected agent\'s runs on three.ws.',
		async run(_argv, api) {
			const local = api.ctx.store.listRuns({ limit: 15 });
			const lines = [
				local.length
					? table([['ID', 'KIND', 'STATUS', 'STARTED', 'TOKENS', 'COST', 'GOAL'], ...local.map((r) => [r.id, r.kind, r.status, ago(r.started_at), r.prompt_tokens + r.completion_tokens, usd(r.billed_usd), truncate(r.goal, 40)])])
					: 'No local runs yet. Subagents (/subagent) and schedules (/cron) record theirs here.',
			];
			if (api.ctx.config.agentId && api.ctx.platform) {
				const remote = await api.ctx.platform.listRuns(api.ctx.config.agentId, { limit: 10 });
				lines.push('', remote.length ? `On three.ws:\n${table(remote.map((r) => [r.id, r.status || '', ago(r.createdAt || r.created_at || r.startedAt), truncate(r.goal || r.title || r.trigger || '', 50)]))}` : 'No runs on three.ws for this agent yet.');
			}
			return { text: lines.join('\n') };
		},
	},
	{
		name: 'new',
		args: '',
		description: 'Start a fresh session (the current one stays saved).',
		run(_argv, api) {
			const s = api.newSession();
			return { text: `New session ${s.id}.` };
		},
	},
	{
		name: 'sessions',
		args: '',
		description: 'Recent sessions on this machine.',
		run(_argv, api) {
			return { text: printSessions(listSessions({ store: api.ctx.store, limit: 20 })) };
		},
	},
	{
		name: 'search',
		args: '<words>',
		description: 'Full-text search across every saved session.',
		run(argv, api) {
			if (!argv.length) return { error: 'Usage: /search <words>' };
			return { text: printSearch(searchSessions({ store: api.ctx.store, query: argv.join(' ') })) };
		},
	},
	{
		name: 'resume',
		args: '<session id>',
		description: 'Switch to a saved session (an id prefix is enough).',
		run(argv, api) {
			if (!argv[0]) return { error: 'Usage: /resume <session id>. Find one with /sessions or /search.' };
			const s = api.resumeSession(argv[0]);
			return { text: `Resumed ${s.id}${s.title ? `: ${s.title}` : ''}.` };
		},
	},
	{
		name: 'export',
		args: '[<session id>] [<file>]',
		description: 'Write a session (default: this one) to a JSON file in the workspace.',
		run(argv, api) {
			const [id = api.session.id, out = null] = argv;
			return { text: printExport(exportSession({ store: api.ctx.store, id, out, cwd: api.ctx.cwd })) };
		},
	},
	{
		name: 'cron',
		args: '[add "<when>" "<prompt>" [--server] | rm <id> | mode <id> local|server | on <id> | off <id>]',
		description: 'Schedules in plain language ("every weekday at 9am"). Local ones fire while the agent runs; --server makes a three.ws automation.',
		async run(argv, api) {
			const [sub, ...rest] = argv;
			const ctx = api.ctx;
			if (!sub || sub === 'list') return { text: printCrons(listCrons({ ctx })) };
			if (sub === 'add') {
				const server = rest.includes('--server');
				const words = rest.filter((w) => w !== '--server' && w !== '--local');
				if (words.length < 2) return { error: 'Usage: /cron add "<when>" "<prompt>" [--server], e.g. /cron add "every day at 8am" "check my wallet balance"' };
				const [when, ...prompt] = words;
				return { text: printCron(await addCron({ ctx, when, prompt: prompt.join(' '), mode: server ? 'server' : rest.includes('--local') ? 'local' : undefined })) };
			}
			if (sub === 'rm' || sub === 'remove' || sub === 'delete') {
				if (!rest[0]) return { error: 'Usage: /cron rm <id>' };
				return { text: printCron(await removeCron({ ctx, id: rest[0] }), 'Removed') };
			}
			if (sub === 'mode') {
				const [id, mode] = rest;
				if (!id || !['local', 'server'].includes(mode)) return { error: 'Usage: /cron mode <id> local|server' };
				return { text: printCron(await setCronMode({ ctx, id, mode }), 'Moved') };
			}
			if (sub === 'on' || sub === 'off') {
				if (!rest[0]) return { error: `Usage: /cron ${sub} <id>` };
				return { text: printCron(setCronEnabled({ ctx, id: rest[0], enabled: sub === 'on' }), sub === 'on' ? 'Resumed' : 'Paused') };
			}
			return { error: `Unknown /cron option "${sub}". Try /cron, /cron add, /cron rm, /cron mode, /cron on, /cron off.` };
		},
	},
	{
		name: 'subagent',
		args: '<goal> | list | cancel <id>',
		description: 'Run a goal in a parallel child session with its own budget; its report lands back here.',
		run(argv, api) {
			const [sub, ...rest] = argv;
			if (!sub || sub === 'list') {
				const jobs = api.pool.list();
				if (!jobs.length) return { text: `No subagents yet. Start one: /subagent "summarize the README in this folder". Up to ${api.pool.limit} run at once.` };
				return { text: table([['ID', 'STATUS', 'TOKENS', 'COST', 'GOAL'], ...jobs.map((j) => [j.id, j.status, (j.usage?.prompt_tokens || 0) + (j.usage?.completion_tokens || 0), usd(j.billedUsd), truncate(j.goal, 60)])]) };
			}
			if (sub === 'cancel') {
				if (!rest[0]) return { error: 'Usage: /subagent cancel <id>' };
				return api.pool.cancel(rest[0]) ? { text: `Cancelling ${rest[0]}.` } : { error: `No queued or running subagent ${rest[0]}.` };
			}
			const goal = argv.join(' ');
			const job = api.pool.spawn({ goal, parent: api.session, approve: api.approve, onEvent: api.onSubagentEvent });
			return { text: `Subagent ${job.id} ${api.pool.running >= api.pool.limit ? 'queued' : 'started'}: ${truncate(goal, 80)}` };
		},
	},
	{
		name: 'clear',
		args: '',
		description: 'Clear the screen (the session itself is kept).',
		run(_argv, api) {
			api.clear();
		},
	},
	{
		name: 'help',
		args: '',
		description: 'This list.',
		run() {
			return { text: helpText() };
		},
	},
	{
		name: 'exit',
		args: '',
		description: 'Quit (the session is saved; resume it with --resume).',
		run(_argv, api) {
			api.exit();
		},
	},
];

const BY_NAME = new Map(COMMANDS.map((c) => [c.name, c]));
const ALIASES = new Map([
	['quit', 'exit'],
	['q', 'exit'],
	['?', 'help'],
	['models', 'model'],
	['agents', 'agent'],
]);

export function helpText() {
	const rows = COMMANDS.map((c) => [`/${c.name}${c.args ? ` ${c.args}` : ''}`, c.description]);
	return [
		'Slash commands:',
		table(rows.map(([a, b]) => [`  ${a}`, b])),
		'',
		'Keys: Enter sends. End a line with \\ for a newline. Up/Down walk history. Tab completes a command.',
		'Ctrl+C stops the running turn; on an empty prompt it quits. Typing while a turn runs redirects it.',
		'Approvals: Enter approves, Esc denies.',
	].join('\n');
}

/** Commands whose name starts with what was typed after "/" (nothing once a space follows). */
export function completions(input) {
	if (!input.startsWith('/') || /\s/.test(input)) return [];
	const prefix = input.slice(1).toLowerCase();
	return COMMANDS.filter((c) => c.name.startsWith(prefix));
}

/** What Tab turns the input into: the single match, or the longest shared prefix of several. */
export function complete(input) {
	const matches = completions(input);
	if (!matches.length) return input;
	if (matches.length === 1) return `/${matches[0].name} `;
	let common = matches[0].name;
	for (const m of matches) while (!m.name.startsWith(common)) common = common.slice(0, -1);
	return `/${common}`.length > input.length ? `/${common}` : input;
}

export function isSlash(text) {
	return /^\/[a-z?]/i.test(String(text).trim());
}

/** Run a slash command line. Errors become { error } so the TUI never crashes on one. */
export async function runSlash(line, api) {
	const [head, ...argv] = splitArgs(String(line).trim());
	const name = head.slice(1).toLowerCase();
	const cmd = BY_NAME.get(ALIASES.get(name) || name);
	if (!cmd) {
		const near = completions(`/${name.slice(0, 2)}`).map((c) => `/${c.name}`);
		return { error: `Unknown command /${name}.${near.length ? ` Did you mean ${near.join(', ')}?` : ''} /help lists them all.` };
	}
	try {
		return (await cmd.run(argv, api)) || null;
	} catch (err) {
		return { error: String(err?.message || err) };
	}
}
