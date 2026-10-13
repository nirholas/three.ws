#!/usr/bin/env node
// Operator CLI for the content queue's bundles: how an approved post reaches
// production without a deploy (api/_lib/x-content/overlay.js).
//
//   node scripts/x-bundle.mjs publish <id> [<id>...]   bundle approved items and upload them
//   node scripts/x-bundle.mjs publish --approved       every approved item the ledger has not published
//   node scripts/x-bundle.mjs list                     the verified index, one bundle per line
//   node scripts/x-bundle.mjs pull [--dir <path>]      build the root production will see, locally
//   node scripts/x-bundle.mjs remove <id>              drop a bundle and its files
//   node scripts/x-bundle.mjs verify                   check the signature and every file hash
//
// `publish --replace-index` starts a new index when the stored one no longer
// verifies, which is the step that follows rotating the secret.
//
// Env: reads .env.local then .env. The storage credentials (S3_ENDPOINT,
// S3_BUCKET, S3_ACCESS_KEY_ID, S3_SECRET_ACCESS_KEY) and the signing secret
// (X_CONTENT_BUNDLE_SECRET) are taken from the Cloud Run service when they are
// not set locally, so a bundle is signed with the secret production verifies
// against. DATABASE_URL gives `publish --approved` the shared publish ledger.

import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

import { loadQueue } from '../api/_lib/x-content/queue.js';
import { REVIEW_MAX_AGE_DAYS } from '../api/_lib/x-content/review.js';
import { dbStore, memoryStore } from '../api/_lib/x-content/state.js';
import { DEFAULT_OVERLAY_DIR, INDEX_VERSION, buildBundle, materialize, publishBundles, bundleStorage, readIndex, removeBundle, signIndex, verifyBundles } from '../api/_lib/x-content/overlay.js';

const root = resolve(fileURLToPath(new URL('..', import.meta.url)));
const DAY = 24 * 60 * 60_000;

