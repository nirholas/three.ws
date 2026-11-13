#!/usr/bin/env node
// Drain the legacy Forge thumbnail backlog: rows whose preview_key still names
// the original 768² PNG are re-encoded to the 512² WebP by the same
// upgradeLegacyBatch() the forge-thumbnail-backfill cron runs each tick. This
// is the bulk form for clearing a large backlog in one sitting; the cron keeps
// the steady state. Idempotent, and the PNG originals are never deleted.
//
// Usage: load DATABASE_URL, the S3_* keys and PUBLIC_APP_ORIGIN from the live
// Cloud Run service (one key at a time is fastest: node scripts/read-service-env.mjs '^S3_BUCKET$'), then
//   node scripts/upgrade-forge-thumbnails.mjs [--batch 200] [--concurrency 12] [--max N]

import { upgradeLegacyBatch } from '../api/_lib/forge-thumbs.js';

function arg(name, fallback) {
	const i = process.argv.indexOf(`--${name}`);
	return i > -1 ? Number(process.argv[i + 1]) : fallback;
}

const BATCH = arg('batch', 200);
const CONCURRENCY = arg('concurrency', 12);
const MAX = arg('max', Infinity);

let total = 0;
let failedTotal = 0;
const started = Date.now();
while (total < MAX) {
	const r = await upgradeLegacyBatch({ limit: BATCH, concurrency: CONCURRENCY });
	total += r.upgraded;
	failedTotal += r.failed;
	console.log(`[upgrade] batch scanned=${r.scanned} upgraded=${r.upgraded} failed=${r.failed} total=${total} ${Math.round((Date.now() - started) / 1000)}s`);
	if (r.scanned === 0) break;
	if (r.upgraded === 0) {
		console.error('[upgrade] a full batch failed; stopping so the failing rows can be inspected');
		process.exitCode = 1;
		break;
	}
}
console.log(`[upgrade] done: upgraded=${total} failed=${failedTotal}`);
