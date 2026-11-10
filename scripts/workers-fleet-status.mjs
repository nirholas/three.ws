#!/usr/bin/env node
// workers-fleet-status: one command that says which workers/* directories are
// live on Cloud Run and which are built-only, with the ship command for each.
//
//   npm run workers:fleet                 table of every worker
//   npm run workers:fleet -- --json       machine readable
//   npm run workers:fleet -- --markdown   docs/ops/workers-fleet.md body
//   npm run workers:fleet -- --check      exit 1 when a README claim disagrees with Cloud Run
//
// Reads `gcloud run services list --format=json` (read-only). Pass
// --services-file <path> to use a saved capture instead of calling gcloud.

import { readFileSync, readdirSync, existsSync, statSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
export const PROJECT = 'aerial-vehicle-466722-p5';

// Workers that are deliberately not Cloud Run services. They are reported, never
// flagged by --check.
export const NOT_A_SERVICE = {
	'agent-screen-worker': 'owner-run on a workstation, no cloudbuild by design',
	deploy: 'deploy tooling, not a service',
	'agent-forge': 'operator-run CLI, not a Cloud Run service',
};

/** Service name a worker deploys as, read from its cloudbuild.yaml text. */
export function serviceNameFromCloudbuild(yaml) {
	if (!yaml) return null;
	const sub = yaml.match(/^\s*_SERVICE:\s*['"]?([a-z0-9][a-z0-9-]*)['"]?\s*(?:#.*)?$/m);
	if (sub) return sub[1];
	const inline = yaml.match(/\brun\s+(?:deploy|services\s+update)\s+([a-z0-9][a-z0-9-]*)/);
	if (inline) return inline[1];
	const listed = yaml.match(/^\s*-\s*(?:deploy|update)\s*\n\s*-\s*([a-z0-9][a-z0-9-]*)\s*$/m);
	return listed ? listed[1] : null;
}

/**
 * What the README says about its own deployment: 'undeployed', 'deployed' or
 * null. Only bold status statements, or sentences that name this worker, count,
 * so a README discussing some other worker's state is not misread.
 */
export function readmeClaim(md, dir = '') {
	if (!md) return null;
	let claim = null;
	for (const line of md.split('\n')) {
		const l = line.toLowerCase();
		const boldUndeployed = /\*\*(?:status\b[^*]*|not\b[^*]*)not (?:currently )?deployed|\*\*not (?:currently )?deployed/.test(l);
		const namedUndeployed = dir && l.includes(dir) && /\bnot (?:currently )?deployed\b/.test(l);
		if (boldUndeployed || namedUndeployed) claim = 'undeployed';
		else if (/\*\*status[^*]*\*\*:?\s*(?:re)?deployed\b|\*\*status:\s*(?:re)?deployed/.test(l)) claim = 'deployed';
	}
	return claim;
}

/** Collapse the raw `gcloud run services list` JSON into one record per name. */
export function indexServices(raw) {
	const by = new Map();
	for (const s of raw || []) {
		const name = s?.metadata?.name;
		if (!name) continue;
		const tpl = s.spec?.template || {};
		const ann = tpl.metadata?.annotations || {};
		const limits = tpl.spec?.containers?.[0]?.resources?.limits || {};
		const ready = (s.status?.conditions || []).find((c) => c.type === 'Ready');
		const rec = {
			name,
			url: s.status?.url || null,
			ready: ready ? ready.status === 'True' : false,
			minInstances: ann['autoscaling.knative.dev/minScale'] ?? '0',
			maxInstances: ann['autoscaling.knative.dev/maxScale'] ?? '-',
			gpu: limits['nvidia.com/gpu'] ? `${limits['nvidia.com/gpu']}x` : '-',
			lastDeploy: ready?.lastTransitionTime || null,
			region: s.metadata?.labels?.['cloud.googleapis.com/location'] || null,
		};
		const prev = by.get(name);
		if (!prev || rec.region === 'us-central1') by.set(name, rec);
	}
	return by;
}

/** Combine the local tree view and the Cloud Run view into table rows. */
export function buildRows(workers, services) {
	return workers.map((w) => {
		const service = w.service || w.dir;
		const svc = services.get(service) || (w.service ? null : services.get(`${w.dir}-service`)) || null;
		const live = !!svc;
		const exempt = NOT_A_SERVICE[w.dir] || null;
		let problem = null;
		if (!exempt) {
			if (w.claim === 'undeployed' && live) problem = 'README says not deployed but the service is live';
			else if (w.claim === 'deployed' && !live) problem = 'README says deployed but no service exists';
		}
		return {
			worker: w.dir,
			service: svc ? svc.name : w.service || null,
			state: exempt ? 'n/a' : live ? 'live' : w.hasDockerfile || w.hasCloudbuild ? 'built-only' : 'no image',
			url: svc?.url || null,
			min: svc?.minInstances ?? '-',
			max: svc?.maxInstances ?? '-',
			gpu: svc?.gpu ?? '-',
			lastDeploy: svc?.lastDeploy || null,
			cloudbuild: w.hasCloudbuild,
			verify: w.hasVerify,
			tests: w.hasTests,
			note: exempt,
			claim: w.claim,
			problem,
		};
	});
}

/** Exit status for --check: 1 when any row disagrees with its README. */
export function checkExitCode(rows) {
	return rows.some((r) => r.problem) ? 1 : 0;
}

const yn = (b) => (b ? 'y' : 'n');

export function renderTable(rows) {
	const head = ['worker', 'service', 'state', 'min/max', 'gpu', 'last deploy', 'cb', 'verify', 'tests'];
	const body = rows.map((r) => [
		r.worker,
		r.service || '-',
		r.state,
		`${r.min}/${r.max}`,
		r.gpu,
		r.lastDeploy ? r.lastDeploy.slice(0, 10) : '-',
		yn(r.cloudbuild),
		yn(r.verify),
		yn(r.tests),
	]);
	const widths = head.map((h, i) => Math.max(h.length, ...body.map((b) => String(b[i]).length)));
	const fmt = (cells) => cells.map((c, i) => String(c).padEnd(widths[i])).join('  ').trimEnd();
	return [fmt(head), fmt(widths.map((w) => '-'.repeat(w))), ...body.map(fmt)].join('\n');
}

export function shipCommand(r) {
	if (r.note) return r.note;
	if (!r.cloudbuild) return 'no cloudbuild.yaml';
	return `gcloud builds submit . --config workers/${r.worker}/cloudbuild.yaml --region us-central1 --project ${PROJECT}`;
}

export function renderMarkdown(rows, generatedAt, verifyRuns = {}) {
	const proof = (r) => {
		const v = verifyRuns[r.worker];
		if (!v) return r.verify ? 'config only, no run recorded' : 'no verify config';
		return v.buildId ? `${v.status} \`${v.buildId}\` (${v.date})` : v.status;
	};
	const live = rows.filter((r) => r.state === 'live');
	const built = rows.filter((r) => r.state === 'built-only');
	const lines = [
		'# Workers fleet',
		'',
		`Generated by \`npm run workers:fleet -- --markdown\` on ${generatedAt}. Do not edit by hand; rerun the command. Project \`${PROJECT}\`, read from \`gcloud run services list\`.`,
		'',
		`${live.length} workers are live on Cloud Run, ${built.length} are built-only (a Dockerfile and usually a cloudbuild.yaml, no service).`,
		'',
		'## Live',
		'',
		'| worker | service | min/max | GPU | last deploy |',
		'|---|---|---|---|---|',
		...live.map((r) => `| ${r.worker} | ${r.service} | ${r.min}/${r.max} | ${r.gpu} | ${r.lastDeploy ? r.lastDeploy.slice(0, 10) : '-'} |`),
		'',
		'## Built-only (owner deploy decision)',
		'',
		'Each has a build-only proof where a `cloudbuild.verify.yaml` exists (see the verify column). Deploys are owner-gated.',
		'',
		'| worker | Cloud Build verify | tests | needs | ship command |',
		'|---|---|---|---|---|',
		...built.map((r) => `| ${r.worker} | ${proof(r)} | ${yn(r.tests)} | ${verifyRuns[r.worker]?.needs || '-'} | \`${shipCommand(r)}\` |`),
		'',
		'## Not Cloud Run services',
		'',
		...rows.filter((r) => r.state === 'n/a').map((r) => `- \`${r.worker}\`: ${r.note}`),
		'',
		'Secrets, quota and per-worker env live in each worker README and in [gcp-model-workers.md](./gcp-model-workers.md).',
		'',
	];
	return lines.join('\n');
}

export function scanWorkers(root = ROOT) {
	const dir = join(root, 'workers');
	return readdirSync(dir)
		.filter((n) => statSync(join(dir, n)).isDirectory())
		.sort()
		.map((n) => {
			const d = join(dir, n);
			const read = (f) => (existsSync(join(d, f)) ? readFileSync(join(d, f), 'utf8') : null);
			const entries = readdirSync(d);
			const rootTests = existsSync(join(root, 'tests')) ? readdirSync(join(root, 'tests')) : [];
			return {
				dir: n,
				service: serviceNameFromCloudbuild(read('cloudbuild.yaml')),
				claim: readmeClaim(read('README.md'), n),
				hasDockerfile: existsSync(join(d, 'Dockerfile')),
				hasCloudbuild: existsSync(join(d, 'cloudbuild.yaml')),
				hasVerify: existsSync(join(d, 'cloudbuild.verify.yaml')),
				hasTests: entries.some((e) => /test/i.test(e)) || rootTests.some((t) => t.startsWith(`${n}-`) && /\.test\.[cm]?js$/.test(t)),
			};
		});
}

/** Recorded Cloud Build verify runs, kept in docs/ops/workers-verify-runs.json. */
function loadVerifyRuns() {
	const p = join(ROOT, 'docs/ops/workers-verify-runs.json');
	return existsSync(p) ? JSON.parse(readFileSync(p, 'utf8')) : {};
}

function loadServices(args) {
	const i = args.indexOf('--services-file');
	const text = i >= 0
		? readFileSync(args[i + 1], 'utf8')
		: execFileSync('gcloud', ['run', 'services', 'list', '--project', PROJECT, '--format=json'], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
	return JSON.parse(text);
}

async function main() {
	const args = process.argv.slice(2);
	let raw;
	try {
		raw = loadServices(args);
	} catch (err) {
		console.error(`workers-fleet-status: could not read Cloud Run services (${String(err.message).split('\n')[0]}). Run \`gcloud auth login\` or pass --services-file.`);
		process.exit(2);
	}
	const rows = buildRows(scanWorkers(), indexServices(raw));
	if (args.includes('--json')) console.log(JSON.stringify(rows, null, 2));
	else if (args.includes('--markdown')) console.log(renderMarkdown(rows, new Date().toISOString().slice(0, 10), loadVerifyRuns()));
	else console.log(renderTable(rows));
	if (args.includes('--check')) {
		for (const r of rows.filter((x) => x.problem)) console.error(`MISMATCH ${r.worker}: ${r.problem}`);
		process.exit(checkExitCode(rows));
	}
}

if (process.argv[1] === fileURLToPath(import.meta.url)) main();
