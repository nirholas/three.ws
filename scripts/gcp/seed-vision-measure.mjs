#!/usr/bin/env node
/**
 * Measure the catalog vision gate on seed assets that are already published.
 *
 * Read-only. Picks the most recent published seed jobs from forge_seed_jobs,
 * re-runs the full catalog gate on each (api/_lib/seed-quality.js: mesh stage,
 * then render + judge), and reports what stage 2 WOULD have decided, grouped by
 * the SEED_GATE_VERSION each row was published under. Nothing is written to the
 * database or to object storage, and no threshold is touched: this is the
 * number to read before turning on SEED_VISION_PHASE=1 (docs/seed-quality.md),
 * and the number to read again afterwards to see what the phase is filtering.
 *
 * The judge runs where the vision cron's would, or as close as this machine
 * allows:
 *   --judge=remote      (default) render + judge through the deployed
 *                       /api/render/avatar-clip and /api/vision, so a machine
 *                       with no GCP credentials measures the live chain
 *   --judge=local       render remote, judge in this process through
 *                       api/_lib/vision.js (measures a chain change pre-deploy)
 *   --judge=in-process  the cron's own transport: renderClip + Vertex here
 *                       (needs chromium and GCP application-default credentials)
 *
 * Usage:
 *   node scripts/gcp/seed-vision-measure.mjs                 # 10 most recent
 *   node scripts/gcp/seed-vision-measure.mjs --limit=25 --judge=local
 *   node scripts/gcp/seed-vision-measure.mjs --json          # machine-readable
 *
 * Reads DATABASE_URL from the environment, .env.local, or .env.
 */

import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');

// .env.local first, then .env; the first definition of a key wins and a real
// environment variable beats both. Loaded before db.js is imported.
for (const file of ['.env.local', '.env']) {
	let raw;
	try { raw = readFileSync(resolve(ROOT, file), 'utf8'); } catch { continue; }
	for (const line of raw.split('\n')) {
		const m = line.match(/^([A-Z_][A-Z0-9_]*)=(.*)$/);
		if (!m || process.env[m[1]]) continue;
		let val = m[2].trim();
		if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) val = val.slice(1, -1);
		process.env[m[1]] = val;
	}
}

const args = Object.fromEntries(
	process.argv.slice(2).map((a) => {
		const m = a.match(/^--([^=]+)(?:=(.*))?$/);
		return m ? [m[1], m[2] ?? true] : [a, true];
	}),
);
const LIMIT = Math.max(1, Math.min(Number(args.limit) || 10, 200));
const JUDGE = ['local', 'in-process'].includes(args.judge) ? args.judge : 'remote';
const ORIGIN = String(args.origin || process.env.SEED_ORIGIN || 'https://three.ws').replace(/\/+$/, '');
const AS_JSON = args.json === true;
const TIMEOUT_MS = 180_000;

if (!process.env.DATABASE_URL) {
	console.error('DATABASE_URL is not set (environment, .env.local or .env).');
	process.exit(2);
}

const { sql } = await import('../../api/_lib/db.js');
const { evaluateSeedAsset, inProcessTransport, localJudgeTransport, remoteTransport, SEED_GATE_VERSION } =
	await import('../../api/_lib/seed-quality.js');
const { publishableGlbUrl } = await import('../../api/_lib/seed-publish.js');

// The bytes come from the same public URL the renderer fetches, so the script
// needs no bucket credentials and reads exactly what a viewer would download.
async function readGlb(url) {
	const res = await fetch(url, { signal: AbortSignal.timeout(30_000) });
	if (!res.ok) throw new Error(`glb read ${res.status} from ${url}`);
	return Buffer.from(await res.arrayBuffer());
}

const transport =
	JUDGE === 'in-process'
		? inProcessTransport()
		: (JUDGE === 'local' ? localJudgeTransport : remoteTransport)({ origin: ORIGIN, timeoutMs: TIMEOUT_MS });

