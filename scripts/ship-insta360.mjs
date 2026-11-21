#!/usr/bin/env node
/**
 * ship-insta360.mjs: put the Insta360 360 capture lanes into production.
 *
 *   npm run ship:insta360                  # deploy, wire, verify
 *   npm run ship:insta360 -- --dry-run     # read live state, print every mutation, change nothing
 *   npm run ship:insta360 -- --verify-only # only the production lane checks (run after deploy:gcp:full)
 *   npm run ship:insta360 -- --skip-verify # deploy and wire, no lane jobs
 *   npm run ship:insta360 -- --region us-central1   # pin the GPU region
 *
 * Steps:
 *   1. Check every verified digest in deploy/insta360/images.json exists in Artifact Registry.
 *   2. Pick the GPU region from live L4 quota minus warm pins held by other services.
 *   3. Create or update model-pano2splat and model-panodepth (L4, min 0, max 1,
 *      runtime SA three-ws@) and roll model-video2motion to its verified image.
 *   4. Wait for each worker's /health to report ready (GPU present, weights loaded).
 *   5. Point three-ws-api at the workers with --update-env-vars (never --set-env-vars).
 *   6. Run one authenticated preview job per lane through https://three.ws on a real fixture.
 *   7. Print a summary.
 *
 * It never pushes git and never runs deploy:gcp:full; those stay separate owner
 * commands. Lane checks report "deferred" when the production API predates the
 * campaign (route 404); rerun with --verify-only after deploy:gcp:full.
 *
 * Runbook: docs/ops/insta360-ship.md. Plan logic: scripts/lib/insta360-ship-plan.mjs.
 */

import { spawnSync } from 'node:child_process';
import './lib/gcloud-path.mjs';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';
import {
	API_SERVICE,
	GPU_REGIONS,
	GPU_SERVICES,
	L4_QUOTA_METRIC,
	PRODUCTION_ORIGIN,
	PROJECT,
	VIDEO2MOTION,
	apiEnvArgs,
	apiEnvDiff,
	chooseGpuRegion,
	gpuDeployArgs,
	heldGpus,
	isRouteMissing,
	judgePoll,
	laneChecks,
	parseImagesFile,
	video2motionUpdateArgs,
} from './lib/insta360-ship-plan.mjs';

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const IMAGES_FILE = resolve(REPO_ROOT, 'deploy/insta360/images.json');

const argv = process.argv.slice(2);
const DRY = argv.includes('--dry-run');
const VERIFY_ONLY = argv.includes('--verify-only');
const SKIP_VERIFY = argv.includes('--skip-verify');
const regionFlag = argv.indexOf('--region');
const REGION_OVERRIDE = regionFlag >= 0 ? argv[regionFlag + 1] : null;
const POLL_MS = 15_000;
const HEALTH_TIMEOUT_MS = 20 * 60_000;

