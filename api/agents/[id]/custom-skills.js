/**
 * Prompt-only custom skills on one agent.
 *
 * Routes (vercel.json rewrites map /api/agents/:id/custom-skills → this file):
 *   GET    /api/agents/:id/custom-skills             every skill + the token budget
 *   POST   /api/agents/:id/custom-skills             create { name, content, ... }
 *                                                    or import { source: 'community', slug }
 *   GET    /api/agents/:id/custom-skills/:skillId    one skill + where it lands in the budget
 *   PATCH  /api/agents/:id/custom-skills/:skillId    edit fields, toggle { enabled },
 *                                                    or { resync: true } to pull the
 *                                                    latest registry revision
 *   DELETE /api/agents/:id/custom-skills/:skillId    remove permanently
 *
 * Every route is owner-only: a skill's text is part of the agent's prompt,
 * which is private IP exactly like persona_prompt. Browsers authenticate with
 * the session cookie (mutations carry CSRF); the CLI and MCP clients use a
 * bearer API key or OAuth token, which needs agents:read / agents:write.
 * Injection order and the budget live in api/_lib/agent-custom-skills.js.
 */

import { getRequestUser, hasScope } from '../../_lib/auth.js';
import { cors, json, wrap, error, readJson, rateLimited } from '../../_lib/http.js';
import { limits, clientIp } from '../../_lib/rate-limit.js';
import { requireCsrf } from '../../_lib/csrf.js';
import { isUuid } from '../../_lib/validate.js';
import {
	CustomSkillError,
	createSchema,
	importSchema,
	patchSchema,
	requireOwnedAgent,
	listSkills,
	getSkill,
	createSkill,
	importCommunitySkill,
	updateSkill,
	deleteSkill,
	presentSkill,
} from '../../_lib/agent-custom-skills.js';

export default wrap(async (req, res) => {
	if (cors(req, res, { methods: 'GET,POST,PATCH,DELETE,OPTIONS', credentials: true })) return;

	const url = new URL(req.url, 'http://x');
	const parts = url.pathname.split('/').filter(Boolean);
	const agentId = url.searchParams.get('id') || parts[2] || null;
	const skillId = url.searchParams.get('skill_id') || parts[4] || null;

	if (!agentId || !isUuid(agentId)) return error(res, 400, 'validation_error', 'valid agent id required');

	const write = req.method !== 'GET';
	const user = await getRequestUser(req, res);
	if (!user) return error(res, 401, 'unauthorized', 'sign in or send a bearer token');
	if (user.source === 'bearer' && !hasScope(user.scope, write ? 'agents:write' : 'agents:read')) {
		return error(res, 403, 'insufficient_scope', `this token needs ${write ? 'agents:write' : 'agents:read'}`);
	}

	if (write) {
		const rl = await limits.authIp(clientIp(req));
		if (!rl.success) return rateLimited(res, rl);
		if (!(await requireCsrf(req, res, user.id))) return;
	}

	try {
		await requireOwnedAgent(agentId, user.id);

		if (req.method === 'GET' && !skillId) return json(res, 200, { data: await listSkills(agentId) });
		if (req.method === 'GET') return json(res, 200, { data: await getSkill(agentId, skillId) });
		if (req.method === 'POST' && !skillId) return await handleCreate(req, res, agentId, user.id);
		if (req.method === 'PATCH' && skillId) return await handlePatch(req, res, agentId, skillId);
		if (req.method === 'DELETE' && skillId) {
			const removed = await deleteSkill(agentId, skillId);
			return json(res, 200, { data: { deleted: true, id: removed.id, slug: removed.slug, ...(await listSkills(agentId)) } });
		}
		return error(res, 405, 'method_not_allowed', 'method not allowed');
	} catch (err) {
		if (err instanceof CustomSkillError) return error(res, err.status, err.code, err.message, err.extra);
		throw err;
	}
});

async function handleCreate(req, res, agentId, userId) {
	const body = await readJson(req);
	const isImport = body && body.source === 'community';
	const parsed = (isImport ? importSchema : createSchema).safeParse(body);
	if (!parsed.success) {
		return error(res, 400, 'validation_error', parsed.error.issues.map((i) => `${i.path.join('.') || 'body'}: ${i.message}`).join('; '));
	}
	const row = isImport
		? await importCommunitySkill(agentId, userId, parsed.data)
		: await createSkill(agentId, userId, parsed.data);
	const { skills, budget } = await listSkills(agentId);
	const skill = skills.find((s) => s.id === row.id) || presentSkill(row);
	return json(res, 201, { data: { skill, budget } });
}

async function handlePatch(req, res, agentId, skillId) {
	const parsed = patchSchema.safeParse(await readJson(req));
	if (!parsed.success) {
		return error(res, 400, 'validation_error', parsed.error.issues.map((i) => `${i.path.join('.') || 'body'}: ${i.message}`).join('; '));
	}
	const row = await updateSkill(agentId, skillId, parsed.data);
	const { skills, budget } = await listSkills(agentId);
	const skill = skills.find((s) => s.id === row.id) || presentSkill(row);
	return json(res, 200, { data: { skill, budget } });
}
