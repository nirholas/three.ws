#!/usr/bin/env node
// Run the daily partner spotlight unattended (docs/x-partner-series.md).
//
// A Cloud Run Job runs deploy/x-partners/run.sh in the image built from
// deploy/x-partners/Dockerfile: it pulls production's overlay, keeps three days
// of spotlights in stock, and ships what the approval policy releases. Cloud
// Scheduler starts it once a day. The job reads the same environment as the
// three-ws-api service (the model keys, DATABASE_URL, object storage, the bundle
// secret), copied as the service has it: Secret Manager references stay references.
//
// Shipping a bundle publishes, so this is owner-gated: the default prints the
// plan and changes nothing.
//
//   node scripts/create-x-partners-job.mjs            # plan
//   node scripts/create-x-partners-job.mjs --apply    # build the image, create or update the job and its schedule
//   node scripts/create-x-partners-job.mjs --apply --skip-build   # reuse the last image
//   node scripts/create-x-partners-job.mjs --run-now  # also start one run

import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const PROJECT = 'aerial-vehicle-466722-p5';
const REGION = 'us-central1';
const SERVICE = 'three-ws-api';
const JOB = 'three-ws-x-partners';
const SCHEDULER_JOB = 'three-ws-x-partners-daily';
// 08:10 UTC: hours before the first slot, so a released spotlight clears its veto window in time.
const SCHEDULE = '10 8 * * *';
const TIME_ZONE = 'Etc/UTC';
const IMAGE = `${REGION}-docker.pkg.dev/${PROJECT}/cloud-run-source-deploy/x-partners:latest`;
const BUILD_SA = `three-ws-build@${PROJECT}.iam.gserviceaccount.com`;
const RUNTIME_SA = `three-ws@${PROJECT}.iam.gserviceaccount.com`;
const ROOT = fileURLToPath(new URL('..', import.meta.url));

const argv = process.argv.slice(2);
const runNow = argv.includes('--run-now');
const apply = argv.includes('--apply') || runNow;
const skipBuild = argv.includes('--skip-build');

function gcloud(args, { allowFail = false, inherit = false } = {}) {
	try {
		const out = execFileSync('gcloud', [...args, `--project=${PROJECT}`, '--quiet'], {
			cwd: ROOT,
			encoding: 'utf8',
			stdio: inherit ? 'inherit' : ['ignore', 'pipe', 'pipe'],
		});
		return typeof out === 'string' ? out.trim() : '';
	} catch (error) {
		if (allowFail) return null;
		throw new Error(`gcloud ${args.join(' ')} failed:\n${error.stderr || error.message}`);
	}
}

const show = (args) => `gcloud ${args.map((a) => (/[\s*]/.test(a) ? `'${a}'` : a)).join(' ')} --project=${PROJECT}`;

// The service's environment, exactly as Cloud Run holds it: plain values and
// Secret Manager references. Copying the spec, never the resolved values, keeps
// every secret in Secret Manager.
export function serviceEnv(service) {
	const container = service?.spec?.template?.spec?.containers?.[0];
	if (!container?.env?.length) throw new Error(`${SERVICE} has no environment to copy`);
	return container.env.filter((entry) => entry.name && !['PORT', 'K_SERVICE', 'K_REVISION', 'K_CONFIGURATION'].includes(entry.name));
}

export function jobSpec(env) {
	return {
		apiVersion: 'run.googleapis.com/v1',
		kind: 'Job',
		metadata: { name: JOB, labels: { app: 'three-ws', component: 'x-partners' } },
		spec: {
			template: {
				spec: {
					taskCount: 1,
					parallelism: 1,
					template: {
						spec: {
							serviceAccountName: RUNTIME_SA,
							// A failed day costs nothing: three days are in stock and tomorrow's run refills them.
							maxRetries: 0,
							timeoutSeconds: 3600,
							containers: [
								{
									image: IMAGE,
									env: [...env.filter((entry) => entry.name !== 'X_PARTNERS_DAYS'), { name: 'X_PARTNERS_DAYS', value: '3' }],
									resources: { limits: { cpu: '2', memory: '4Gi' } },
								},
							],
						},
					},
				},
			},
		},
	};
}

