// v1 skills routes: the built-in skill catalog, the community registry, and an
// agent's custom skills (prompt-level instructions injected into its system
// prompt under a token budget).
//
//   GET    /skills                                   built-in skill ids for agent.skills[]
//   GET    /skills/community                         public community registry search
//   GET    /skills/community/:slug                   one registry skill with its SKILL.md
//   GET    /agents/:id/skills/custom                 the agent's custom skills + budget
//   POST   /agents/:id/skills/custom                 write a new custom skill
//   POST   /agents/:id/skills/custom/import          install a community skill by slug
//   GET    /agents/:id/skills/custom/:skillId        one custom skill
//   PATCH  /agents/:id/skills/custom/:skillId        edit, enable/disable, or { resync: true }
//   DELETE /agents/:id/skills/custom/:skillId        remove it
//
// Custom skills live in agent_custom_skills and are owned by
// api/_lib/agent-custom-skills.js; these routes are a v1 face over that store,
// the same one /api/agents/:id/custom-skills and the MCP tools use.

import { apiError, created, requireUuid, strParam, intParam } from '../http.js';
import { CORE_SKILLS, OPTIONAL_SKILLS } from '../../../../src/studio/skills/skills-catalog.js';
import { searchCommunitySkills, getCommunitySkill } from '../../community-skills.js';
import {
	CustomSkillError,
	createSchema,
	patchSchema,
	requireOwnedAgent,
	listSkills,
	getSkill,
	createSkill,
	importCommunitySkill,
	updateSkill,
	deleteSkill,
	presentSkill,
} from '../../agent-custom-skills.js';

/** Map the store's errors (and zod failures) onto the v1 envelope. */
async function guard(fn) {
	try {
		return await fn();
	} catch (err) {
		if (err instanceof CustomSkillError) {
			throw apiError(err.status, err.code === 'validation_error' ? 'invalid_parameter' : err.code, err.message, Object.keys(err.extra || {}).length ? err.extra : null);
		}
		throw err;
	}
}

function parse(schema, body) {
	const r = schema.safeParse(body);
	if (!r.success) {
		const issues = r.error.issues.map((i) => ({ path: i.path, message: i.message }));
		throw apiError(400, 'invalid_parameter', issues[0]?.message || 'Invalid request body.', {
			parameter: issues[0]?.path?.join('.') || null,
			fields: issues,
		});
	}
	return r.data;
}

function shapeSkill(s) {
	return {
		id: s.id,
		agentId: s.agent_id,
		slug: s.slug,
		name: s.name,
		description: s.description,
		author: s.author ?? null,
		tags: s.tags || [],
		version: s.version,
		content: s.content,
		source: s.source,
		sourceSlug: s.source_slug ?? null,
		sourceVersion: s.source_version ?? null,
		enabled: s.enabled,
		tokens: s.tokens ?? null,
		injected: s.injected ?? null,
		skipReason: s.skip_reason ?? null,
		registry: s.registry
			? {
					slug: s.registry.slug,
					latestVersion: s.registry.latest_version ?? null,
					updateAvailable: Boolean(s.registry.update_available),
					removed: Boolean(s.registry.removed),
				}
			: null,
		installedAt: s.installed_at,
		updatedAt: s.updated_at,
	};
}

function shapeBudget(b) {
	return {
		capTokens: b.cap_tokens,
		usedTokens: b.used_tokens,
		enabledTokens: b.enabled_tokens,
		remainingTokens: b.remaining_tokens,
		injectedCount: b.injected_count,
		skippedOverBudget: b.skipped_over_budget,
	};
}

/** The agent's custom skills with the injection plan applied. */
async function listing(agentId) {
	const { skills, budget } = await listSkills(agentId);
	return { skills: skills.map(shapeSkill), budget: shapeBudget(budget) };
}

/** One skill as planned against the budget, after a write. */
async function planned(agentId, row) {
	const { skills, budget } = await listSkills(agentId);
	const s = skills.find((x) => x.id === row.id) || presentSkill(row);
	return { skill: shapeSkill(s), budget: shapeBudget(budget) };
}

function shapeCommunity(s, { full = false } = {}) {
	const out = {
		slug: s.slug,
		name: s.name,
		description: s.description,
		author: s.author ?? null,
		tags: s.tags || [],
		version: s.version,
		sha256: s.sha256 ?? null,
		page: `/skills/community?skill=${s.slug}`,
	};
	if (full) out.content = s.body;
	return out;
}

