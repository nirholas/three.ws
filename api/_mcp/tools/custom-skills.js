// Prompt-only custom skills over MCP: manage the instruction sets installed on
// an agent, and browse and import from the community registry.
//
// Every write goes through api/_lib/agent-custom-skills.js, the same store the
// REST routes (/api/agents/:id/custom-skills) and /skills/community use, so an
// import from a model, the CLI or the browser lands identically.
//
// Tool policy (the shared tiers are defined by the MCP tool-policy brief):
// reads are `read`, create/update/import are `write` (reversible: edit or
// delete undoes them), and delete_custom_skill is `financial` because it is
// irreversible. It refuses without `confirm_delete: true`, and the refusal
// names get_custom_skill as the preview to show the user first. The policy is
// published per tool under `_meta['three.ws/policy']`.

import { limits } from '../../_lib/rate-limit.js';
import { getCommunitySkill, searchCommunitySkills } from '../../_lib/community-skills.js';
import {
	CustomSkillError,
	CUSTOM_SKILL_MAX_CHARS,
	CUSTOM_SKILL_TOKEN_CAP,
	createSchema,
	patchSchema,
	requireOwnedAgent,
	listSkills,
	getSkill,
	createSkill,
	importCommunitySkill,
	updateSkill,
	deleteSkill,
} from '../../_lib/agent-custom-skills.js';

const READ = { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false };
const WRITE = { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false };
const policy = (tier, extra = {}) => ({ 'three.ws/policy': { group: 'skills', tier, ...extra } });

function toolResult(structured, { isError = false } = {}) {
	return {
		content: [{ type: 'text', text: JSON.stringify(structured, null, 2) }],
		structuredContent: structured,
		...(isError ? { isError: true } : {}),
	};
}

function designedError(status, message, extra = {}) {
	return toolResult({ status, error: status, message, ...extra }, { isError: true });
}

function rpcError(code, message, data) {
	const e = new Error(message);
	e.code = code;
	e.data = data;
	return e;
}

// Account-scoped tools share one prologue: a signed-in owner, a rate limit,
// and ownership of the agent. Store errors come back as designed tool errors.
function ownerTool(fn) {
	return async (args, auth) => {
		if (!auth.userId) {
			return designedError(
				'sign_in_required',
				'Custom skills belong to an agent you own. Connect with your three.ws account (run `npx three-ws setup`, or OAuth in your client) and retry.',
			);
		}
		const rl = await limits.mcpUser(auth.userId);
		if (!rl.success) throw rpcError(-32000, 'rate_limited', { retry_after: Math.ceil((rl.reset - Date.now()) / 1000) });
		try {
			await requireOwnedAgent(args.agent_id, auth.userId);
			return await fn(args, auth);
		} catch (err) {
			if (err instanceof CustomSkillError) return designedError(err.code, err.message, err.extra);
			throw err;
		}
	};
}

function zodMessage(result) {
	return result.error.issues.map((i) => `${i.path.join('.') || 'input'}: ${i.message}`).join('; ');
}

const agentId = { type: 'string', format: 'uuid', description: 'Your agent id (uuid). list_agents or GET /api/agents lists them.' };
const skillId = { type: 'string', format: 'uuid', description: 'The custom skill id (uuid) from list_custom_skills.' };
const tagList = { type: 'array', items: { type: 'string' }, maxItems: 8, description: 'Up to 8 lowercase kebab-case tags.' };

