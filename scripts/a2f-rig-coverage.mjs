#!/usr/bin/env node
// Audio2Face-3D rig coverage across the avatars people actually brought.
// ---------------------------------------------------------------------------
// A2F-3D emits an ARKit-52 track (plus tongue). Our avatars come from the
// studio, the forge, selfie reconstruction, Avaturn, and arbitrary uploads, so
// the face on the other end may expose ARKit morphs, VRM vowels, Oculus
// visemes, or nothing. src/voice/a2f-player.js decides per mesh whether to
// drive morphs DIRECTLY (the name canonicalizes to ARKit) or to DERIVE a vowel
// or viseme expression from the ARKit frame, and falls back to amplitude
// lipsync when neither applies.
//
// This script measures how often each path fires on real avatars, using the
// shipping A2FPlayer itself: it reads each GLB's morph target names (the JSON
// chunk only, by HTTP range request), hands them to A2FPlayer.attach() as the
// morph dictionaries three.js would build, and classifies the result. It is the
// evidence behind the coverage figure in docs/nvidia-gtc-2027-poster.md.
//
// Usage:
//   node scripts/a2f-rig-coverage.mjs                 sample up to 60 distinct files per source
//   node scripts/a2f-rig-coverage.mjs --per-source 200
//   node scripts/a2f-rig-coverage.mjs --json          machine-readable report
//
// Read-only. Reads DATABASE_URL and S3_PUBLIC_DOMAIN from the environment, then
// .env.local, then .env. Seed-cron accounts, QA logins, and synthetic test
// registrations are excluded with the same predicate as partners:proof.

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { neon } from '@neondatabase/serverless';
import { A2FPlayer } from '../src/voice/a2f-player.js';
import { ARKIT_GROUPS, canonicalARKitName } from '../src/voice/arkit-blendshapes.js';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
for (const envFile of ['.env.local', '.env']) {
	try {
		const raw = readFileSync(path.resolve(REPO_ROOT, envFile), 'utf8');
		for (const line of raw.split('\n')) {
			const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
			if (!m || process.env[m[1]]) continue;
			process.env[m[1]] = m[2].replace(/^(['"])(.*)\1$/, '$2');
		}
	} catch {
		// Optional: the shell environment may already carry the vars.
	}
}

const args = process.argv.slice(2);
const flag = (name) => args.includes(`--${name}`);
const opt = (name, fallback) => {
	const i = args.indexOf(`--${name}`);
	return i >= 0 && args[i + 1] ? args[i + 1] : fallback;
};
const PER_SOURCE = Number(opt('per-source', 60));
const CONCURRENCY = 8;
// Production's public R2 domain, used only when the env does not name one.
const PUBLIC_DOMAIN = process.env.S3_PUBLIC_DOMAIN || 'https://pub-2534e921bf9c4314addcd4d8a6e98b7b.r2.dev';

if (!process.env.DATABASE_URL) {
	console.error('missing DATABASE_URL (looked in the environment, .env.local, .env)');
	process.exit(1);
}
const sql = neon(process.env.DATABASE_URL);

const HUMAN_USER = `not u.service_account
	and u.email::text !~* '(@qa\\.three\\.ws$|\\.invalid$|^(qa|gdqa|e2e|test|probe|audit|home-e2e)[-_.0-9])'`;

const MOUTH = new Set([...ARKIT_GROUPS.jaw, ...ARKIT_GROUPS.mouth]);

function urlFor(key) {
	if (/^https?:\/\//i.test(key)) return key;
	return `${PUBLIC_DOMAIN}/${key.split('/').map(encodeURIComponent).join('/')}`;
}

// The glTF JSON of a .glb or .vrm, fetching as few bytes as the server allows.
async function fetchGltfJson(url) {
	const head = await fetch(url, { headers: { range: 'bytes=0-19' } });
	if (!head.ok) throw new Error(`HTTP ${head.status}`);
	let buf = Buffer.from(await head.arrayBuffer());
	if (buf.length < 20 || buf.readUInt32LE(0) !== 0x46546c67) {
		// Not binary glTF (or the server ignored the range and sent a .gltf).
		const full = head.status === 200 ? buf : Buffer.from(await (await fetch(url)).arrayBuffer());
		if (full.readUInt32LE(0) !== 0x46546c67) return JSON.parse(full.toString('utf8'));
		buf = full;
	}
	const jsonLen = buf.readUInt32LE(12);
	if (buf.length < 20 + jsonLen) {
		const res = await fetch(url, { headers: { range: `bytes=20-${19 + jsonLen}` } });
		if (!res.ok) throw new Error(`HTTP ${res.status}`);
		const body = Buffer.from(await res.arrayBuffer());
		// A server that ignores Range answers 200 with the whole file.
		return JSON.parse((res.status === 206 ? body : body.subarray(20, 20 + jsonLen)).toString('utf8'));
	}
	return JSON.parse(buf.subarray(20, 20 + jsonLen).toString('utf8'));
}

// The object graph A2FPlayer.attach() walks, built the way three.js's
// GLTFLoader names morph targets: mesh.extras.targetNames, else the index.
function sceneFromGltf(gltf) {
	const meshes = [];
	for (const [mi, mesh] of (gltf.meshes || []).entries()) {
		const targets = mesh.primitives?.[0]?.targets;
		if (!targets?.length) continue;
		const names = mesh.extras?.targetNames || [];
		const dict = {};
		targets.forEach((_, i) => {
			dict[names[i] ?? String(i)] = i;
		});
		meshes.push({
			isMesh: true,
			name: mesh.name || `mesh${mi}`,
			morphTargetDictionary: dict,
			morphTargetInfluences: new Array(targets.length).fill(0),
		});
	}
	return { meshes, root: { traverse: (fn) => meshes.forEach(fn) } };
}

function classify(gltf) {
	const { meshes, root } = sceneFromGltf(gltf);
	if (!meshes.length) return { path: 'no-morphs', mouthShapes: 0 };
	const player = new A2FPlayer();
	player.attach(root);
	const d = player.describe();
	const mouth = new Set(
		d.direct.map((s) => s.slice(s.lastIndexOf(':') + 1)).filter((n) => MOUTH.has(n)),
	);
	if (mouth.size) return { path: 'direct', mouthShapes: mouth.size };
	if (d.expression.length) return { path: 'derived', mouthShapes: 0 };
	// Morphs exist but none the player can drive: report what they were called,
	// which is how the next mapping table gets written.
	const sample = meshes.flatMap((m) => Object.keys(m.morphTargetDictionary)).filter((n) => !canonicalARKitName(n));
	return { path: 'unmapped-morphs', mouthShapes: 0, sample: sample.slice(0, 6) };
}

async function pool(items, n, fn) {
	const out = new Array(items.length);
	let next = 0;
	await Promise.all(
		Array.from({ length: n }, async () => {
			while (next < items.length) {
				const i = next++;
				out[i] = await fn(items[i]);
			}
		}),
	);
	return out;
}

// One row per distinct file: stock avatars imported by many people count once,
// and a source contributes at most PER_SOURCE files so no single source decides
// the headline number.
const rows = await sql.query(
	`select source, storage_key, owners from (
		select a.source, a.storage_key, count(distinct a.owner_id)::int as owners,
		       row_number() over (partition by a.source order by md5(a.storage_key)) as rn
		from avatars a join users u on u.id = a.owner_id
		where a.deleted_at is null and ${HUMAN_USER}
		  and (a.storage_key ilike '%.glb' or a.storage_key ilike '%.vrm' or a.content_type ilike '%gltf%')
		group by a.source, a.storage_key
	) t where rn <= $1 order by source, storage_key`,
	[PER_SOURCE],
);

const results = await pool(rows, CONCURRENCY, async (r) => {
	try {
		return { ...r, ...classify(await fetchGltfJson(urlFor(r.storage_key))) };
	} catch (err) {
		return { ...r, path: 'unreadable', error: String(err.message || err).slice(0, 80) };
	}
});

const PATHS = ['direct', 'derived', 'unmapped-morphs', 'no-morphs', 'unreadable'];
const bySource = {};
for (const r of results) {
	bySource[r.source] ??= Object.fromEntries(PATHS.map((p) => [p, 0]));
	bySource[r.source][r.path]++;
}
const totals = Object.fromEntries(PATHS.map((p) => [p, results.filter((r) => r.path === p).length]));
const readable = results.length - totals.unreadable;
const faceDriven = totals.direct + totals.derived;
const unmappedNames = {};
for (const r of results) for (const n of r.sample || []) unmappedNames[n] = (unmappedNames[n] || 0) + 1;

const report = {
	measured_at: new Date().toISOString(),
	per_source_cap: PER_SOURCE,
	files: results.length,
	readable,
	totals,
	a2f_face_driven: faceDriven,
	a2f_face_driven_ratio: readable ? faceDriven / readable : 0,
	morphed_files: totals.direct + totals.derived + totals['unmapped-morphs'],
	by_source: bySource,
	top_unmapped_morph_names: Object.entries(unmappedNames)
		.sort((a, b) => b[1] - a[1])
		.slice(0, 15),
};

if (flag('json')) {
	console.log(JSON.stringify(report, null, 2));
} else {
	const pct = (n, d) => (d ? `${((100 * n) / d).toFixed(1)}%` : 'n/a');
	console.log(`A2F rig coverage, ${report.measured_at}`);
	console.log(`${results.length} distinct avatar files (cap ${PER_SOURCE} per source), ${readable} readable\n`);
	console.log(['source'.padEnd(14), ...PATHS.map((p) => p.padStart(16))].join(''));
	for (const [src, c] of Object.entries(bySource)) {
		console.log([src.padEnd(14), ...PATHS.map((p) => String(c[p]).padStart(16))].join(''));
	}
	console.log(['total'.padEnd(14), ...PATHS.map((p) => String(totals[p]).padStart(16))].join(''));
	console.log(`\nface driven by A2F: ${faceDriven} of ${readable} readable (${pct(faceDriven, readable)})`);
	console.log(`  direct ARKit mouth: ${totals.direct}   derived from VRM/Oculus expressions: ${totals.derived}`);
	console.log(`of files that carry any morph targets: ${pct(faceDriven, report.morphed_files)} driven`);
	if (report.top_unmapped_morph_names.length) {
		console.log('\nmost common morph names the player cannot map yet:');
		for (const [n, c] of report.top_unmapped_morph_names) console.log(`  ${String(c).padStart(4)}  ${n}`);
	}
}