function loadEnvFile(path) {
	if (!existsSync(path)) return;
	for (const line of readFileSync(path, 'utf8').split('\n')) {
		const match = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/i);
		if (match && !process.env[match[1]]) process.env[match[1]] = match[2].replace(/^["']|["']$/g, '');
	}
}
loadEnvFile(resolve(root, '.env.local'));
loadEnvFile(resolve(root, '.env'));

const args = process.argv.slice(2);
const VALUE_FLAGS = new Set(['--dir']);
const positional = args.filter((arg, index) => !arg.startsWith('--') && !VALUE_FLAGS.has(args[index - 1]));
const has = (flag) => args.includes(`--${flag}`);
const option = (name, fallback = null) => {
	const inline = args.find((arg) => arg.startsWith(`--${name}=`));
	if (inline) return inline.slice(name.length + 3);
	const index = args.indexOf(`--${name}`);
	return index >= 0 && args[index + 1] && !args[index + 1].startsWith('--') ? args[index + 1] : fallback;
};
const command = positional[0] || 'list';

function fail(message) {
	console.error(message);
	process.exit(1);
}

// What api/_lib/env.js reads for the storage client, plus the signing secret.
const R2_ENV = ['S3_ENDPOINT', 'S3_BUCKET', 'S3_ACCESS_KEY_ID', 'S3_SECRET_ACCESS_KEY'];
// With X_CONTENT_BUNDLE_BUCKET the bundles live on Google Cloud Storage and the
// R2 credentials are not needed.
const gcsBucket = () => Boolean(String(process.env.X_CONTENT_BUNDLE_BUCKET ?? '').trim());

function hydrateBundleEnv() {
	if (!process.env.GOOGLE_CLOUD_PROJECT) process.env.GOOGLE_CLOUD_PROJECT = 'aerial-vehicle-466722-p5';
	const hydrate = (names) => {
		for (const name of names.filter((key) => !String(process.env[key] ?? '').trim())) {
			const read = spawnSync(process.execPath, [resolve(root, 'scripts/read-service-env.mjs'), `^${name}$`, '--raw'], { cwd: root, encoding: 'utf8' });
			const value = read.status === 0 ? read.stdout.trim() : '';
			if (value) process.env[name] = value;
		}
	};
	hydrate(['X_CONTENT_BUNDLE_BUCKET', 'X_CONTENT_BUNDLE_SECRET']);
	if (!gcsBucket()) hydrate(R2_ENV);
	const missing = [...(gcsBucket() ? [] : R2_ENV), 'X_CONTENT_BUNDLE_SECRET'].filter((key) => !String(process.env[key] ?? '').trim());
	if (missing.includes('X_CONTENT_BUNDLE_SECRET')) {
		fail('X_CONTENT_BUNDLE_SECRET is not set here or on the Cloud Run service. Generate one with `openssl rand -hex 32`, store it on the service as a Secret Manager reference, and run this again.');
	}
	if (missing.length) fail(`Object storage is not configured: ${missing.join(', ')} missing here and on the Cloud Run service.`);
}

const kb = (bytes) => `${(bytes / 1024).toFixed(1)} KB`;
const totalBytes = (bundle) => bundle.files.reduce((sum, file) => sum + file.bytes, 0);

async function approvedIds() {
	const store = process.env.DATABASE_URL ? dbStore() : memoryStore();
	const state = await store.load();
	const published = new Set((state.published || []).map((row) => row.id));
	console.log(`ledger: ${store.label}`);
	return loadQueue(root).items.filter((item) => item.status === 'approved' && !published.has(item.id)).map((item) => item.id);
}

async function publish() {
	const named = positional.slice(1);
	if (!named.length && !has('approved')) fail('Usage: publish <id> [<id>...] | publish --approved [--replace-index]');
	const ids = named.length ? named : await approvedIds();
	if (!ids.length) {
		console.log('Nothing to bundle: no approved item is waiting to be published.');
		return;
	}

	// Named items are all or nothing. A sweep of everything approved skips what
	// cannot be bundled, says why, and still ships the rest.
	const ready = [];
	const refused = [];
	for (const id of ids) {
		try {
			const bundle = buildBundle(root, id);
			ready.push(id);
			console.log(`ready  ${id}: ${bundle.files.length} file(s), ${kb(totalBytes(bundle))}`);
		} catch (err) {
			refused.push(id);
			console.error(`refuse ${err.message}`);
		}
	}
	if (refused.length && named.length) fail(`Nothing was uploaded: ${refused.join(', ')} cannot be bundled.`);
	if (!ready.length) fail('Nothing was uploaded: no item could be bundled.');

	const result = await publishBundles({ root, ids: ready, storage: bundleStorage(), replaceIndex: has('replace-index') });
	console.log(`\nPublished ${result.published.join(', ')}: ${result.uploaded} file(s) uploaded, ${result.skipped} already stored.`);
	console.log('Production reads the index at the start of its next tick when X_CONTENT_REMOTE_QUEUE is true.');
	if (refused.length) process.exit(1);
}

function reviewWindow(bundle, now) {
	const age = (now - Date.parse(bundle.review.reviewedAt)) / DAY;
	if (!(age <= REVIEW_MAX_AGE_DAYS)) return `review EXPIRED (${Math.floor(age)} days old, limit ${REVIEW_MAX_AGE_DAYS})`;
	return `review ${Math.floor(age)} day(s) old, ${Math.ceil(REVIEW_MAX_AGE_DAYS - age)} left`;
}

async function list() {
	const index = await readIndex({ storage: bundleStorage() });
	if (!index) {
		console.log('No bundle index in storage.');
		return;
	}
	const now = Date.now();
	console.log(`index signed and verified, updated ${index.updatedAt}, ${index.bundles.length} bundle(s)\n`);
	for (const bundle of index.bundles) {
		console.log(`  ${bundle.id.padEnd(30)} T${bundle.item.tier}  ${String(bundle.item.kind).padEnd(7)}  ${bundle.files.length} file(s), ${kb(totalBytes(bundle))}  bundled ${bundle.bundledAt}  ${reviewWindow(bundle, now)}`);
	}
}

async function pull() {
	const dir = resolve(option('dir', DEFAULT_OVERLAY_DIR));
	const storage = bundleStorage();
	// A bucket that has never been published to is the normal first run: nothing
	// is shipped yet, so the overlay is the image's queue with no bundles on it.
	let index = null;
	if (!(await readIndex({ storage }))) {
		const empty = { version: INDEX_VERSION, updatedAt: new Date().toISOString(), bundles: [] };
		index = { ...empty, signature: signIndex(empty) };
	}
	const result = await materialize({ imageRoot: root, storage, dir, index });
	console.log(`bundles: ${result.bundles.join(', ') || 'none'}`);
	if (result.superseded.length) console.log(`already posted in this checkout's queue, so left alone: ${result.superseded.join(', ')}`);
	console.log(`files: ${result.files} (${result.reused} reused from an earlier pull)`);
	console.log(`root: ${result.root}`);
}

async function remove() {
	const id = positional[1];
	if (!id) fail('Usage: remove <id>');
	const result = await removeBundle({ id, storage: bundleStorage() });
	if (!result.removed) fail(`${id} is not in the bundle index.`);
	console.log(`Removed ${id} and its files. ${result.remaining ? `${result.remaining} bundle(s) remain.` : 'The index was the last object, so it is gone too.'}`);
}

async function verify() {
	const result = await verifyBundles({ storage: bundleStorage() });
	if (!result.index) {
		console.log('No bundle index in storage; nothing to verify.');
		return;
	}
	console.log(`signature: ok (index updated ${result.index.updatedAt})`);
	for (const problem of result.problems) console.error(`error ${problem}`);
	if (result.problems.length) fail(`x-bundle: ${result.problems.length} problem(s) across ${result.bundles} bundle(s)`);
	console.log(`files: ${result.files} downloaded across ${result.bundles} bundle(s), every hash matches`);
}

const commands = { publish, list, pull, remove, verify };
if (!commands[command]) fail(`Unknown command ${command}. Commands: ${Object.keys(commands).join(', ')}`);
hydrateBundleEnv();
try {
	await commands[command]();
} catch (err) {
	fail(`x-bundle: ${err.code ? `${err.code}: ` : ''}${err.message}`);
}
