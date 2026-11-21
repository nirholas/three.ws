#!/usr/bin/env node
// Live proof of the /api/pano-capture finaliser against real object storage.
//
// Runs the production code path (createCapture, then syncJob, which polls the
// worker, sees success and finalises) on a throwaway in-process database
// (scripts/lib/isolated-db.mjs), so the production database is never touched.
// A local server speaks worker contract C1 and serves real splat files from
// disk as the task's result URLs. The finaliser streams them into the bucket,
// and this script reads every stored object back and compares its SHA-256 with
// the source file. The proof objects are deleted at the end.
//
//   node scripts/pano-capture-live-check.mjs --leg r2 --ply <file.ply> --spz <file.spz>
//   node scripts/pano-capture-live-check.mjs --leg fallback --ply <file.ply> --spz <file.spz>
//
// --leg r2        writes into the production R2 bucket with the working
//                 cloudflare-r2-* credential pair from Secret Manager.
// --leg fallback  uses the credential the production service holds and its
//                 STORAGE_FALLBACK_BUCKET, which is what production does today:
//                 when R2 refuses that credential, the files land in GCS.
//
// Credentials are read in-process (Secret Manager and the Cloud Run service
// env) and never printed. Prints one JSON report line.
//
// The fallback leg's GCS token: on Cloud Run, api/_lib/gcp-auth.js asks the
// metadata server for the runtime service account's cloud-platform token. A
// developer box's metadata server (when it has one) answers with a token that
// has no storage scope, so this leg routes getGcpAccessToken() to the token of
// the signed-in gcloud account instead. Nothing else is substituted.

import { execFileSync } from 'node:child_process';
import { createHash, randomBytes } from 'node:crypto';
import { createReadStream, statSync } from 'node:fs';
import { createServer } from 'node:http';
import { registerHooks } from 'node:module';
import path from 'node:path';
import { useIsolatedDb } from './lib/isolated-db.mjs';

const args = process.argv.slice(2);
const flag = (name) => (args.includes(name) ? args[args.indexOf(name) + 1] : undefined);
const LEG = flag('--leg');
const PLY = flag('--ply');
const SPZ = flag('--spz');
if (!['r2', 'fallback'].includes(LEG) || !PLY || !SPZ) {
	process.stderr.write('usage: --leg r2|fallback --ply <file> --spz <file>\n');
	process.exit(2);
}

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const quiet = { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], cwd: ROOT, env: { ...process.env, TMPDIR: process.env.TMPDIR || '/home/user/.cache/gcloud-tmp' } };
const serviceEnv = (name) => execFileSync('node', ['scripts/read-service-env.mjs', `^${name}$`, '--raw'], quiet).trim();
const secret = (name) => execFileSync('gcloud', ['secrets', 'versions', 'access', 'latest', `--secret=${name}`], quiet).trim();

function loadStorageEnv() {
	for (const name of ['S3_ENDPOINT', 'S3_BUCKET', 'S3_PUBLIC_DOMAIN']) process.env[name] = serviceEnv(name);
	if (LEG === 'r2') {
		process.env.S3_ACCESS_KEY_ID = secret('cloudflare-r2-access-key-id');
		process.env.S3_SECRET_ACCESS_KEY = secret('cloudflare-r2-secret-access-key');
		delete process.env.STORAGE_FALLBACK_BUCKET;
	} else {
		process.env.S3_ACCESS_KEY_ID = serviceEnv('S3_ACCESS_KEY_ID');
		process.env.S3_SECRET_ACCESS_KEY = serviceEnv('S3_SECRET_ACCESS_KEY');
		process.env.STORAGE_FALLBACK_BUCKET = serviceEnv('STORAGE_FALLBACK_BUCKET');
	}
}

const sha256File = (file) =>
	new Promise((resolve, reject) => {
		const h = createHash('sha256');
		createReadStream(file).on('data', (c) => h.update(c)).on('end', () => resolve(h.digest('hex'))).on('error', reject);
	});

async function sha256Stream(body) {
	const h = createHash('sha256');
	let bytes = 0;
	for await (const chunk of body) {
		h.update(chunk);
		bytes += chunk.length;
	}
	return { sha256: h.digest('hex'), bytes };
}

// A worker that speaks contract C1 and serves the real files as its results.
function startWorker(key) {
	const tasks = new Map();
	const served = { 'scene.ply': PLY, 'scene.spz': SPZ };
	const server = createServer(async (req, res) => {
		const reply = (status, body) => {
			res.writeHead(status, { 'content-type': 'application/json' });
			res.end(JSON.stringify(body));
		};
		const url = new URL(req.url, 'http://x');
		if (url.pathname.startsWith('/files/')) {
			const file = served[url.pathname.slice('/files/'.length)];
			if (!file) return reply(404, { error: 'not found' });
			res.writeHead(200, { 'content-type': 'application/octet-stream', 'content-length': statSync(file).size });
			return createReadStream(file).pipe(res);
		}
		if (req.headers.authorization !== `Bearer ${key}`) return reply(401, { error: { code: 'unauthorized', message: 'bad bearer' } });
		for await (const _ of req);
		if (req.method === 'POST' && url.pathname === '/infer') {
			const id = `proof-${randomBytes(4).toString('hex')}`;
			tasks.set(id, true);
			return reply(202, { task_id: id });
		}
		const m = url.pathname.match(/^\/tasks\/([^/]+)$/);
		if (m && req.method === 'GET' && tasks.has(m[1])) {
			const base = `http://127.0.0.1:${server.address().port}/files`;
			return reply(200, {
				status: 'succeeded',
				stage: 'done',
				progress: 1,
				result: { ply_url: `${base}/scene.ply`, spz_url: `${base}/scene.spz`, stats: { gaussians: 0 } },
			});
		}
		return reply(404, { error: { code: 'not_found', message: 'no such task' } });
	});
	return new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve(server)));
}

