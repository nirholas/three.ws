#!/usr/bin/env node
/**
 * Re-render stored avatar thumbnails in the thumbnail rest pose.
 *
 * Posters baked before src/thumbnail-pose.js existed show a humanoid in its raw
 * bind pose, arms straight out in a T. Every thumbnail the server renders from
 * now on is posed, but the ones already in the bucket stay as they were until
 * something re-renders them. This script is that something.
 *
 * What it touches: only thumbnail objects the platform renders or auto-captures
 * itself, never a creator's own artwork.
 *
 *   thumb/<uuid>.png         backfill renders and the /create auto-capture
 *   og/avatar/<uuid>.png     OG renders of first-party avatars
 *   <storage key>_og.png     OG renders of bucket avatars
 *   forge/thumb/<uuid>.png   server renders of forge models
 *
 * Many avatars share one thumbnail (an agent's cloned body keeps its source's
 * key), so work is planned per distinct key: one render rewrites the picture
 * for every avatar that points at it. Keys are visited most-visible first
 * (featured, then public, then views).
 *
 * How it writes: --apply re-renders the GLB and overwrites the object IN PLACE
 * under the same key, stamped with x-amz-meta-thumbnail-pose. No database row
 * changes, so the avatars table is never written. A model that is not a
 * humanoid (a prop, a vehicle, a creature) comes back from the renderer
 * unposed, and its stored thumbnail is left alone. An object already stamped
 * with the current THUMBNAIL_POSE_VERSION is skipped, so a run can be stopped
 * and restarted (use --offset to jump ahead) without paying for work twice.
 *
 * Usage (DATABASE_URL is in .env.local; the S3_* set lives on the Cloud Run
 * service):
 *
 *   eval "$(node scripts/read-service-env.mjs '^S3_')"
 *
 *   # Plan only (the default). Renders nothing, writes nothing.
 *   node --env-file=.env.local scripts/regenerate-avatar-thumbnails.mjs --limit=20 --plan-only
 *
 *   # Dry run: render each candidate locally and save before/after PNGs to a
 *   # folder for review. Reads production, writes nothing to it.
 *   node --env-file=.env.local scripts/regenerate-avatar-thumbnails.mjs --limit=12 --out=/tmp/thumbs
 *
 *   # Apply: overwrite the stale posters in the bucket.
 *   node --env-file=.env.local scripts/regenerate-avatar-thumbnails.mjs --apply --limit=500 --concurrency=3
 *
 * Flags:
 *   --apply            overwrite objects in the bucket (default: dry run)
 *   --limit=N          distinct thumbnail keys to visit (default 25)
 *   --offset=N         skip the first N keys in priority order (default 0)
 *   --concurrency=N    renders in flight at once (default 2)
 *   --ids=a,b,c        only the thumbnails of these avatar ids
 *   --out=DIR          dry run: write <avatar>-before.png and <avatar>-after.png here
 *   --plan-only        list the keys that would be visited, render nothing
 *
 * Cache: the public bucket domain serves these objects with no Cache-Control
 * header, so a fresh request gets the new bytes the moment the overwrite
 * lands, and a browser holding a heuristically cached copy revalidates on its
 * ETag, which the overwrite changes. Nothing on our side caches the image URL:
 * every surface derives it from thumbnail_key at read time.
 */

import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { sql } from '../api/_lib/db.js';
import { headObject, presignGet, publicUrl, putObject, isStorageInfrastructureError } from '../api/_lib/r2.js';
import { renderGlbToPng, isBrowserInfrastructureError } from '../api/_lib/render-glb.js';
import { thumbBackdropFor, THUMB_SIZE, THUMB_BACKGROUND } from '../api/_lib/avatar-thumbs.js';
import { THUMBNAIL_POSE_VERSION } from '../src/thumbnail-pose.js';

const argv = process.argv.slice(2);
const flag = (name) => argv.includes(`--${name}`);
const opt = (name, fallback) => {
	const hit = argv.find((a) => a.startsWith(`--${name}=`));
	return hit ? hit.slice(name.length + 3) : fallback;
};
const int = (name, fallback, min) => {
	const n = Number.parseInt(opt(name, ''), 10);
	return Number.isFinite(n) ? Math.max(min, n) : fallback;
};

const APPLY = flag('apply');
const PLAN_ONLY = flag('plan-only');
const LIMIT = int('limit', 25, 1);
const OFFSET = int('offset', 0, 0);
const CONCURRENCY = int('concurrency', 2, 1);
const OUT = opt('out', '');
const IDS = opt('ids', '')
	.split(',')
	.map((s) => s.trim())
	.filter(Boolean);

const META_KEY = 'thumbnail-pose';
const UUID = '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}';

