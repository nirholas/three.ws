#!/usr/bin/env node
/**
 * deploy-sniper.mjs — build, push, and deploy the agent-sniper worker to Cloud
 * Run, idempotently, following the house pattern (see deploy/world/*).
 *
 * The agent-sniper worker (workers/agent-sniper) is a long-lived background
 * process — it holds the PumpPortal feed open and snipes from agent wallets, so
 * it cannot run on Vercel. This script is the repeatable deploy:
 *
 *   1. verify gcloud is installed + authenticated
 *   2. enable the required GCP APIs (idempotent)
 *   3. ensure the runtime service account + the Artifact Registry repo exist
 *   4. preflight the secrets the service config mounts (warn if missing)
 *   4b. boot the worker from exactly the files the Dockerfile COPYs, so a runtime
 *      read outside that set fails here in seconds instead of as a revision
 *      Cloud Run refuses to start after a full build
 *   5. build + push the image via Cloud Build (deploy/sniper/cloudbuild.yaml)
 *   6. deploy the service (deploy/sniper/cloudrun.yaml) — minScale=maxScale=1,
 *      no CPU throttling, default SNIPER_MODE=simulate
 *   7. verify the worker reported a fresh heartbeat (proves it actually booted
 *      and connected — not just that the revision rolled out)
 *
 * Usage:
 *   node scripts/deploy-sniper.mjs                 # build + deploy (simulate)
 *   node scripts/deploy-sniper.mjs --skip-build    # redeploy current image only
 *   node scripts/deploy-sniper.mjs --dry-run       # print the gcloud commands, run nothing
 *
 * SIMULATE is the default and the only mode this script deploys. Going LIVE is a
 * deliberate, separate cutover — see deploy/sniper/README.md ("Cutover to live").
 * This script will NOT flip a service to live.
 *
 * Env (overridable):
 *   GCP_PROJECT   default aerial-vehicle-466722-p5   (the platform's Cloud Run project)
 *   GCP_REGION    default us-central1
 */

import { spawnSync } from 'node:child_process';
import './lib/gcloud-path.mjs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve, basename, join } from 'node:path';
import { tmpdir } from 'node:os';
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync } from 'node:fs';
import { parseImageDigest, resolveRolloutImage } from './lib/sniper-rollout-image.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(__dirname, '..');

const PROJECT = process.env.GCP_PROJECT || 'aerial-vehicle-466722-p5';
const REGION = process.env.GCP_REGION || 'us-central1';
const REPO = 'workers'; // Artifact Registry repo (shared by the worker images)
const SERVICE = 'agent-sniper';
const RUNTIME_SA = `agent-sniper-sa@${PROJECT}.iam.gserviceaccount.com`;
// Build identity for `gcloud builds submit`. This project has no legacy Cloud
// Build service account (newer GCP projects don't auto-create
// <projectNumber>@cloudbuild.gserviceaccount.com), so an unqualified submit fails
// with "Unknown service account". Run the build as the dedicated build SA the
// other images already use; override with BUILD_SERVICE_ACCOUNT if it's renamed.
// The cloudbuild.yaml sets `logging: CLOUD_LOGGING_ONLY`, which a user-specified
// build SA requires (no default logs bucket).
const BUILD_SA = process.env.BUILD_SERVICE_ACCOUNT || `three-ws-build@${PROJECT}.iam.gserviceaccount.com`;
const CLOUDBUILD = 'deploy/sniper/cloudbuild.yaml';
const CLOUDRUN = 'deploy/sniper/cloudrun.yaml';

// Secrets the cloudrun.yaml mounts. database-url + jwt-secret are mandatory;
// solana-rpc-url is required only for the live cutover; telegram-* enable ops
// alerting and are optional.
const REQUIRED_SECRETS = ['sniper-database-url', 'sniper-jwt-secret'];
const OPTIONAL_SECRETS = ['sniper-solana-rpc-url', 'telegram-bot-token', 'telegram-alerts-chat-id'];

const args = process.argv.slice(2);
const DRY_RUN = args.includes('--dry-run');
const SKIP_BUILD = args.includes('--skip-build');

const C = { cyan: '\x1b[1;36m', green: '\x1b[1;32m', yellow: '\x1b[1;33m', red: '\x1b[1;31m', reset: '\x1b[0m' };
const log = (m) => console.log(`${C.cyan}[deploy-sniper]${C.reset} ${m}`);
const ok = (m) => console.log(`${C.green}[deploy-sniper] ✓${C.reset} ${m}`);
const warn = (m) => console.warn(`${C.yellow}[deploy-sniper] !${C.reset} ${m}`);
const die = (m) => { console.error(`${C.red}[deploy-sniper] ERROR:${C.reset} ${m}`); process.exit(1); };

