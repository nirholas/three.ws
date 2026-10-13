import { afterEach, describe, it, expect, vi } from 'vitest';
import { existsSync, lstatSync, mkdtempSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

import {
	INDEX_KEY, OverlayError, buildBundle, bundleHash, bundlePathProblem, canonical, fileKey, materialize, mergeQueue, proofPath, publishBundles,
	readIndex, removeBundle, resolveRoot, signIndex, verifyBundles, verifyIndex,
} from '../api/_lib/x-content/overlay.js';
import { loadQueue, validateQueue } from '../api/_lib/x-content/queue.js';
import { contentHash, loadReview, reviewPath } from '../api/_lib/x-content/review.js';
import { readMedia } from '../api/_lib/x-content/media.js';
import { runTick } from '../api/_lib/x-content/runner.js';
import { memoryStore } from '../api/_lib/x-content/state.js';

const HOUR = 3_600_000;
const SECRET = 'a'.repeat(64);
const env = { X_CONTENT_BUNDLE_SECRET: SECRET, X_CONTENT_REMOTE_QUEUE: 'true' };
const CADENCE = { windowMinutes: 45, minimumMinutesApart: 240, dailyCap: 3, slots: [{ tier: 3, at: '08:00' }, { tier: 1, at: '16:00' }, { tier: 2, at: '22:00' }] };
const QUALITY = { queueSimilarityLimit: 0.34, archiveSimilarityLimit: 0.42 };

const FRESH = 'Rig Doctor names the skeleton convention of any humanoid GLB, then lists which bones animate and which stay put: three.ws/rig-doctor';
const OLDER = 'Materialize measures the true solid volume of a repaired mesh and prices a physical print from that measurement: three.ws/materialize';

function write(root, path, content) {
	mkdirSync(dirname(join(root, path)), { recursive: true });
	writeFileSync(join(root, path), content);
}

function writeQueue(root, items, over = {}) {
	write(root, 'data/x-content/queue.json', JSON.stringify({ account: 'trythreews', cadence: CADENCE, quality: QUALITY, items, ...over }));
}

function writeReview(root, item, over = {}) {
	const record = { id: item.id, contentHash: contentHash(item, root), reviewedAt: new Date(Date.now() - HOUR).toISOString(), passed: true, blockers: [], ...over };
	write(root, reviewPath(item.id), JSON.stringify(record));
	return record;
}

const post = (id, text, over = {}) => ({
	id, status: 'approved', kind: 'post', tier: 1, lane: id, pattern: id, notBefore: '2026-09-01T00:00:00Z',
	posts: [{ text, media: [{ path: `public/x-media/${id}/card.png`, alt: `The ${id} page` }] }],
	...over,
});

// The operator's checkout: one approved, reviewed post the image has never seen.
function checkout(over = {}) {
	const root = mkdtempSync(join(tmpdir(), 'x-overlay-checkout-'));
	const item = post('fresh', FRESH, over);
	write(root, 'public/x-media/fresh/card.png', Buffer.from('the fresh card, byte for byte'));
	writeQueue(root, [item]);
	writeReview(root, item);
	return { root, item };
}

// The production image: an older deploy with its own queue, history, and media.
function image(items = null) {
	const root = mkdtempSync(join(tmpdir(), 'x-overlay-image-'));
	const older = post('older', OLDER, { status: 'posted' });
	write(root, 'public/x-media/older/card.png', Buffer.from('the older card'));
	write(root, 'public/announce/img/hero.webp', Buffer.from('a hero that only the image has'));
	write(root, 'data/x-content/volume-model.json', JSON.stringify({ intercept: -2, baseRate: 0.1, features: [] }));
	write(root, 'data/archives/trythreews_tweets_1.json', JSON.stringify([{ text: 'An unrelated earlier post about something else entirely.' }]));
	write(root, 'scripts/probe.mjs', 'process.exit(0);\n');
	write(root, 'package.json', '{"name":"image"}\n');
	writeQueue(root, items || [older]);
	writeReview(root, older);
	return root;
}

function memoryStorage() {
	const objects = new Map();
	const puts = [];
	return {
		objects,
		puts,
		async put(key, buffer) {
			puts.push(key);
			objects.set(key, Buffer.from(buffer));
		},
		async get(key) {
			return objects.has(key) ? Buffer.from(objects.get(key)) : null;
		},
		async remove(key) {
			objects.delete(key);
		},
	};
}

const scratch = () => join(mkdtempSync(join(tmpdir(), 'x-overlay-out-')), 'overlay');

async function published(over = {}) {
	const source = checkout(over);
	const storage = memoryStorage();
	await publishBundles({ root: source.root, ids: ['fresh'], storage, env });
	return { ...source, storage };
}

// A signed index around hand-built bundles, for the shapes buildBundle refuses
// to produce.
async function forge(storage, bundles) {
	const index = { version: 1, updatedAt: new Date().toISOString(), bundles: bundles.map((bundle) => ({ ...bundle, hash: bundleHash(bundle) })) };
	index.signature = signIndex(index, env);
	await storage.put(INDEX_KEY, Buffer.from(JSON.stringify(index)));
	return index;
}

const rejection = async (promise) => {
	try {
		await promise;
	} catch (err) {
		return err;
	}
	return null;
};

afterEach(() => {
	vi.restoreAllMocks();
	vi.unstubAllEnvs();
});

describe('canonical JSON and the signature', () => {
	it('does not depend on key order at any depth', () => {
		const left = { b: 1, a: { d: [1, { z: 1, y: 2 }], c: 'x' }, gone: undefined };
		const right = { a: { c: 'x', d: [1, { y: 2, z: 1 }] }, b: 1 };
		expect(canonical(left)).toBe(canonical(right));
		expect(canonical(left)).toBe('{"a":{"c":"x","d":[1,{"y":2,"z":1}]},"b":1}');
		expect(canonical([1, 2])).not.toBe(canonical([2, 1]));
		expect(canonical(JSON.parse(JSON.stringify(left)))).toBe(canonical(left));
	});

	it('signs an index and verifies it again', () => {
		const index = { version: 1, updatedAt: '2026-09-29T00:00:00.000Z', bundles: [{ id: 'fresh', item: { id: 'fresh', tier: 1 } }] };
		index.signature = signIndex(index, env);
		expect(index.signature).toMatch(/^[0-9a-f]{64}$/);
		expect(verifyIndex(index, env)).toBe(index);
		expect(verifyIndex({ signature: index.signature, bundles: [{ item: { tier: 1, id: 'fresh' }, id: 'fresh' }], updatedAt: index.updatedAt, version: 1 }, env)).toBeTruthy();
	});

	it('rejects a tampered index, a tampered item, and the wrong secret', async () => {
		const { storage } = await published();
		const stored = JSON.parse(storage.objects.get(INDEX_KEY).toString('utf8'));
		expect((await readIndex({ storage, env })).bundles.map((bundle) => bundle.id)).toEqual(['fresh']);

		const tampered = [
			{ ...stored, updatedAt: '2030-01-01T00:00:00.000Z' },
			{ ...stored, bundles: [{ ...stored.bundles[0], item: { ...stored.bundles[0].item, posts: [{ text: 'Buy this other coin now' }] } }] },
			{ ...stored, bundles: [] },
			{ ...stored, signature: 'not a signature' },
			{ ...stored, signature: undefined },
		];
		for (const index of tampered) {
			storage.objects.set(INDEX_KEY, Buffer.from(JSON.stringify(index)));
			const err = await rejection(readIndex({ storage, env }));
			expect(err).toBeInstanceOf(OverlayError);
			expect(err.code).toBe('bad_signature');
		}

		storage.objects.set(INDEX_KEY, Buffer.from(JSON.stringify(stored)));
		expect((await rejection(readIndex({ storage, env: { X_CONTENT_BUNDLE_SECRET: 'b'.repeat(64) } }))).code).toBe('bad_signature');
		expect((await rejection(readIndex({ storage, env: {} }))).code).toBe('unconfigured');
		expect((await rejection(readIndex({ storage, env: { X_CONTENT_BUNDLE_SECRET: 'short' } }))).code).toBe('unconfigured');
		expect(await readIndex({ storage: memoryStorage(), env })).toBeNull();
	});
});

describe('buildBundle', () => {
	it('packs the item, its review record, and the hash of every file', () => {
		const { root, item } = checkout();
		const bundle = buildBundle(root, 'fresh', { now: Date.parse('2026-09-29T12:00:00Z') });
		expect(bundle.item).toEqual(item);
		expect(bundle.review).toEqual(loadReview(root, 'fresh'));
		expect(bundle.files).toEqual([{ path: 'public/x-media/fresh/card.png', sha256: expect.stringMatching(/^[0-9a-f]{64}$/), bytes: 29 }]);
		expect(bundle.bundledAt).toBe('2026-09-29T12:00:00.000Z');
		expect(bundle.hash).toBe(bundleHash(bundle));
	});

	it('refuses an item that is not approved', () => {
		const { root } = checkout({ status: 'review' });
		expect(() => buildBundle(root, 'fresh')).toThrow(/fresh cannot be bundled: status is review/);
		expect(() => buildBundle(root, 'absent')).toThrow(/no queue item/);
	});

	it('refuses an item whose review record does not match its content', () => {
		const { root, item } = checkout();
		writeQueue(root, [{ ...item, posts: [{ ...item.posts[0], text: FRESH.replace('Rig Doctor', 'The Rig Doctor') }] }]);
		expect(() => buildBundle(root, 'fresh')).toThrow(/changed after the last review/);

		writeQueue(root, [item]);
		writeFileSync(join(root, 'public/x-media/fresh/card.png'), Buffer.from('a different card'));
		expect(() => buildBundle(root, 'fresh')).toThrow(/changed after the last review/);
	});

	it('refuses a review that is too old or did not pass', () => {
		const { root, item } = checkout();
		writeReview(root, item, { reviewedAt: new Date(Date.now() - 20 * 24 * HOUR).toISOString() });
		expect(() => buildBundle(root, 'fresh')).toThrow(/days old/);
		writeReview(root, item, { passed: false, blockers: ['link three.ws/rig-doctor: HTTP 404'] });
		expect(() => buildBundle(root, 'fresh')).toThrow(/did not pass/);
	});

	it('bundles the body, cover, and inline images of an Article', () => {
		const root = mkdtempSync(join(tmpdir(), 'x-overlay-checkout-'));
		write(root, 'public/x-media/long/cover.png', Buffer.from('cover'));
		const shots = [1, 2, 3, 4].map((n) => `public/x-media/long/inline-${n}.png`);
		for (const shot of shots) write(root, shot, Buffer.from(shot));
		// An Article deep enough for the queue's depth gate: eight sections of
		// prose, real tables and code, four captures, the partners and Try it.
		const prose = Array.from({ length: 320 }, (_, index) => `word${index % 40}`).join(' ');
		const table = ['| Bone | Canonical |', '|---|---|', ...Array.from({ length: 60 }, (_, index) => `| mixamorig:Spine${index} | spine${index} |`)].join('\n');
		const code = ['```js', ...Array.from({ length: 30 }, (_, index) => `const bone${index} = canonicalize('mixamorig:Spine${index}');`), '```'].join('\n');
		const sections = ['How a skeleton is read', 'Where names come from', 'The canonical set', 'Retargeting the clips', 'What the doctor reports', 'How it was checked', 'The partners behind the rig library', 'Try it'];
		const body = sections.map((heading, index) => `## ${heading}\n\n${prose}\n\n${index === 2 ? `${table}\n\n` : ''}${index === 3 ? `${code}\n\n` : ''}${index < 4 ? `![Capture ${index + 1}](../../../${shots[index]})\n\n` : ''}${heading === 'Try it' ? '[Rig Doctor](https://three.ws/rig-doctor)' : ''}`).join('\n\n');
		write(root, 'data/x-content/articles/long.md', body);
		const item = {
			id: 'long', status: 'approved', kind: 'article', tier: 1, lane: 'article', pattern: 'longform', notBefore: '2026-09-01T00:00:00Z',
			article: { title: 'How Rig Doctor reads a skeleton from any exporter and maps its bones onto one canonical set', body: 'data/x-content/articles/long.md', cover: { path: 'public/x-media/long/cover.png' } },
			posts: [{ text: 'The long version of how Rig Doctor reads a skeleton.' }],
		};
		writeQueue(root, [item]);
		writeReview(root, item);
		expect(buildBundle(root, 'long').files.map((file) => file.path)).toEqual(['data/x-content/articles/long.md', 'public/x-media/long/cover.png', ...shots]);
	});
});

describe('publishBundles', () => {
	it('uploads each file once and is idempotent', async () => {
		const { root } = checkout();
		const storage = memoryStorage();
		const first = await publishBundles({ root, ids: ['fresh', 'fresh'], storage, env });
		expect(first).toEqual({ published: ['fresh'], uploaded: 1, skipped: 0 });
		const [file] = buildBundle(root, 'fresh').files;
		expect(storage.puts).toEqual([fileKey('fresh', file.sha256), INDEX_KEY]);
		expect(storage.objects.get(fileKey('fresh', file.sha256)).equals(readFileSync(join(root, file.path)))).toBe(true);

		const second = await publishBundles({ root, ids: ['fresh'], storage, env });
		expect(second).toEqual({ published: ['fresh'], uploaded: 0, skipped: 1 });
		expect(storage.puts.filter((key) => key !== INDEX_KEY)).toHaveLength(1);
		const index = await readIndex({ storage, env });
		expect(index.bundles.map((bundle) => bundle.id)).toEqual(['fresh']);
		expect([...storage.objects.keys()].sort()).toEqual([fileKey('fresh', file.sha256), INDEX_KEY].sort());
	});

	it('uploads nothing when any named item cannot be bundled', async () => {
		const { root, item } = checkout();
		writeQueue(root, [item, post('draft', OLDER, { status: 'draft' })]);
		const storage = memoryStorage();
		await expect(publishBundles({ root, ids: ['fresh', 'draft'], storage, env })).rejects.toThrow(/draft cannot be bundled/);
		expect(storage.objects.size).toBe(0);
		await expect(publishBundles({ root, ids: ['fresh'], storage, env: {} })).rejects.toThrow(/X_CONTENT_BUNDLE_SECRET/);
	});

	it('replaces a bundle with the same id and drops the file it no longer uses', async () => {
		const { root, item, storage } = await published();
		const before = buildBundle(root, 'fresh').files[0];
		writeFileSync(join(root, 'public/x-media/fresh/card.png'), Buffer.from('a reshot card'));
		writeReview(root, item);
		await publishBundles({ root, ids: ['fresh'], storage, env });
		const after = buildBundle(root, 'fresh').files[0];
		expect(after.sha256).not.toBe(before.sha256);
		expect((await readIndex({ storage, env })).bundles).toHaveLength(1);
		expect(storage.objects.has(fileKey('fresh', before.sha256))).toBe(false);
		expect(storage.objects.has(fileKey('fresh', after.sha256))).toBe(true);
	});

	it('refuses to build on an index it cannot verify unless told to replace it', async () => {
		const { root, storage } = await published();
		const rotated = { X_CONTENT_BUNDLE_SECRET: 'c'.repeat(64) };
		expect((await rejection(publishBundles({ root, ids: ['fresh'], storage, env: rotated }))).code).toBe('bad_signature');
		await publishBundles({ root, ids: ['fresh'], storage, env: rotated, replaceIndex: true });
		expect((await readIndex({ storage, env: rotated })).bundles.map((bundle) => bundle.id)).toEqual(['fresh']);
	});

	it('removes a bundle, its files, and the index once it is empty', async () => {
		const { storage } = await published();
		expect(await removeBundle({ id: 'absent', storage, env })).toEqual({ removed: false, remaining: 1 });
		expect(await removeBundle({ id: 'fresh', storage, env })).toEqual({ removed: true, remaining: 0 });
		expect(storage.objects.size).toBe(0);
		expect(await readIndex({ storage, env })).toBeNull();
	});

	it('verifies every stored file against the index', async () => {
		const { root, storage } = await published();
		expect(await verifyBundles({ storage, env })).toMatchObject({ bundles: 1, files: 1, problems: [] });
		const [file] = buildBundle(root, 'fresh').files;
		storage.objects.set(fileKey('fresh', file.sha256), Buffer.from('swapped'));
		expect((await verifyBundles({ storage, env })).problems.join('\n')).toMatch(/does not hash/);
		storage.objects.delete(fileKey('fresh', file.sha256));
		expect((await verifyBundles({ storage, env })).problems.join('\n')).toMatch(/missing from storage/);
	});
});

describe('materialize', () => {
	it('builds a root the unchanged engine reads as an approved, reviewed item', async () => {
		const { root: source, item, storage } = await published();
		const imageRoot = image();
		const result = await materialize({ imageRoot, storage, env, dir: scratch() });
		expect(result).toMatchObject({ bundles: ['fresh'], files: 1, reused: 0, superseded: [] });

		const queue = loadQueue(result.root);
		expect(queue.items.map((row) => `${row.id}:${row.status}`)).toEqual(['older:posted', 'fresh:approved']);
		expect(queue.items[1]).toEqual(item);
		expect(queue.cadence).toEqual(CADENCE);
		expect(queue.quality).toEqual(QUALITY);

		const { problems } = validateQueue(queue, result.root);
		expect(problems.fresh).toEqual([]);
		expect(problems.older).toEqual([]);
		expect(loadReview(result.root, 'fresh')).toEqual(loadReview(source, 'fresh'));
		expect(loadReview(result.root, 'fresh').contentHash).toBe(contentHash(item, result.root));

		const media = readMedia(item.posts[0].media[0], result.root);
		expect(media.buffer.equals(readFileSync(join(source, 'public/x-media/fresh/card.png')))).toBe(true);
		expect(media).toMatchObject({ mime: 'image/png', kind: 'image', category: 'tweet_image' });
		expect(lstatSync(join(result.root, 'public/x-media/fresh/card.png')).isFile()).toBe(true);
	});

	it('reaches everything the image holds through the overlay', async () => {
		const { storage } = await published();
		const imageRoot = image();
		const { root } = await materialize({ imageRoot, storage, env, dir: scratch() });

		expect(JSON.parse(readFileSync(join(root, 'data/x-content/volume-model.json'), 'utf8')).baseRate).toBe(0.1);
		expect(readFileSync(join(root, 'public/announce/img/hero.webp'), 'utf8')).toBe('a hero that only the image has');
		expect(readFileSync(join(root, 'public/x-media/older/card.png'), 'utf8')).toBe('the older card');
		expect(loadReview(root, 'older')).toEqual(loadReview(imageRoot, 'older'));
		expect(existsSync(join(root, 'scripts/probe.mjs'))).toBe(true);
		expect(existsSync(join(root, 'package.json'))).toBe(true);

		// A directory the overlay never writes into is one link; a directory on the
		// way to a bundle file is real, with the image's entries linked inside it.
		expect(lstatSync(join(root, 'data/archives')).isSymbolicLink()).toBe(true);
		expect(lstatSync(join(root, 'public/announce')).isSymbolicLink()).toBe(true);
		expect(lstatSync(join(root, 'public/x-media/older')).isSymbolicLink()).toBe(true);
		for (const path of ['data', 'data/x-content', 'data/x-content/reviews', 'public', 'public/x-media', 'public/x-media/fresh']) {
			expect(lstatSync(join(root, path)).isDirectory()).toBe(true);
		}
		expect(lstatSync(join(root, 'data/x-content/reviews/older.json')).isSymbolicLink()).toBe(true);
	});

	it('writes a bundle file at any depth, and never into the image', async () => {
		const source = checkout();
		const deep = 'public/announce/img/launch/2026/card.png';
		const item = post('fresh', FRESH, { posts: [{ text: FRESH, media: [{ path: deep, alt: 'The launch card' }] }] });
		write(source.root, deep, Buffer.from('the reviewed card'));
		writeQueue(source.root, [item]);
		writeReview(source.root, item);
		const storage = memoryStorage();
		await publishBundles({ root: source.root, ids: ['fresh'], storage, env });

		const imageRoot = image([post('fresh', OLDER), post('older', OLDER, { status: 'posted' })]);
		write(imageRoot, deep, Buffer.from('the card the last deploy shipped'));
		writeFileSync(join(imageRoot, reviewPath('fresh')), '{"id":"fresh","stale":true}');
		const before = readFileSync(join(imageRoot, 'data/x-content/queue.json'), 'utf8');

		const { root } = await materialize({ imageRoot, storage, env, dir: scratch() });
		expect(readFileSync(join(root, deep), 'utf8')).toBe('the reviewed card');
		expect(readFileSync(join(root, 'public/announce/img/hero.webp'), 'utf8')).toBe('a hero that only the image has');
		expect(loadQueue(root).items.map((row) => row.id)).toEqual(['fresh', 'older']);
		expect(loadQueue(root).items[0]).toEqual(item);
		expect(validateQueue(loadQueue(root), root).problems.fresh).toEqual([]);

		expect(readFileSync(join(imageRoot, deep), 'utf8')).toBe('the card the last deploy shipped');
		expect(readFileSync(join(imageRoot, reviewPath('fresh')), 'utf8')).toBe('{"id":"fresh","stale":true}');
		expect(readFileSync(join(imageRoot, 'data/x-content/queue.json'), 'utf8')).toBe(before);
	});

	it('never replaces an item the image records as posted', async () => {
		const { storage } = await published();
		const posted = post('fresh', OLDER, { status: 'posted' });
		const imageRoot = image([posted]);
		write(imageRoot, 'public/x-media/fresh/card.png', Buffer.from('what actually went out'));
		const result = await materialize({ imageRoot, storage, env, dir: scratch() });

		expect(result).toMatchObject({ bundles: [], files: 0, superseded: ['fresh'] });
		expect(loadQueue(result.root).items).toEqual([posted]);
		expect(readFileSync(join(result.root, 'public/x-media/fresh/card.png'), 'utf8')).toBe('what actually went out');
		expect(mergeQueue({ cadence: CADENCE, items: [posted] }, [{ id: 'fresh', item: post('fresh', FRESH) }]).queue).toEqual({ cadence: CADENCE, items: [posted] });
	});

	it('reuses what an earlier tick downloaded and drops what is no longer bundled', async () => {
		const { storage } = await published();
		const imageRoot = image();
		const dir = scratch();
		await materialize({ imageRoot, storage, env, dir });
		const gets = [];
		const get = storage.get;
		storage.get = async (key) => {
			gets.push(key);
			return get(key);
		};
		expect(await materialize({ imageRoot, storage, env, dir })).toMatchObject({ bundles: ['fresh'], files: 1, reused: 1 });
		expect(gets).toEqual([INDEX_KEY]);

		// A file that rotted on disk is fetched again instead of trusted.
		writeFileSync(join(dir, 'public/x-media/fresh/card.png'), 'rot');
		expect(await materialize({ imageRoot, storage, env, dir })).toMatchObject({ files: 1, reused: 0 });
		expect(readFileSync(join(dir, 'public/x-media/fresh/card.png'), 'utf8')).toBe('the fresh card, byte for byte');

		const other = checkout();
		const next = post('next', OLDER.replace('Materialize', 'The volume tool'));
		write(other.root, 'public/x-media/next/card.png', Buffer.from('the next card'));
		writeQueue(other.root, [next]);
		writeReview(other.root, next);
		await publishBundles({ root: other.root, ids: ['next'], storage, env });
		await removeBundle({ id: 'fresh', storage, env });

		const result = await materialize({ imageRoot, storage, env, dir });
		expect(result.bundles).toEqual(['next']);
		expect(existsSync(join(dir, 'public/x-media/fresh'))).toBe(false);
		expect(existsSync(join(dir, reviewPath('fresh')))).toBe(false);
		expect(loadQueue(dir).items.map((row) => row.id)).toEqual(['older', 'next']);
		expect(readFileSync(join(imageRoot, 'public/x-media/older/card.png'), 'utf8')).toBe('the older card');
		expect(readFileSync(join(imageRoot, 'data/archives/trythreews_tweets_1.json'), 'utf8')).toMatch(/unrelated earlier post/);
	});

	it('throws bad_file when the stored bytes do not match the recorded hash', async () => {
		const { root, storage } = await published();
		const [file] = buildBundle(root, 'fresh').files;
		storage.objects.set(fileKey('fresh', file.sha256), Buffer.from('swapped in the bucket'));
		const dir = scratch();
		const err = await rejection(materialize({ imageRoot: image(), storage, env, dir }));
		expect(err).toBeInstanceOf(OverlayError);
		expect(err.code).toBe('bad_file');
		expect(existsSync(join(dir, 'public/x-media/fresh/card.png'))).toBe(false);

		storage.objects.delete(fileKey('fresh', file.sha256));
		expect((await rejection(materialize({ imageRoot: image(), storage, env, dir: scratch() }))).code).toBe('bad_file');
	});

	it('rejects path traversal and every path outside the media roots', async () => {
		expect(bundlePathProblem('public/x-media/fresh/card.png')).toBeNull();
		expect(bundlePathProblem('data/x-content/articles/fresh.md')).toBeNull();
		expect(bundlePathProblem(proofPath('fresh'))).toBeNull();

		const { item, root } = checkout();
		const review = loadReview(root, 'fresh');
		const bytes = Buffer.from('payload');
		const sha256 = buildBundle(root, 'fresh').files[0].sha256;
		const paths = [
			'../outside.png', 'public/../../outside.png', 'public/x-media/..', '/etc/passwd', 'C:/windows/card.png', 'scripts/x-content.mjs', 'api/cron/x-content.js',
			'public\\x-media\\card.png', 'public//card.png', 'public/./card.png', 'data/x-content/queue.json', 'data/x-content/reviews/fresh.json', '',
		];
		for (const path of paths) {
			expect(bundlePathProblem(path)).toBeTruthy();
			const storage = memoryStorage();
			await storage.put(fileKey('fresh', sha256), bytes);
			await forge(storage, [{ id: 'fresh', item, review, files: [{ path, sha256, bytes: bytes.length }], bundledAt: new Date().toISOString() }]);
			const imageRoot = image();
			const dir = scratch();
			const err = await rejection(materialize({ imageRoot, storage, env, dir }));
			expect(err).toBeInstanceOf(OverlayError);
			expect(err.code).toBe('bad_path');
			expect(existsSync(dir)).toBe(false);
			expect(existsSync(join(dirname(dir), 'outside.png'))).toBe(false);
		}
	});

	it('rejects a bundle whose id, item, or review record do not agree', async () => {
		const { item, root } = checkout();
		const review = loadReview(root, 'fresh');
		const bundledAt = new Date().toISOString();
		for (const bundle of [
			{ id: '../fresh', item: { ...item, id: '../fresh' }, review: { ...review, id: '../fresh' }, files: [], bundledAt },
			{ id: 'fresh', item: { ...item, id: 'other' }, review, files: [], bundledAt },
			{ id: 'fresh', item, review: { ...review, id: 'other' }, files: [], bundledAt },
		]) {
			const storage = memoryStorage();
			await forge(storage, [bundle]);
			expect((await rejection(materialize({ imageRoot: image(), storage, env, dir: scratch() }))).code).toBe('bad_bundle');
		}
	});

	it('only takes a directory that is empty or already an overlay', async () => {
		const { storage } = await published();
		const imageRoot = image();
		const occupied = mkdtempSync(join(tmpdir(), 'x-overlay-occupied-'));
		writeFileSync(join(occupied, 'notes.txt'), 'someone else keeps files here');
		expect((await rejection(materialize({ imageRoot, storage, env, dir: occupied }))).code).toBe('bad_dir');
		expect(readFileSync(join(occupied, 'notes.txt'), 'utf8')).toBe('someone else keeps files here');
		expect((await rejection(materialize({ imageRoot, storage, env, dir: imageRoot }))).code).toBe('bad_dir');
		expect((await rejection(materialize({ imageRoot, storage, env, dir: dirname(imageRoot) }))).code).toBe('bad_dir');
		expect((await rejection(materialize({ imageRoot, storage, env, dir: join(imageRoot, 'public/overlay') }))).code).toBe('bad_dir');
		expect(existsSync(join(imageRoot, 'public/x-media/older/card.png'))).toBe(true);

		const empty = mkdtempSync(join(tmpdir(), 'x-overlay-empty-'));
		expect((await materialize({ imageRoot, storage, env, dir: empty })).bundles).toEqual(['fresh']);
	});

	it('carries the proof record of an item with a scenario', async () => {
		const source = checkout();
		const proof = Buffer.from(`${JSON.stringify({ id: 'fresh', scenario: 'rig-doctor', steps: [{ name: 'diagnose', ok: true }] }, null, '\t')}\n`);
		write(source.root, proofPath('fresh'), proof);
		const bundle = buildBundle(source.root, 'fresh');
		expect(bundle.files.map((file) => file.path)).toEqual(['public/x-media/fresh/card.png', 'data/x-content/proofs/fresh.json']);

		const storage = memoryStorage();
		expect(await publishBundles({ root: source.root, ids: ['fresh'], storage, env })).toMatchObject({ uploaded: 2 });
		const imageRoot = image();
		const { root, files } = await materialize({ imageRoot, storage, env, dir: scratch() });
		expect(files).toBe(2);
		expect(readFileSync(join(root, 'data/x-content/proofs/fresh.json')).equals(proof)).toBe(true);
		expect(lstatSync(join(root, 'data/x-content/proofs/fresh.json')).isFile()).toBe(true);
		expect(existsSync(join(imageRoot, 'data/x-content/proofs'))).toBe(false);
	});
});

describe('resolveRoot', () => {
	const quiet = () => vi.spyOn(console, 'warn').mockImplementation(() => {});

	it('uses the overlay when the index verifies', async () => {
		const { storage } = await published();
		const imageRoot = image();
		const dir = scratch();
		const result = await resolveRoot({ imageRoot, env, storage, dir });
		expect(result.root).toBe(dir);
		expect(result.overlay).toMatchObject({ bundles: ['fresh'], files: 1, reused: 0 });
		expect(result.overlay.root).toBeUndefined();
	});

	it('falls back to the image root for every failure and never throws', async () => {
		const warn = quiet();
		const { root, storage } = await published();
		const imageRoot = image();
		const fallback = (result) => {
			expect(result.root).toBe(imageRoot);
			expect(result.overlay).toBeNull();
			expect(result.reason).toBeTruthy();
			return result.reason;
		};

		expect(fallback(await resolveRoot({ imageRoot, env: { X_CONTENT_BUNDLE_SECRET: SECRET }, storage, dir: scratch() }))).toMatch(/X_CONTENT_REMOTE_QUEUE/);
		expect(fallback(await resolveRoot({ imageRoot, env: { ...env, X_CONTENT_REMOTE_QUEUE: 'TRUE' }, storage, dir: scratch() }))).toMatch(/X_CONTENT_REMOTE_QUEUE/);
		expect(fallback(await resolveRoot({ imageRoot, env: { ...env, X_CONTENT_REMOTE_QUEUE: '1' }, storage, dir: scratch() }))).toMatch(/X_CONTENT_REMOTE_QUEUE/);
		expect(warn).not.toHaveBeenCalled();

		expect(fallback(await resolveRoot({ imageRoot, env: { X_CONTENT_REMOTE_QUEUE: 'true' }, storage, dir: scratch() }))).toMatch(/X_CONTENT_BUNDLE_SECRET is not set/);
		expect(fallback(await resolveRoot({ imageRoot, env, storage: memoryStorage(), dir: scratch() }))).toMatch(/no bundle index/);
		expect(fallback(await resolveRoot({ imageRoot, env: { ...env, X_CONTENT_BUNDLE_SECRET: 'd'.repeat(64) }, storage, dir: scratch() }))).toMatch(/signature does not verify/);

		for (const name of ['S3_ENDPOINT', 'S3_BUCKET', 'S3_PUBLIC_DOMAIN', 'S3_ACCESS_KEY_ID', 'S3_SECRET_ACCESS_KEY']) vi.stubEnv(name, '');
		expect(fallback(await resolveRoot({ imageRoot, env, dir: scratch() }))).toMatch(/object storage is not configured/);

		const down = { ...memoryStorage(), get: async () => { throw new Error('socket hang up'); } };
		expect(fallback(await resolveRoot({ imageRoot, env, storage: down, dir: scratch() }))).toMatch(/socket hang up/);

		const posted = image([post('fresh', OLDER, { status: 'posted' })]);
		expect((await resolveRoot({ imageRoot: posted, env, storage, dir: scratch() })).root).toBe(posted);

		const [file] = buildBundle(root, 'fresh').files;
		storage.objects.set(fileKey('fresh', file.sha256), Buffer.from('swapped in the bucket'));
		expect(fallback(await resolveRoot({ imageRoot, env, storage, dir: scratch() }))).toMatch(/does not hash/);

		const missing = mkdtempSync(join(tmpdir(), 'x-overlay-image-'));
		const result = await resolveRoot({ imageRoot: missing, env, storage, dir: scratch() });
		expect(result).toMatchObject({ root: missing, overlay: null });

		expect(warn).toHaveBeenCalledWith('[x-content] overlay unavailable, using the image queue', expect.stringMatching(/does not hash/));
	});

	it('reads a named Cloud Storage bucket even when R2 is not configured', async () => {
		quiet();
		for (const name of ['S3_ENDPOINT', 'S3_BUCKET', 'S3_PUBLIC_DOMAIN', 'S3_ACCESS_KEY_ID', 'S3_SECRET_ACCESS_KEY', 'GCP_SERVICE_ACCOUNT_JSON']) vi.stubEnv(name, '');
		const asked = [];
		vi.stubGlobal('fetch', async (url) => {
			asked.push(String(url));
			if (String(url).includes('metadata.google.internal')) return new Response(JSON.stringify({ access_token: 'token', expires_in: 3600 }), { status: 200 });
			return new Response('not found', { status: 404 });
		});
		const imageRoot = image();
		const result = await resolveRoot({ imageRoot, env: { ...env, X_CONTENT_BUNDLE_BUCKET: 'bundles' }, dir: scratch() });
		vi.unstubAllGlobals();
		expect(result.reason).toMatch(/no bundle index/);
		expect(asked.some((url) => url.startsWith('https://storage.googleapis.com/storage/v1/b/bundles/'))).toBe(true);
	});
});

describe('a tick against the overlay', () => {
	it('previews the bundled post with the bytes that were reviewed', async () => {
		const { root: source, storage } = await published();
		const imageRoot = image();
		const { root, overlay } = await resolveRoot({ imageRoot, env, storage, dir: scratch() });
		expect(overlay.bundles).toEqual(['fresh']);

		// 16:50 UTC today: the 16:00 flagship slot is open whatever its jitter.
		const now = Date.parse(`${new Date().toISOString().slice(0, 10)}T16:50:00Z`);
		const result = await runTick({ root, store: memoryStore(), dryRun: true, now, env: {} });
		expect(result.blocked).toEqual([]);
		expect(result.preview.id).toBe('fresh');
		expect(result.preview.calls.map((call) => call.call)).toEqual(['media.upload', 'media.metadata', 'tweets.create']);
		expect(result.preview.calls[0]).toMatchObject({ bytes: readFileSync(join(source, 'public/x-media/fresh/card.png')).length, media_type: 'image/png', media_category: 'tweet_image' });
		expect(result.preview.calls[1].alt).toBe('The fresh page');
		expect(result.preview.calls[2].text).toBe(FRESH);

		// The same tick against the image alone has nothing to send.
		const without = await runTick({ root: imageRoot, store: memoryStore(), dryRun: true, now, env: {} });
		expect(without.preview).toBeUndefined();
	});

	it('blocks a bundled post whose review has expired, exactly as the image queue would', async () => {
		const source = checkout();
		const storage = memoryStorage();
		await publishBundles({ root: source.root, ids: ['fresh'], storage, env });
		const index = await readIndex({ storage, env });
		const aged = { ...index.bundles[0], review: { ...index.bundles[0].review, reviewedAt: new Date(Date.now() - 15 * 24 * HOUR).toISOString() } };
		await forge(storage, [aged]);

		const { root } = await materialize({ imageRoot: image(), storage, env, dir: scratch() });
		const now = Date.parse(`${new Date().toISOString().slice(0, 10)}T16:50:00Z`);
		const result = await runTick({ root, store: memoryStore(), dryRun: true, now, env: {} });
		expect(result.preview).toBeUndefined();
		expect(result.blocked.map((row) => row.id)).toEqual(['fresh']);
		expect(result.blocked[0].problems.join('\n')).toMatch(/days old/);
	});
});

describe('where bundles live in the bucket', () => {
	const env = { X_CONTENT_BUNDLE_SECRET: 'a'.repeat(64) };

	it('puts every bundle key under a folder only the secret can name', async () => {
		const { sealedKey, BUNDLE_ROOT } = await import('../api/_lib/x-content/overlay.js');
		const sealed = sealedKey(INDEX_KEY, env);
		expect(sealed).toMatch(/^x-content\/bundles\/[0-9a-f]{40}\/index\.json$/);
		expect(sealed).not.toContain(env.X_CONTENT_BUNDLE_SECRET);
		expect(sealedKey(fileKey('fresh', 'abc'), env)).toBe(sealed.replace('index.json', 'fresh/abc'));
		expect(sealedKey(INDEX_KEY, { X_CONTENT_BUNDLE_SECRET: 'b'.repeat(64) })).not.toBe(sealed);
		expect(BUNDLE_ROOT).toBe('x-content/bundles/');
	});

	it('refuses a key outside the bundles and a missing secret', async () => {
		const { sealedKey } = await import('../api/_lib/x-content/overlay.js');
		expect(() => sealedKey('avatars/someone.glb', env)).toThrow(/not a bundle key/);
		expect(() => sealedKey(INDEX_KEY, {})).toThrow(/X_CONTENT_BUNDLE_SECRET is not set/);
	});
});

describe('bundle storage selection', () => {
	const secretEnv = { X_CONTENT_BUNDLE_SECRET: 'a'.repeat(64) };

	it('uses Google Cloud Storage when a bundle bucket is named', async () => {
		const { bundleStorage } = await import('../api/_lib/x-content/overlay.js');
		expect(bundleStorage({ ...secretEnv, X_CONTENT_BUNDLE_BUCKET: 'bundles' }).label).toBe('Google Cloud Storage');
	});

	it('keeps object storage (R2) when no bucket is named', async () => {
		const { bundleStorage } = await import('../api/_lib/x-content/overlay.js');
		expect(bundleStorage(secretEnv).label).toBe('object storage');
	});

	it('refuses a GCS store without a bucket', async () => {
		const { gcsStorage } = await import('../api/_lib/x-content/overlay.js');
		expect(() => gcsStorage(secretEnv)).toThrow(/X_CONTENT_BUNDLE_BUCKET/);
	});
});
