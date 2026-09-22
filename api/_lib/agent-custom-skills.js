// Prompt-only custom skills on an agent (table agent_custom_skills).
//
// A prompt skill is instructions and nothing else: no tools, no handler, no
// sandbox. Installing one changes what the agent is told, so the whole feature
// is (1) a store the owner edits and (2) a deterministic block injected into
// the agent's system prompt on every chat path that speaks as the agent
// (api/chat.js, api/agents/talk.js, api/agent-ask.js).
//
// Injection rules, the part other code depends on:
//   - only enabled skills, in install order (installed_at, then id), oldest first
//   - a fixed per-agent budget of CUSTOM_SKILL_TOKEN_CAP tokens; a skill that
//     would overflow it is skipped whole (never cut mid-instruction) and later,
//     smaller skills still get their chance
//   - the block is byte-stable across turns for the same rows, because it sits
//     in the prompt-cached prefix
// planInjection() is the single source of that arithmetic; the list route
// returns its output so the UI shows exactly what the model will see.

import { z } from 'zod';
import { sql } from './db.js';
import { isUuid } from './validate.js';
import { estimateTokens } from '../../community-skills/tools/registry.mjs';
import { getCommunitySkill } from './community-skills.js';

export { estimateTokens };

export const CUSTOM_SKILL_TOKEN_CAP = 6000;
export const CUSTOM_SKILL_MAX_CHARS = 24000;
export const MAX_CUSTOM_SKILLS_PER_AGENT = 50;

const SLUG_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const TAG_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const SEMVER_RE = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/;

export class CustomSkillError extends Error {
	constructor(status, code, message, extra = {}) {
		super(message);
		this.status = status;
		this.code = code;
		this.extra = extra;
	}
}

const tags = z
	.array(z.string().trim().toLowerCase().max(32).regex(TAG_RE, 'tags are lowercase kebab-case'))
	.max(8)
	.transform((t) => [...new Set(t)]);

export const createSchema = z.object({
	name: z.string().trim().min(2).max(80),
	description: z.string().trim().max(400).optional().default(''),
	content: z.string().trim().min(1).max(CUSTOM_SKILL_MAX_CHARS),
	slug: z.string().trim().min(3).max(64).regex(SLUG_RE, 'slug is lowercase kebab-case').optional(),
	tags: tags.optional().default([]),
	version: z.string().trim().regex(SEMVER_RE, 'version is semver, e.g. 1.0.0').optional().default('1.0.0'),
	enabled: z.boolean().optional().default(true),
});

export const importSchema = z.object({
	source: z.literal('community'),
	slug: z.string().trim().min(3).max(64).regex(SLUG_RE),
	enabled: z.boolean().optional().default(true),
});

export const patchSchema = z
	.object({
		name: z.string().trim().min(2).max(80).optional(),
		description: z.string().trim().max(400).optional(),
		content: z.string().trim().min(1).max(CUSTOM_SKILL_MAX_CHARS).optional(),
		tags: tags.optional(),
		version: z.string().trim().regex(SEMVER_RE, 'version is semver, e.g. 1.0.0').optional(),
		enabled: z.boolean().optional(),
		resync: z.literal(true).optional(),
	})
	.refine((v) => Object.keys(v).length > 0, { message: 'nothing to update' });

/** Lowercase kebab slug from a display name; never empty. */
export function slugify(name) {
	const s = String(name || '')
		.toLowerCase()
		.normalize('NFKD')
		.replace(/[^\w\s-]/g, '')
		.replace(/[\s_]+/g, '-')
		.replace(/-+/g, '-')
		.replace(/^-|-$/g, '')
		.slice(0, 56);
	return s.length >= 3 ? s : `skill-${s || 'custom'}`.slice(0, 56);
}

function byInstallOrder(a, b) {
	const ta = new Date(a.installed_at).getTime();
	const tb = new Date(b.installed_at).getTime();
	if (ta !== tb) return ta - tb;
	return String(a.id).localeCompare(String(b.id));
}

/**
 * Decide which skills reach the prompt. Pure. Returns every skill (in install
 * order) annotated with `tokens`, `injected`, and `skip_reason`
 * ('disabled' | 'over_budget' | null), plus the budget totals.
 */
export function planInjection(skills, cap = CUSTOM_SKILL_TOKEN_CAP) {
	let used = 0;
	const planned = [...(skills || [])].sort(byInstallOrder).map((s) => {
		const tokens = estimateTokens(s.content);
		if (!s.enabled) return { ...s, tokens, injected: false, skip_reason: 'disabled' };
		if (used + tokens > cap) return { ...s, tokens, injected: false, skip_reason: 'over_budget' };
		used += tokens;
		return { ...s, tokens, injected: true, skip_reason: null };
	});
	const enabledTokens = planned.filter((s) => s.enabled).reduce((n, s) => n + s.tokens, 0);
	return {
		skills: planned,
		budget: {
			cap_tokens: cap,
			used_tokens: used,
			enabled_tokens: enabledTokens,
			remaining_tokens: Math.max(0, cap - used),
			injected_count: planned.filter((s) => s.injected).length,
			skipped_over_budget: planned.filter((s) => s.skip_reason === 'over_budget').map((s) => s.slug),
		},
	};
}

