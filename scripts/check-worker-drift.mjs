#!/usr/bin/env node
// Report every Cloud Run worker whose serving image is behind its source.
//
// For each workers/<dir>/cloudbuild*.yaml that deploys a Cloud Run service, this
// reads the service in every region it runs in, follows the revision(s) taking
// traffic to the image digest, asks Artifact Registry when that image was built
// and which commit tag it carries, and compares that with the git history of
// workers/<dir> (README and other *.md edits excluded: they never reach the
// image). A worker is DRIFTED when source it does not contain has waited longer
// than the grace window (default 7 days).
//
// Read-only: it lists and describes, it never builds, deploys or updates.
//
// Usage:
//   node scripts/check-worker-drift.mjs                    # table, exit 1 on DRIFTED
//   node scripts/check-worker-drift.mjs --grace-days 3
//   node scripts/check-worker-drift.mjs --worker remesh --worker model-trellis
//   node scripts/check-worker-drift.mjs --ref threews/main # compare to a ref other than HEAD
//   node scripts/check-worker-drift.mjs --json
//
// Exit codes: 0 every deployed worker is current or within grace, 1 at least one
// is DRIFTED, 2 the check itself could not run (no credentials, API error).

import { readFileSync, readdirSync } from 'node:fs';
import { execFile, execFileSync } from 'node:child_process';
import { promisify } from 'node:util';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import './lib/gcloud-path.mjs';
import {
	DEFAULT_GRACE_DAYS,
	parseCloudbuildTargets,
	sourceCommitFromTags,
	pickBuiltAt,
	unbuiltCommits,
	classify,
	servingRevisions,
	parseImageRef,
	formatTable,
	hexTokens,
} from './lib/worker-drift.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PROJECT = process.env.GCP_PROJECT || 'aerial-vehicle-466722-p5';
const BUILD_REGION = 'us-central1';
const execFileP = promisify(execFile);

function parseArgs(argv) {
	const opts = { graceDays: DEFAULT_GRACE_DAYS, json: false, workers: [], ref: 'HEAD' };
	for (let i = 0; i < argv.length; i++) {
		const a = argv[i];
		if (a === '--json') opts.json = true;
		else if (a === '--grace-days') opts.graceDays = Number(argv[++i]);
		else if (a.startsWith('--grace-days=')) opts.graceDays = Number(a.split('=')[1]);
		else if (a === '--worker') opts.workers.push(argv[++i]);
		else if (a.startsWith('--worker=')) opts.workers.push(a.split('=')[1]);
		else if (a === '--ref') opts.ref = argv[++i];
		else if (a.startsWith('--ref=')) opts.ref = a.split('=')[1];
		else if (a === '-h' || a === '--help') {
			console.log(readFileSync(fileURLToPath(import.meta.url), 'utf8').split('\n').slice(1, 23).map((l) => l.replace(/^\/\/ ?/, '')).join('\n'));
			process.exit(0);
		} else throw new Error(`Unknown argument: ${a}`);
	}
	if (!Number.isFinite(opts.graceDays) || opts.graceDays < 0) throw new Error('--grace-days must be a non-negative number');
	return opts;
}

