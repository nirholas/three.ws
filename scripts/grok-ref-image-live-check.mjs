#!/usr/bin/env node
// Prove the Grok Imagine reference-image flag can never fail a forge job: boot
// the real server (server/index.mjs) on a local port with
// FORGE_REF_IMAGE_PROVIDER=xai, submit a real text-to-3D job through
// POST /api/forge, poll it to the end, and check that the reference step logged
// the xAI fall-through reason and the job still finished on the existing lane.
//
// Real provider env (image lanes, storage, TRELLIS) comes from the three-ws-api
// Cloud Run service into this process only. The database is a throwaway PGlite
// (scripts/lib/isolated-db.mjs) and Redis is unset, so nothing lands in
// production rows or cooldown keys. The platform caller header is a secret
// generated for this run, never the production CRON_SECRET.
//
// Without an xAI key the expected log line is "xai lane skipped (reason=no_key)".
// With a key (order 927) pass --expect-xai to require the job to be served by
// Grok Imagine instead.
//
//   node scripts/grok-ref-image-live-check.mjs [--port 3274] [--prompt "..."] [--expect-xai]
//
// Exit codes: 0 proven; 1 the job failed or the expected log line is missing;
// 2 setup error.

import { randomBytes } from 'node:crypto';
import { loadCloudRunEnv } from './lib/cloud-run-env.mjs';

const args = process.argv.slice(2);
const flag = (name, fallback) => {
	const i = args.indexOf(name);
	return i >= 0 && i + 1 < args.length ? args[i + 1] : fallback;
};
const PORT = Number(flag('--port', '3274'));
const PROMPT = flag('--prompt', "a brass ship's telescope with leather grip");
const EXPECT_XAI = args.includes('--expect-xai');
const JOB_TIMEOUT_MS = 12 * 60_000;
const POLL_MS = 5_000;

const ENV_WANTED =
	/^(NVIDIA_|NIM_|HF_TOKEN$|S3_|R2_|STORAGE_|APP_ORIGIN$|PUBLIC_APP_ORIGIN$|GOOGLE_CLOUD_|GCP_|MODEL_|VERTEX_|TEXT_TO_IMAGE_|REPLICATE_|GROK_API_KEY$|XAI_|OPENROUTER_|GROQ_|CEREBRAS_|CLOUDFLARE_ACCOUNT_ID$|CLOUDFLARE_AI_|OPENAI_API_KEY$|FORGE_|JWT_SECRET$|SESSION_SECRET$)/;

const loaded = loadCloudRunEnv({ wanted: ENV_WANTED, required: ['MODEL_TRELLIS_URL'] });
for (const k of ['REDIS_URL', 'UPSTASH_REDIS_REST_URL', 'UPSTASH_REDIS_REST_TOKEN', 'KV_REST_API_URL', 'KV_REST_API_TOKEN']) delete process.env[k];
if (!EXPECT_XAI) {
	delete process.env.GROK_API_KEY;
	delete process.env.XAI_API_KEY;
}
process.env.DATABASE_URL = 'postgres://isolated.invalid/isolated';
process.env.CRON_SECRET = randomBytes(24).toString('hex');
process.env.FORGE_REF_IMAGE_PROVIDER = 'xai';
process.env.PORT = String(PORT);
console.log(`loaded ${loaded} provider env vars from Cloud Run; database is PGlite, Redis unset, FORGE_REF_IMAGE_PROVIDER=xai`);

// Keep every reference-image log line so the verdict reads the server's own words.
const refLog = [];
for (const level of ['log', 'warn', 'error']) {
	const real = console[level].bind(console);
	console[level] = (...parts) => {
		const line = parts.map((p) => (typeof p === 'string' ? p : String(p?.message ?? p))).join(' ');
		if (/\[forge-reference-image\]|\[text-to-image\]/.test(line)) refLog.push(line);
		real(...parts);
	};
}

const { useIsolatedDb } = await import('./lib/isolated-db.mjs');
await useIsolatedDb();
await import('../server/index.mjs');

const base = `http://127.0.0.1:${PORT}`;
for (let i = 0; i < 60; i++) {
	try {
		const r = await fetch(`${base}/api/forge?catalog`, { signal: AbortSignal.timeout(3_000) });
		if (r.ok) break;
	} catch {
		// server still binding
	}
	await new Promise((r) => setTimeout(r, 500));
}

const headers = { 'content-type': 'application/json', 'x-forge-seed': process.env.CRON_SECRET };
const submit = await fetch(`${base}/api/forge`, { method: 'POST', headers, body: JSON.stringify({ prompt: PROMPT }) });
const submitted = await submit.json().catch(() => ({}));
console.log(`POST /api/forge -> ${submit.status} ${JSON.stringify({ job: submitted.job_id || submitted.job || submitted.id, model: submitted.text_to_image_model, status: submitted.status, error: submitted.error })}`);
const jobId = submitted.job_id || submitted.job || submitted.id;
if (!submit.ok || !jobId) {
	console.error(`submit failed: ${JSON.stringify(submitted).slice(0, 600)}`);
	process.exit(1);
}

const startedAt = Date.now();
let last = submitted;
while (Date.now() - startedAt < JOB_TIMEOUT_MS) {
	await new Promise((r) => setTimeout(r, POLL_MS));
	const r = await fetch(`${base}/api/forge?job=${encodeURIComponent(jobId)}`, { headers });
	last = await r.json().catch(() => ({}));
	if (['done', 'failed', 'error'].includes(last.status)) break;
}

const glb = last.glb_url || last.result_glb_url || last.glbUrl || null;
const servedBy = submitted.text_to_image_model || last.text_to_image_model || null;
const expected = EXPECT_XAI ? /served by xai\/.*\(xai-reference lane\)/ : /xai lane (skipped|failed) \(reason=[a-z_]+\), falling through/;
const fallThrough = refLog.find((l) => expected.test(l));

console.log('\n── verdict ──');
console.log(`job ${jobId}: status=${last.status} after ${Math.round((Date.now() - startedAt) / 1000)}s`);
console.log(`reference image served by: ${servedBy}`);
console.log(`GLB: ${glb}`);
console.log(`${EXPECT_XAI ? 'xai serve' : 'fall-through'} log line: ${fallThrough || 'MISSING'}`);
const ok = last.status === 'done' && Boolean(glb) && Boolean(fallThrough) && (EXPECT_XAI ? /^xai\//.test(servedBy || '') : !/^xai\//.test(servedBy || ''));
console.log(ok ? 'PROVEN' : `NOT PROVEN: ${JSON.stringify(last).slice(0, 600)}`);
process.exit(ok ? 0 : 1);
