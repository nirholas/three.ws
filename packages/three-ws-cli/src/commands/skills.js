// `three-ws skills`: browse the public community skills registry and import a
// skill onto one of your agents as an editable prompt-only custom skill.
//
//   three-ws skills list [--tag <tag>] [--author <name>]
//   three-ws skills search <query>
//   three-ws skills show <slug>
//   three-ws skills import <slug> --agent <agent-id> [--disabled]
//   three-ws skills installed --agent <agent-id>
//
// Every subcommand takes --json. Reads are public; import and installed use
// the stored credential (`three-ws login`) or THREE_WS_API_KEY. Server side:
// /api/skills/community and /api/agents/:id/custom-skills (docs/skills.md).

import { requestJson, ApiError } from '../http.js';
import { bearerFor } from '../oauth.js';
import { readStore, resolveOrigin } from '../store.js';
import { systemEnv } from '../paths.js';

export const SKILLS_USAGE = `Usage:
  three-ws skills list [--tag <tag>] [--author <name>] [--json]
  three-ws skills search <query> [--json]
  three-ws skills show <slug> [--json]
  three-ws skills import <slug> --agent <agent-id> [--disabled] [--json]
  three-ws skills installed --agent <agent-id> [--json]

Browse every skill: https://three.ws/skills/community`;

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Split argv into positionals and --flags (a flag followed by a non-flag takes it as its value). */
export function parseSkillsArgs(argv) {
	const positional = [];
	const flags = {};
	for (let i = 0; i < argv.length; i++) {
		const a = argv[i];
		if (!a.startsWith('--')) {
			positional.push(a);
			continue;
		}
		const [key, inline] = a.slice(2).split('=', 2);
		if (inline !== undefined) flags[key] = inline;
		else if (argv[i + 1] !== undefined && !argv[i + 1].startsWith('--')) flags[key] = argv[++i];
		else flags[key] = true;
	}
	return { sub: positional[0] || 'list', args: positional.slice(1), flags };
}

async function authHeaders(env) {
	const key = env.vars.THREE_WS_API_KEY;
	const bearer = key || (await bearerFor(env));
	if (!bearer) {
		throw new ApiError('not signed in. Run `npx three-ws login`, or set THREE_WS_API_KEY.', { code: 'login_required' });
	}
	return { authorization: `Bearer ${bearer}` };
}

function pad(s, n) {
	const str = String(s ?? '');
	return str.length >= n ? `${str.slice(0, n - 1)}…` : str.padEnd(n);
}

/** One line per skill, fixed columns. */
export function formatSkillTable(skills) {
	if (!skills.length) return 'No skills match. Try `three-ws skills list` with no filters.';
	const lines = [`${pad('SLUG', 24)} ${pad('TOKENS', 7)} ${pad('TAGS', 30)} DESCRIPTION`];
	for (const s of skills) {
		lines.push(`${pad(s.slug, 24)} ${pad(`~${s.tokens}`, 7)} ${pad(s.tags.join(','), 30)} ${s.description}`);
	}
	return lines.join('\n');
}

/** The installed list with the budget line the chat path enforces. */
export function formatInstalled({ skills, budget }) {
	const head = `Budget: ${budget.used_tokens} / ${budget.cap_tokens} tokens injected (${budget.injected_count} of ${skills.length} skills)`;
	if (!skills.length) return `${head}\nNo custom skills yet. Import one: three-ws skills import <slug> --agent <agent-id>`;
	const rows = skills.map((s) => {
		const state = s.injected ? 'on' : s.skip_reason === 'disabled' ? 'off' : 'over budget';
		const update = s.registry?.update_available ? ' (update available)' : '';
		return `${pad(s.slug, 24)} ${pad(`~${s.tokens}`, 7)} ${pad(state, 12)} ${s.id}${update}`;
	});
	return [head, `${pad('SLUG', 24)} ${pad('TOKENS', 7)} ${pad('STATE', 12)} ID`, ...rows].join('\n');
}

/**
 * Run a `skills` subcommand. Returns { code, output } so the dispatcher decides
 * where it goes; nothing here writes to stdout directly.
 */
export async function runSkills(argv, { env = systemEnv(), origin: originFlag } = {}) {
	const { sub, args, flags } = parseSkillsArgs(argv);
	const origin = resolveOrigin({ flag: originFlag || flags.origin, env, store: readStore(env) });
	const json = Boolean(flags.json);
	const done = (data, text) => ({ code: 0, output: json ? JSON.stringify(data, null, 2) : text });

	if (sub === 'list' || sub === 'search') {
		const q = new URLSearchParams();
		if (sub === 'search') {
			if (!args.length) return { code: 2, output: SKILLS_USAGE };
			q.set('q', args.join(' '));
		}
		if (typeof flags.tag === 'string') q.set('tag', flags.tag);
		if (typeof flags.author === 'string') q.set('author', flags.author);
		const data = await requestJson(`${origin}/api/skills/community?${q}`);
		return done(data, `${formatSkillTable(data.skills)}\n\n${data.count} of ${data.total} skills. Import: three-ws skills import <slug> --agent <agent-id>`);
	}

	if (sub === 'show') {
		if (!args[0]) return { code: 2, output: SKILLS_USAGE };
		const { skill } = await requestJson(`${origin}/api/skills/community/${encodeURIComponent(args[0])}`);
		return done(skill, `${skill.name} (${skill.slug} v${skill.version}) by ${skill.author}\n${skill.description}\nTags: ${skill.tags.join(', ')}  ~${skill.tokens} tokens\nSource: ${skill.source_url}\n\n${skill.body}`);
	}

	if (sub === 'import' || sub === 'installed') {
		const agent = flags.agent;
		if (typeof agent !== 'string' || !UUID_RE.test(agent)) {
			return { code: 2, output: `--agent <agent-id> is required (a uuid; list yours with GET ${origin}/api/agents).\n\n${SKILLS_USAGE}` };
		}
		const headers = await authHeaders(env);
		const base = `${origin}/api/agents/${agent}/custom-skills`;
		if (sub === 'installed') {
			const { data } = await requestJson(base, { headers });
			return done(data, formatInstalled(data));
		}
		if (!args[0]) return { code: 2, output: SKILLS_USAGE };
		try {
			const { data } = await requestJson(base, {
				method: 'POST',
				headers,
				json: { source: 'community', slug: args[0], enabled: !flags.disabled },
			});
			const { skill, budget } = data;
			const state = skill.injected
				? 'active in the agent\'s next reply'
				: skill.skip_reason === 'over_budget'
					? `saved but NOT injected: it does not fit the ${budget.cap_tokens}-token budget. Disable another skill to make room.`
					: 'saved, disabled';
			return done(data, `Imported ${skill.name} (${skill.slug}) onto ${agent}: ${state}.\nBudget: ${budget.used_tokens} / ${budget.cap_tokens} tokens.\nManage: ${origin}/skills/community?agent=${agent}`);
		} catch (err) {
			if (err instanceof ApiError && err.code === 'already_installed') {
				return { code: 1, output: `${args[0]} is already installed on this agent (skill ${err.body?.skill_id}). Manage it at ${origin}/skills/community?agent=${agent}` };
			}
			throw err;
		}
	}

	return { code: 2, output: `Unknown skills subcommand "${sub}".\n\n${SKILLS_USAGE}` };
}
