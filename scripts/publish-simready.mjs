#!/usr/bin/env node
/**
 * Upload the converted NVIDIA SimReady GLBs and posters to R2.
 *
 * Reads public/objects/simready/catalog.json (written by scripts/ingest-simready.py)
 * and uploads each done entry's GLB and poster from the ingest output directory to
 * the keys the catalog records. Skips keys already present unless --force. After it
 * finishes, run `node scripts/build-object-library.mjs` to publish the manifest that
 * GET /api/objects/library and /api/catalog serve.
 *
 * Usage: node scripts/publish-simready.mjs [--dir ~/simready-out] [--concurrency=8] [--force] [--dry-run]
 */
import { readFileSync, existsSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { homedir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { putObject, objectExists, haveR2Creds } from './lib/asset-r2.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const args = Object.fromEntries(process.argv.slice(2).map((a) => {
	const m = a.match(/^--([^=]+)(?:=(.*))?$/);
	return m ? [m[1], m[2] ?? true] : [a, true];
}));
const DIR = resolve(args.dir || join(homedir(), 'simready-out'));
const CONCURRENCY = Number(args.concurrency) || 8;
const FORCE = !!args.force;
const DRY = !!args['dry-run'];

if (!DRY && !haveR2Creds()) {
	console.error('R2 credentials missing: see the credential row in the self-unblock-playbook skill.');
	process.exit(1);
}

const catalog = JSON.parse(readFileSync(join(ROOT, 'public', 'objects', 'simready', 'catalog.json'), 'utf8'));
const jobs = [];
for (const m of Object.values(catalog.models)) {
	if (m.status !== 'done') continue;
	jobs.push({ key: m.glb_file, local: join(DIR, 'glb', `${m.slug}.glb`), type: 'model/gltf-binary', cache: 'public, max-age=604800' });
	if (m.thumb_file) {
		jobs.push({ key: m.thumb_file, local: join(DIR, 'thumbs', `${m.slug}.webp`), type: 'image/webp', cache: 'public, max-age=604800' });
	}
}

let uploaded = 0, skipped = 0, missing = 0;
let next = 0;
async function worker() {
	while (next < jobs.length) {
		const job = jobs[next++];
		if (!existsSync(job.local)) { missing++; console.error(`missing local file ${job.local}`); continue; }
		if (DRY) { uploaded++; continue; }
		if (!FORCE && await objectExists(job.key)) { skipped++; continue; }
		await putObject(job.key, readFileSync(job.local), job.type, job.cache);
		uploaded++;
		if (uploaded % 100 === 0) console.log(`${uploaded} uploaded`);
	}
}
await Promise.all(Array.from({ length: CONCURRENCY }, worker));
console.log(`${DRY ? '[dry-run] ' : ''}${uploaded} uploaded, ${skipped} already present, ${missing} missing of ${jobs.length}`);
if (missing) process.exit(2);