/** Run a command. Returns {status, stdout, stderr}. Honors --dry-run for mutating gcloud calls. */
function run(cmd, cmdArgs, { mutating = true, capture = false } = {}) {
	const pretty = `${cmd} ${cmdArgs.join(' ')}`;
	if (DRY_RUN && mutating) {
		console.log(`${C.yellow}[dry-run]${C.reset} ${pretty}`);
		return { status: 0, stdout: '', stderr: '' };
	}
	const res = spawnSync(cmd, cmdArgs, {
		cwd: REPO_ROOT,
		encoding: 'utf8',
		stdio: capture ? ['ignore', 'pipe', 'pipe'] : 'inherit',
	});
	return { status: res.status ?? 1, stdout: res.stdout || '', stderr: res.stderr || '' };
}

function gcloud(cmdArgs, opts) {
	return run('gcloud', [...cmdArgs, `--project=${PROJECT}`], opts);
}

function preflight() {
	if (run('gcloud', ['version'], { mutating: false, capture: true }).status !== 0) {
		die('gcloud not found on PATH. Install the Cloud SDK: https://cloud.google.com/sdk/docs/install');
	}
	const token = run('gcloud', ['auth', 'print-access-token'], { mutating: false, capture: true });
	if (token.status !== 0) {
		die("gcloud is not authenticated — run 'gcloud auth login' (a deployer with Cloud Run + Cloud Build + Artifact Registry + Secret Manager access on " + PROJECT + ').');
	}
	for (const f of [CLOUDBUILD, CLOUDRUN, 'workers/agent-sniper/Dockerfile']) {
		if (!existsSync(resolve(REPO_ROOT, f))) die(`missing ${f} — run from the repo root`);
	}
	ok('gcloud authenticated; deploy artifacts present');
}

function enableApis() {
	log('enabling required APIs (idempotent)…');
	const r = gcloud(['services', 'enable',
		'run.googleapis.com', 'cloudbuild.googleapis.com',
		'artifactregistry.googleapis.com', 'secretmanager.googleapis.com',
	]);
	if (r.status !== 0) die('failed to enable APIs (insufficient permission on ' + PROJECT + '?)');
	ok('APIs enabled');
}

function ensureServiceAccount() {
	const exists = gcloud(['iam', 'service-accounts', 'describe', RUNTIME_SA], { mutating: false, capture: true });
	if (exists.status === 0) { ok(`runtime SA exists: ${RUNTIME_SA}`); return; }
	log(`creating runtime SA ${RUNTIME_SA}…`);
	const r = gcloud(['iam', 'service-accounts', 'create', 'agent-sniper-sa',
		'--display-name=agent-sniper worker runtime']);
	if (r.status !== 0 && !DRY_RUN) warn('could not create the runtime SA (may already exist or lack permission) — verify it manually');
	else ok('runtime SA ready');
}

function ensureRepo() {
	const exists = gcloud(['artifacts', 'repositories', 'describe', REPO, `--location=${REGION}`],
		{ mutating: false, capture: true });
	if (exists.status === 0) { ok(`Artifact Registry repo exists: ${REPO}`); return; }
	log(`creating Artifact Registry repo ${REPO} in ${REGION}…`);
	const r = gcloud(['artifacts', 'repositories', 'create', REPO,
		'--repository-format=docker', `--location=${REGION}`,
		'--description=three.ws long-lived worker images']);
	if (r.status !== 0 && !DRY_RUN) die('failed to create Artifact Registry repo');
	ok('Artifact Registry repo ready');
}

function checkSecrets() {
	log('checking mounted secrets…');
	for (const name of REQUIRED_SECRETS) {
		const r = gcloud(['secrets', 'describe', name], { mutating: false, capture: true });
		if (r.status !== 0) {
			die(`required secret "${name}" is missing. Create it (NEVER commit secrets):\n` +
				`  printf '%s' "$VALUE" | gcloud secrets create ${name} --data-file=- --project=${PROJECT}\n` +
				`  gcloud secrets add-iam-policy-binding ${name} --project=${PROJECT} \\\n` +
				`    --member=serviceAccount:${RUNTIME_SA} --role=roles/secretmanager.secretAccessor`);
		}
		ok(`secret present: ${name}`);
	}
	for (const name of OPTIONAL_SECRETS) {
		const r = gcloud(['secrets', 'describe', name], { mutating: false, capture: true });
		if (r.status !== 0) {
			warn(`optional secret "${name}" is missing — ${name === 'sniper-solana-rpc-url'
				? 'REQUIRED before the live cutover (live mode refuses a public RPC)'
				: 'ops alerting via Telegram will be disabled'}.`);
		} else {
			ok(`secret present: ${name}`);
		}
	}
}

