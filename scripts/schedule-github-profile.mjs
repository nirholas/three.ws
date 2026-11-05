#!/usr/bin/env node
// Keep github.com/nirholas/nirholas current without anyone remembering to.
//
// Cloud Scheduler posts deploy/github-profile/build.json to the Cloud Build
// API once a day. That build clones the public three.ws scripts, runs
// scripts/build-github-profile.mjs --publish, and pushes only when the catalog,
// charts or numbers actually moved (a date-only rebuild is skipped).
//
//   node scripts/schedule-github-profile.mjs            # create or update the daily job
//   node scripts/schedule-github-profile.mjs --run-now  # also trigger one build immediately
//
// The token lives in the github-profile-token secret (repo push on the profile
// repo). The job runs as three-ws-build@, which can read that secret.
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const PROJECT = 'aerial-vehicle-466722-p5';
const REGION = 'us-central1';
const JOB = 'github-profile-refresh';
const SCHEDULE = '17 9 * * *';
const SA = `three-ws-build@${PROJECT}.iam.gserviceaccount.com`;
const BUILD = fileURLToPath(new URL('../deploy/github-profile/build.json', import.meta.url));

const gcloud = (args, { quiet = false } = {}) => {
	const r = spawnSync('gcloud', [...args, `--project=${PROJECT}`], { encoding: 'utf8' });
	if (r.status !== 0 && !quiet) throw new Error(`gcloud ${args.slice(0, 3).join(' ')} failed:\n${r.stderr}`);
	return r;
};

const exists = gcloud(['scheduler', 'jobs', 'describe', JOB, `--location=${REGION}`, '--format=value(name)'], { quiet: true }).status === 0;
gcloud([
	'scheduler',
	'jobs',
	exists ? 'update' : 'create',
	'http',
	JOB,
	`--location=${REGION}`,
	`--schedule=${SCHEDULE}`,
	'--time-zone=UTC',
	`--uri=https://cloudbuild.googleapis.com/v1/projects/${PROJECT}/builds`,
	'--http-method=POST',
	`--message-body-from-file=${BUILD}`,
	exists ? '--update-headers=Content-Type=application/json' : '--headers=Content-Type=application/json',
	`--oauth-service-account-email=${SA}`,
	'--oauth-token-scope=https://www.googleapis.com/auth/cloud-platform',
	'--attempt-deadline=60s',
	'--description=Rebuild and publish the github.com/nirholas profile catalog daily (scripts/build-github-profile.mjs)',
]);
console.log(`${exists ? 'updated' : 'created'} Cloud Scheduler job ${JOB} (${SCHEDULE} UTC)`);

if (process.argv.includes('--run-now')) {
	gcloud(['scheduler', 'jobs', 'run', JOB, `--location=${REGION}`]);
	console.log(`triggered ${JOB}; follow it with: gcloud builds list --filter="tags=github-profile-refresh" --limit=1 --project=${PROJECT}`);
}
