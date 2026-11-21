#!/usr/bin/env node
// Local API server for exercising /api/pano-capture and the /mine captures
// shelf in a real browser, end to end, without touching production data.
//
//   PORT=3349 node scripts/pano-capture-live-server.mjs --cookie-file <path> \
//     --ply <file.ply> --spz <file.spz> [--worker-port 3348]
//   DEV_API_PROXY=http://localhost:3349 npx vite --port 3339 --strictPort
//
// Runs the real server/index.mjs (the process that serves production) on a
// throwaway in-process Postgres (scripts/lib/isolated-db.mjs), writing to the
// production R2 bucket with the working cloudflare-r2-* credential pair read
// from Secret Manager in-process (never printed). A local server speaking
// worker contract C1 stands in for workers/model-pano2splat and serves the
// real splat files as its results, so a finished capture is a real scene the
// finaliser copied into the bucket. Which way a task goes follows the source
// URL's file name: one containing "running" stays at 40 percent, one
// containing "unreadable" is refused at submit, anything else succeeds.
//
// The account's session token is written to --cookie-file (mode 0600) as the
// value of the __Host-sid cookie, never printed.

import { execFileSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { createReadStream, statSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import path from 'node:path';

const args = process.argv.slice(2);
const flag = (name, d) => (args.includes(name) ? args[args.indexOf(name) + 1] : d);
const COOKIE_FILE = flag('--cookie-file');
const PLY = flag('--ply');
const SPZ = flag('--spz');
const WORKER_PORT = Number(flag('--worker-port', 3348));
const PORT = Number(process.env.PORT || 3349);
if (!COOKIE_FILE || !PLY || !SPZ) {
	process.stderr.write('usage: pano-capture-live-server.mjs --cookie-file <path> --ply <file> --spz <file>\n');
	process.exit(2);
}

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const quiet = { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], cwd: ROOT, env: { ...process.env, TMPDIR: process.env.TMPDIR || '/home/user/.cache/gcloud-tmp' } };
const serviceEnv = (name) => execFileSync('node', ['scripts/read-service-env.mjs', `^${name}$`, '--raw'], quiet).trim();
const secret = (name) => execFileSync('gcloud', ['secrets', 'versions', 'access', 'latest', `--secret=${name}`], quiet).trim();

for (const name of ['S3_ENDPOINT', 'S3_BUCKET', 'S3_PUBLIC_DOMAIN']) process.env[name] = serviceEnv(name);
process.env.S3_ACCESS_KEY_ID = secret('cloudflare-r2-access-key-id');
process.env.S3_SECRET_ACCESS_KEY = secret('cloudflare-r2-secret-access-key');
delete process.env.STORAGE_FALLBACK_BUCKET;

process.env.DATABASE_URL = 'postgres://isolated.invalid/isolated';
process.env.JWT_SECRET = randomBytes(32).toString('hex');
process.env.APP_ORIGIN = `http://localhost:${PORT}`;
for (const v of ['UPSTASH_REDIS_REST_URL', 'UPSTASH_REDIS_REST_TOKEN', 'REDIS_URL', 'KV_REST_API_URL', 'KV_REST_API_TOKEN', 'RESEND_API_KEY']) {
	delete process.env[v];
}

// ── The C1 stand-in ─────────────────────────────────────────────────────────
const workerKey = randomBytes(16).toString('hex');
process.env.GCP_PANO2SPLAT_URL = `http://127.0.0.1:${WORKER_PORT}`;
process.env.GCP_RECONSTRUCTION_KEY = workerKey;
const tasks = new Map();
const served = { 'scene.ply': PLY, 'scene.spz': SPZ };
const worker = createServer(async (req, res) => {
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
	if (req.headers.authorization !== `Bearer ${workerKey}`) return reply(401, { error: { code: 'unauthorized', message: 'bad bearer' } });
	const chunks = [];
	for await (const c of req) chunks.push(c);
	if (req.method === 'POST' && url.pathname === '/infer') {
		const job = JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}');
		const name = String(job.source_url || '').split('/').pop();
		if (name.includes('unreadable')) {
			return reply(422, { error: { code: 'bad_source', message: 'The footage is not an equirectangular 360 video.' } });
		}
		const id = `local-${randomBytes(4).toString('hex')}`;
		tasks.set(id, name.includes('running') ? 'running' : 'succeeded');
		return reply(202, { task_id: id });
	}
	const m = url.pathname.match(/^\/tasks\/([^/]+)$/);
	if (m && tasks.has(m[1])) {
		if (req.method === 'DELETE') {
			tasks.set(m[1], 'cancelled');
			return reply(200, { status: 'cancelled' });
		}
		const state = tasks.get(m[1]);
		if (state === 'running') return reply(200, { status: 'running', stage: 'train', progress: 0.4 });
		if (state === 'cancelled') return reply(200, { status: 'cancelled' });
		const base = `http://127.0.0.1:${WORKER_PORT}/files`;
		return reply(200, {
			status: 'succeeded',
			stage: 'done',
			progress: 1,
			result: { ply_url: `${base}/scene.ply`, spz_url: `${base}/scene.spz`, stats: { gaussians: 0 } },
		});
	}
	return reply(404, { error: { code: 'not_found', message: 'no such task' } });
});
await new Promise((resolve) => worker.listen(WORKER_PORT, '127.0.0.1', resolve));

// ── Isolated database, account and session ──────────────────────────────────
const { useIsolatedDb } = await import('./lib/isolated-db.mjs');
const { sql } = await useIsolatedDb();
const { createSession } = await import('../api/_lib/auth.js');
const [user] = await sql`insert into users (email, display_name, email_verified) values ('pano-capture-proof@example.invalid', 'Capture proof', true) returning id`;
const token = await createSession({ userId: user.id, userAgent: 'pano-capture-live-server', recordActivity: false });
writeFileSync(COOKIE_FILE, token, { mode: 0o600 });
process.stdout.write(`pano-capture live server: user ${user.id}, session written to ${COOKIE_FILE}, worker on ${WORKER_PORT}\n`);

await import('../server/index.mjs');
