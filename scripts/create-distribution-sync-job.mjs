#!/usr/bin/env node
// Schedule the daily sync of the externally hosted three.ws distributions.
//
// Cloud Scheduler calls the Cloud Build API with distributions/sync/cloudbuild.json
// as the request body, so every run builds the current three.ws main without a
// connected repository or a build trigger. The build merges Hermes Agent upstream
// into nirholas/three-ws-agent and mirrors the Gemini CLI extension (see
// distributions/sync/run.sh).
//
// Pushing to GitHub is publishing, so this is owner-gated: the default prints the
// plan and changes nothing.
//
//   node scripts/create-distribution-sync-job.mjs            # plan
//   node scripts/create-distribution-sync-job.mjs --apply    # create or update the job
//   node scripts/create-distribution-sync-job.mjs --run-now  # also trigger one run
//
// Prerequisite: the secret three-ws-distributions-github-token (a fine-grained PAT
// with contents:write on nirholas/three-ws-agent and nirholas/three-ws-gemini).

import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const PROJECT = 'aerial-vehicle-466722-p5';
const LOCATION = 'us-central1';
const JOB_ID = 'three-ws-distributions-sync';
const SCHEDULE = '17 6 * * *';
const TIME_ZONE = 'Etc/UTC';
const SECRET = 'three-ws-distributions-github-token';
const BUILD_SA = `three-ws-build@${PROJECT}.iam.gserviceaccount.com`;
const CONFIG_PATH = fileURLToPath(new URL('../distributions/sync/cloudbuild.json', import.meta.url));
const BUILDS_URI = `https://cloudbuild.googleapis.com/v1/projects/${PROJECT}/locations/${LOCATION}/builds`;

const argv = process.argv.slice(2);
const apply = argv.includes('--apply') || argv.includes('--run-now');
const runNow = argv.includes('--run-now');

function gcloud(args, { allowFail = false } = {}) {
	try {
		return execFileSync('gcloud', [...args, `--project=${PROJECT}`, '--quiet'], {
			encoding: 'utf8',
			stdio: ['ignore', 'pipe', 'pipe'],
		}).trim();
	} catch (error) {
		if (allowFail) return null;
		throw new Error(`gcloud ${args.join(' ')} failed:\n${error.stderr || error.message}`);
	}
}

function show(args) {
	return `gcloud ${args.map((a) => (/[\s*]/.test(a) ? `'${a}'` : a)).join(' ')} --project=${PROJECT}`;
}

export function jobArgs(verb) {
	return [
		'scheduler',
		'jobs',
		verb,
		'http',
		JOB_ID,
		`--location=${LOCATION}`,
		`--schedule=${SCHEDULE}`,
		`--time-zone=${TIME_ZONE}`,
		`--uri=${BUILDS_URI}`,
		'--http-method=POST',
		`--message-body-from-file=${CONFIG_PATH}`,
		'--headers=Content-Type=application/json',
		`--oauth-service-account-email=${BUILD_SA}`,
		'--oauth-token-scope=https://www.googleapis.com/auth/cloud-platform',
		'--attempt-deadline=180s',
		`--description=Daily sync of three-ws-agent (Hermes upstream) and the three.ws Gemini CLI extension`,
	];
}

const grants = [
	[
		'secrets',
		'add-iam-policy-binding',
		SECRET,
		`--member=serviceAccount:${BUILD_SA}`,
		'--role=roles/secretmanager.secretAccessor',
	],
	[
		'iam',
		'service-accounts',
		'add-iam-policy-binding',
		BUILD_SA,
		`--member=serviceAccount:${BUILD_SA}`,
		'--role=roles/iam.serviceAccountUser',
	],
	[
		'projects',
		'add-iam-policy-binding',
		PROJECT,
		`--member=serviceAccount:${BUILD_SA}`,
		'--role=roles/cloudbuild.builds.editor',
		'--condition=None',
	],
];

function main() {
	JSON.parse(readFileSync(CONFIG_PATH, 'utf8'));
	const exists = gcloud(['scheduler', 'jobs', 'describe', JOB_ID, `--location=${LOCATION}`, '--format=value(name)'], {
		allowFail: true,
	});
	const verb = exists ? 'update' : 'create';

	if (!apply) {
		console.log(`Plan (nothing changed; rerun with --apply):\n`);
		console.log(`# 1. The GitHub token (once): paste a fine-grained PAT with contents:write on both repos`);
		console.log(`printf '%s' "$GITHUB_TOKEN" | gcloud secrets create ${SECRET} --data-file=- --project=${PROJECT}\n`);
		console.log(`# 2. Permissions for the build service account`);
		for (const g of grants) console.log(show(g));
		console.log(`\n# 3. The schedule (${SCHEDULE} ${TIME_ZONE}); job ${exists ? 'exists, will update' : 'does not exist, will create'}`);
		console.log(show(jobArgs(verb)));
		console.log(`\n# 4. A first run on demand`);
		console.log(show(['scheduler', 'jobs', 'run', JOB_ID, `--location=${LOCATION}`]));
		return;
	}

	if (!gcloud(['secrets', 'describe', SECRET, '--format=value(name)'], { allowFail: true })) {
		console.error(`Secret ${SECRET} does not exist. Create it first:\n  printf '%s' "$GITHUB_TOKEN" | gcloud secrets create ${SECRET} --data-file=- --project=${PROJECT}`);
		process.exit(1);
	}
	for (const g of grants) {
		gcloud(g);
		console.log(`granted: ${g.slice(-1)[0].replace('--role=', '')}`);
	}
	gcloud(jobArgs(verb));
	console.log(`${verb}d scheduler job ${JOB_ID} (${SCHEDULE} ${TIME_ZONE})`);
	if (runNow) {
		gcloud(['scheduler', 'jobs', 'run', JOB_ID, `--location=${LOCATION}`]);
		console.log(`triggered a run; follow it with: gcloud builds list --region=${LOCATION} --filter="tags=three-ws-distributions-sync" --project=${PROJECT}`);
	}
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) main();
