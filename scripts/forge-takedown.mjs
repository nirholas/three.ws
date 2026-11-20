#!/usr/bin/env node
// Take a Forge model down completely: the row, the mesh, the preview, every
// delivery variant under the creation's storage prefix, the source uploads, the
// edge-cached copies, and an audit row in forge_removal_requests.
//
// For any takedown: one filed through "Request removal" on the model page
// (listed by `npm run forge:removals`), a GitHub issue, or an email. Every open
// removal request on the model is closed with the resolution given here.
//
//   npm run forge:takedown -- <creation-id> --prod-env                 dry run
//   npm run forge:takedown -- <creation-id> --prod-env --apply \
//       --reason my_content --details "GitHub issue #639" \
//       --resolution "Removed at the maker's request" \
//       [--extra-key forge/uploads/<client12>/<file>]...
//
// --prod-env  read DATABASE_URL, S3_*, STORAGE_FALLBACK_* and APP_ORIGIN from
//             the three-ws-api Cloud Run service (secrets through Secret
//             Manager) into this process only; nothing is written to disk.
//             Without it the script uses the environment it was started with.
// --extra-key a bucket key the row never recorded (an upload made before
//             source_image_keys existed). Must sit under forge/.
// --evidence-released "<report reference>"
//             required to delete a model under a CSAM evidence hold (any
//             content_safety_reviews row with csam set). Without it the
//             takedown refuses and changes nothing. Pass it only after the
//             owner has filed the legal report and retention is met
//             (docs/ops/content-safety.md); the reference is recorded.
//
// The dry run prints the row and every object the delete will remove. --apply
// deletes (forgeStore.deleteCreation with the moderator grant), records the
// takedown, invalidates the CDN for each removed path and the model page, then
// fetches each public URL.
//
// Object storage outage: when the bucket refuses the delete (a rejected
// credential, an unreachable endpoint) the row still comes down and every
// object that could not be removed is queued in forge_storage_purges. /cdn/
// answers 410 for queued keys and /api/cron/forge-storage-purge finishes the
// delete once storage accepts writes again. If listing is refused too, the dry
// run probes the public bucket domain for the creation's usual file names so
// those keys are queued as well.
//
// Exit codes: 0 every URL is gone; 1 a three.ws URL still serves the model;
// 2 usage error; 4 refused: CSAM evidence hold; 3 three.ws is clean but copies on the public bucket domain
// are still readable, waiting on the purge queue. Rerunning after a partial
// failure is safe: a missing row still deletes the extra keys, records, purges
// and verifies.

import { SERVICE, gcloud, loadCloudRunEnv } from './lib/cloud-run-env.mjs';

const URL_MAP = 'three-ws-lb';
const ENV_WANTED = /^(DATABASE_URL|APP_ORIGIN|S3_[A-Z_]+|STORAGE_FALLBACK_[A-Z_]+)$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

function usage(msg) {
	if (msg) console.error(`forge-takedown: ${msg}`);
	console.error('Usage: npm run forge:takedown -- <creation-id> [--prod-env] [--apply] [--reason R] [--details D] [--resolution T] [--extra-key K]... [--evidence-released REF]');
	process.exit(2);
}

function parseArgs(argv) {
	const out = { id: null, apply: false, prodEnv: false, reason: 'other', details: null, resolution: null, extraKeys: [], evidenceReleased: null };
	for (let i = 0; i < argv.length; i++) {
		const a = argv[i];
		const next = () => {
			const v = argv[++i];
			if (v === undefined) usage(`${a} needs a value`);
			return v;
		};
		if (a === '--apply') out.apply = true;
		else if (a === '--prod-env') out.prodEnv = true;
		else if (a === '--reason') out.reason = next();
		else if (a === '--details') out.details = next();
		else if (a === '--resolution') out.resolution = next();
		else if (a === '--extra-key') out.extraKeys.push(next());
		else if (a === '--evidence-released') out.evidenceReleased = next().trim() || usage('--evidence-released needs the report reference');
		else if (a.startsWith('--')) usage(`unknown flag ${a}`);
		else if (!out.id) out.id = a.trim().toLowerCase();
		else usage(`unexpected argument ${a}`);
	}
	if (!out.id || !UUID.test(out.id)) usage('give the creation id (a uuid)');
	for (const k of out.extraKeys) if (!k.startsWith('forge/') || k.includes('..')) usage(`--extra-key must be a forge/ bucket key: ${k}`);
	return out;
}

function loadProdEnv() {
	const n = loadCloudRunEnv({ wanted: ENV_WANTED, required: ['DATABASE_URL', 'S3_BUCKET'] });
	console.log(`loaded ${n} production env vars from ${SERVICE} (in memory only)`);
}

function cdnPath(key) {
	return `/cdn/${key.split('/').map(encodeURIComponent).join('/')}`;
}

async function stillServed(url) {
	try {
		const r = await fetch(url, { method: 'GET', redirect: 'manual', headers: { 'cache-control': 'no-cache' } });
		await r.body?.cancel().catch(() => {});
		return { url, status: r.status, gone: r.status === 404 || r.status === 410 };
	} catch (err) {
		return { url, status: `error: ${err?.message || err}`, gone: false };
	}
}