const rows = await sql`
	select id, prompt, model_category, creation_id, glb_url, gate, finished_at
	from forge_seed_jobs
	where status = 'done'
	  and avatar_id is not null
	order by finished_at desc nulls last
	limit ${LIMIT}
`;

const say = (...parts) => { if (!AS_JSON) console.log(...parts); };
say(`Vision gate measurement: ${rows.length} published seed asset(s), judge=${JUDGE}, origin=${ORIGIN}`);
say(`Current SEED_GATE_VERSION: ${SEED_GATE_VERSION}`);
say('');

const assets = [];
for (const row of rows) {
	const startedAt = Date.now();
	const publishedUnder = row.gate?.gateVersion != null ? `v${row.gate.gateVersion}` : 'unrecorded';
	const record = { job_id: row.id, prompt: row.prompt, category: row.model_category, published_under: publishedUnder };
	try {
		const glbUrl = await publishableGlbUrl(row);
		if (!glbUrl) throw new Error('no public glb url to render');
		const buf = await readGlb(glbUrl);
		const verdict = await evaluateSeedAsset({
			glbBuffer: buf,
			glbUrl,
			prompt: row.prompt,
			category: row.model_category,
			transport,
		});
		Object.assign(record, {
			// A mesh that fails on re-read is a reject the judge never saw; an
			// unanswered judge is infrastructure, not a verdict.
			outcome: !verdict.mesh.pass ? 'rejected'
				: verdict.vision.status !== 'judged' ? 'unavailable'
				: (verdict.accepted ? 'accepted' : 'rejected'),
			reasons: verdict.reasons,
			vision_mean: verdict.vision.mean ?? null,
			error: verdict.vision.error ?? null,
		});
	} catch (err) {
		Object.assign(record, { outcome: 'unavailable', reasons: [], vision_mean: null, error: String(err?.message || err).slice(0, 200) });
	}
	record.ms = Date.now() - startedAt;
	assets.push(record);
	say(
		`  ${record.outcome.padEnd(11)} ${String(record.ms).padStart(6)} ms  ${record.published_under.padEnd(14)} `
		+ `${record.prompt.slice(0, 60)}${record.reasons.length ? `  [${record.reasons.join(', ')}]` : ''}`
		+ `${record.error ? `  (${record.error})` : ''}`,
	);
}

// Accept rate over the assets the judge actually saw: an unreachable judge is
// infrastructure, not curation, the same rule the cron's own report follows.
const byVersion = {};
for (const a of assets) {
	const v = (byVersion[a.published_under] ||= { accepted: 0, rejected: 0, unavailable: 0 });
	v[a.outcome] += 1;
}
for (const v of Object.values(byVersion)) {
	const judged = v.accepted + v.rejected;
	v.accept_rate = judged ? Number(((v.accepted / judged) * 100).toFixed(1)) : null;
}
const durations = assets.map((a) => a.ms).sort((x, y) => x - y);
const summary = {
	judge: JUDGE,
	origin: ORIGIN,
	current_gate_version: SEED_GATE_VERSION,
	measured: assets.length,
	by_published_gate_version: byVersion,
	ms: durations.length
		? { p50: durations[Math.floor((durations.length - 1) / 2)], max: durations[durations.length - 1] }
		: null,
	assets,
};

if (AS_JSON) {
	console.log(JSON.stringify(summary, null, 2));
} else {
	say('');
	for (const [version, v] of Object.entries(byVersion)) {
		say(`  ${version}: ${v.accepted} accepted, ${v.rejected} rejected, ${v.unavailable} unavailable`
			+ `  (accept rate ${v.accept_rate == null ? 'n/a' : `${v.accept_rate}%`} of judged)`);
	}
	if (summary.ms) say(`  per asset: p50 ${summary.ms.p50} ms, max ${summary.ms.max} ms`);
}
