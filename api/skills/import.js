/**
 * POST /api/skills/import { url }: turn an OpenAPI spec or a GitHub repo URL
 * into a skill bundle (packages/skill-import) and save it as a draft.
 * GET  /api/skills/import: list the caller's own drafts.
 *
 * A draft is never enabled automatically: `enabled` starts false
 * (api/_lib/openapi-skill-imports.js createDraft) and stays false until an
 * explicit PATCH at /api/skills/import/[id]. This is a different feature from
 * api/skill-imports.js (prompt-only SKILL.md import with a scan/approve flow
 * into agent_custom_skills): this one generates an executable bundle
 * (manifest.json/tools.json/handlers.js) served at
 * /api/skills/import/[id]/[...file].js for src/skills/index.js's
 * SkillRegistry to install.
 *
 * Owner-only: the fetched URL and the generated bundle can embed anything the
 * upstream host chose to write, so nothing here runs with elevated trust and
 * the fetch itself goes through the SSRF guard, pinned-IP variant, since the
 * response is forwarded into generated code.
 */

import { getRequestUser, hasScope } from '../_lib/auth.js';
import { cors, json, wrap, error, readJson } from '../_lib/http.js';
import { limits, clientIp } from '../_lib/rate-limit.js';
import { requireCsrf } from '../_lib/csrf.js';
import { fetchSafePublicUrlPinned, SsrfBlockedError } from '../_lib/ssrf-guard.js';
import { importFromUrl, OpenApiParseError, GithubDiscoveryError, SkillBundleValidationError } from '@three-ws/skill-import';
import { createDraft, listDrafts, OpenApiSkillImportError } from '../_lib/openapi-skill-imports.js';

const MAX_SPEC_BYTES = 4 * 1024 * 1024;

async function guardedFetch(url, init = {}) {
	return fetchSafePublicUrlPinned(url, init, { maxBytes: MAX_SPEC_BYTES });
}

export default wrap(async (req, res) => {
	if (cors(req, res, { methods: 'GET,POST,OPTIONS', credentials: true })) return;

	const user = await getRequestUser(req, res);
	if (!user) return error(res, 401, 'unauthorized', 'sign in or send a bearer token');
	const write = req.method !== 'GET';
	if (user.source === 'bearer' && !hasScope(user.scope, write ? 'agents:write' : 'agents:read')) {
		return error(res, 403, 'insufficient_scope', `this token needs ${write ? 'agents:write' : 'agents:read'}`);
	}

	if (req.method === 'GET') {
		return json(res, 200, { data: await listDrafts(user.id) });
	}

	if (req.method !== 'POST') return error(res, 405, 'method_not_allowed', 'method not allowed');

	const rl = await limits.openapiSkillImportUser(user.id);
	if (!rl.success) return error(res, 429, 'rate_limited', 'too many imports, try again shortly');
	if (!(await requireCsrf(req, res, user.id))) return;

	const body = await readJson(req);
	const url = typeof body?.url === 'string' ? body.url.trim() : '';
	if (!url) return error(res, 400, 'validation_error', 'url is required');

	try {
		const bundle = await importFromUrl(url, {
			fetchUrl: guardedFetch,
			githubToken: process.env.GITHUB_TOKEN || process.env.GH_TOKEN || undefined,
		});
		const draft = await createDraft(user.id, bundle);
		return json(res, 201, { data: draft });
	} catch (err) {
		if (err instanceof SsrfBlockedError) return error(res, 400, 'url_blocked', err.message);
		if (err instanceof OpenApiParseError) return error(res, 400, 'spec_parse_error', err.message);
		if (err instanceof GithubDiscoveryError) return error(res, 400, 'github_error', err.message);
		if (err instanceof SkillBundleValidationError) return error(res, 400, 'invalid_bundle', err.message);
		if (err instanceof OpenApiSkillImportError) return error(res, err.status, err.code, err.message);
		throw err;
	}
});
