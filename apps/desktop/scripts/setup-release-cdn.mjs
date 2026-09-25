#!/usr/bin/env node
// One-time infrastructure for the three.ws Desktop release feed: a public GCS
// bucket, served by the production load balancer at
// https://three.ws/releases/desktop/ through a Cloud CDN backend bucket.
//
//   node apps/desktop/scripts/setup-release-cdn.mjs          # plan: print every command, change nothing
//   node apps/desktop/scripts/setup-release-cdn.mjs --apply  # run them (owner-gated: it edits the production URL map)
//
// Objects live under releases/desktop/ in the bucket because a backend bucket
// maps the request path straight to the object name. Every step is idempotent:
// a resource that already exists is left as it is.

import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

export const PROJECT = 'aerial-vehicle-466722-p5';
export const BUCKET = 'three-ws-desktop-releases';
export const BACKEND_BUCKET = 'three-ws-desktop-releases-bb';
export const URL_MAP = 'three-ws-lb';
export const PATH_MATCHER = 'releases';
const BUILD_SA = `three-ws-build@${PROJECT}.iam.gserviceaccount.com`;

export function plan() {
	return [
		{
			what: 'release bucket (us-central1, uniform access)',
			exists: ['storage', 'buckets', 'describe', `gs://${BUCKET}`],
			run: ['storage', 'buckets', 'create', `gs://${BUCKET}`, '--location=us-central1', '--uniform-bucket-level-access'],
		},
		{
			what: 'public read on the artifacts',
			run: ['storage', 'buckets', 'add-iam-policy-binding', `gs://${BUCKET}`, '--member=allUsers', '--role=roles/storage.objectViewer'],
		},
		{
			what: 'Cloud Build may write releases',
			run: ['storage', 'buckets', 'add-iam-policy-binding', `gs://${BUCKET}`, `--member=serviceAccount:${BUILD_SA}`, '--role=roles/storage.objectAdmin'],
		},
		{
			what: 'Cloud Build may read the Windows signing secrets (when they exist)',
			run: ['projects', 'add-iam-policy-binding', PROJECT, `--member=serviceAccount:${BUILD_SA}`, '--role=roles/secretmanager.secretAccessor', '--condition=None'],
		},
		{
			what: 'CDN backend bucket honouring the Cache-Control each upload sets',
			exists: ['compute', 'backend-buckets', 'describe', BACKEND_BUCKET],
			run: ['compute', 'backend-buckets', 'create', BACKEND_BUCKET, `--gcs-bucket-name=${BUCKET}`, '--enable-cdn', '--cache-mode=USE_ORIGIN_HEADERS'],
		},
		{
			what: `route /releases/* on ${URL_MAP} to the backend bucket; everything else keeps three-ws-backend`,
			exists: ['compute', 'url-maps', 'describe', URL_MAP, '--global', `--format=value(pathMatchers[].name)`],
			existsMatch: PATH_MATCHER,
			run: ['compute', 'url-maps', 'add-path-matcher', URL_MAP, '--global', `--path-matcher-name=${PATH_MATCHER}`, '--default-service=three-ws-backend', `--backend-bucket-path-rules=/releases/*=${BACKEND_BUCKET}`, '--new-hosts=three.ws,www.three.ws'],
		},
	];
}

function gcloud(args, { capture = false } = {}) {
	return execFileSync('gcloud', [...args, `--project=${PROJECT}`, '--quiet'], { encoding: 'utf8', stdio: capture ? ['ignore', 'pipe', 'pipe'] : 'inherit' });
}

function already(step) {
	if (!step.exists) return false;
	try {
		const out = gcloud(step.exists, { capture: true });
		return step.existsMatch ? out.split(/[\s;,]+/).includes(step.existsMatch) : true;
	} catch {
		return false;
	}
}

function main() {
	const apply = process.argv.includes('--apply');
	const steps = plan();
	if (!apply) console.log('Plan (nothing changed; rerun with --apply once the owner approves the URL map change):\n');
	for (const step of steps) {
		const cmd = `gcloud ${step.run.map((a) => (/[\s*;]/.test(a) ? `'${a}'` : a)).join(' ')} --project=${PROJECT}`;
		if (!apply) {
			console.log(`# ${step.what}\n${cmd}\n`);
			continue;
		}
		if (already(step)) {
			console.log(`ok (exists) ${step.what}`);
			continue;
		}
		console.log(`run ${step.what}`);
		gcloud(step.run);
	}
	if (apply) console.log(`\nDone. Check with: curl -sI https://three.ws/releases/desktop/release.json`);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) main();