const opts = parseArgs(process.argv.slice(2));
if (opts.prodEnv) loadProdEnv();

// Imported after the env is in place: these modules read it at load time.
const { sql } = await import('../api/_lib/db.js');
const { deleteCreation, forgeStoreEnabled } = await import('../api/_lib/forge-store.js');
const { listObjectsPage, deleteObject, cdnUrl, keyFromPublicUrl, isStorageInfrastructureError } = await import('../api/_lib/r2.js');
const { recordTakedown, REMOVAL_REASONS } = await import('../api/_lib/forge-removal-requests.js');
const { queueStoragePurges } = await import('../api/_lib/forge-storage-purges.js');
const { VARIANT_WIDTHS } = await import('../src/shared/cdn-variant.js');
const { hasEvidenceHold } = await import('../api/_lib/content-safety-store.js');

if (!REMOVAL_REASONS.includes(opts.reason)) usage(`--reason must be one of ${REMOVAL_REASONS.join(', ')}`);
if (!forgeStoreEnabled()) {
	console.error('forge-takedown: database or object storage is not configured (pass --prod-env, or start with the production env)');
	process.exit(1);
}
const origin = String(process.env.APP_ORIGIN || 'https://three.ws').replace(/\/+$/, '');

// A CSAM verdict means the model is evidence for a legal report. Check before
// listing or deleting anything, dry run included, so the operator sees it first.
const evidenceHold = await hasEvidenceHold(opts.id);
if (evidenceHold && !opts.evidenceReleased) {
	console.error(`\nforge-takedown: ${opts.id} is under a CSAM evidence hold. Nothing was changed.`);
	console.error('Do not delete it, its files or its review rows until the owner has filed the report and retention');
	console.error('is met (docs/ops/content-safety.md, CSAM runbook). Then rerun with --evidence-released "<report reference>".');
	process.exit(4);
}
if (evidenceHold) console.log(`\nCSAM evidence hold released by the operator: ${opts.evidenceReleased}`);

const [row] = await sql`
	select id, client_key, status, visibility, outcome, prompt, created_at, user_id,
		glb_key, glb_url, preview_key, preview_image_url, web_glb_key, web_glb_url,
		lod_glb_key, lod_glb_url, source_image_keys
	from forge_creations where id = ${opts.id} limit 1
`;

const publicDomain = String(process.env.S3_PUBLIC_DOMAIN || '').replace(/\/+$/, '');
const PREFIX_SUFFIXES = ['.glb', '.png', '.jpg', '.webp', '.web.glb', '.lod.glb', '-poster.webp', '-poster.png', '-poster.jpg'];
async function probePublic(prefix) {
	if (!publicDomain) return [];
	const found = await Promise.all(
		PREFIX_SUFFIXES.map(async (s) => ((await stillServed(`${publicDomain}/${prefix}${s}`)).status === 200 ? `${prefix}${s}` : null)),
	);
	return found.filter(Boolean);
}

let storageDown = false;
const planned = new Set(opts.extraKeys);
if (row) {
	for (const k of [row.glb_key, row.preview_key, row.web_glb_key, row.lod_glb_key, ...(row.source_image_keys || [])]) {
		if (typeof k === 'string' && k.startsWith('forge/')) planned.add(k);
	}
	for (const u of [row.glb_url, row.preview_image_url, row.web_glb_url, row.lod_glb_url]) {
		const k = keyFromPublicUrl(u);
		if (k?.startsWith('forge/')) planned.add(k);
	}
	if (row.client_key) {
		const prefix = `forge/${row.client_key.slice(0, 12)}/${row.id}`;
		try {
			const page = await listObjectsPage({ prefix, maxKeys: 1000 });
			for (const o of page.objects) planned.add(o.key);
		} catch (err) {
			if (!isStorageInfrastructureError(err)) throw err;
			storageDown = true;
			// Listing needs the credential; the public domain does not. Probe the
			// suffixes the pipeline writes so the CDN purge still names them.
			for (const key of await probePublic(prefix)) planned.add(key);
		}
	}
	console.log('\ncreation');
	console.log(`  id          ${row.id}`);
	console.log(`  status      ${row.status} (${row.outcome || 'no outcome'}), visibility ${row.visibility ?? 'null (public)'}`);
	console.log(`  created     ${new Date(row.created_at).toISOString()}${row.user_id ? `, account ${row.user_id}` : ', anonymous'}`);
	console.log(`  client key  ${row.client_key}`);
	console.log(`  prompt      ${row.prompt ? JSON.stringify(String(row.prompt).slice(0, 120)) : '(none)'}`);
} else {
	console.log(`\nno forge_creations row for ${opts.id} (already deleted?)`);
}
console.log(`\nbucket objects (${planned.size})${storageDown ? ', found by probing the public domain: storage refused the listing' : ''}`);
for (const k of [...planned].sort()) console.log(`  ${k}`);
if (storageDown) {
	console.log('\nobject storage is rejecting the credential. --apply still takes the row down and queues every');
	console.log('object in forge_storage_purges; /cdn/ refuses them and /api/cron/forge-storage-purge deletes them');
	console.log('once storage accepts writes again.');
}

