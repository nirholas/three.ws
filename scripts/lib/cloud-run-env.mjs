// Load a slice of the three-ws-api Cloud Run environment into this process.
//
// Operator CLIs (forge:takedown, forge:removals) act on production data from a
// workstation instead of through an HTTP admin endpoint, so there is no admin
// surface on the public server to attack. They read the env vars they need
// straight from the Cloud Run service, resolving secret references through
// Secret Manager, into process.env only. Nothing is written to disk. Access is
// whatever the operator's own gcloud login allows.

import { spawnSync } from 'node:child_process';

export const PROJECT = 'aerial-vehicle-466722-p5';
export const SERVICE = 'three-ws-api';
export const REGION = 'us-central1';

export function gcloud(args) {
	const r = spawnSync('gcloud', [...args, '--project', PROJECT], { encoding: 'utf8', maxBuffer: 32 * 1024 * 1024 });
	if (r.status !== 0) throw new Error(`gcloud ${args.slice(0, 3).join(' ')} failed: ${(r.stderr || '').trim().split('\n').pop()}`);
	return r.stdout;
}

/**
 * Copy every Cloud Run env var whose name matches `wanted` into process.env,
 * replacing whatever the shell had, so the CLI acts on production's values.
 *
 * `keep` names one credential the operator may supply themselves, under any of
 * its aliases (GROK_API_KEY and XAI_API_KEY are the same key). When the shell
 * already holds any of them, none of them is read from the service: the
 * operator's value stays and the service's copy never enters this process.
 *
 * Throws when any name in `required` is still unset afterwards.
 * Returns the number of vars loaded.
 */
export function loadCloudRunEnv({ wanted, required = [], keep = [] }) {
	const svc = JSON.parse(gcloud(['run', 'services', 'describe', SERVICE, '--region', REGION, '--format', 'json']));
	const vars = svc?.spec?.template?.spec?.containers?.[0]?.env || [];
	const kept = keep.some((k) => process.env[k]) ? new Set(keep) : new Set();
	let n = 0;
	for (const v of vars) {
		if (!wanted.test(v.name) || kept.has(v.name)) continue;
		if (typeof v.value === 'string') process.env[v.name] = v.value;
		else if (v.valueFrom?.secretKeyRef?.name) {
			const ref = v.valueFrom.secretKeyRef;
			process.env[v.name] = gcloud(['secrets', 'versions', 'access', ref.key || 'latest', `--secret=${ref.name}`]).replace(/\r?\n$/, '');
		} else continue;
		n++;
	}
	const missing = required.filter((k) => !process.env[k]);
	if (missing.length) throw new Error(`Cloud Run env is missing ${missing.join(', ')}`);
	return n;
}