// Route api/_lib/gcp-auth.js's token to the signed-in gcloud account (see top).
function useGcloudToken() {
	const token = execFileSync('gcloud', ['auth', 'print-access-token'], quiet).trim();
	const shim = `data:text/javascript,${encodeURIComponent(
		`export * from ${JSON.stringify(new URL('../api/_lib/gcp-auth.js', import.meta.url).href)};\n` +
			`export async function getGcpAccessToken() { return ${JSON.stringify(token)}; }\n`,
	)}`;
	registerHooks({
		resolve(specifier, context, next) {
			const out = next(specifier, context);
			if (out.url.endsWith('/api/_lib/gcp-auth.js') && !context.parentURL?.startsWith('data:')) return { ...out, url: shim, shortCircuit: true };
			return out;
		},
	});
}

async function main() {
	loadStorageEnv();
	if (LEG === 'fallback') useGcloudToken();
	const workerKey = randomBytes(16).toString('hex');
	const worker = await startWorker(workerKey);
	process.env.GCP_PANO2SPLAT_URL = `http://127.0.0.1:${worker.address().port}`;
	process.env.GCP_RECONSTRUCTION_KEY = workerKey;

	const db = await useIsolatedDb();
	const lib = await import('../api/_lib/pano-capture.js');
	const { r2 } = await import('../api/_lib/r2.js');
	const { GetObjectCommand } = await import('@aws-sdk/client-s3');
	const { fallbackFetch } = await import('../api/_lib/storage-fallback.js');

	const [user] = await db.sql`INSERT INTO users (email, display_name) VALUES ('pano-proof@example.invalid', 'Pano proof') RETURNING id`;
	const sources = { ply: { file: PLY, sha256: await sha256File(PLY), bytes: statSync(PLY).size }, spz: { file: SPZ, sha256: await sha256File(SPZ), bytes: statSync(SPZ).size } };

	const cfg = lib.workerConfig();
	const created = await lib.createCapture(cfg, user.id, {
		source_kind: 'equirect_video',
		source_url: 'https://storage.googleapis.com/three-ws-pano-captures/proof/source.mp4',
		quality: 'standard',
	});
	if (!created.row || created.error) throw new Error(`create failed: ${JSON.stringify(created.error || created)}`);
	const jobId = created.row.id;
	await db.sql`UPDATE pano_captures SET polled_at = now() - interval '10 seconds' WHERE id = ${jobId}`;

	const t0 = Date.now();
	let row = await lib.syncJob(cfg, created.row);
	const finaliseMs = Date.now() - t0;
	if (row.status !== 'succeeded') throw new Error(`job ended ${row.status}: ${JSON.stringify(row.error)} stage=${row.stage}`);

	const files = {};
	for (const [field, saved] of Object.entries(row.result.files)) {
		const src = sources[field];
		let readBack;
		if (saved.store === 'gcs') {
			const res = await fallbackFetch(saved.key);
			readBack = await sha256Stream(res.body);
		} else {
			const out = await r2.send(new GetObjectCommand({ Bucket: process.env.S3_BUCKET, Key: saved.key }));
			readBack = await sha256Stream(out.Body);
		}
		files[field] = {
			key: saved.key,
			store: saved.store,
			bytes: saved.bytes,
			source_sha256: src.sha256,
			recorded_sha256: saved.sha256,
			read_back_sha256: readBack.sha256,
			identical: src.sha256 === saved.sha256 && src.sha256 === readBack.sha256 && src.bytes === readBack.bytes,
		};
	}

	const removed = await lib.removeJob(cfg, row);
	const leftovers = [];
	for (const saved of Object.values(row.result.files)) {
		if (saved.store === 'gcs') {
			if (await fallbackFetch(saved.key, { method: 'HEAD' })) leftovers.push(saved.key);
		} else {
			const gone = await r2.send(new GetObjectCommand({ Bucket: process.env.S3_BUCKET, Key: saved.key })).then(
				() => false,
				(err) => err?.$metadata?.httpStatusCode === 404 || err?.name === 'NoSuchKey',
			);
			if (!gone) leftovers.push(saved.key);
		}
	}
	worker.close();

	const report = {
		leg: LEG,
		bucket: LEG === 'r2' ? process.env.S3_BUCKET : process.env.STORAGE_FALLBACK_BUCKET,
		job_id: jobId,
		status: row.status,
		finalise_ms: finaliseMs,
		viewer_url: row.result.viewer_url,
		files,
		all_identical: Object.values(files).every((f) => f.identical),
		cleanup: { removed, leftovers },
	};
	process.stdout.write(`${JSON.stringify(report)}\n`);
	process.exit(report.all_identical && leftovers.length === 0 ? 0 : 1);
}

main().catch((err) => {
	process.stderr.write(`pano-capture live check failed: ${err?.stack || err}\n`);
	process.exit(1);
});