export const toolDefs = [
	{
		name: 'list_available_skills',
		title: 'Browse community skills',
		annotations: READ,
		_meta: policy('read'),
		description:
			'Search the public three.ws community skills registry: prompt-only skills (a SKILL.md of instructions) anyone can contribute by pull request and import onto an agent in one call. Filter by free text, tag, or author. Each result carries slug, name, description, author, tags, version and an estimated token size. Import one with import_community_skill.',
		inputSchema: {
			type: 'object',
			properties: {
				q: { type: 'string', maxLength: 200, description: 'Free text matched against slug, name, description, tags and author.' },
				tag: { type: 'string', maxLength: 32, description: 'Exact tag, e.g. "risk" or "solana".' },
				author: { type: 'string', maxLength: 80, description: 'Exact author name.' },
				include_content: { type: 'boolean', default: false, description: 'Also return each SKILL.md body (larger response).' },
			},
			additionalProperties: false,
		},
		async handler(args) {
			const out = searchCommunitySkills({ q: args.q, tag: args.tag, author: args.author });
			const skills = out.skills.map((s) => (args.include_content ? { ...s, body: getCommunitySkill(s.slug)?.body || '' } : s));
			return toolResult({
				count: out.count,
				total: out.total,
				tags: out.tags,
				source: out.source,
				mirror: out.mirror,
				browse_url: 'https://three.ws/skills/community',
				skills,
			});
		},
	},
	{
		name: 'import_community_skill',
		title: 'Import a community skill onto an agent',
		annotations: WRITE,
		_meta: policy('write'),
		description:
			'Install a community registry skill (see list_available_skills) on one of your agents as an editable prompt-only custom skill. From the next message on, the agent follows the skill in every chat, within its per-agent token budget. Returns the new skill and the updated budget. Installing the same skill twice returns already_installed with the existing skill_id.',
		inputSchema: {
			type: 'object',
			properties: {
				slug: { type: 'string', minLength: 3, maxLength: 64, description: 'Registry slug, e.g. "risk-manager".' },
				agent_id: agentId,
				enabled: { type: 'boolean', default: true, description: 'Start enabled (injected into the prompt).' },
			},
			required: ['slug', 'agent_id'],
			additionalProperties: false,
		},
		scope: 'agents:write',
		handler: ownerTool(async (args, auth) => {
			const row = await importCommunitySkill(args.agent_id, auth.userId, { slug: args.slug, enabled: args.enabled !== false });
			const { skills, budget } = await listSkills(args.agent_id);
			return toolResult({ status: 'imported', skill: skills.find((s) => s.id === row.id), budget });
		}),
	},
	{
		name: 'list_custom_skills',
		title: 'List an agent\'s custom skills',
		annotations: READ,
		_meta: policy('read'),
		description:
			`List every prompt-only custom skill on one of your agents in install order, with each skill's token size, whether it is injected into the prompt right now (skip_reason: disabled | over_budget), and the agent's budget (cap ${CUSTOM_SKILL_TOKEN_CAP} tokens). Imported skills report whether the registry has a newer revision.`,
		inputSchema: {
			type: 'object',
			properties: { agent_id: agentId, include_content: { type: 'boolean', default: false, description: 'Return each skill\'s full text.' } },
			required: ['agent_id'],
			additionalProperties: false,
		},
		scope: 'agents:read',
		handler: ownerTool(async (args) => {
			const { skills, budget } = await listSkills(args.agent_id);
			return toolResult({
				agent_id: args.agent_id,
				budget,
				skills: args.include_content ? skills : skills.map(({ content: _c, ...rest }) => rest),
			});
		}),
	},
	{
		name: 'get_custom_skill',
		title: 'Get one custom skill',
		annotations: READ,
		_meta: policy('read'),
		description:
			'Read one custom skill on your agent, full text included, plus where it lands in the agent\'s token budget. Call this and show the user the skill before delete_custom_skill.',
		inputSchema: {
			type: 'object',
			properties: { agent_id: agentId, skill_id: skillId },
			required: ['agent_id', 'skill_id'],
			additionalProperties: false,
		},
		scope: 'agents:read',
		handler: ownerTool(async (args) => toolResult(await getSkill(args.agent_id, args.skill_id))),
	},
	{
		name: 'create_custom_skill',
		title: 'Write a custom skill for an agent',
		annotations: WRITE,
		_meta: policy('write'),
		description:
			`Write a new prompt-only skill on one of your agents: markdown instructions the agent follows whenever a message falls in the skill's domain. Up to ${CUSTOM_SKILL_MAX_CHARS} characters. Skills are injected oldest first inside a ${CUSTOM_SKILL_TOKEN_CAP}-token budget per agent; the response says whether this one fits.`,
		inputSchema: {
			type: 'object',
			properties: {
				agent_id: agentId,
				name: { type: 'string', minLength: 2, maxLength: 80 },
				content: { type: 'string', minLength: 1, maxLength: CUSTOM_SKILL_MAX_CHARS, description: 'The instructions, in markdown.' },
				description: { type: 'string', maxLength: 400 },
				slug: { type: 'string', minLength: 3, maxLength: 64, description: 'Optional; derived from name when omitted.' },
				tags: tagList,
				version: { type: 'string', description: 'Semver, default 1.0.0.' },
				enabled: { type: 'boolean', default: true },
			},
			required: ['agent_id', 'name', 'content'],
			additionalProperties: false,
		},
		scope: 'agents:write',
		handler: ownerTool(async (args, auth) => {
			const { agent_id: _a, ...fields } = args;
			const parsed = createSchema.safeParse(fields);
			if (!parsed.success) return designedError('validation_error', zodMessage(parsed));
			const row = await createSkill(args.agent_id, auth.userId, parsed.data);
			const { skills, budget } = await listSkills(args.agent_id);
			return toolResult({ status: 'created', skill: skills.find((s) => s.id === row.id), budget });
		}),
	},
	{
		name: 'update_custom_skill',
		title: 'Edit or toggle a custom skill',
		annotations: WRITE,
		_meta: policy('write'),
		description:
			'Edit a custom skill on your agent: rename it, rewrite its instructions, retag it, enable or disable it (a disabled skill stays saved but is not injected), or pass resync:true to pull the latest registry revision of an imported skill (overwrites local edits).',
		inputSchema: {
			type: 'object',
			properties: {
				agent_id: agentId,
				skill_id: skillId,
				name: { type: 'string', minLength: 2, maxLength: 80 },
				content: { type: 'string', minLength: 1, maxLength: CUSTOM_SKILL_MAX_CHARS },
				description: { type: 'string', maxLength: 400 },
				tags: tagList,
				version: { type: 'string' },
				enabled: { type: 'boolean' },
				resync: { type: 'boolean', description: 'true: replace with the latest community registry revision.' },
			},
			required: ['agent_id', 'skill_id'],
			additionalProperties: false,
		},
		scope: 'agents:write',
		handler: ownerTool(async (args) => {
			const { agent_id: _a, skill_id: _s, resync, ...fields } = args;
			const parsed = patchSchema.safeParse(resync ? { ...fields, resync: true } : fields);
			if (!parsed.success) return designedError('validation_error', zodMessage(parsed));
			const row = await updateSkill(args.agent_id, args.skill_id, parsed.data);
			const { skills, budget } = await listSkills(args.agent_id);
			return toolResult({ status: 'updated', skill: skills.find((s) => s.id === row.id), budget });
		}),
	},
	{
		name: 'delete_custom_skill',
		title: 'Delete a custom skill',
		annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: false },
		_meta: policy('financial', { confirmFlag: 'confirm_delete', previewTool: 'get_custom_skill' }),
		description:
			'Permanently delete a custom skill from your agent. Irreversible: a hand-written skill cannot be recovered. First call get_custom_skill, show the user the skill, and wait for a clear yes; then call this with confirm_delete: true. To stop a skill without losing it, use update_custom_skill with enabled:false instead.',
		inputSchema: {
			type: 'object',
			properties: {
				agent_id: agentId,
				skill_id: skillId,
				confirm_delete: { type: 'boolean', description: 'Must be true. Set only after the user confirmed.' },
			},
			required: ['agent_id', 'skill_id'],
			additionalProperties: false,
		},
		scope: 'agents:write',
		handler: ownerTool(async (args) => {
			if (args.confirm_delete !== true) {
				return designedError(
					'confirmation_required',
					'delete_custom_skill is irreversible. Call get_custom_skill first, show the user what will be deleted, and retry with confirm_delete: true once they confirm.',
					{ preview_tool: 'get_custom_skill', confirm_flag: 'confirm_delete' },
				);
			}
			const removed = await deleteSkill(args.agent_id, args.skill_id);
			const { budget } = await listSkills(args.agent_id);
			return toolResult({ status: 'deleted', skill_id: removed.id, slug: removed.slug, name: removed.name, budget });
		}),
	},
];