if (!opts.apply) {
	console.log('\ndry run: nothing changed. Re-run with --apply --resolution "<why>" to take it down.');
	process.exit(0);
}
if (!opts.resolution) usage('--apply needs --resolution "<what was done and why>"');

let removed = [];
let pending = [];
if (row) {
	const outcome = await deleteCreation({
		id: row.id,
		moderator: true,
		onDeleted: (info) => {
			removed = info.keys;
			pending = info.pending || [];
		},
	});
	if (outcome !== 'deleted' && outcome !== 'not_found') {
		console.error(`\ndelete failed (${outcome}). Nothing was recorded; rerun once the database answers.`);
		process.exit(1);
	}
	console.log(`\ndeleteCreation: ${outcome}, ${removed.length} object(s) covered, ${pending.length} queued for purge`);
}
for (const k of opts.extraKeys) {
	try {
		await deleteObject(k);
		console.log(`deleted extra key ${k}`);
	} catch (err) {
		if (!isStorageInfrastructureError(err)) throw err;
		await queueStoragePurges({ creationId: opts.id, entries: [{ target: k, kind: 'object' }] });
		pending.push(k);
		console.log(`queued extra key ${k} (storage refused the delete)`);
	}
}
// Probed keys were never listed, so deleteCreation could not name them: queue
// them by name too (the queued prefix already covers them; this keeps the
// purge exact even if the prefix sweep is ever narrowed).
const unlisted = [...planned].filter((k) => !removed.includes(k) && !opts.extraKeys.includes(k));
if (storageDown && unlisted.length) {
	await queueStoragePurges({ creationId: opts.id, entries: unlisted.map((target) => ({ target, kind: 'object' })) });
	pending.push(...unlisted);
}
const allKeys = [...new Set([...planned, ...removed])].filter((k) => !k.endsWith('.') && !k.endsWith('/'));

const ids = await recordTakedown({
	creationId: opts.id,
	reason: opts.reason,
	details: opts.details,
	resolution: evidenceHold ? `${opts.resolution} (evidence hold released: ${opts.evidenceReleased})` : opts.resolution,
	reviewedBy: `ops-cli:${process.env.USER || 'unknown'}`,
});
console.log(`recorded in forge_removal_requests: ${ids.join(', ') || '(none)'}`);

const RASTER = /\.(png|jpe?g|webp)$/i;
const variantPaths = allKeys.filter((k) => RASTER.test(k) && !k.startsWith('variants/')).flatMap((k) => VARIANT_WIDTHS.map((w) => `/cdn/_v/${w}${cdnPath(k).slice(4)}`));
const paths = [`/m/${opts.id}`, `/m/${opts.id}/*`, ...allKeys.map(cdnPath), ...variantPaths];
console.log(`\ninvalidating ${paths.length} CDN path(s) on ${URL_MAP}`);
for (const p of paths) {
	try {
		gcloud(['compute', 'url-maps', 'invalidate-cdn-cache', URL_MAP, '--path', p, '--async']);
		console.log(`  ${p}`);
	} catch (err) {
		console.error(`  ${p}: ${err.message}`);
	}
}

// three.ws URLs must be gone now. The bucket's own public domain keeps serving
// until storage accepts the queued deletes; that part is owned by the purge cron.
const siteUrls = [...allKeys.map((k) => cdnUrl(k)), `${origin}/api/forge-creation?id=${opts.id}`];
const bucketUrls = publicDomain ? allKeys.map((k) => `${publicDomain}/${k}`) : [];
console.log('\nverifying');
const siteChecks = await Promise.all(siteUrls.map(stillServed));
const bucketChecks = await Promise.all(bucketUrls.map(stillServed));
for (const c of siteChecks) console.log(`  ${c.gone ? 'gone   ' : 'LIVE   '} ${c.status}  ${c.url}`);
for (const c of bucketChecks) console.log(`  ${c.gone ? 'gone   ' : 'pending'} ${c.status}  ${c.url}`);
const siteLive = siteChecks.filter((c) => !c.gone);
const bucketLive = bucketChecks.filter((c) => !c.gone);
if (siteLive.length) {
	console.error(`\n${siteLive.length} three.ws URL(s) still answer. The CDN purge is async (a few minutes), and /cdn/`);
	console.error('only refuses queued objects on a build that includes forge-storage-purges. Rerun to recheck.');
	process.exit(1);
}
if (bucketLive.length) {
	console.log(`\nrow and three.ws copies are gone. ${bucketLive.length} object(s) remain on the bucket's public domain,`);
	console.log('queued in forge_storage_purges; /api/cron/forge-storage-purge removes them once storage accepts deletes.');
	process.exit(3);
}
console.log('\ntakedown complete: every stored copy and public URL is gone.');
process.exit(0);
