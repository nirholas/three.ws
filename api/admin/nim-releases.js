// /api/admin/nim-releases: the day-0 NIM adoption board (/admin/nim-releases).
//
//   GET   list of evaluated and queued catalog models (nim_release_evals), newest
//         first, with the headline numbers each row needs on the board.
//   GET   ?id=<row id> | ?model=<catalog id>   one row in full: classification,
//         report, markdown report, the exact config diff and the post draft.
//         Add &format=md to get the stored markdown report as text/markdown.
//   POST  { id, action: 'requeue' }   put a row back on the queue (resets its
//         attempt count) so the next cron tick re-evaluates it.
//
// Rows are written by api/cron/nim-release-eval.js. This endpoint only reads
// them and can requeue; nothing here (or anywhere in the pipeline) applies a
// diff to production config. Auth: authorizeOps, the gate every internal
// board uses.

import { error, json, method, rateLimited, readJson, wrap } from '../_lib/http.js';
import { limits, clientIp } from '../_lib/rate-limit.js';
import { authorizeOps } from '../_lib/ops-auth.js';
import { respondMfaRequired } from '../_lib/admin-mfa.js';
import { getReleaseEval, listReleaseEvals, requeueReleaseEval } from '../_lib/nim-release-store.js';
import { LANES } from '../_lib/nim-lane-eval.js';

const NO_STORE = { 'cache-control': 'no-store', 'x-robots-tag': 'noindex' };
const MODEL_ID = /^[\w.-]+\/[\w.:-]+$/;

function lanePins() {
	return Object.fromEntries(Object.entries(LANES).map(([lane, l]) => [lane, { model: l.incumbent(), file: l.file }]));
}

export default wrap(async (req, res) => {
	if (!method(req, res, ['GET', 'POST'])) return;
	const rl = await limits.authedReadIp(clientIp(req));
	if (!rl.success) return rateLimited(res, rl);
	const auth = await authorizeOps(req);
	if (auth.mfaRequired) return respondMfaRequired(res);
	if (!auth.ok) return error(res, 401, 'unauthorized', 'admin session or ops secret required');

	if (req.method === 'GET') {
		const url = new URL(req.url, 'http://local');
		const idRaw = url.searchParams.get('id');
		const model = url.searchParams.get('model');
		if (idRaw || model) {
			if (idRaw && !/^\d+$/.test(idRaw)) return error(res, 400, 'validation_error', 'id must be a row id');
			if (!idRaw && !MODEL_ID.test(model)) return error(res, 400, 'validation_error', 'model must be a catalog id like owner/name');
			const row = await getReleaseEval(idRaw ? { id: Number(idRaw) } : { modelId: model });
			if (!row) return error(res, 404, 'not_found', 'no evaluation for that model yet');
			if (url.searchParams.get('format') === 'md') {
				if (!row.report_md) return error(res, 404, 'not_found', 'this row has no report yet');
				res.statusCode = 200;
				res.setHeader('content-type', 'text/markdown; charset=utf-8');
				for (const [k, v] of Object.entries(NO_STORE)) res.setHeader(k, v);
				res.end(row.report_md);
				return;
			}
			return json(res, 200, { ok: true, row }, NO_STORE);
		}
		const limit = Math.min(Math.max(Number(url.searchParams.get('limit')) || 100, 1), 500);
		const rows = await listReleaseEvals({ limit });
		return json(res, 200, { ok: true, pins: lanePins(), rows }, NO_STORE);
	}

	const body = (await readJson(req)) || {};
	const id = String(body.id ?? '');
	if (!/^\d+$/.test(id)) return error(res, 400, 'validation_error', 'id must be a row id');
	if (body.action !== 'requeue') return error(res, 400, 'validation_error', "action must be 'requeue'");
	const row = await requeueReleaseEval(Number(id));
	if (!row) return error(res, 409, 'conflict', 'no such row, or it is being evaluated right now');
	return json(res, 200, { ok: true, row }, NO_STORE);
});
