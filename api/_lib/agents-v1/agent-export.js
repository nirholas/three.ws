// Portable agent config: GET /api/v1/agents/:id/export and POST /api/v1/agents/import.
//
// An export is everything that defines how an agent behaves, and nothing that
// identifies or funds it: settings, skills, custom skills and automations, but
// no wallet addresses, keys, balances, memory, message history or run logs. The
// document can be checked into a repo, diffed, and imported to make a copy on
// any three.ws account.
//
// Import goes through createAgent and createAutomation, the same validators a
// hand-written POST uses. An automation that spends from the wallet (swap or
// transfer) is created only when the import carries `confirm: true` and the
// caller holds wallet:write; otherwise it is skipped and listed in `skipped`,
// so a copied config never authorizes spending on its own.

import { sql } from '../db.js';
import { env } from '../env.js';
import { apiError } from './http.js';
import { createAgent, loadOwnedAgent, serializeAgent, updateAgent } from './agents.js';
import { createAutomation, getAutomation, updateAutomation } from './automations.js';
import { CustomSkillError, createSchema, createSkill, importCommunitySkill, listSkills } from '../agent-custom-skills.js';

export const EXPORT_FORMAT = 'three.ws/agent';
export const EXPORT_VERSION = 1;
const SPEND_ACTIONS = new Set(['swap', 'transfer']);
const MAX_IMPORT_AUTOMATIONS = 25;
const MAX_IMPORT_SKILLS = 50;

function exportSkill(s) {
	if (s.source === 'community' && s.source_slug) return { source: 'community', slug: s.source_slug, enabled: s.enabled };
	return {
		source: 'custom',
		name: s.name,
		description: s.description || '',
		content: s.content,
		tags: s.tags || [],
		version: s.version || '1.0.0',
		enabled: s.enabled,
	};
}

/** The portable document for one owned agent row. */
export async function exportAgent(agent) {
	const a = serializeAgent(agent);
	const [automations, { skills }] = await Promise.all([
		sql`SELECT id, title, trigger_config, action_config, trigger_once, enabled, intent_id FROM agent_automations WHERE agent_id = ${agent.id} ORDER BY created_at ASC`,
		listSkills(agent.id),
	]);
	// Spend limits live on the backing wallet intent; read them so a re-import
	// keeps the same ceilings instead of falling back to defaults.
	const spendLimits = new Map();
	for (const r of automations.filter((x) => x.intent_id)) {
		const full = await getAutomation(agent.user_id, r.id).catch(() => null);
		if (full?.limits && Object.keys(full.limits).length) spendLimits.set(r.id, full.limits);
	}
	return {
		format: EXPORT_FORMAT,
		version: EXPORT_VERSION,
		exportedAt: new Date().toISOString(),
		source: { origin: env.APP_ORIGIN, agentId: agent.id },
		agent: {
			name: a.name,
			persona: a.persona,
			systemPrompt: a.systemPrompt,
			model: a.model,
			temperature: a.temperature,
			strategy: a.strategy,
			skills: a.skills,
			inferenceBudget: a.inferenceBudget ? { daily: a.inferenceBudget.daily, monthly: a.inferenceBudget.monthly } : null,
		},
		automations: automations.map((r) => ({
			title: r.title,
			trigger: r.trigger_config,
			action: r.action_config,
			triggerOnce: r.trigger_once,
			enabled: r.enabled,
			...(spendLimits.has(r.id) ? { limits: spendLimits.get(r.id) } : {}),
		})),
		customSkills: skills.map(exportSkill),
	};
}