export const ROUTES = [
	{
		method: 'GET',
		path: '/skills',
		name: 'v1.skills.list',
		auth: 'public',
		summary: "Built-in skill ids an agent's skills[] accepts. Core skills are always on; optional ones are toggled per agent.",
		handler: () => ({
			skills: [
				...CORE_SKILLS.map((s) => ({ id: s.id, name: s.name, description: s.desc, kind: 'core', sellable: false })),
				...OPTIONAL_SKILLS.map((s) => ({
					id: s.id,
					name: s.name,
					description: s.desc,
					kind: 'optional',
					sellable: s.sellable !== false,
				})),
			],
		}),
	},
	{
		method: 'GET',
		path: '/skills/community',
		name: 'v1.skills.community.list',
		auth: 'public',
		summary: 'Search the public community skills registry.',
		params: { q: 'free-text search', tag: 'filter by tag', author: 'filter by author', limit: '1-100, default 50' },
		handler: ({ query }) => {
			const limit = intParam(query.limit, { name: 'limit', min: 1, max: 100, fallback: 50 });
			const result = searchCommunitySkills({
				q: strParam(query.q, { name: 'q', max: 120 }) || '',
				tag: strParam(query.tag, { name: 'tag', max: 32 }) || '',
				author: strParam(query.author, { name: 'author', max: 64 }) || '',
				limit,
			});
			return {
				skills: result.skills.map((s) => shapeCommunity(s)),
				count: result.count,
				total: result.total,
				tags: result.tags,
			};
		},
	},
	{
		method: 'GET',
		path: '/skills/community/:slug',
		name: 'v1.skills.community.get',
		auth: 'public',
		summary: 'One community registry skill, including its SKILL.md body.',
		handler: ({ params }) => {
			const s = getCommunitySkill(params.slug);
			if (!s) throw apiError(404, 'not_found', `No community skill "${params.slug}".`);
			return { skill: shapeCommunity(s, { full: true }) };
		},
	},
	{
		method: 'GET',
		path: '/agents/:id/skills/custom',
		name: 'v1.agents.skills.custom.list',
		auth: 'required',
		scope: 'agents:read',
		summary: "The agent's custom skills and how much of the prompt budget they use.",
		handler: ({ params, principal }) =>
			guard(async () => {
				const id = requireUuid(params.id, 'agent');
				await requireOwnedAgent(id, principal.userId);
				return listing(id);
			}),
	},
	{
		method: 'POST',
		path: '/agents/:id/skills/custom',
		name: 'v1.agents.skills.custom.create',
		auth: 'required',
		scope: 'agents:write',
		summary: 'Write a custom skill: instructions injected into the agent\'s system prompt.',
		params: {
			name: '2-80 chars (required)',
			content: 'the instructions, markdown (required)',
			description: 'up to 400 chars',
			slug: 'kebab-case id, derived from name when omitted',
			tags: 'up to 8 kebab-case tags',
			version: 'semver, default 1.0.0',
			enabled: 'default true',
		},
		handler: ({ params, principal, body }) =>
			guard(async () => {
				const id = requireUuid(params.id, 'agent');
				await requireOwnedAgent(id, principal.userId);
				const input = parse(createSchema, body);
				const row = await createSkill(id, principal.userId, input);
				return created(await planned(id, row));
			}),
	},
	{
		method: 'POST',
		path: '/agents/:id/skills/custom/import',
		name: 'v1.agents.skills.custom.import',
		auth: 'required',
		scope: 'agents:write',
		summary: 'Install a community registry skill on the agent as an editable custom skill.',
		params: { slug: 'registry slug (required)', enabled: 'default true' },
		handler: ({ params, principal, body }) =>
			guard(async () => {
				const id = requireUuid(params.id, 'agent');
				await requireOwnedAgent(id, principal.userId);
				const slug = strParam(body.slug, { name: 'slug', max: 64, required: true });
				if (body.enabled !== undefined && typeof body.enabled !== 'boolean') {
					throw apiError(400, 'invalid_parameter', 'enabled must be a boolean.', { parameter: 'enabled' });
				}
				const row = await importCommunitySkill(id, principal.userId, { slug, enabled: body.enabled ?? true });
				return created(await planned(id, row));
			}),
	},
	{
		method: 'GET',
		path: '/agents/:id/skills/custom/:skillId',
		name: 'v1.agents.skills.custom.get',
		auth: 'required',
		scope: 'agents:read',
		summary: 'One custom skill and where it lands in the prompt budget.',
		handler: ({ params, principal }) =>
			guard(async () => {
				const id = requireUuid(params.id, 'agent');
				const skillId = requireUuid(params.skillId, 'custom skill');
				await requireOwnedAgent(id, principal.userId);
				const { skill, budget } = await getSkill(id, skillId);
				return { skill: shapeSkill(skill), budget: shapeBudget(budget) };
			}),
	},
	{
		method: 'PATCH',
		path: '/agents/:id/skills/custom/:skillId',
		name: 'v1.agents.skills.custom.update',
		auth: 'required',
		scope: 'agents:write',
		summary: 'Edit a custom skill, toggle it, or { resync: true } to pull the latest registry version of an import.',
		handler: ({ params, principal, body }) =>
			guard(async () => {
				const id = requireUuid(params.id, 'agent');
				const skillId = requireUuid(params.skillId, 'custom skill');
				await requireOwnedAgent(id, principal.userId);
				const patch = parse(patchSchema, body);
				const row = await updateSkill(id, skillId, patch);
				return planned(id, row);
			}),
	},
	{
		method: 'DELETE',
		path: '/agents/:id/skills/custom/:skillId',
		name: 'v1.agents.skills.custom.delete',
		auth: 'required',
		scope: 'agents:write',
		summary: 'Permanently remove a custom skill from the agent.',
		handler: ({ params, principal }) =>
			guard(async () => {
				const id = requireUuid(params.id, 'agent');
				const skillId = requireUuid(params.skillId, 'custom skill');
				await requireOwnedAgent(id, principal.userId);
				const row = await deleteSkill(id, skillId);
				return { deleted: true, id: row.id, slug: row.slug, ...(await listing(id)) };
			}),
	},
];