const summary = [];
const log = (msg) => console.log(msg);
const step = (msg) => console.log(`\n== ${msg}`);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function gcloud(args, { mutate = false, allowFail = false } = {}) {
	const printable = `gcloud ${args.map((a) => (/[\s,=]/.test(a) && !a.startsWith('--') ? JSON.stringify(a) : a)).join(' ')}`;
	if (mutate && DRY) {
		log(`  [dry-run] ${printable}`);
		return { ok: true, stdout: '', dry: true };
	}
	if (mutate) log(`  $ ${printable}`);
	const r = spawnSync('gcloud', args, { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
	const ok = r.status === 0;
	if (!ok && !allowFail) {
		throw new Error(`${printable}\n  failed (exit ${r.status}): ${(r.stderr || r.error?.message || '').trim().slice(0, 2000)}`);
	}
	return { ok, stdout: (r.stdout || '').trim(), stderr: (r.stderr || '').trim() };
}

function gcloudJson(args) {
	const r = gcloud([...args, '--format=json']);
	return r.stdout ? JSON.parse(r.stdout) : null;
}

// A real run refuses to start without every verified digest. A dry run keeps
// going so the owner can see the rest of the plan, and names what is missing.
function readImages() {
	const raw = readFileSync(IMAGES_FILE, 'utf8');
	const { images, missing } = parseImagesFile(raw);
	if (missing.length && !DRY) throw new Error(`deploy/insta360/images.json has no verified image for: ${missing.join(', ')}`);
	for (const key of missing) {
		log(`  BLOCKER: deploy/insta360/images.json has no verified image for ${key}; a real run stops here`);
		summary.push([`image ${key}`, 'missing: record the GPU-verified digest in deploy/insta360/images.json']);
	}
	return images;
}

function checkImagesExist(images) {
	step('1. Verified images exist in Artifact Registry');
	for (const [key, ref] of Object.entries(images)) {
		gcloud(['artifacts', 'docker', 'images', 'describe', ref, `--project=${PROJECT}`, '--format=value(image_summary.digest)']);
		log(`  ok  ${key}  ${ref}`);
	}
}

async function readL4Quotas() {
	const token = gcloud(['auth', 'print-access-token']).stdout;
	const metric = encodeURIComponent(L4_QUOTA_METRIC);
	const url = `https://serviceusage.googleapis.com/v1beta1/projects/${PROJECT}/services/run.googleapis.com/consumerQuotaMetrics/${metric}`;
	const res = await fetch(url, { headers: { authorization: `Bearer ${token}`, 'x-goog-user-project': PROJECT } });
	if (!res.ok) throw new Error(`L4 quota lookup answered ${res.status}: ${(await res.text()).slice(0, 400)}`);
	const data = await res.json();
	const quotas = {};
	for (const limit of data.consumerQuotaLimits || []) {
		for (const bucket of limit.quotaBuckets || []) {
			const region = bucket.dimensions?.region;
			if (region) quotas[region] = Number(bucket.effectiveLimit) || 0;
		}
	}
	return quotas;
}

function readGpuPins(region) {
	const list = gcloudJson(['run', 'services', 'list', `--project=${PROJECT}`, `--region=${region}`]) || [];
	const own = GPU_SERVICES.map((s) => s.name);
	const services = list.map((svc) => {
		const tmpl = svc.spec?.template;
		const ann = tmpl?.metadata?.annotations || {};
		const limits = tmpl?.spec?.containers?.[0]?.resources?.limits || {};
		return {
			name: svc.metadata?.name,
			gpu: Boolean(limits['nvidia.com/gpu']),
			minScale: Number(ann['autoscaling.knative.dev/minScale']) || 0,
		};
	});
	return heldGpus(services, own);
}

async function pickRegion() {
	step('2. GPU region from live L4 quota');
	const quotas = await readL4Quotas();
	const held = {};
	for (const { region } of GPU_REGIONS) held[region] = readGpuPins(region);
	const pick = chooseGpuRegion({ quotas, held, override: REGION_OVERRIDE });
	for (const r of pick.report) log(`  ${r.region}: L4 limit ${r.limit}, warm pins ${r.held}, free ${r.headroom}`);
	log(`  -> ${pick.region}`);
	summary.push(['GPU region', `${pick.region} (free L4 ${pick.headroom})`]);
	return pick;
}

function serviceUrl(name, region) {
	const r = gcloud(['run', 'services', 'describe', name, `--project=${PROJECT}`, `--region=${region}`, '--format=value(status.url)'], { allowFail: true });
	return r.ok && r.stdout ? r.stdout : null;
}

function deployWorkers(images, region) {
	step('3. Create or update the workers');
	const urls = {};
	for (const spec of GPU_SERVICES) {
		const existed = serviceUrl(spec.name, region.region);
		if (!images[spec.key]) {
			log(`  ${spec.name}: skipped in this dry run (no verified image)`);
			urls[spec.key] = existed;
			continue;
		}
		log(`  ${spec.name}: ${existed ? `update (${existed})` : 'create'} in ${region.region}`);
		gcloud(gpuDeployArgs(spec, { region: region.region, image: images[spec.key] }), { mutate: true });
		urls[spec.key] = DRY ? existed : serviceUrl(spec.name, region.region);
		summary.push([spec.name, `${images[spec.key].split('@')[1].slice(0, 19)} at ${urls[spec.key] || '(URL assigned on create)'}`]);
	}
	const v2mCurrent = gcloud(['run', 'services', 'describe', VIDEO2MOTION.name, `--project=${PROJECT}`, `--region=${VIDEO2MOTION.region}`, '--format=value(spec.template.spec.containers[0].image)']).stdout;
	urls.video2motion = serviceUrl(VIDEO2MOTION.name, VIDEO2MOTION.region);
	if (!images.video2motion) {
		log(`  ${VIDEO2MOTION.name}: skipped in this dry run (no verified image), stays on ${v2mCurrent}`);
		return urls;
	}
	if (v2mCurrent === images.video2motion) {
		log(`  ${VIDEO2MOTION.name}: already on ${images.video2motion}`);
	} else {
		log(`  ${VIDEO2MOTION.name}: ${v2mCurrent} -> ${images.video2motion}`);
		gcloud(video2motionUpdateArgs(images.video2motion), { mutate: true });
	}
	summary.push([VIDEO2MOTION.name, `${images.video2motion.split('@')[1].slice(0, 19)} at ${urls.video2motion}`]);
	return urls;
}

async function waitHealthy(urls) {
	step('4. Wait for /health');
	const specs = [...GPU_SERVICES, VIDEO2MOTION];
	if (DRY) {
		for (const spec of specs) log(`  [dry-run] poll ${urls[spec.key] || `<${spec.name} URL>`}/health until ready`);
		return;
	}
	await Promise.all(
		specs.map(async (spec) => {
			const deadline = Date.now() + HEALTH_TIMEOUT_MS;
			let last = '';
			while (Date.now() < deadline) {
				try {
					const res = await fetch(`${urls[spec.key]}/health`, { signal: AbortSignal.timeout(120_000) });
					const body = await res.json().catch(() => null);
					if (res.ok && spec.health(body)) {
						log(`  ok  ${spec.name}  ${JSON.stringify(body)}`);
						return;
					}
					last = `${res.status} ${JSON.stringify(body)}`;
				} catch (err) {
					last = err.message;
				}
				await sleep(POLL_MS);
			}
			throw new Error(`${spec.name} never reported ready at ${urls[spec.key]}/health (last: ${last})`);
		}),
	);
}

function wireApi(urls) {
	step(`5. Point ${API_SERVICE.name} at the workers`);
	const env = gcloudJson(['run', 'services', 'describe', API_SERVICE.name, `--project=${PROJECT}`, `--region=${API_SERVICE.region}`]);
	const current = Object.fromEntries((env?.spec?.template?.spec?.containers?.[0]?.env || []).map((e) => [e.name, e.value ?? `<secret ${e.valueFrom?.secretKeyRef?.name}>`]));
	if (!current.GCP_RECONSTRUCTION_KEY) throw new Error(`${API_SERVICE.name} has no GCP_RECONSTRUCTION_KEY; the workers would reject every call`);
	const unknown = GPU_SERVICES.filter((s) => !urls[s.key]);
	if (unknown.length) {
		for (const s of unknown) log(`  [dry-run] ${s.envVar}: ${current[s.envVar] ?? '(unset)'} -> URL of ${s.name} once it exists`);
		summary.push([API_SERVICE.name, `env update waits on ${unknown.map((s) => s.name).join(', ')}`]);
		return;
	}
	const diff = apiEnvDiff(current, urls);
	for (const d of diff) log(`  ${d.name}: ${d.prev ?? '(unset)'} -> ${d.next}${d.changed ? '' : ' (unchanged)'}`);
	if (diff.some((d) => d.changed)) gcloud(apiEnvArgs(urls), { mutate: true });
	else log('  nothing to change');
	summary.push([API_SERVICE.name, diff.map((d) => `${d.name}${d.changed ? ' set' : ' unchanged'}`).join(', ')]);
}

async function api(method, url, apiKey, body) {
	const res = await fetch(url, {
		method,
		headers: { authorization: `Bearer ${apiKey}`, 'content-type': 'application/json', accept: 'application/json' },
		body: body ? JSON.stringify(body) : undefined,
		signal: AbortSignal.timeout(120_000),
	});
	const text = await res.text();
	let data;
	try {
		data = JSON.parse(text);
	} catch {
		data = text;
	}
	return { status: res.status, data };
}

async function runLane(check, apiKey) {
	const started = Date.now();
	const submit = await api('POST', check.submit.url, apiKey, check.submit.body);
	if (isRouteMissing(submit.status, submit.data)) return { key: check.key, state: 'deferred', detail: 'route not in production yet; rerun --verify-only after deploy:gcp:full' };
	const jobId = submit.data?.job_id;
	if (submit.status !== 202 || !jobId) {
		return { key: check.key, state: 'failed', detail: `submit answered ${submit.status}: ${JSON.stringify(submit.data).slice(0, 400)}` };
	}
	log(`  ${check.key}: job ${jobId} submitted`);
	let lastDetail = '';
	while (Date.now() - started < check.timeoutMs) {
		await sleep(POLL_MS);
		const poll = await api('GET', check.poll(jobId), apiKey);
		if (poll.status >= 500 || poll.status === 429) {
			lastDetail = `poll ${poll.status}`;
			continue;
		}
		if (poll.status !== 200) return { key: check.key, state: 'failed', jobId, detail: `poll answered ${poll.status}: ${JSON.stringify(poll.data).slice(0, 400)}` };
		const verdict = judgePoll(check, poll.data);
		if (verdict.detail !== lastDetail) log(`  ${check.key}: ${verdict.detail}`);
		lastDetail = verdict.detail;
		if (verdict.state !== 'running') return { key: check.key, jobId, seconds: Math.round((Date.now() - started) / 1000), ...verdict };
	}
	if (check.cleanup) await api('DELETE', check.cleanup(jobId), apiKey).catch(() => null);
	return { key: check.key, state: 'failed', jobId, detail: `no result after ${Math.round(check.timeoutMs / 60_000)} min (last: ${lastDetail})` };
}

async function verifyLanes() {
	step(`6. Lane checks through ${PRODUCTION_ORIGIN}`);
	const checks = laneChecks(PRODUCTION_ORIGIN);
	if (DRY) {
		// Read-only probe: an unauthenticated GET tells a deployed route (401/400/405)
		// from one the production API does not have yet (route-miss 404).
		for (const c of checks) {
			const probe = await fetch(c.submit.url, { signal: AbortSignal.timeout(30_000) })
				.then(async (r) => ({ status: r.status, body: await r.text() }))
				.catch((err) => ({ status: 0, body: err.message }));
			const live = probe.status === 0 ? `unreachable (${probe.body})` : isRouteMissing(probe.status, probe.body) ? 'NOT deployed yet (lane will report deferred)' : `deployed (GET answered ${probe.status})`;
			log(`  [dry-run] POST ${c.submit.url} ${JSON.stringify(c.submit.body)}; poll until ${c.artifacts.join(', ')}`);
			log(`            route: ${live}`);
			summary.push([`lane ${c.key}`, `route ${live}`]);
		}
		return [];
	}
	dotenv.config({ path: resolve(REPO_ROOT, '.env'), quiet: true });
	const apiKey = process.env.THREE_WS_API_KEY;
	if (!apiKey) throw new Error('THREE_WS_API_KEY is not set (.env); the lane checks call the production API as a signed-in account');
	const results = await Promise.all(checks.map((c) => runLane(c, apiKey).catch((err) => ({ key: c.key, state: 'failed', detail: err.message }))));
	for (const r of results) {
		const files = r.files ? ` ${Object.values(r.files).map((u) => u.split('?')[0]).join(' ')}` : '';
		summary.push([`lane ${r.key}`, `${r.state}${r.seconds ? ` in ${r.seconds}s` : ''}: ${r.detail}${files}`]);
	}
	return results;
}

async function main() {
	log(`ship:insta360${DRY ? ' (dry run: live reads, no changes)' : ''}${VERIFY_ONLY ? ' (verify only)' : ''}`);
	let lanes = [];
	if (!VERIFY_ONLY) {
		const images = readImages();
		checkImagesExist(images);
		const region = await pickRegion();
		const urls = deployWorkers(images, region);
		await waitHealthy(urls);
		wireApi(urls);
	}
	if (!SKIP_VERIFY) lanes = await verifyLanes();

	step('Summary');
	const width = Math.max(...summary.map(([k]) => k.length), 4);
	for (const [k, v] of summary) log(`  ${k.padEnd(width)}  ${v}`);
	if (DRY) log('\nDry run: nothing was changed.');
	const failed = lanes.filter((l) => l.state === 'failed');
	const deferred = lanes.filter((l) => l.state === 'deferred');
	if (deferred.length) log(`\n${deferred.length} lane(s) deferred. After deploy:gcp:full run: npm run ship:insta360 -- --verify-only`);
	if (failed.length) {
		console.error(`\n${failed.length} lane(s) failed. Rollback: docs/ops/insta360-ship.md#rollback`);
		process.exit(1);
	}
}

main().catch((err) => {
	console.error(`\nship:insta360 stopped: ${err.message}`);
	console.error('Nothing after this step ran. Rollback per service: docs/ops/insta360-ship.md#rollback');
	process.exit(1);
});