/**
 * The source paths the sniper Dockerfile COPYs into /app, as
 * [{ from, to }] pairs relative to the repo root and to /app. Only plain
 * `COPY <src...> <dest>` lines (no --from/--chown flags) are read, and a
 * trailing `*` glob (package-lock.json*) is kept only when the file exists.
 */
function dockerfileCopies(dockerfile) {
	const pairs = [];
	for (const raw of dockerfile.split('\n')) {
		const line = raw.trim();
		if (!/^COPY\s/i.test(line) || /\s--/.test(line)) continue;
		const parts = line.split(/\s+/).slice(1);
		const dest = parts.pop();
		for (const srcRaw of parts) {
			const src = srcRaw.replace(/\*$/, '');
			const to = dest.endsWith('/') ? join(dest, basename(src)) : dest;
			pairs.push({ from: src, to: to.replace(/^\.\//, ''), optional: srcRaw.endsWith('*') });
		}
	}
	return pairs;
}

/**
 * Boot workers/agent-sniper/index.js from a tree holding ONLY what the image
 * holds (the Dockerfile's COPY set plus the installed node_modules), with the
 * database env stripped. A healthy module graph loads completely and then stops
 * at the config check with "missing required env var: DATABASE_URL"; anything
 * else (ENOENT on a data file, ERR_MODULE_NOT_FOUND on a path the image lacks)
 * is exactly what would crash the revision before its health port opens.
 * On 2026-09-29 a read of data/plans.json did that, and Cloud Run refused the
 * revision after a full 8-minute build.
 */
function verifyImageBoots() {
	log('booting the worker from the image file set (Dockerfile COPYs only)…');
	const stage = mkdtempSync(join(tmpdir(), 'sniper-image-'));
	let failure;
	try {
		failure = bootFromStage(stage);
	} finally {
		rmSync(stage, { recursive: true, force: true });
	}
	if (failure) die(failure);
	ok('worker module graph loads from the image file set');
}

/** Stage the image file set into `stage` and boot it. Returns an error message, or null. */
function bootFromStage(stage) {
	const pairs = dockerfileCopies(readFileSync(resolve(REPO_ROOT, 'workers/agent-sniper/Dockerfile'), 'utf8'));
	for (const { from, to, optional } of pairs) {
		const src = resolve(REPO_ROOT, from);
		if (!existsSync(src)) {
			if (optional) continue;
			return `the Dockerfile COPYs ${from}, which does not exist in the build context`;
		}
		const dst = join(stage, to);
		mkdirSync(dirname(dst), { recursive: true });
		cpSync(src, dst, { recursive: true, filter: (p) => !p.split(/[\\/]/).includes('node_modules') });
	}
	const modules = resolve(REPO_ROOT, 'node_modules');
	if (!existsSync(modules)) return 'node_modules is missing: run `npm install` so the boot check can load the worker';
	symlinkSync(modules, join(stage, 'node_modules'), 'dir');

	const env = { ...process.env, NODE_ENV: 'production', SNIPER_MODE: 'simulate' };
	for (const k of ['DATABASE_URL', 'POSTGRES_URL', 'NEON_DATABASE_URL', 'PORT']) delete env[k];
	const res = spawnSync(process.execPath, ['workers/agent-sniper/index.js'], {
		cwd: stage, env, encoding: 'utf8', timeout: 60_000,
	});
	const out = `${res.stdout || ''}${res.stderr || ''}`;
	if (/missing required env var: DATABASE_URL/.test(out)) return null;
	const detail = out.split('\n').filter(Boolean).slice(0, 12).join('\n');
	return 'the worker does not boot from the image file set. A module or data file it loads is not COPYd by workers/agent-sniper/Dockerfile:\n' + detail;
}

function build() {
	if (SKIP_BUILD) { warn('--skip-build: reusing the current :latest image'); return; }
	log('building + pushing image via Cloud Build (this can take several minutes)…');
	const r = gcloud([
		'builds', 'submit',
		`--config=${CLOUDBUILD}`,
		`--service-account=projects/${PROJECT}/serviceAccounts/${BUILD_SA}`,
		'.',
	]);
	if (r.status !== 0) die('Cloud Build failed — see the build logs above');
	ok('image built + pushed');
}

function deploy() {
	// Read the mode straight from the manifest being applied so the log never
	// lies about whether this deploy spends real SOL.
	let mode = 'unknown';
	try {
		const yaml = readFileSync(CLOUDRUN, 'utf8');
		const m = yaml.match(/name:\s*SNIPER_MODE[\s\S]*?value:\s*["']?(live|simulate)/);
		if (m) mode = m[1];
	} catch { /* fall back to "unknown" in the log */ }

	// An existing service may carry env the manifest does not know about: the
	// live cutover (SNIPER_MODE=live), WALLET_ENCRYPTION_KEY, the RPC failover
	// chain, LLM keys. `services replace` would wipe every one of them: that
	// exact footgun was caught mid-deploy on 2026-08-09, where a replace would
	// have silently flipped the live fleet back to simulate AND removed the
	// wallet decryption key. So: replace only on first deploy; after that, roll
	// code with `services update --image`, which preserves the running config.
	const existing = gcloud(['run', 'services', 'describe', SERVICE, `--region=${REGION}`,
		'--format=value(spec.template.spec.containers[0].image)'], { mutating: false, capture: true });
	if (existing.status === 0 && existing.stdout.trim()) {
		// Roll the image the build just pushed (or, with --skip-build, the current
		// :latest), never the service's own running image: re-rolling that shipped
		// a stale broken digest after a green build on 2026-11-19.
		const imageRepo = `${REGION}-docker.pkg.dev/${PROJECT}/${REPO}/${SERVICE}`;
		const described = gcloud(['artifacts', 'docker', 'images', 'describe', `${imageRepo}:latest`,
			'--format=value(image_summary.digest)'], { mutating: false, capture: true });
		if (described.status !== 0) die(`could not resolve the digest of ${imageRepo}:latest`);
		let image;
		try { image = resolveRolloutImage({ imageRepo, latestDigest: parseImageDigest(described.stdout) || described.stdout.trim() }); }
		catch (e) { die(e.message); }
		log(`service exists (was ${existing.stdout.trim()}): rolling a new revision of ${image} (running env preserved, incl. any live cutover)…`);
		const r = gcloud(['run', 'services', 'update', SERVICE, `--region=${REGION}`, `--image=${image}`]);
		if (r.status !== 0) die('gcloud run services update failed');
		ok('new revision rolled out with the running config intact');
		warn('the checked-in cloudrun.yaml was NOT applied (it would clobber the running env). To change service config, use `gcloud run services update --update-env-vars` per key.');
		return;
	}

	log(`first deploy: applying manifest (minScale=maxScale=1, no CPU throttling, mode=${mode})…`);
	if (mode === 'live') warn('LIVE mode: this service will sign + broadcast real trades from agent wallets.');
	const r = gcloud(['run', 'services', 'replace', CLOUDRUN, `--region=${REGION}`]);
	if (r.status !== 0) die('gcloud run services replace failed');
	ok('service config applied');
}

async function verifyHeartbeat() {
	if (DRY_RUN) { warn('--dry-run: skipping heartbeat verification'); return; }
	if (!process.env.DATABASE_URL) {
		warn('DATABASE_URL not set locally — cannot verify the heartbeat from here.');
		warn(`Verify the worker is live with: curl -s https://three.ws/api/sniper/status`);
		warn('Or read the logs: gcloud run services logs read agent-sniper --region=' + REGION + ' --project=' + PROJECT);
		return;
	}
	log('waiting for the worker to report a fresh heartbeat…');
	const { sql } = await import('../api/_lib/db.js');
	const deadline = Date.now() + 90_000;
	while (Date.now() < deadline) {
		try {
			const [beat] = await sql`SELECT mode, last_beat_at, meta FROM bot_heartbeat WHERE worker = 'agent-sniper' LIMIT 1`;
			if (beat) {
				const ageMs = Date.now() - new Date(beat.last_beat_at).getTime();
				if (ageMs < 90_000) {
					const meta = beat.meta || {};
					ok(`heartbeat fresh (${Math.round(ageMs / 1000)}s) — mode=${beat.mode} feedConnected=${meta.feedConnected} strategies=${meta.strategies}`);
					return;
				}
			}
		} catch (e) {
			warn('heartbeat probe error (will retry): ' + (e?.message || e));
		}
		await new Promise((r) => setTimeout(r, 5_000));
	}
	warn('no fresh heartbeat within 90s. The revision rolled out but the worker may still be booting (image pull + SDK build) or wedged.');
	warn('Check logs: gcloud run services logs read agent-sniper --region=' + REGION + ' --project=' + PROJECT);
}

async function main() {
	log(`project=${PROJECT} region=${REGION} service=${SERVICE} mode=simulate${DRY_RUN ? ' [DRY-RUN]' : ''}`);
	preflight();
	enableApis();
	ensureServiceAccount();
	ensureRepo();
	checkSecrets();
	verifyImageBoots();
	build();
	deploy();
	await verifyHeartbeat();
	ok('done. First deploys land in SIMULATE mode (zero spend); redeploys keep the running mode.');
	log('Live cutover (gated): see deploy/sniper/README.md → "Cutover to live".');
	log('Status surface: https://three.ws/api/sniper/status');
}

main().catch((e) => die(e?.stack || e?.message || String(e)));
