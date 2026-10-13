// The overlay root: how an approved post reaches production without a deploy.
//
// The engine reads everything from files under one root (the queue, the review
// records, the media), and in production that root is the Cloud Run image, so a
// post approved today could not go out until someone shipped a new image. This
// module removes that ceiling without touching a single editorial rule.
//
// `npm run x:bundle -- publish <id>` packs an approved item, its full review
// record, and every file it needs into a bundle, uploads the files to object
// storage under content-addressed keys, and lists the bundle in one index that
// is signed with X_CONTENT_BUNDLE_SECRET. At the start of a tick production
// verifies that signature, then materializes a directory that mirrors the repo
// layout: the image's own data/ and public/ reached through symlinks, the
// bundle files written on top after their bytes hash to what the index
// recorded. The unchanged engine then runs with `root` pointing at it. The
// review record is still bound to the content hash, still expires, and the
// media limits, link checks, and probes still run, because the engine cannot
// tell an overlay from an image.
//
// Nothing here can stop a tick. Any failure (no secret, no storage, a bad
// signature, a file that does not match its hash) falls back to the image root,
// which is exactly what production did before the overlay existed.

import { createHash, createHmac, timingSafeEqual } from 'node:crypto';
import { existsSync, lstatSync, mkdirSync, readFileSync, readdirSync, readlinkSync, renameSync, rmSync, statSync, symlinkSync, unlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { isAbsolute, join, resolve, sep } from 'node:path';
import { MEDIA_ROOTS, mediaType } from './media.js';
import { QUEUE_PATH, loadArticle, loadQueue, validateItem } from './queue.js';
import { loadReview, reviewPath } from './review.js';

export const INDEX_KEY = 'x-content/bundles/index.json';
export const INDEX_VERSION = 1;
export const ARTICLE_ROOT = 'data/x-content/articles/';
export const REVIEW_ROOT = 'data/x-content/reviews/';
export const proofPath = (id) => `data/x-content/proofs/${id}.json`;
export const fileKey = (id, sha256) => `x-content/bundles/${id}/${sha256}`;
export const DEFAULT_OVERLAY_DIR = join(tmpdir(), 'x-content-overlay');

// A short secret is a guessable one, and this secret is the only thing standing
// between write access to the bucket and a post on @trythreews.
export const MIN_SECRET_LENGTH = 32;

// Marks a directory as one this module built, so materialize never prunes a
// directory that holds someone's files.
const MARKER = '.x-content-overlay';
// Top-level entries of the image that the overlay exposes. data/ and public/
// are what the engine reads; the rest is what a command probe or a textFrom
// check may look for under root.
const EXPOSED = ['data', 'public', 'scripts', 'docs', 'package.json'];

const SLUG = /^[a-z0-9][a-z0-9-]{1,80}$/;
const SHA256 = /^[0-9a-f]{64}$/;

export class OverlayError extends Error {
	constructor(code, message) {
		super(message);
		this.name = 'OverlayError';
		this.code = code;
	}
}

const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex');

// ── Canonical JSON and the signature ────────────────────────────────────────
// Keys sorted at every depth, so the bytes that are signed do not depend on the
// order a writer happened to build an object in, or on a store that reorders
// keys. Values follow JSON.stringify: undefined members are dropped, undefined
// array entries become null.
export function canonical(value) {
	if (value && typeof value.toJSON === 'function') return canonical(value.toJSON());
	if (Array.isArray(value)) return `[${value.map((row) => canonical(row === undefined ? null : row)).join(',')}]`;
	if (value && typeof value === 'object') {
		const keys = Object.keys(value).filter((key) => value[key] !== undefined && typeof value[key] !== 'function').sort();
		return `{${keys.map((key) => `${JSON.stringify(key)}:${canonical(value[key])}`).join(',')}}`;
	}
	return JSON.stringify(value) ?? 'null';
}

export const bundleHash = ({ item, review, files }) => sha256(canonical({ item, review, files }));

function secretFrom(env) {
	const secret = String(env?.X_CONTENT_BUNDLE_SECRET ?? '').trim();
	if (!secret) throw new OverlayError('unconfigured', 'X_CONTENT_BUNDLE_SECRET is not set');
	if (secret.length < MIN_SECRET_LENGTH) throw new OverlayError('unconfigured', `X_CONTENT_BUNDLE_SECRET is shorter than ${MIN_SECRET_LENGTH} characters; generate one with \`openssl rand -hex 32\``);
	return secret;
}

export function signIndex({ version, updatedAt, bundles }, env = process.env) {
	return createHmac('sha256', secretFrom(env)).update(canonical({ version, updatedAt, bundles })).digest('hex');
}

export function verifyIndex(index, env = process.env) {
	const expected = Buffer.from(signIndex(index, env), 'hex');
	const given = SHA256.test(String(index?.signature || '')) ? Buffer.from(index.signature, 'hex') : null;
	if (!given || given.length !== expected.length || !timingSafeEqual(given, expected)) {
		throw new OverlayError('bad_signature', 'the bundle index signature does not verify; it was not written with this X_CONTENT_BUNDLE_SECRET, or it was changed after it was signed');
	}
	return index;
}

// ── Paths ───────────────────────────────────────────────────────────────────
// Why a path may not be written into the overlay, or null when it may. The
// queue and the review records are the overlay's own: a bundle file is never
// allowed to stand in for either.
export function bundlePathProblem(path) {
	if (typeof path !== 'string' || !path) return 'is empty';
	if (path.includes('..')) return 'contains ..';
	if (isAbsolute(path) || path.startsWith('/') || /^[a-zA-Z]:/.test(path)) return 'is absolute';
	if (path.includes('\\') || path.includes('\0')) return 'contains a backslash or a null byte';
	if (path.split('/').some((part) => !part || part === '.')) return 'has an empty or dot segment';
	if (![...MEDIA_ROOTS, ARTICLE_ROOT].some((prefix) => path.startsWith(prefix))) return `is outside ${[...MEDIA_ROOTS, ARTICLE_ROOT].join(', ')}`;
	if (path === QUEUE_PATH || path.startsWith(REVIEW_ROOT)) return 'is reserved for the queue and the review records';
	return null;
}

function checkBundle(bundle) {
	const id = String(bundle?.id || '');
	if (!SLUG.test(id)) throw new OverlayError('bad_bundle', `bundle id ${JSON.stringify(bundle?.id)} is not a lowercase slug`);
	if (bundle.item?.id !== id) throw new OverlayError('bad_bundle', `${id}: the bundled item is ${JSON.stringify(bundle.item?.id)}`);
	if (!bundle.review || bundle.review.id !== id) throw new OverlayError('bad_bundle', `${id}: the bundled review record is for ${JSON.stringify(bundle.review?.id)}`);
	if (!Array.isArray(bundle.files)) throw new OverlayError('bad_bundle', `${id}: files is not a list`);
	for (const file of bundle.files) {
		const problem = bundlePathProblem(file?.path);
		if (problem) throw new OverlayError('bad_path', `${id}: file path ${JSON.stringify(file?.path)} ${problem}`);
		if (!SHA256.test(String(file.sha256 || ''))) throw new OverlayError('bad_bundle', `${id}: ${file.path} has no sha256`);
		if (!Number.isInteger(file.bytes) || file.bytes < 0) throw new OverlayError('bad_bundle', `${id}: ${file.path} has no byte count`);
	}
	if (bundle.hash !== bundleHash(bundle)) throw new OverlayError('bad_bundle', `${id}: the bundle hash does not cover its item, review record, and files`);
	return bundle;
}

// ── Storage ─────────────────────────────────────────────────────────────────
// The real store. Loaded on first use, so the cron module stays importable and
// cheap while the overlay is switched off.
// Where a key really lives in the bucket. The bucket is served on a public
// domain, and a bundle holds the copy of posts that have not gone out yet, some
// of them embargoed, so the bundles sit under a folder named from the secret:
// the index cannot be fetched by anyone who could not also have signed it.
export const BUNDLE_ROOT = 'x-content/bundles/';
export function sealedKey(key, env = process.env) {
	if (!key.startsWith(BUNDLE_ROOT)) throw new OverlayError('bad_path', `${key} is not a bundle key`);
	const folder = createHmac('sha256', secretFrom(env)).update('x-content bundle location').digest('hex').slice(0, 40);
	return `${BUNDLE_ROOT}${folder}/${key.slice(BUNDLE_ROOT.length)}`;
}

export function r2Storage(env = process.env) {
	const r2 = () => import('../r2.js');
	return {
		label: 'object storage',
		async put(key, buffer, contentType) {
			const { putObject } = await r2();
			await putObject({ key: sealedKey(key, env), body: buffer, contentType });
		},
		async get(key) {
			const { getObjectBuffer } = await r2();
			try {
				return await getObjectBuffer(sealedKey(key, env));
			} catch (err) {
				if (err?.name === 'NoSuchKey' || err?.$metadata?.httpStatusCode === 404) return null;
				throw err;
			}
		},
		async has(key) {
			const { headObject } = await r2();
			return Boolean(await headObject(sealedKey(key, env)));
		},
		async remove(key) {
			const { deleteObject } = await r2();
			await deleteObject(sealedKey(key, env));
		},
	};
}

// The same store on Google Cloud Storage, for when Cloudflare R2 is not
// available. Selected by X_CONTENT_BUNDLE_BUCKET; the Cloud Run service account
// and the partner job authenticate with their own identity, so no key is stored.
const GCS_API = 'https://storage.googleapis.com';

export function gcsStorage(env = process.env) {
	const bucket = String(env.X_CONTENT_BUNDLE_BUCKET || '').trim();
	if (!bucket) throw new OverlayError('unconfigured', 'X_CONTENT_BUNDLE_BUCKET is not set');
	const call = async (method, url, { body, contentType } = {}) => {
		const { getGcpAccessToken } = await import('../gcp-auth.js');
		const headers = { authorization: `Bearer ${await getGcpAccessToken()}` };
		if (contentType) headers['content-type'] = contentType;
		return fetch(url, { method, headers, body, signal: AbortSignal.timeout(60_000) });
	};
	const mediaUrl = (key) => `${GCS_API}/storage/v1/b/${bucket}/o/${encodeURIComponent(sealedKey(key, env))}`;
	const failed = async (res, what) => new Error(`${what}: Google Cloud Storage answered ${res.status} ${(await res.text()).slice(0, 200)}`);
	return {
		label: 'Google Cloud Storage',
		async put(key, buffer, contentType) {
			const url = `${GCS_API}/upload/storage/v1/b/${bucket}/o?uploadType=media&name=${encodeURIComponent(sealedKey(key, env))}`;
			const res = await call('POST', url, { body: buffer, contentType: contentType || 'application/octet-stream' });
			if (!res.ok) throw await failed(res, `put ${key}`);
		},
		async get(key) {
			const res = await call('GET', `${mediaUrl(key)}?alt=media`);
			if (res.status === 404) return null;
			if (!res.ok) throw await failed(res, `get ${key}`);
			return Buffer.from(await res.arrayBuffer());
		},
		async has(key) {
			const res = await call('GET', `${mediaUrl(key)}?fields=name`);
			if (res.status === 404) return false;
			if (!res.ok) throw await failed(res, `has ${key}`);
			return true;
		},
		async remove(key) {
			const res = await call('DELETE', mediaUrl(key));
			if (!res.ok && res.status !== 404) throw await failed(res, `remove ${key}`);
		},
	};
}

// The store the overlay really uses: GCS when a bucket is named, R2 otherwise.
export function bundleStorage(env = process.env) {
	return String(env.X_CONTENT_BUNDLE_BUCKET || '').trim() ? gcsStorage(env) : r2Storage(env);
}

// `has` is optional on a store: one that only has put, get, and remove answers
// by reading the object.
const stored = async (storage, key) => (storage.has ? storage.has(key) : (await storage.get(key)) !== null);

const contentTypeOf = (path) => mediaType(path)?.mime || (path.endsWith('.md') ? 'text/markdown; charset=utf-8' : path.endsWith('.json') ? 'application/json' : 'application/octet-stream');

// ── Building and publishing ─────────────────────────────────────────────────
// Every file the item needs at publish time: each post's media, and for an
// Article its body, cover, and inline images. An item with a scenario also
// carries its proof record.
function itemPaths(item, root) {
	const paths = [];
	for (const post of item.posts || []) for (const media of post.media || []) paths.push(media.path);
	if (item.kind === 'article') {
		paths.push(item.article.body, item.article.cover.path);
		for (const image of loadArticle(root, item.article).images) paths.push(image.path);
	}
	if (existsSync(resolve(root, proofPath(item.id)))) paths.push(proofPath(item.id));
	return [...new Set(paths)];
}

export function buildBundle(root, id, { now = Date.now() } = {}) {
	const item = (loadQueue(root).items || []).find((row) => row.id === id);
	if (!item) throw new Error(`${id} cannot be bundled: no queue item has that id`);
	const reasons = [];
	if (item.status !== 'approved') reasons.push(`status is ${item.status}; only an approved item is bundled`);
	reasons.push(...validateItem(item, root));
	if (!reasons.length) {
		for (const path of itemPaths(item, root)) {
			const problem = bundlePathProblem(path);
			if (problem) reasons.push(`file path ${path} ${problem}`);
		}
	}
	if (reasons.length) throw new Error(`${id} cannot be bundled: ${reasons.join('; ')}`);

	const review = loadReview(root, id);
	const files = itemPaths(item, root).map((path) => {
		const bytes = readFileSync(resolve(root, path));
		return { path, sha256: sha256(bytes), bytes: bytes.length };
	});
	return { id, item, review, files, bundledAt: new Date(now).toISOString(), hash: bundleHash({ item, review, files }) };
}

// Two bundles may share a file (one hero image on two posts), but never
// disagree about its bytes: each review record is bound to one exact file.
function fileConflicts(bundles) {
	const seen = new Map();
	const conflicts = [];
	for (const bundle of bundles) {
		for (const file of bundle.files) {
			const prior = seen.get(file.path);
			if (prior && prior.sha256 !== file.sha256) conflicts.push(`${file.path} differs between ${prior.id} and ${bundle.id}`);
			else seen.set(file.path, { id: bundle.id, sha256: file.sha256 });
		}
	}
	return conflicts;
}

async function writeIndex({ bundles, storage, env, now }) {
	const index = { version: INDEX_VERSION, updatedAt: new Date(now).toISOString(), bundles };
	index.signature = signIndex(index, env);
	await storage.put(INDEX_KEY, Buffer.from(`${JSON.stringify(index, null, '\t')}\n`), 'application/json');
	return index;
}

async function removeFiles(storage, id, files, keep = new Set()) {
	for (const file of files) if (!keep.has(file.sha256)) await storage.remove(fileKey(id, file.sha256));
}

// `replaceIndex` starts a new index when the stored one cannot be verified,
// which is what an operator needs after rotating the secret.
export async function publishBundles({ root, ids, storage = null, env = process.env, now = Date.now(), replaceIndex = false }) {
	storage ||= bundleStorage(env);
	secretFrom(env);
	const built = [];
	const failures = [];
	for (const id of [...new Set(ids)]) {
		try {
			built.push(buildBundle(root, id, { now }));
		} catch (err) {
			failures.push(err.message);
		}
	}
	if (failures.length) throw new Error(failures.join('\n'));

	let existing = null;
	try {
		existing = await readIndex({ storage, env });
	} catch (err) {
		if (!(replaceIndex && err instanceof OverlayError && err.code !== 'unconfigured')) throw err;
	}
	const replaced = (existing?.bundles || []).filter((bundle) => built.some((row) => row.id === bundle.id));
	const bundles = [...(existing?.bundles || []).filter((bundle) => !replaced.includes(bundle)), ...built];
	const conflicts = fileConflicts(bundles);
	if (conflicts.length) throw new Error(`bundles disagree about a file, so one of them would fail its review: ${conflicts.join('; ')}`);

	// Files first, then the index, so the index never names a file that is not
	// there yet.
	let uploaded = 0;
	let skipped = 0;
	for (const bundle of built) {
		for (const file of bundle.files) {
			const key = fileKey(bundle.id, file.sha256);
			if (await stored(storage, key)) {
				skipped++;
				continue;
			}
			await storage.put(key, readFileSync(resolve(root, file.path)), contentTypeOf(file.path));
			uploaded++;
		}
	}
	await writeIndex({ bundles, storage, env, now });
	for (const old of replaced) {
		const current = built.find((row) => row.id === old.id);
		await removeFiles(storage, old.id, old.files, new Set(current.files.map((file) => file.sha256)));
	}
	return { published: built.map((bundle) => bundle.id), uploaded, skipped };
}

// Drops a bundle and its files. The last bundle takes the index with it, so an
// empty bucket reads as "no index" rather than as an index of nothing.
export async function removeBundle({ id, storage = null, env = process.env, now = Date.now() }) {
	storage ||= bundleStorage(env);
	const index = await readIndex({ storage, env });
	const bundle = index?.bundles.find((row) => row.id === id);
	if (!bundle) return { removed: false, remaining: index?.bundles.length || 0 };
	const bundles = index.bundles.filter((row) => row !== bundle);
	if (bundles.length) await writeIndex({ bundles, storage, env, now });
	else await storage.remove(INDEX_KEY);
	await removeFiles(storage, id, bundle.files);
	return { removed: true, remaining: bundles.length };
}

export async function readIndex({ storage = null, env = process.env }) {
	storage ||= bundleStorage(env);
	secretFrom(env);
	const bytes = await storage.get(INDEX_KEY);
	if (!bytes) return null;
	let index;
	try {
		index = JSON.parse(bytes.toString('utf8'));
	} catch {
		throw new OverlayError('bad_signature', 'the bundle index is not JSON, so there is nothing to verify');
	}
	verifyIndex(index, env);
	if (index.version !== INDEX_VERSION) throw new OverlayError('bad_bundle', `bundle index version ${index.version} is not ${INDEX_VERSION}`);
	if (!Array.isArray(index.bundles)) throw new OverlayError('bad_bundle', 'the bundle index has no bundle list');
	index.bundles.forEach(checkBundle);
	return index;
}

// Downloads every file the index names and checks it against its recorded hash.
export async function verifyBundles({ storage = null, env = process.env }) {
	storage ||= bundleStorage(env);
	const index = await readIndex({ storage, env });
	if (!index) return { index: null, bundles: 0, files: 0, problems: [] };
	const problems = fileConflicts(index.bundles);
	let files = 0;
	for (const bundle of index.bundles) {
		for (const file of bundle.files) {
			files++;
			const bytes = await storage.get(fileKey(bundle.id, file.sha256));
			if (!bytes) problems.push(`${bundle.id}: ${file.path} is missing from storage`);
			else if (sha256(bytes) !== file.sha256) problems.push(`${bundle.id}: ${file.path} does not hash to ${file.sha256}`);
		}
	}
	return { index, bundles: index.bundles.length, files, problems };
}

// ── The overlay directory ───────────────────────────────────────────────────
function kindOf(path) {
	try {
		const stat = lstatSync(path);
		return stat.isSymbolicLink() ? 'link' : stat.isDirectory() ? 'directory' : 'file';
	} catch (err) {
		if (err.code === 'ENOENT') return null;
		throw err;
	}
}

const isDirectory = (path) => existsSync(path) && statSync(path).isDirectory();

// Removes what is at `path` and never what a symlink there points to.
function discard(path) {
	const kind = kindOf(path);
	if (kind === 'directory') rmSync(path, { recursive: true, force: true });
	else if (kind) unlinkSync(path);
}

function link(target, path) {
	if (kindOf(path) === 'link' && readlinkSync(path) === target) return;
	discard(path);
	symlinkSync(target, path);
}

// Written beside the destination and renamed over it. A rename replaces a
// symlink instead of following it, so a write can never land in the image.
function writeAtomic(path, bytes) {
	const partial = `${path}.${process.pid}.partial`;
	discard(partial);
	writeFileSync(partial, bytes);
	if (kindOf(path) === 'directory') discard(path);
	renameSync(partial, path);
}

const parentOf = (path) => (path.includes('/') ? path.slice(0, path.lastIndexOf('/')) : '');
const nameOf = (path) => path.slice(path.lastIndexOf('/') + 1);

// Every directory on the way to each path, nearest the root included.
function directoriesOf(paths) {
	const directories = new Set();
	for (const path of paths) for (let parent = parentOf(path); parent; parent = parentOf(parent)) directories.add(parent);
	return directories;
}

// Lays `dir` out as a view of the image with room for `writes`, the relative
// paths of the files the overlay is about to write. A directory on the way to
// any of those paths becomes a real directory whose image entries are linked
// one by one; every other directory is a single link to the image's own. Works
// for a write at any depth, and leaves nothing behind from an earlier tick
// that this one does not want.
function layout({ imageRoot, dir, writes }) {
	const owned = new Set(writes);
	const parents = directoriesOf(writes);

	const visit = (relative) => {
		const here = join(dir, relative);
		if (kindOf(here) !== 'directory') {
			discard(here);
			mkdirSync(here, { recursive: true });
		}
		const wanted = new Set(relative ? [] : [MARKER]);
		const source = join(imageRoot, relative);
		const names = isDirectory(source) ? readdirSync(source) : [];
		for (const name of relative ? names : names.filter((entry) => EXPOSED.includes(entry))) {
			const child = relative ? `${relative}/${name}` : name;
			wanted.add(name);
			if (!owned.has(child) && !parents.has(child)) link(join(source, name), join(here, name));
		}
		for (const path of [...owned, ...parents]) if (parentOf(path) === relative) wanted.add(nameOf(path));
		for (const path of parents) if (parentOf(path) === relative) visit(path);
		for (const name of readdirSync(here)) if (!wanted.has(name)) discard(join(here, name));
	};
	visit('');
}

const inside = (child, parent) => child === parent || child.startsWith(`${parent}${sep}`);

// The overlay prunes what it does not recognize, so it only ever takes a
// directory that is new, empty, or already its own.
function claimDirectory(dir, imageRoot) {
	if (inside(imageRoot, dir)) throw new OverlayError('bad_dir', `${dir} contains the image root`);
	if (EXPOSED.some((name) => inside(dir, join(imageRoot, name)))) throw new OverlayError('bad_dir', `${dir} is inside a directory the overlay mirrors`);
	const kind = kindOf(dir);
	if (kind && kind !== 'directory') throw new OverlayError('bad_dir', `${dir} is not a directory`);
	if (kind && readdirSync(dir).length && !existsSync(join(dir, MARKER))) throw new OverlayError('bad_dir', `${dir} holds files that are not an overlay; pick an empty directory`);
	mkdirSync(dir, { recursive: true, mode: 0o700 });
}

const hasBytes = (path, hash) => kindOf(path) === 'file' && sha256(readFileSync(path)) === hash;

// The image queue with the bundled items laid over it. A post the image records
// as posted is history and is never replaced; cadence and quality settings are
// always the image's.
export function mergeQueue(imageQueue, bundles) {
	const items = [...(imageQueue.items || [])];
	const applied = [];
	const superseded = [];
	for (const bundle of bundles) {
		const at = items.findIndex((item) => item.id === bundle.id);
		if (at >= 0 && items[at].status === 'posted') {
			superseded.push(bundle.id);
			continue;
		}
		if (at >= 0) items[at] = bundle.item;
		else items.push(bundle.item);
		applied.push(bundle);
	}
	return { queue: { ...imageQueue, items }, applied, superseded };
}

// Builds the overlay directory and returns its root. `files` counts the bundle
// files in the overlay, `reused` how many of them an earlier tick had already
// downloaded.
export async function materialize({ imageRoot, storage = null, env = process.env, dir = DEFAULT_OVERLAY_DIR, now = Date.now(), index = null }) {
	storage ||= bundleStorage(env);
	const image = resolve(imageRoot);
	const root = resolve(dir);
	const verified = index ? verifyIndex(index, env) : await readIndex({ storage, env });
	if (!verified) throw new OverlayError('no_index', 'there is no bundle index in storage');
	verified.bundles.forEach(checkBundle);

	const { queue, applied, superseded } = mergeQueue(loadQueue(image), verified.bundles);
	const conflicts = fileConflicts(applied);
	if (conflicts.length) throw new OverlayError('bad_bundle', `bundles disagree about a file: ${conflicts.join('; ')}`);
	const files = new Map();
	for (const bundle of applied) for (const file of bundle.files) files.set(file.path, { ...file, id: bundle.id });

	const writes = [QUEUE_PATH, ...applied.map((bundle) => reviewPath(bundle.id)), ...files.keys()];
	const directories = directoriesOf(writes);
	for (const path of files.keys()) if (directories.has(path)) throw new OverlayError('bad_path', `${path} is both a file and a directory on the way to another file`);

	claimDirectory(root, image);
	writeAtomic(join(root, MARKER), `${JSON.stringify({ imageRoot: image, materializedAt: new Date(now).toISOString() })}\n`);
	layout({ imageRoot: image, dir: root, writes });

	let reused = 0;
	for (const file of files.values()) {
		const path = join(root, file.path);
		if (hasBytes(path, file.sha256)) {
			reused++;
			continue;
		}
		const bytes = await storage.get(fileKey(file.id, file.sha256));
		if (!bytes) throw new OverlayError('bad_file', `${file.id}: ${file.path} is missing from storage`);
		if (sha256(bytes) !== file.sha256) throw new OverlayError('bad_file', `${file.id}: ${file.path} does not hash to the ${file.sha256.slice(0, 12)} the index recorded`);
		writeAtomic(path, bytes);
	}
	for (const bundle of applied) writeAtomic(join(root, reviewPath(bundle.id)), `${JSON.stringify(bundle.review, null, '\t')}\n`);
	writeAtomic(join(root, QUEUE_PATH), `${JSON.stringify(queue, null, '\t')}\n`);

	return { root, bundles: applied.map((bundle) => bundle.id), files: files.size, reused, superseded };
}

// The one call the cron makes: the root this tick should run against, and why.
// It answers with the image root whenever the overlay is switched off or cannot
// be trusted, and it never throws.
export async function resolveRoot({ imageRoot, env = process.env, storage = null, dir = DEFAULT_OVERLAY_DIR, now = Date.now() }) {
	const image = (reason) => ({ root: imageRoot, overlay: null, reason });
	const unavailable = (reason) => {
		console.warn('[x-content] overlay unavailable, using the image queue', reason);
		return image(reason);
	};
	if (env.X_CONTENT_REMOTE_QUEUE !== 'true') return image('X_CONTENT_REMOTE_QUEUE is not true');
	try {
		secretFrom(env);
		// A named bucket is Cloud Storage, which needs no R2 credentials at all.
		const gcs = Boolean(String(env.X_CONTENT_BUNDLE_BUCKET || '').trim());
		if (!storage && !gcs && !(await import('../r2.js')).objectStorageConfigured()) return unavailable('object storage is not configured');
		const store = storage || bundleStorage(env);
		const index = await readIndex({ storage: store, env });
		if (!index) return image('there is no bundle index in storage');
		const { root, ...overlay } = await materialize({ imageRoot, storage: store, env, dir, now, index });
		if (!overlay.bundles.length) return image('every bundle in the index is already posted in the image queue');
		return { root, overlay, reason: `${overlay.bundles.length} bundle(s) laid over the image queue` };
	} catch (err) {
		return unavailable(String(err?.message || err));
	}
}
