/**
 * Suggested skills: procedures an agent followed to a verified success, kept as
 * draft skill bundles the owner approves (api/_lib/skill-candidates.js).
 *
 * Routes (vercel.json rewrites map these paths to this file):
 *   GET  /api/agents/:id/skill-candidates                       the owner's list (?status=draft|invalid|installed|dismissed)
 *   GET  /api/agents/:id/skill-candidates/:cid                  one candidate with its bundle, evidence and revisions
 *   POST /api/agents/:id/skill-candidates/:cid                  { action, revision_id? }
 *        action: accept (install on this agent only) | publish (marketplace) | dismiss |
 *                redraft (retry an invalid draft) | accept_revision | dismiss_revision
 *   POST /api/agents/:id/skill-candidates                       the same body with { id } for the candidate
 *   GET  /api/agents/:id/skill-candidates/:cid/bundle/<file>    manifest.json | SKILL.md | tools.json | handlers.js
 *        of an INSTALLED candidate. Public and anonymous, like every hosted skill
 *        bundle, so the embed that runs the agent can fetch it without a session.
 *
 * Everything but the bundle files is owner-only. Nothing installs or publishes
 * without a POST here: the detector only ever writes drafts.
 */

import { getRequestUser, hasScope } from '../../_lib/auth.js';
import { cors, json, text, wrap, error, readJson, rateLimited } from '../../_lib/http.js';
import { limits, clientIp } from '../../_lib/rate-limit.js';
import { requireCsrf } from '../../_lib/csrf.js';
import { isUuid } from '../../_lib/validate.js';
import {
	SkillCandidateError,
	listCandidates,
	getCandidate,
	acceptCandidate,
	publishCandidate,
	dismissCandidate,
	redistillCandidate,
	acceptRevision,
	dismissRevision,
	getInstalledBundleFile,
} from '../../_lib/skill-candidates.js';

const STATUSES = new Set(['draft', 'invalid', 'installed', 'dismissed']);
const ACTIONS = new Set(['accept', 'publish', 'dismiss', 'redraft', 'accept_revision', 'dismiss_revision']);

export default wrap(async (req, res) => {
	const url = new URL(req.url, 'http://x');
	const agentId = url.searchParams.get('id');
	const candidateId = url.searchParams.get('candidate_id');
	const file = url.searchParams.get('file');

	if (file) return serveBundleFile(req, res, agentId, candidateId, file);

	if (cors(req, res, { methods: 'GET,POST,OPTIONS', credentials: true })) return;
	if (!agentId || !isUuid(agentId)) return error(res, 400, 'validation_error', 'valid agent id required');

	const write = req.method === 'POST';
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
		if (req.method === 'GET' && !candidateId) {
			const status = url.searchParams.get('status');
			if (status && !STATUSES.has(status)) return error(res, 400, 'validation_error', 'status must be draft, invalid, installed or dismissed');
			return json(res, 200, { data: { candidates: await listCandidates({ agentId, userId: user.id, status }) } });
		}
		if (req.method === 'GET') return json(res, 200, { data: await getCandidate({ agentId, userId: user.id, id: candidateId }) });
		if (req.method === 'POST') return await handleAction(req, res, agentId, candidateId, user.id);
		return error(res, 405, 'method_not_allowed', 'method not allowed');
	} catch (err) {
		if (err instanceof SkillCandidateError) return error(res, err.status, err.code, err.message);
		throw err;
	}
});

async function handleAction(req, res, agentId, candidateId, userId) {
	const body = (await readJson(req)) || {};
	const id = candidateId || body.id;
	if (!isUuid(id)) return error(res, 400, 'validation_error', 'a candidate id is required');
	if (!ACTIONS.has(body.action)) return error(res, 400, 'validation_error', `action must be one of ${[...ACTIONS].join(', ')}`);
	const args = { agentId, userId, id };

	switch (body.action) {
		case 'accept':
			return json(res, 200, { data: await acceptCandidate(args) });
		case 'publish':
			return json(res, 200, { data: await publishCandidate(args) });
		case 'dismiss':
			return json(res, 200, { data: await dismissCandidate(args) });
		case 'redraft':
			return json(res, 200, { data: await redistillCandidate(args) });
		case 'accept_revision':
		case 'dismiss_revision': {
			if (!isUuid(body.revision_id)) return error(res, 400, 'validation_error', 'revision_id is required');
			const run = body.action === 'accept_revision' ? acceptRevision : dismissRevision;
			return json(res, 200, { data: await run({ ...args, revisionId: body.revision_id }) });
		}
	}
}

async function serveBundleFile(req, res, agentId, candidateId, file) {
	if (cors(req, res, { origins: '*', methods: 'GET,OPTIONS', credentials: false })) return;
	if (req.method !== 'GET') return error(res, 405, 'method_not_allowed', 'method not allowed');
	const served = await getInstalledBundleFile(agentId, candidateId, file);
	if (!served) return error(res, 404, 'not_found', 'no installed skill bundle at this path');
	res.setHeader('cache-control', 'no-store');
	if (served.type === 'json') return json(res, 200, served.body);
	const contentType = served.type === 'markdown' ? 'text/markdown; charset=utf-8' : 'text/javascript; charset=utf-8';
	return text(res, 200, served.body, { 'content-type': contentType });
}
