#!/usr/bin/env node
// Daily, verified, off-provider backup of the production Neon database.
//
// Cloud Scheduler posts a Cloud Build body to the Cloud Build API once a day.
// The build (all scripts in deploy/db-backup/) runs as three-ws-build@ and:
//   1. pg_dumps the database (unpooled URL from Secret Manager) as a parallel
//      directory archive and records source row counts before and after,
//   2. uploads the archive to gs://three-ws-db-backups (30-day retention
//      lock-in, so a backup cannot be deleted or replaced inside the window),
//   3. downloads that object back and checks its SHA-256,
//   4. restores it into a fresh Postgres 17 cluster and compares table count
//      and critical-table row counts against the source,
//   5. writes report.json beside the archive and as neondb/latest.json, and
//      fails the build when the restore did not verify.
// The report carries the measured RTO (download + restore seconds).
//
//   node scripts/schedule-db-backup.mjs            # provision bucket + create/update the daily job
//   node scripts/schedule-db-backup.mjs --run-now  # also trigger one run immediately
//   node scripts/schedule-db-backup.mjs --print    # print the Cloud Build body and exit
import { spawnSync } from 'node:child_process';
import { readFileSync, writeFileSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

export const PROJECT = 'aerial-vehicle-466722-p5';
export const REGION = 'us-central1';
export const JOB = 'db-backup-daily';
export const SCHEDULE = '30 6 * * *';
export const BUCKET = 'three-ws-db-backups';
export const RETENTION_DAYS = 30;
export const DELETE_AFTER_DAYS = 35;
const SA = `three-ws-build@${PROJECT}.iam.gserviceaccount.com`;
const PG_IMAGE = 'pgvector/pgvector:pg17';
const SDK_IMAGE = 'gcr.io/google.com/cloudsdktool/cloud-sdk:slim';

const script = (name) =>
	Buffer.from(readFileSync(fileURLToPath(new URL(`../deploy/db-backup/${name}`, import.meta.url)))).toString('base64');

const run = (image, id, name, arg = '', extra = {}) => ({
	id,
	name: image,
	entrypoint: 'bash',
	args: ['-c', `echo ${script(name)} | base64 -d > /workspace/${name} && bash /workspace/${name} ${arg}`.trim()],
	env: [`BACKUP_BUCKET=${BUCKET}`],
	...extra,
});

export function buildBody() {
	return {
		steps: [
			run(PG_IMAGE, 'dump', 'dump.sh', '', { secretEnv: ['DATABASE_URL'] }),
			run(SDK_IMAGE, 'upload', 'transfer.sh', 'upload'),
			run(SDK_IMAGE, 'download', 'transfer.sh', 'download'),
			run(PG_IMAGE, 'restore-test', 'restore-test.sh'),
			run(SDK_IMAGE, 'publish', 'transfer.sh', 'publish'),
		],
		availableSecrets: {
			secretManager: [
				{ versionName: `projects/${PROJECT}/secrets/database-url-unpooled/versions/latest`, env: 'DATABASE_URL' },
			],
		},
		serviceAccount: `projects/${PROJECT}/serviceAccounts/${SA}`,
		options: { logging: 'CLOUD_LOGGING_ONLY', machineType: 'E2_HIGHCPU_8', diskSizeGb: 200 },
		timeout: '10800s',
		tags: [JOB],
	};
}

const gcloud = (args, { quiet = false } = {}) => {
	const r = spawnSync('gcloud', [...args, `--project=${PROJECT}`], { encoding: 'utf8' });
	if (r.status !== 0 && !quiet) throw new Error(`gcloud ${args.slice(0, 4).join(' ')} failed:\n${r.stderr}`);
	return r;
};

function ensureBucket() {
	const uri = `gs://${BUCKET}`;
	const exists = gcloud(['storage', 'buckets', 'describe', uri, '--format=value(name)'], { quiet: true }).status === 0;
	if (!exists) {
		gcloud([
			'storage', 'buckets', 'create', uri,
			`--location=${REGION}`,
			'--uniform-bucket-level-access',
			'--public-access-prevention',
			'--default-storage-class=STANDARD',
		]);
	}
	const dir = mkdtempSync(join(tmpdir(), 'db-backup-'));
	const lifecycle = join(dir, 'lifecycle.json');
	writeFileSync(lifecycle, JSON.stringify({ rule: [{ action: { type: 'Delete' }, condition: { age: DELETE_AFTER_DAYS } }] }));
	gcloud([
		'storage', 'buckets', 'update', uri,
		`--retention-period=${RETENTION_DAYS}d`,
		`--lifecycle-file=${lifecycle}`,
		'--soft-delete-duration=7d',
	]);
	gcloud([
		'storage', 'buckets', 'add-iam-policy-binding', uri,
		`--member=serviceAccount:${SA}`,
		'--role=roles/storage.objectAdmin',
	]);
	console.log(`${exists ? 'updated' : 'created'} ${uri}: ${RETENTION_DAYS}d retention, delete at ${DELETE_AFTER_DAYS}d, 7d soft delete, private`);
}

function ensureJob() {
	const dir = mkdtempSync(join(tmpdir(), 'db-backup-'));
	const body = join(dir, 'build.json');
	writeFileSync(body, JSON.stringify(buildBody()));
	const exists = gcloud(['scheduler', 'jobs', 'describe', JOB, `--location=${REGION}`, '--format=value(name)'], { quiet: true }).status === 0;
	gcloud([
		'scheduler', 'jobs', exists ? 'update' : 'create', 'http', JOB,
		`--location=${REGION}`,
		`--schedule=${SCHEDULE}`,
		'--time-zone=UTC',
		`--uri=https://cloudbuild.googleapis.com/v1/projects/${PROJECT}/builds`,
		'--http-method=POST',
		`--message-body-from-file=${body}`,
		exists ? '--update-headers=Content-Type=application/json' : '--headers=Content-Type=application/json',
		`--oauth-service-account-email=${SA}`,
		'--oauth-token-scope=https://www.googleapis.com/auth/cloud-platform',
		'--attempt-deadline=60s',
		'--description=Daily pg_dump of the production database to gs://three-ws-db-backups with a verified restore test (scripts/schedule-db-backup.mjs)',
	]);
	console.log(`${exists ? 'updated' : 'created'} Cloud Scheduler job ${JOB} (${SCHEDULE} UTC)`);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
	if (process.argv.includes('--print')) {
		console.log(JSON.stringify(buildBody(), null, 2));
	} else {
		ensureBucket();
		ensureJob();
		if (process.argv.includes('--run-now')) {
			gcloud(['scheduler', 'jobs', 'run', JOB, `--location=${REGION}`]);
			console.log(`triggered ${JOB}; follow it with: gcloud builds list --filter="tags=${JOB}" --limit=1 --project=${PROJECT}`);
		}
	}
}
