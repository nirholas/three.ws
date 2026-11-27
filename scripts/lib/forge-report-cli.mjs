// Plumbing shared by the two Forge operator CLIs (scripts/forge-error-report.mjs
// and scripts/forge-funnel-report.mjs). The counting, wording and redaction live
// in api/_lib/forge-operator-report.js; this file only touches the workstation:
// the env files and the gcloud CLI.

import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { ensureGcloudOnPath } from './gcloud-path.mjs';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

/** Load .env.local, then .env, never overriding what the shell already set. */
export function loadRepoEnv() {
	for (const envFile of ['.env.local', '.env']) {
		let raw;
		try {
			raw = readFileSync(path.resolve(REPO_ROOT, envFile), 'utf8');
		} catch {
			continue;
		}
		for (const line of raw.split('\n')) {
			const m = line.match(/^([A-Z_][A-Z0-9_]*)=(.*)$/);
			if (!m || process.env[m[1]]) continue;
			let val = m[2].trim();
			if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) val = val.slice(1, -1);
			process.env[m[1]] = val;
		}
	}
}

/** `--name value` from argv, or the fallback. */
export function flagValue(args, name, fallback) {
	const i = args.indexOf(`--${name}`);
	return i >= 0 && args[i + 1] && !args[i + 1].startsWith('--') ? args[i + 1] : fallback;
}

export const REQUEST_LOG_LIMIT = 50_000;

/**
 * Read the Cloud Run request log for generation POSTs over the last `days`.
 * The only record of a request refused before a forge_creations row existed.
 * Returns `{ ok, text, project, truncated }` or `{ ok: false, error, project }`;
 * never throws, because the rest of the report stands without it.
 * @param {{ days: number }} opts
 */
export function readForgeRequestLog({ days }) {
	const project = process.env.GCP_PROJECT || 'aerial-vehicle-466722-p5';
	if (!ensureGcloudOnPath()) return { ok: false, project, error: 'gcloud is not installed on this machine' };
	const filter = [
		'resource.type="cloud_run_revision"',
		'resource.labels.service_name="three-ws-api"',
		'log_name:"run.googleapis.com%2Frequests"',
		'httpRequest.requestMethod="POST"',
		'(httpRequest.requestUrl:"/api/forge" OR httpRequest.requestUrl:"/api/gpt-forge")',
	].join(' AND ');
	const args = [
		'logging', 'read', filter,
		`--project=${project}`,
		`--freshness=${Math.max(1, Math.trunc(days))}d`,
		`--limit=${REQUEST_LOG_LIMIT}`,
		'--format=value(httpRequest.status,httpRequest.requestUrl)',
	];
	if (process.env.GCP_ACCOUNT) args.push(`--account=${process.env.GCP_ACCOUNT}`);
	const r = spawnSync('gcloud', args, { encoding: 'utf8', maxBuffer: 256 * 1024 * 1024, timeout: 180_000 });
	if (r.error) return { ok: false, project, error: r.error.message };
	if (r.status !== 0) {
		const last = (r.stderr || '').trim().split('\n').filter(Boolean).pop() || `gcloud exited ${r.status}`;
		const hint = /invalid_grant|reauth|login/i.test(r.stderr || '')
			? ' (run gcloud auth login with an account that can read this project, or set GCP_ACCOUNT)'
			: /PERMISSION_DENIED/.test(r.stderr || '')
				? ' (this account cannot read the project; set GCP_PROJECT or GCP_ACCOUNT)'
				: '';
		return { ok: false, project, error: `${last.slice(0, 200)}${hint}` };
	}
	const text = r.stdout || '';
	const lines = text.split('\n').filter((l) => l.trim()).length;
	return { ok: true, project, text, truncated: lines >= REQUEST_LOG_LIMIT };
}