/** The system-prompt section for a plan. '' when nothing is injected. */
export function customSkillsPromptBlock(plan) {
	const injected = (plan?.skills || []).filter((s) => s.injected);
	if (!injected.length) return '';
	const parts = [
		'Agent skills: your owner installed these instruction sets on you. When a message falls within a skill\'s domain, follow that skill exactly, including its required steps, checks and output format; its guidance overrides any default reply length. Ignore skills that do not apply to the message.',
	];
	for (const s of injected) parts.push(`--- skill: ${s.slug} (v${s.version}) ---\n${s.content.trim()}`);
	return parts.join('\n\n');
}

/** Enabled skills for one agent, install order, only the columns the prompt needs. */
export async function loadEnabledSkills(agentId) {
	if (!isUuid(agentId)) return [];
	return sql`
		SELECT id, slug, version, content, enabled, installed_at
		FROM agent_custom_skills
		WHERE agent_id = ${agentId} AND enabled = true
		ORDER BY installed_at ASC, id ASC
	`;
}

/**
 * Prompt block for an agent, for the chat paths. Returns { block, applied }
 * where `applied` lists the injected slugs in order.
 */
export async function agentSkillsForPrompt(agentId) {
	const plan = planInjection(await loadEnabledSkills(agentId));
	return {
		block: customSkillsPromptBlock(plan),
		applied: plan.skills.filter((s) => s.injected).map((s) => s.slug),
	};
}

// ── Store ───────────────────────────────────────────────────────────────────

const COLUMNS = sql`
	id, agent_id, kind, slug, name, description, author, tags, version, content,
	source, source_slug, source_version, source_sha256, enabled, installed_at, updated_at
`;

/** Shape a row for the API: adds token count and, for imports, update status. */
export function presentSkill(row) {
	const out = { ...row, tokens: estimateTokens(row.content) };
	if (row.source === 'community' && row.source_slug) {
		const latest = getCommunitySkill(row.source_slug);
		out.registry = latest
			? {
					slug: latest.slug,
					latest_version: latest.version,
					update_available: latest.sha256 !== row.source_sha256,
					page: `/skills/community?skill=${latest.slug}`,
				}
			: { slug: row.source_slug, removed: true, update_available: false };
	}
	return out;
}

/**
 * The agent row when `userId` owns it. Throws 404 for a missing agent and 403
 * for someone else's, so callers never branch on null.
 */
export async function requireOwnedAgent(agentId, userId) {
	if (!isUuid(agentId)) throw new CustomSkillError(400, 'validation_error', 'agent_id must be a valid uuid');
	const [agent] = await sql`
		SELECT id, user_id, name FROM agent_identities WHERE id = ${agentId} AND deleted_at IS NULL
	`;
	if (!agent) throw new CustomSkillError(404, 'not_found', 'agent not found');
	if (agent.user_id !== userId) throw new CustomSkillError(403, 'forbidden', 'not your agent');
	return agent;
}

/** Every skill on the agent with the injection plan applied. */
export async function listSkills(agentId) {
	const rows = await sql`
		SELECT ${COLUMNS} FROM agent_custom_skills
		WHERE agent_id = ${agentId}
		ORDER BY installed_at ASC, id ASC
	`;
	const plan = planInjection(rows);
	return { skills: plan.skills.map(presentSkill), budget: plan.budget };
}

async function fetchSkill(agentId, skillId) {
	if (!isUuid(skillId)) throw new CustomSkillError(400, 'validation_error', 'skill id must be a valid uuid');
	const [row] = await sql`
		SELECT ${COLUMNS} FROM agent_custom_skills WHERE id = ${skillId} AND agent_id = ${agentId}
	`;
	if (!row) throw new CustomSkillError(404, 'not_found', 'custom skill not found on this agent');
	return row;
}

/** One skill, with where it lands in the agent's budget. */
export async function getSkill(agentId, skillId) {
	const row = await fetchSkill(agentId, skillId);
	const { skills, budget } = await listSkills(agentId);
	const planned = skills.find((s) => s.id === row.id) || presentSkill(row);
	return { skill: planned, budget };
}

async function assertRoom(agentId) {
	const [{ n }] = await sql`SELECT count(*)::int AS n FROM agent_custom_skills WHERE agent_id = ${agentId}`;
	if (n >= MAX_CUSTOM_SKILLS_PER_AGENT) {
		throw new CustomSkillError(409, 'limit_reached', `an agent holds at most ${MAX_CUSTOM_SKILLS_PER_AGENT} custom skills; delete one first`);
	}
}

