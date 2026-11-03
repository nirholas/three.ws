// Owner controls for the agent learning loop (the API behind /settings/memory).
//
//   GET    /api/memory/settings                       the account's memory switch, skill-draft switch, nudge cadence
//   PATCH  /api/memory/settings                       change any of them
//   GET    /api/memory/items?agent_id=&kind=&q=&before=   memories across the account's agents, newest first, with counts
//   DELETE /api/memory/items/:id                      forget one memory (irreversible)
//   GET    /api/memory/user-model                     the "about you" document, grouped by section
//   POST   /api/memory/user-model                     add a line { section, content }
//   PATCH  /api/memory/user-model/:id                 rewrite or move a line
//   DELETE /api/memory/user-model/:id                 remove a line
//   DELETE /api/memory/user-model?confirm=true        clear the whole document
//   GET    /api/memory/skills?agent_id=               skills the agent drafted from experience, drafts first
//   GET    /api/memory/skills/:id/versions?agent_id=  the skill's version history
//   PATCH  /api/memory/skills/:id                     owner edit { agent_id, name?, description?, content? }
//   POST   /api/memory/skills/:id/review              { agent_id, enable } enable or disable a draft
//   POST   /api/memory/skills/:id/rollback            { agent_id, version } restore a recorded version
//
// Auth: the browser session, or a bearer credential carrying `memory:write`
// (`memory:read` for GET). Every query is scoped to the caller's account, so
// another account's id answers 404, never its data. Mutations are CSRF-gated
// for cookie sessions; bearers are exempt (api/_lib/csrf.js).

import { z } from 'zod';
import { getRequestUser, requestUserHasScope } from '../_lib/auth.js';
import { requireCsrf } from '../_lib/csrf.js';
import { cors, error, json, method, readJson, wrap } from '../_lib/http.js';
import { LearningError } from '../_lib/agent-learning/errors.js';
import { getMemorySettings, settingsPatchSchema, updateMemorySettings } from '../_lib/agent-learning/settings.js';
import { forgetMemory, listMemories, memoryCounts } from '../_lib/agent-learning/memory.js';
import {
	SECTION_IDS,
	MAX_ENTRY_CHARS,
	addUserModelEntry,
	clearUserModel,
	deleteUserModelEntry,
	getUserModel,
	updateUserModelEntry,
} from '../_lib/agent-learning/user-model.js';
import {
	listLearnedSkills,
	listSkillVersions,
	ownerEditSkill,
	reviewLearnedSkill,
	rollbackSkill,
} from '../_lib/agent-learning/skill-drafts.js';

const uuid = z.string().uuid();

const userModelCreate = z
	.object({ section: z.enum(SECTION_IDS), content: z.string().trim().min(1).max(MAX_ENTRY_CHARS) })
	.strict();
const userModelPatch = z
	.object({ section: z.enum(SECTION_IDS).optional(), content: z.string().trim().min(1).max(MAX_ENTRY_CHARS).optional() })
	.strict()
	.refine((v) => v.section !== undefined || v.content !== undefined, { message: 'nothing to update' });
const skillEdit = z
	.object({
		agent_id: uuid,
		name: z.string().trim().min(2).max(80).optional(),
		description: z.string().trim().max(400).optional(),
		content: z.string().trim().min(1).max(24000).optional(),
	})
	.strict()
	.refine((v) => v.name !== undefined || v.description !== undefined || v.content !== undefined, { message: 'nothing to update' });
const skillReview = z.object({ agent_id: uuid, enable: z.boolean() }).strict();
const skillRollback = z.object({ agent_id: uuid, version: z.number().int().min(1) }).strict();

function fail(res, err) {
	// Someone else's agent answers exactly like one that does not exist.
	if (err instanceof LearningError && err.status === 403 && err.code === 'forbidden') {
		return error(res, 404, 'not_found', 'no such agent, skill or memory on your account');
	}
	if (err instanceof LearningError) return error(res, err.status, err.code, err.message, err.extra);
	throw err;
}

function parseBody(res, schema, body) {
	const parsed = schema.safeParse(body);
	if (!parsed.success) {
		const issue = parsed.error.issues[0];
		const where = issue?.path?.length ? `${issue.path.join('.')}: ` : '';
		error(res, 400, 'validation_error', `${where}${issue?.message || 'invalid body'}`);
		return null;
	}
	return parsed.data;
}

async function readBody(req, res) {
	try {
		return await readJson(req);
	} catch (err) {
		error(res, err.status || 400, err.status === 415 ? 'unsupported_media_type' : 'validation_error', err.message);
		return undefined;
	}
}

