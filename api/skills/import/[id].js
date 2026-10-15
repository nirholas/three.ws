/**
 * GET/PATCH/DELETE /api/skills/import/:id: manage one OpenAPI/repo skill
 * draft (api/_lib/openapi-skill-imports.js), owner-scoped.
 *
 * PATCH { enabled } is the only way a draft's `enabled` flag ever changes:
 * createDraft (api/skills/import.js) always hardcodes it false, so a draft
 * stays inert until its owner deliberately flips it here. Enabling does not
 * install the skill onto any agent; it only lets src/skills/index.js's
 * SkillRegistry accept the bundle when an agent's owner later installs it
 * by uri (the disabled check belongs to that install path, not this one).
 */

import { getRequestUser, hasScope } from '../../_lib/auth.js';
import { cors, json, wrap, error, readJson } from '../../_lib/http.js';
import { requireCsrf } from '../../_lib/csrf.js';
import { getDraft, setEnabled, deleteDraft, OpenApiSkillImportError } from '../../_lib/openapi-skill-imports.js';

export default wrap(async (req, res) => {
	if (cors(req, res, { methods: 'GET,PATCH,DELETE,OPTIONS', credentials: true })) return;

	const user = await getRequestUser(req, res);
	if (!user) return error(res, 401, 'unauthorized', 'sign in or send a bearer token');
	const write = req.method !== 'GET';
	if (user.source === 'bearer' && !hasScope(user.scope, write ? 'agents:write' : 'agents:read')) {
		return error(res, 403, 'insufficient_scope', `this token needs ${write ? 'agents:write' : 'agents:read'}`);
	}

	const id = req.query?.id;

	try {
		if (req.method === 'GET') return json(res, 200, { data: await getDraft(id, user.id) });

		if (req.method === 'PATCH') {
			if (!(await requireCsrf(req, res, user.id))) return;
			const body = await readJson(req);
			if (typeof body?.enabled !== 'boolean') return error(res, 400, 'validation_error', 'enabled (boolean) is required');
			return json(res, 200, { data: await setEnabled(id, user.id, body.enabled) });
		}

		if (req.method === 'DELETE') {
			if (!(await requireCsrf(req, res, user.id))) return;
			await deleteDraft(id, user.id);
			return json(res, 200, { data: { deleted: true, id } });
		}

		return error(res, 405, 'method_not_allowed', 'method not allowed');
	} catch (err) {
		if (err instanceof OpenApiSkillImportError) return error(res, err.status, err.code, err.message);
		throw err;
	}
});