// The four key shapes the platform writes itself. Anything else (an adopted
// forge reference image, a creator's uploaded cover) is not ours to repaint.
const KEY_SHAPES = {
	thumb: new RegExp(`^thumb/${UUID}\\.png$`),
	ogAvatar: new RegExp(`^og/avatar/${UUID}\\.png$`),
	forgeThumb: new RegExp(`^forge/thumb/${UUID}\\.png$`),
	ogBucket: /^(?!https?:\/\/).+_og\.png$/i,
};

function shapeOf(key) {
	for (const [shape, re] of Object.entries(KEY_SHAPES)) if (re.test(key)) return shape;
	return null;
}

// Same canvas each writer used, so a regenerated poster is interchangeable with
// a fresh one: OG cards are 1200x630, gallery thumbnails square.
function canvasFor(shape) {
	if (shape === 'ogAvatar' || shape === 'ogBucket') return { width: 1200, height: 630 };
	return { width: THUMB_SIZE, height: THUMB_SIZE };
}

// The stage tint is seeded the way the original writer seeded it: by avatar id,
// or by the forge creation id embedded in a forge key.
function backdropSeed(key, shape, avatarId) {
	if (shape === 'forgeThumb') return key.slice('forge/thumb/'.length, -'.png'.length);
	return avatarId;
}

function requireEnv() {
	const missing = ['DATABASE_URL'];
	if (!PLAN_ONLY) missing.push('S3_PUBLIC_DOMAIN');
	if (APPLY) missing.push('S3_BUCKET', 'S3_ACCESS_KEY_ID', 'S3_SECRET_ACCESS_KEY');
	for (const name of missing) {
		if (process.env[name]) continue;
		const where = name.startsWith('S3_')
			? `export the S3_* set first: eval "$(node scripts/read-service-env.mjs '^S3_')"`
			: `run with: node --env-file=.env.local ${path.relative(process.cwd(), process.argv[1])}`;
		console.error(`[regen] ${name} is unset. ${where}`);
		process.exit(1);
	}
}

const SHAPE_SQL = `^(thumb/${UUID}\\.png|og/avatar/${UUID}\\.png|forge/thumb/${UUID}\\.png)$`;

/**
 * Distinct server-written thumbnail keys, each with the GLB to re-render it
 * from. A key named after an avatar (thumb/<id>.png) renders from that avatar
 * when it still exists; otherwise from the oldest avatar sharing the key.
 */
async function planKeys() {
	const ids = IDS.length ? IDS : null;
	return sql`
		WITH refs AS (
			SELECT a.id, a.storage_key, a.thumbnail_key AS key, a.featured, a.visibility,
			       a.view_count, a.created_at
			  FROM avatars a
			 WHERE a.deleted_at IS NULL
			   AND a.storage_key IS NOT NULL
			   AND a.thumbnail_key IS NOT NULL
			   AND (a.thumbnail_key ~ ${SHAPE_SQL}
			        OR (a.thumbnail_key ~* '_og[.]png$' AND a.thumbnail_key !~* '^https?://'))
			   AND (${ids}::uuid[] IS NULL OR a.id = ANY(${ids}::uuid[]))
		)
		SELECT key,
		       (array_agg(id ORDER BY (key LIKE '%' || id::text || '%') DESC, created_at ASC))[1] AS avatar_id,
		       (array_agg(storage_key ORDER BY (key LIKE '%' || id::text || '%') DESC, created_at ASC))[1] AS storage_key,
		       count(*)::int AS refs,
		       bool_or(featured) AS featured,
		       bool_or(visibility = 'public') AS public,
		       max(view_count) AS views
		  FROM refs
		 GROUP BY key
		 ORDER BY featured DESC, public DESC, views DESC NULLS LAST, key
		 LIMIT ${LIMIT} OFFSET ${OFFSET}
	`;
}

// GLB the renderer reads. A signed URL when we hold storage credentials (works
// for private avatars too), otherwise the public bucket URL, which is all a dry
// run needs. Absolute first-party URLs pass through either way.
async function glbUrlFor(storageKey) {
	if (process.env.S3_ACCESS_KEY_ID && process.env.S3_BUCKET) {
		return presignGet({ key: storageKey, expiresIn: 300 });
	}
	return publicUrl(storageKey);
}

// Pose stamp of the stored object, or null when we cannot tell (no storage
// credentials in a dry run) or the object predates the stamp.
async function storedPoseVersion(key) {
	if (!process.env.S3_ACCESS_KEY_ID) return null;
	const head = await headObject(key);
	return head?.Metadata?.[META_KEY] || null;
}

async function saveCurrent(key, file) {
	const res = await fetch(publicUrl(key), { signal: AbortSignal.timeout(20_000) });
	if (!res.ok) return false;
	await writeFile(file, Buffer.from(await res.arrayBuffer()));
	return true;
}

// One model that never finishes rendering (seen in the chromium lane) once
// held a whole pass for seven hours. It is counted as failed and the pass moves on.
const RENDER_TIMEOUT_MS = 120_000;