export default wrap(async (req, res) => {
	if (cors(req, res, { methods: 'GET,POST,PATCH,DELETE,OPTIONS', credentials: true })) return;
	if (!method(req, res, ['GET', 'POST', 'PATCH', 'DELETE'])) return;

	const url = new URL(req.url, 'http://x');
	const action = req.query?.action || url.searchParams.get('action');
	const id = req.query?.id || url.searchParams.get('id') || null;
	const q = (k) => url.searchParams.get(k);

	const user = await getRequestUser(req, res);
	if (!user) return error(res, 401, 'unauthorized', 'sign in required');
	const write = req.method !== 'GET';
	if (!requestUserHasScope(user, write ? 'memory:write' : 'memory:read')) {
		return error(res, 403, 'insufficient_scope', `this credential needs the ${write ? 'memory:write' : 'memory:read'} scope`);
	}
	if (write && !(await requireCsrf(req, res, user.id))) return;
	const userId = user.id;

	try {
		switch (action) {
			case 'settings': {
				if (!method(req, res, ['GET', 'PATCH'])) return;
				if (req.method === 'GET') return json(res, 200, { settings: await getMemorySettings(userId) }, { 'cache-control': 'no-store' });
				const body = await readBody(req, res);
				if (body === undefined) return;
				const patch = parseBody(res, settingsPatchSchema, body);
				if (!patch) return;
				return json(res, 200, { settings: await updateMemorySettings(userId, patch) });
			}

			case 'items': {
				if (!method(req, res, ['GET', 'DELETE'])) return;
				if (req.method === 'DELETE') {
					if (!id) return error(res, 400, 'validation_error', 'memory id required');
					const removed = await forgetMemory(userId, id);
					return json(res, 200, { forgotten: removed.id });
				}
				const page = await listMemories({
					userId,
					agentId: q('agent_id'),
					kind: q('kind'),
					q: q('q'),
					limit: q('limit'),
					before: q('before'),
				});
				const counts = q('before') ? undefined : await memoryCounts(userId);
				return json(res, 200, { ...page, ...(counts ? { counts } : {}) }, { 'cache-control': 'no-store' });
			}

			case 'user-model': {
				if (!method(req, res, ['GET', 'POST', 'PATCH', 'DELETE'])) return;
				if (req.method === 'GET') return json(res, 200, await getUserModel(userId), { 'cache-control': 'no-store' });
				if (req.method === 'DELETE') {
					if (id) return json(res, 200, { deleted: (await deleteUserModelEntry(userId, id)).id });
					if (q('confirm') !== 'true') {
						return error(res, 400, 'confirmation_required', 'clearing the whole user model needs confirm=true');
					}
					return json(res, 200, { cleared: await clearUserModel(userId) });
				}
				const body = await readBody(req, res);
				if (body === undefined) return;
				if (req.method === 'POST') {
					const data = parseBody(res, userModelCreate, body);
					if (!data) return;
					const { entry, reinforced } = await addUserModelEntry(userId, { ...data, source: 'owner', confidence: 1 });
					return json(res, reinforced ? 200 : 201, { entry, reinforced });
				}
				if (!id) return error(res, 400, 'validation_error', 'user-model entry id required');
				const data = parseBody(res, userModelPatch, body);
				if (!data) return;
				return json(res, 200, { entry: await updateUserModelEntry(userId, id, data) });
			}

			case 'skills': {
				const sub = url.searchParams.get('sub');
				if (!id) {
					if (!method(req, res, ['GET'])) return;
					const agentId = uuid.safeParse(q('agent_id'));
					if (!agentId.success) return error(res, 400, 'validation_error', 'agent_id (uuid) required');
					return json(res, 200, { skills: await listLearnedSkills({ agentId: agentId.data, userId }) }, { 'cache-control': 'no-store' });
				}
				if (!uuid.safeParse(id).success) return error(res, 400, 'validation_error', 'skill id must be a uuid');

				if (sub === 'versions') {
					if (!method(req, res, ['GET'])) return;
					const agentId = uuid.safeParse(q('agent_id'));
					if (!agentId.success) return error(res, 400, 'validation_error', 'agent_id (uuid) required');
					return json(res, 200, await listSkillVersions({ agentId: agentId.data, userId, skillId: id }), { 'cache-control': 'no-store' });
				}
				if (sub === 'review') {
					if (!method(req, res, ['POST'])) return;
					const body = await readBody(req, res);
					if (body === undefined) return;
					const data = parseBody(res, skillReview, body);
					if (!data) return;
					return json(res, 200, { skill: await reviewLearnedSkill({ agentId: data.agent_id, userId, skillId: id, enable: data.enable }) });
				}
				if (sub === 'rollback') {
					if (!method(req, res, ['POST'])) return;
					const body = await readBody(req, res);
					if (body === undefined) return;
					const data = parseBody(res, skillRollback, body);
					if (!data) return;
					return json(res, 200, await rollbackSkill({ agentId: data.agent_id, userId, skillId: id, versionNo: data.version }));
				}
				if (!method(req, res, ['PATCH'])) return;
				const body = await readBody(req, res);
				if (body === undefined) return;
				const data = parseBody(res, skillEdit, body);
				if (!data) return;
				return json(res, 200, await ownerEditSkill({ agentId: data.agent_id, userId, skillId: id, name: data.name, description: data.description, content: data.content }));
			}

			default:
				return error(res, 404, 'not_found', 'unknown memory route');
		}
	} catch (err) {
		return fail(res, err);
	}
});