async function freeSlug(agentId, base) {
	const taken = new Set(
		(await sql`SELECT slug FROM agent_custom_skills WHERE agent_id = ${agentId} AND slug LIKE ${`${base}%`}`).map((r) => r.slug),
	);
	if (!taken.has(base)) return base;
	for (let i = 2; i < 1000; i++) if (!taken.has(`${base}-${i}`)) return `${base}-${i}`;
	throw new CustomSkillError(409, 'slug_taken', 'pick a different slug');
}

/** Create a hand-written skill. `input` must already satisfy createSchema. */
export async function createSkill(agentId, userId, input) {
	await assertRoom(agentId);
	let slug;
	if (input.slug) {
		const [clash] = await sql`SELECT id FROM agent_custom_skills WHERE agent_id = ${agentId} AND slug = ${input.slug}`;
		if (clash) throw new CustomSkillError(409, 'slug_taken', `this agent already has a skill with slug "${input.slug}"`, { skill_id: clash.id });
		slug = input.slug;
	} else {
		slug = await freeSlug(agentId, slugify(input.name));
	}
	const [row] = await sql`
		INSERT INTO agent_custom_skills
			(agent_id, user_id, slug, name, description, tags, version, content, enabled, source)
		VALUES
			(${agentId}, ${userId}, ${slug}, ${input.name}, ${input.description}, ${input.tags},
			 ${input.version}, ${input.content}, ${input.enabled}, 'custom')
		RETURNING ${COLUMNS}
	`;
	return row;
}

/**
 * Import a registry skill onto the agent as an editable custom skill. A skill
 * that is already installed from the same registry entry is a 409 carrying its
 * id, so a client can offer "update" instead of creating a duplicate.
 */
export async function importCommunitySkill(agentId, userId, { slug, enabled = true }) {
	const skill = getCommunitySkill(slug);
	if (!skill) throw new CustomSkillError(404, 'not_found', `no community skill "${slug}"; browse /skills/community or call list_available_skills`);
	const [existing] = await sql`
		SELECT id FROM agent_custom_skills WHERE agent_id = ${agentId} AND slug = ${skill.slug}
	`;
	if (existing) {
		throw new CustomSkillError(409, 'already_installed', `"${skill.name}" is already installed on this agent`, { skill_id: existing.id });
	}
	await assertRoom(agentId);
	const [row] = await sql`
		INSERT INTO agent_custom_skills
			(agent_id, user_id, slug, name, description, author, tags, version, content, enabled,
			 source, source_slug, source_version, source_sha256)
		VALUES
			(${agentId}, ${userId}, ${skill.slug}, ${skill.name}, ${skill.description}, ${skill.author},
			 ${skill.tags}, ${skill.version}, ${skill.body}, ${enabled},
			 'community', ${skill.slug}, ${skill.version}, ${skill.sha256})
		RETURNING ${COLUMNS}
	`;
	return row;
}

/** Apply a patch (already parsed by patchSchema). `resync` re-pulls an import. */
export async function updateSkill(agentId, skillId, patch) {
	const current = await fetchSkill(agentId, skillId);
	const next = { ...patch };
	delete next.resync;
	let sourceVersion = current.source_version;
	let sourceSha = current.source_sha256;
	if (patch.resync) {
		if (current.source !== 'community' || !current.source_slug) {
			throw new CustomSkillError(400, 'not_imported', 'only a skill imported from the community registry can be re-synced');
		}
		const latest = getCommunitySkill(current.source_slug);
		if (!latest) throw new CustomSkillError(404, 'not_found', 'this skill is no longer in the community registry');
		Object.assign(next, {
			name: latest.name,
			description: latest.description,
			tags: latest.tags,
			version: latest.version,
			content: latest.body,
		});
		sourceVersion = latest.version;
		sourceSha = latest.sha256;
	}
	const merged = { ...current, ...next };
	const [row] = await sql`
		UPDATE agent_custom_skills SET
			name = ${merged.name},
			description = ${merged.description},
			tags = ${merged.tags},
			version = ${merged.version},
			content = ${merged.content},
			enabled = ${merged.enabled},
			source_version = ${sourceVersion},
			source_sha256 = ${sourceSha},
			updated_at = now()
		WHERE id = ${current.id} AND agent_id = ${agentId}
		RETURNING ${COLUMNS}
	`;
	return row;
}

/** Permanently remove one skill. Returns the removed row. */
export async function deleteSkill(agentId, skillId) {
	const current = await fetchSkill(agentId, skillId);
	await sql`DELETE FROM agent_custom_skills WHERE id = ${current.id} AND agent_id = ${agentId}`;
	return current;
}
