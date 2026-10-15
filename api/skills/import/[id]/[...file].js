// GET /api/skills/import/<id>/<manifest.json|SKILL.md|tools.json|handlers.js>
//
// Serves one generated skill bundle (api/_lib/openapi-skill-imports.js) over
// the exact four-file shape specs/SKILL_SPEC.md defines, so
// src/skills/index.js's SkillRegistry can `install({ uri: ".../<id>/" })` it
// like any other hosted bundle. Public and anonymous: whoever embeds the
// agent that installed this skill fetches it with no session, same as any
// other bundle host. The draft itself may still be disabled
// (openapi_skill_imports.enabled); that only gates whether an agent is
// allowed to install it, not whether these bytes can be read once the id is
// known, matching how every other hosted skill bundle in this codebase works.

import { cors, error, json, text, wrap } from '../../../_lib/http.js';
import { getPublicDraftRow, OpenApiSkillImportError } from '../../../_lib/openapi-skill-imports.js';

function joinPath(parts) {
	return Array.isArray(parts) ? parts.join('/') : String(parts || '');
}

export default wrap(async (req, res) => {
	if (cors(req, res, { origins: '*', methods: 'GET,OPTIONS', credentials: false })) return;
	if (req.method !== 'GET') return error(res, 405, 'method_not_allowed', 'method not allowed');

	const id = req.query?.id;
	const file = joinPath(req.query?.file);

	let row;
	try {
		row = await getPublicDraftRow(id);
	} catch (err) {
		if (err instanceof OpenApiSkillImportError) return error(res, err.status, err.code, err.message);
		throw err;
	}

	res.setHeader('cache-control', 'no-store');

	if (file === 'manifest.json') return json(res, 200, row.manifest);
	if (file === 'SKILL.md') return text(res, 200, row.skill_md, { 'content-type': 'text/markdown; charset=utf-8' });
	if (file === 'tools.json') {
		if (!row.tools) return error(res, 404, 'not_found', 'this skill is declarative-only and has no tools.json');
		return json(res, 200, row.tools);
	}
	// server/index.mjs strips a trailing ".js" from every API path before
	// routing (Vercel's extension-optional convention), so a request for
	// "handlers.js" arrives here as the bare segment "handlers".
	if (file === 'handlers.js' || file === 'handlers') {
		if (!row.handlers_src) return error(res, 404, 'not_found', 'this skill is declarative-only and has no handlers.js');
		return text(res, 200, row.handlers_src, { 'content-type': 'text/javascript; charset=utf-8' });
	}
	return error(res, 404, 'not_found', `unknown bundle file "${file}"`);
});