const runUri = `https://run.googleapis.com/v2/projects/${PROJECT}/locations/${REGION}/jobs/${JOB}:run`;
const schedulerArgs = (verb) => [
	'scheduler',
	'jobs',
	verb,
	'http',
	SCHEDULER_JOB,
	`--location=${REGION}`,
	`--schedule=${SCHEDULE}`,
	`--time-zone=${TIME_ZONE}`,
	`--uri=${runUri}`,
	'--http-method=POST',
	`--oauth-service-account-email=${RUNTIME_SA}`,
	'--oauth-token-scope=https://www.googleapis.com/auth/cloud-platform',
	'--attempt-deadline=180s',
	'--description=Daily partner spotlight for @trythreews: film, draft, review and ship (docs/x-partner-series.md)',
];
// The build uploads the repo through the shared .gcloudignore allowlist, plus
// the two paths only this image needs: docs/ (the house voice, and the files the
// partner facts cite as evidence) and deploy/ (run.sh). The production image
// stays without them.
const UPLOAD_EXTRAS = ['!/docs/', '!/deploy/', '**/node_modules/', '.git/'];
export function ignoreFile() {
	const dir = mkdtempSync(join(tmpdir(), 'x-partners-upload-'));
	const file = join(dir, '.gcloudignore');
	writeFileSync(file, `${readFileSync(join(ROOT, '.gcloudignore'), 'utf8')}\n# x-partners runner additions\n${UPLOAD_EXTRAS.join('\n')}\n`);
	return file;
}
const buildArgs = (ignore) => ['builds', 'submit', '--config=deploy/x-partners/cloudbuild.yaml', `--ignore-file=${ignore}`, `--region=${REGION}`, `--service-account=projects/${PROJECT}/serviceAccounts/${BUILD_SA}`, '.'];
const invokerGrant = ['run', 'jobs', 'add-iam-policy-binding', JOB, `--region=${REGION}`, `--member=serviceAccount:${RUNTIME_SA}`, '--role=roles/run.invoker'];

function main() {
	const scheduled = gcloud(['scheduler', 'jobs', 'describe', SCHEDULER_JOB, `--location=${REGION}`, '--format=value(name)'], { allowFail: true });
	const verb = scheduled ? 'update' : 'create';

	if (!apply) {
		console.log('Plan (nothing changed; rerun with --apply):\n');
		console.log('# 1. The runner image (Chromium, ffmpeg, the repo at this commit)');
		console.log(show(buildArgs('<.gcloudignore plus docs/ and deploy/>')));
		console.log(`\n# 2. The job ${JOB}, with ${SERVICE}'s environment copied as references`);
		console.log(`gcloud run jobs replace <generated job.yaml> --region=${REGION} --project=${PROJECT}`);
		console.log('\n# 3. Let the runtime account start it');
		console.log(show(invokerGrant));
		console.log(`\n# 4. The schedule (${SCHEDULE} ${TIME_ZONE}); ${scheduled ? 'exists, will update' : 'does not exist, will create'}`);
		console.log(show(schedulerArgs(verb)));
		console.log('\n# 5. A first run on demand');
		console.log(show(['run', 'jobs', 'execute', JOB, `--region=${REGION}`]));
		return;
	}

	if (!skipBuild) gcloud(buildArgs(ignoreFile()), { inherit: true });
	const service = JSON.parse(gcloud(['run', 'services', 'describe', SERVICE, `--region=${REGION}`, '--format=json']));
	const env = serviceEnv(service);
	const dir = mkdtempSync(join(tmpdir(), 'x-partners-job-'));
	// JSON is valid YAML, which is what `jobs replace` reads.
	const file = join(dir, 'job.yaml');
	writeFileSync(file, JSON.stringify(jobSpec(env), null, 2));
	gcloud(['run', 'jobs', 'replace', file, `--region=${REGION}`]);
	console.log(`job ${JOB}: ${env.length} environment entries copied from ${SERVICE}`);
	gcloud(invokerGrant);
	gcloud(schedulerArgs(verb));
	console.log(`${verb}d scheduler job ${SCHEDULER_JOB} (${SCHEDULE} ${TIME_ZONE})`);
	if (runNow) {
		gcloud(['run', 'jobs', 'execute', JOB, `--region=${REGION}`]);
		console.log(`started a run; follow it with: gcloud run jobs executions list --job=${JOB} --region=${REGION} --project=${PROJECT}`);
	}
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) main();