function readDocument(body) {
	const doc = body?.document ?? body;
	if (!doc || typeof doc !== 'object' || doc.format !== EXPORT_FORMAT) {
		throw apiError(400, 'invalid_document', `Send an export document (format "${EXPORT_FORMAT}") as the body or as { document }.`);
	}
	if (doc.version !== EXPORT_VERSION) {
		throw apiError(400, 'unsupported_version', `This server reads export version ${EXPORT_VERSION}; the document is version ${doc.version}.`);
	}
	if (!doc.agent || typeof doc.agent !== 'object') throw apiError(400, 'invalid_document', 'The document has no agent block.');
	const automations = Array.isArray(doc.automations) ? doc.automations : [];
	const customSkills = Array.isArray(doc.customSkills) ? doc.customSkills : [];
	if (automations.length > MAX_IMPORT_AUTOMATIONS) throw apiError(400, 'invalid_document', `At most ${MAX_IMPORT_AUTOMATIONS} automations per import.`);
	if (customSkills.length > MAX_IMPORT_SKILLS) throw apiError(400, 'invalid_document', `At most ${MAX_IMPORT_SKILLS} custom skills per import.`);
	return { agent: doc.agent, automations, customSkills };
}

async function importSkill(agentId, userId, s) {
	if (s?.source === 'community') return importCommunitySkill(agentId, userId, { slug: String(s.slug || ''), enabled: s.enabled !== false });
	const parsed = createSchema.safeParse(s || {});
	if (!parsed.success) throw new CustomSkillError(400, 'validation_error', parsed.error.issues[0]?.message || 'invalid custom skill');
	return createSkill(agentId, userId, parsed.data);
}

/**
 * Create a new agent from an export document.
 * @param {string} userId
 * @param {object} body          the document, or { document, name?, confirm? }
 * @param {{ canSpend: boolean }} o  whether the caller holds wallet:write
 */
export async function importAgent(userId, body, { canSpend }) {
	const doc = readDocument(body);
	const allowSpend = body?.confirm === true && canSpend;
	const settings = {
		name: typeof body?.name === 'string' && body.name.trim() ? body.name : doc.agent.name,
		persona: doc.agent.persona,
		systemPrompt: doc.agent.systemPrompt,
		model: doc.agent.model,
		temperature: doc.agent.temperature,
		skills: doc.agent.skills,
	};
	// A strategy preset would install its own default automations on top of the
	// exported ones; the export already lists them, so the preset id is restored
	// after creation rather than passed to createAgent.
	const { agent } = await createAgent(userId, settings);
	if (doc.agent.strategy || doc.agent.inferenceBudget) {
		const row = await loadOwnedAgent(agent.id, userId);
		const patch = {};
		if (doc.agent.strategy) patch.strategy = doc.agent.strategy;
		if (doc.agent.inferenceBudget) patch.inferenceBudget = doc.agent.inferenceBudget;
		Object.assign(agent, await updateAgent(row, patch));
	}

	const [row] = await sql`SELECT * FROM agent_identities WHERE id = ${agent.id}`;
	const automations = [];
	const skipped = [];
	for (const [i, a] of doc.automations.entries()) {
		const spend = SPEND_ACTIONS.has(a?.action?.type);
		if (spend && !allowSpend) {
			skipped.push({ kind: 'automation', index: i, title: a?.title ?? null, reason: canSpend ? 'confirmation_required' : 'insufficient_scope' });
			continue;
		}
		try {
			const { enabled, ...spec } = a;
			let made = await createAutomation({ agent: row, userId, body: { ...spec, confirm: spend ? true : undefined }, source: 'import' });
			if (enabled === false) made = await updateAutomation({ userId, id: made.id, body: { enabled: false } });
			automations.push(made);
		} catch (err) {
			skipped.push({ kind: 'automation', index: i, title: a?.title ?? null, reason: err?.code || 'invalid', message: err?.message || null });
		}
	}
	const customSkills = [];
	for (const [i, s] of doc.customSkills.entries()) {
		try {
			customSkills.push(await importSkill(agent.id, userId, s));
		} catch (err) {
			skipped.push({ kind: 'custom_skill', index: i, name: s?.name || s?.slug || null, reason: err?.code || 'invalid', message: err?.message || null });
		}
	}
	return { agent, automations, customSkills: customSkills.map((s) => ({ id: s.id, slug: s.slug, name: s.name, source: s.source })), skipped };
}