function withRenderTimeout(render, key) {
	let timer;
	const timeout = new Promise((_, reject) => {
		timer = setTimeout(() => reject(new Error(`render of ${key} did not finish in ${RENDER_TIMEOUT_MS / 1000} s`)), RENDER_TIMEOUT_MS);
	});
	return Promise.race([render, timeout]).finally(() => clearTimeout(timer));
}

async function processKey(row) {
	const shape = shapeOf(row.key);
	if (!shape) return { status: 'skipped', reason: 'unrecognised key shape' };

	if ((await storedPoseVersion(row.key)) === THUMBNAIL_POSE_VERSION) {
		return { status: 'current' };
	}

	let pose = { posed: false, mode: 'unknown' };
	const t0 = Date.now();
	const png = await withRenderTimeout(renderGlbToPng({
		glbUrl: await glbUrlFor(row.storage_key),
		...canvasFor(shape),
		background: THUMB_BACKGROUND,
		backdrop: thumbBackdropFor(backdropSeed(row.key, shape, row.avatar_id)),
		onPose: (result) => {
			pose = result;
		},
	}), row.key);
	const ms = Date.now() - t0;
	if (!png?.length) throw new Error('renderer returned no bytes');

	// Not a humanoid: the render is the model as authored, which is what the
	// stored poster already shows. Leave it.
	if (!pose.posed) return { status: 'skipped', reason: `not posable (${pose.mode})`, ms };

	if (!APPLY) {
		if (OUT) {
			await saveCurrent(row.key, path.join(OUT, `${row.avatar_id}-before.png`)).catch(() => false);
			await writeFile(path.join(OUT, `${row.avatar_id}-after.png`), png);
		}
		return { status: 'would-write', mode: pose.mode, bytes: png.length, ms };
	}

	await putObject({
		key: row.key,
		body: png,
		contentType: 'image/png',
		metadata: { 'avatar-id': String(row.avatar_id), [META_KEY]: THUMBNAIL_POSE_VERSION },
	});
	return { status: 'written', mode: pose.mode, bytes: png.length, ms };
}

async function main() {
	requireEnv();
	if (OUT) await mkdir(OUT, { recursive: true });

	const rows = await planKeys();
	const mode = APPLY ? 'APPLY' : PLAN_ONLY ? 'plan only' : 'dry run';
	console.log(
		`[regen] ${mode}: ${rows.length} thumbnail key(s), offset ${OFFSET}, pose ${THUMBNAIL_POSE_VERSION}` +
			(OUT && !APPLY ? `, saving PNGs to ${OUT}` : ''),
	);
	if (PLAN_ONLY) {
		for (const [i, r] of rows.entries()) {
			console.log(`  ${OFFSET + i + 1}. ${r.key}  avatars=${r.refs}  views=${r.views ?? 0}  glb=${r.storage_key}`);
		}
		return;
	}

	const tally = { written: 0, 'would-write': 0, current: 0, skipped: 0, failed: 0 };
	const queue = rows.map((row, i) => ({ row, n: OFFSET + i + 1 }));
	const total = OFFSET + rows.length;
	let aborted = null;

	const worker = async () => {
		for (let job = queue.shift(); job && !aborted; job = queue.shift()) {
			const { row, n } = job;
			const label = `[${n}/${total}] ${row.key} (avatars=${row.refs})`;
			try {
				const r = await processKey(row);
				tally[r.status] += 1;
				const detail = [r.mode, r.reason, r.bytes && `${r.bytes}B`, r.ms && `${r.ms}ms`].filter(Boolean).join(' ');
				console.log(`${label} ${r.status}${detail ? ` ${detail}` : ''}`);
			} catch (err) {
				const msg = err?.message || String(err);
				// A dead browser or unreachable bucket fails every job after it for a
				// reason that has nothing to do with the models. Stop instead.
				if (isBrowserInfrastructureError(err) || isStorageInfrastructureError(err)) {
					aborted = msg;
					console.error(`${label} aborting the run: ${msg}`);
					return;
				}
				tally.failed += 1;
				console.warn(`${label} failed ${msg}`);
			}
		}
	};
	await Promise.all(Array.from({ length: Math.min(CONCURRENCY, rows.length || 1) }, worker));

	console.log(`[regen] done: ${JSON.stringify(tally)}${aborted ? ` (aborted: ${aborted})` : ''}`);
	if (rows.length === LIMIT) {
		console.log(`[regen] more may remain: rerun with --offset=${OFFSET + rows.length}`);
	}
	if (aborted) process.exitCode = 2;
}

main()
	.catch((err) => {
		console.error('[regen] fatal:', err?.stack || err);
		process.exitCode = 1;
	})
	.finally(() => {
		// The shared chromium (failover lane) keeps the event loop alive.
		setTimeout(() => process.exit(), 100).unref();
	});