// Async on purpose: a synchronous git call blocks the event loop for seconds on
// this repository, and every in-flight fetch's timeout timer then fires against
// a response that was never read.
async function git(args) {
	const { stdout } = await execFileP('git', args, { cwd: ROOT, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
	return stdout;
}

async function resolveCommit(candidate) {
	try {
		return (await git(['rev-parse', '--verify', '--quiet', `${candidate}^{commit}`])).trim() || null;
	} catch {
		return null;
	}
}

/** Pathspec for the worker's source, minus docs that never reach the image. */
const sourcePaths = (dir) => [`workers/${dir}`, `:(exclude)workers/${dir}/*.md`];

async function sourceHistory(dir, ref) {
	const out = (await git(['log', ref, '--format=%H%x09%cI', '--', ...sourcePaths(dir)])).trim();
	return out ? out.split('\n').map((l) => { const [sha, committedAt] = l.split('\t'); return { sha, committedAt }; }) : [];
}

// Exact only when the image's commit is in the ref's history. A tag commit from
// before a history rewrite (remesh-service's 1756bc516, which main carries as
// 57c9aa4a4) is not, and `A..ref` would then list everything since the fork.
async function exactUnbuilt(commit, dir, ref) {
	try {
		await git(['merge-base', '--is-ancestor', commit, ref]);
	} catch {
		return null;
	}
	const out = (await git(['rev-list', `${commit}..${ref}`, '--', ...sourcePaths(dir)])).trim();
	return new Set(out ? out.split('\n') : []);
}

/** Resolve every hex candidate in an image's tags to a full commit, for sourceCommitFromTags. */
async function commitResolver(tags) {
	const known = new Map();
	for (const hex of tags.flatMap(hexTokens)) {
		if (!known.has(hex)) known.set(hex, await resolveCommit(hex));
	}
	return (candidate) => known.get(candidate) || null;
}

async function accessToken() {
	try {
		const t = execFileSync('gcloud', ['auth', 'print-access-token'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
		if (t) return t;
	} catch {
		// No local gcloud session: fall through to the metadata server, which
		// answers when this runs inside GCP (Cloud Build, Cloud Run, a VM).
	}
	const res = await fetch('http://metadata.google.internal/computeMetadata/v1/instance/service-accounts/default/token', {
		headers: { 'Metadata-Flavor': 'Google' },
		signal: AbortSignal.timeout(3000),
	}).catch(() => null);
	if (res?.ok) return (await res.json()).access_token;
	throw new Error('No Google Cloud credentials: run `gcloud auth login` (or run inside GCP).');
}

function makeApi(token) {
	return async function api(url, { allow404 = false } = {}) {
		let lastErr;
		for (let attempt = 0; attempt < 3; attempt++) {
			const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(20000) }).catch((e) => {
				lastErr = new Error(`${e.message} (${url})`);
				return null;
			});
			if (res?.ok) return res.json();
			if (res?.status === 404 && allow404) return null;
			if (res && res.status !== 429 && res.status < 500) {
				throw new Error(`${res.status} from ${url}: ${(await res.text()).slice(0, 300)}`);
			}
			if (res) lastErr = new Error(`${res.status} from ${url}`);
			await new Promise((r) => setTimeout(r, 500 * 2 ** attempt));
		}
		throw lastErr;
	};
}

async function listAllServices(api) {
	const out = [];
	let pageToken = '';
	do {
		const url = `https://run.googleapis.com/v2/projects/${PROJECT}/locations/-/services?pageSize=200${pageToken ? `&pageToken=${encodeURIComponent(pageToken)}` : ''}`;
		const page = await api(url);
		out.push(...(page.services || []));
		pageToken = page.nextPageToken || '';
	} while (pageToken);
	return out;
}

async function mapLimit(items, limit, fn) {
	const results = new Array(items.length);
	let next = 0;
	await Promise.all(
		Array.from({ length: Math.min(limit, items.length) }, async () => {
			while (next < items.length) {
				const i = next++;
				results[i] = await fn(items[i], i);
			}
		}),
	);
	return results;
}

/** Every (worker dir, config file, service, declared regions) the repo knows about. */
function discoverTargets(filter) {
	const byService = new Map();
	const skipped = [];
	const dirs = readdirSync(path.join(ROOT, 'workers'), { withFileTypes: true }).filter((d) => d.isDirectory()).map((d) => d.name).sort();
	for (const dir of dirs) {
		const wdir = path.join(ROOT, 'workers', dir);
		const configs = readdirSync(wdir).filter((f) => /^cloudbuild.*\.ya?ml$/.test(f)).sort();
		for (const file of configs) {
			const { targets } = parseCloudbuildTargets(readFileSync(path.join(wdir, file), 'utf8'), { projectId: PROJECT });
			if (!targets.length) {
				skipped.push(`workers/${dir}/${file}`);
				continue;
			}
			for (const t of targets) {
				const entry = byService.get(t.service) || { worker: dir, config: `workers/${dir}/${file}`, service: t.service, regions: new Set(), via: t.via };
				entry.regions.add(t.region);
				byService.set(t.service, entry);
			}
		}
	}
	let list = [...byService.values()];
	if (filter.length) list = list.filter((t) => filter.includes(t.worker) || filter.includes(t.service));
	return { targets: list, skipped };
}

async function inspectServing(api, svc) {
	const location = svc.name.split('/')[3];
	const revisions = servingRevisions(svc);
	const primary = revisions.sort((a, b) => b.percent - a.percent)[0];
	if (!primary) return { location, revision: null };
	const rev = await api(`https://run.googleapis.com/v2/projects/${PROJECT}/locations/${location}/services/${svc.name.split('/').pop()}/revisions/${primary.revision}`);
	const digestRef = rev.containers?.[0]?.image;
	const tagRef = svc.template?.containers?.[0]?.image;
	const ref = parseImageRef(digestRef) || parseImageRef(tagRef);
	let image = null;
	if (ref?.digest) {
		image = await api(
			`https://artifactregistry.googleapis.com/v1/projects/${ref.project}/locations/${ref.location}/repositories/${ref.repository}/dockerImages/${encodeURIComponent(`${ref.image}@${ref.digest}`)}`,
			{ allow404: true },
		);
	}
	const tagFromTemplate = parseImageRef(tagRef)?.tag;
	const tags = [...new Set([...(image?.tags || []), ...(tagFromTemplate ? [tagFromTemplate] : [])])];
	return {
		location,
		revision: primary.revision,
		trafficSplit: revisions.length > 1,
		revisionCreateTime: rev.createTime,
		image,
		tags,
		imageRef: digestRef || tagRef,
	};
}

function redeployCommand(t) {
	if (t.via === 'comment') return `see the header of ${t.config} (build, then roll with gcloud run services update)`;
	return `gcloud builds submit --config ${t.config} --region ${BUILD_REGION} --project ${PROJECT} --substitutions=SHORT_SHA=$(git rev-parse --short=9 HEAD) .`;
}

// The extra copy runs the same registry image, so after the declared region is
// rebuilt it is refreshed by a config-only image roll (pre-approved).
function extraRollCommand(t, region) {
	return `after the rebuild: gcloud run services update ${t.service} --region ${region} --project ${PROJECT} --image "$(gcloud run services describe ${t.service} --region ${[...t.regions][0]} --project ${PROJECT} --format='value(spec.template.spec.containers[0].image)')"`;
}

async function main() {
	const opts = parseArgs(process.argv.slice(2));
	const { targets, skipped } = discoverTargets(opts.workers);
	const api = makeApi(await accessToken());
	const services = await listAllServices(api);
	const now = Date.now();

	const jobs = [];
	for (const t of targets) {
		const live = services.filter((s) => s.name.split('/').pop() === t.service);
		if (!live.length) jobs.push({ t, svc: null, region: [...t.regions].join(','), declared: true });
		for (const svc of live) {
			const region = svc.name.split('/')[3];
			jobs.push({ t, svc, region, declared: t.regions.has(region) });
		}
	}

	const dirs = [...new Set(targets.map((t) => t.worker))];
	const histories = new Map(await mapLimit(dirs, 6, async (dir) => [dir, await sourceHistory(dir, opts.ref)]));

	const rows = await mapLimit(jobs, 8, async ({ t, svc, region, declared }) => {
		const hist = histories.get(t.worker);
		const base = { worker: t.worker, config: t.config, service: t.service, region, declared, lastSourceChange: hist[0]?.committedAt || null };
		if (!svc) return { ...base, ...classify({ deployed: false, unbuilt: [] }), redeploy: redeployCommand(t) };
		const s = await inspectServing(api, svc);
		const built = pickBuiltAt({ image: s.image, tags: s.tags, revisionCreateTime: s.revisionCreateTime });
		const src = sourceCommitFromTags(s.tags, await commitResolver(s.tags));
		const exact = src ? await exactUnbuilt(src.commit, t.worker, opts.ref) : null;
		const unbuilt = unbuiltCommits(hist, { builtAt: built.at, unbuiltShas: exact });
		const verdict = classify({ deployed: true, unbuilt, builtAt: built.at, declared, now, graceDays: opts.graceDays });
		return {
			...base,
			revision: s.revision,
			trafficSplit: s.trafficSplit,
			revisionCreatedAt: s.revisionCreateTime,
			builtAt: built.at,
			builtAtSource: built.source,
			image: s.imageRef,
			imageTag: s.tags.find((x) => x !== 'latest') || null,
			sourceCommit: src?.commit || null,
			comparedBy: exact ? 'commit' : 'build time',
			unbuiltCommits: unbuilt.map((c) => c.sha.slice(0, 9)),
			...verdict,
			redeploy: verdict.behind ? (declared ? redeployCommand(t) : extraRollCommand(t, region)) : null,
		};
	});

	const order = { DRIFTED: 0, drifting: 1, current: 2, 'NOT-DEPLOYED': 3 };
	rows.sort((a, b) => order[a.status] - order[b.status] || (b.waitingDays ?? -1) - (a.waitingDays ?? -1) || a.service.localeCompare(b.service));
	const failing = rows.filter((r) => r.failing);

	if (opts.json) {
		console.log(JSON.stringify({ project: PROJECT, ref: opts.ref, graceDays: opts.graceDays, checkedAt: new Date(now).toISOString(), rows, skippedConfigs: skipped }, null, 2));
	} else {
		console.log(`Worker image drift vs ${opts.ref} (grace ${opts.graceDays}d, project ${PROJECT})\n`);
		const deployed = rows.filter((r) => r.status !== 'NOT-DEPLOYED');
		const absent = rows.filter((r) => r.status === 'NOT-DEPLOYED');
		console.log(formatTable(deployed));
		const counts = Object.entries(rows.reduce((m, r) => ((m[r.status] = (m[r.status] || 0) + 1), m), {})).map(([k, v]) => `${v} ${k}`).join(', ');
		console.log(`\n${rows.length} service rows: ${counts}.`);
		if (rows.some((r) => r.declared === false)) console.log('(extra) = a copy in a region its cloudbuild config does not deploy to. A rebuild will not refresh it, so it is reported but never fails the check.');
		if (absent.length) console.log(`Not deployed in this project (config exists, no Cloud Run service): ${absent.map((r) => r.service).join(', ')}`);
		if (skipped.length) console.log(`Build-only configs (no Cloud Run deploy step, not tracked): ${skipped.join(', ')}`);
		const toShip = [...new Map(rows.filter((r) => r.behind && r.declared).map((r) => [r.config, r])).values()];
		if (toShip.length) {
			console.log('\nRedeploy commands (production rollouts: owner-gated, run from the repo root with workers/<dir> clean):');
			for (const r of toShip) console.log(`  # ${r.worker} -> ${r.service}: ${r.behind} unbuilt commit(s), oldest waiting ${r.waitingDays}d\n  ${r.redeploy}`);
		}
		const extras = rows.filter((r) => r.behind && !r.declared);
		if (extras.length) {
			console.log('\nExtra-region copies (config-only rolls, pre-approved):');
			for (const r of extras) console.log(`  # ${r.service}@${r.region}\n  ${r.redeploy}`);
		}
	}
	process.exit(failing.length ? 1 : 0);
}

main().catch((err) => {
	console.error(`check-worker-drift: ${err.message}`);
	process.exit(2);
});
