// Owner surface for the agent sandbox (the API behind /settings/sandbox).
//
//   GET   /api/sandbox/overview             plan limits, backend status, allowed hosts, recent runs
//   GET   /api/sandbox/run?run=ID           one run: executions (newest first) and its workspace files
//   POST  /api/sandbox/run?run=ID           { action: 'kill', reason? } stop the run's sandbox for good
//   GET   /api/sandbox/file?run=ID&path=P   download one workspace file (always as an attachment)
//   PATCH /api/sandbox/settings             { allow_hosts?: string[], default_backend?: string }
//
// Auth: the browser session. Every query is scoped to the signed-in account, so
// another account's run answers 404, never its data. Mutations are CSRF-gated.
// Executions are started by agents (execute_code and friends), never from here.

import { z } from 'zod';
import { getSessionUser } from '../_lib/auth.js';
import { requireCsrf } from '../_lib/csrf.js';
import { error, json, method, readJson, wrap } from '../_lib/http.js';
import { BACKEND_ORDER, backendStatus } from '../_lib/sandbox/backends.js';
import { normalizeHostPattern } from '../_lib/sandbox/bridge.js';
import { PLAN_LIMITS, limitsFor } from '../_lib/sandbox/limits.js';
import { getSandboxRun, getSandboxSettings, getUserPlan, killSandboxRun, listExecutions, listSandboxRuns, saveSandboxSettings } from '../_lib/sandbox/store.js';
import { RUN_ID_RE, workspaceStore } from '../_lib/sandbox/workspace.js';
import { normalizeWorkspacePath } from '../_lib/sandbox/paths.js';

const MAX_ALLOW_HOSTS = 50;
const settingsPatch = z
	.object({
		allow_hosts: z.array(z.string().trim().min(1).max(260)).max(MAX_ALLOW_HOSTS).optional(),
		default_backend: z.enum(BACKEND_ORDER).optional(),
	})
	.strict()
	.refine((v) => v.allow_hosts !== undefined || v.default_backend !== undefined, { message: 'nothing to update' });
const killBody = z.object({ action: z.literal('kill'), reason: z.string().trim().max(200).optional() }).strict();

function presentSettings(row) {
	return { default_backend: row?.default_backend || 'cloudrun', allow_hosts: Array.isArray(row?.allow_hosts) ? row.allow_hosts : [] };
}

/** The owner's run, or null (a run that belongs to someone else is indistinguishable from none). */
async function ownedRun(userId, runId) {
	if (!RUN_ID_RE.test(String(runId || ''))) return null;
	const run = await getSandboxRun(runId);
	return run && String(run.user_id) === String(userId) ? run : null;
}

export default wrap(async (req, res) => {
	if (!method(req, res, ['GET', 'POST', 'PATCH'])) return;
	const url = new URL(req.url, 'http://x');
	const action = req.query?.action || url.searchParams.get('action');
	const user = await getSessionUser(req, res);
	if (!user) return error(res, 401, 'unauthorized', 'sign in required');
	if (req.method !== 'GET' && !(await requireCsrf(req, res, user.id))) return;
	res.setHeader('cache-control', 'no-store');

	switch (action) {
		case 'overview': {
			if (!method(req, res, ['GET'])) return;
			const [plan, settings, runs] = await Promise.all([getUserPlan(user.id), getSandboxSettings(user.id), listSandboxRuns(user.id, { limit: 50 })]);
			return json(res, 200, {
				plan,
				limits: limitsFor(plan),
				plans: PLAN_LIMITS,
				backends: backendStatus(),
				settings: presentSettings(settings),
				runs: runs.map((r) => ({ ...r, cost_usd: Number(r.cost_usd), wall_ms: Number(r.wall_ms) })),
			});
		}

		case 'run': {
			const run = await ownedRun(user.id, url.searchParams.get('run'));
			if (!run) return error(res, 404, 'not_found', 'no such run on your account');
			if (req.method === 'POST') {
				let body;
				try {
					body = killBody.parse(await readJson(req));
				} catch (err) {
					return error(res, 400, 'validation_error', err?.issues?.[0]?.message || err.message);
				}
				const killed = await killSandboxRun(run.run_id, body.reason || 'stopped by the owner');
				return json(res, 200, { run: killed || (await getSandboxRun(run.run_id)) });
			}
			if (!method(req, res, ['GET'])) return;
			const [executions, files] = await Promise.all([listExecutions(run.run_id, { limit: 100 }), workspaceStore().list(run.run_id)]);
			return json(res, 200, {
				run: { ...run, cost_usd: Number(run.cost_usd), wall_ms: Number(run.wall_ms) },
				executions: executions.map((e) => ({ ...e, cost_usd: Number(e.cost_usd), charged_usd: Number(e.charged_usd) })),
				files,
			});
		}

		case 'file': {
			if (!method(req, res, ['GET'])) return;
			const run = await ownedRun(user.id, url.searchParams.get('run'));
			if (!run) return error(res, 404, 'not_found', 'no such run on your account');
			let rel;
			try {
				rel = normalizeWorkspacePath(url.searchParams.get('path'));
			} catch {
				return error(res, 400, 'bad_path', 'that is not a workspace path');
			}
			const data = await workspaceStore().read(run.run_id, rel);
			if (!data) return error(res, 404, 'not_found', 'no such file in this workspace');
			const name = rel.split('/').pop().replace(/[^\w.\- ]+/g, '_') || 'file';
			res.statusCode = 200;
			// An attachment that cannot render or run in the browser: a program wrote these bytes.
			res.setHeader('content-type', 'application/octet-stream');
			res.setHeader('content-disposition', `attachment; filename="${name}"`);
			res.setHeader('x-content-type-options', 'nosniff');
			res.setHeader('content-security-policy', "default-src 'none'; sandbox");
			res.setHeader('content-length', String(data.length));
			return res.end(data);
		}

		case 'settings': {
			if (!method(req, res, ['GET', 'PATCH'])) return;
			if (req.method === 'GET') return json(res, 200, { settings: presentSettings(await getSandboxSettings(user.id)) });
			let body;
			try {
				body = settingsPatch.parse(await readJson(req));
			} catch (err) {
				return error(res, 400, 'validation_error', err?.issues?.[0]?.message || err.message);
			}
			const patch = {};
			if (body.default_backend) patch.default_backend = body.default_backend;
			if (body.allow_hosts) {
				const normalized = [];
				for (const raw of body.allow_hosts) {
					const host = normalizeHostPattern(raw);
					if (!host) return error(res, 400, 'validation_error', `"${raw}" is not a hostname or a *.hostname pattern`);
					if (!normalized.includes(host)) normalized.push(host);
				}
				patch.allow_hosts = normalized;
			}
			return json(res, 200, { settings: presentSettings(await saveSandboxSettings(user.id, patch)) });
		}

		default:
			return error(res, 404, 'not_found', 'unknown sandbox action');
	}
});
