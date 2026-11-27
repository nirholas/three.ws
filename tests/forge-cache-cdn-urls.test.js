/**
 * A forge result-cache hit must hand back a URL a browser can load.
 *
 * Regression: the bucket's public *.r2.dev domain stopped serving (Cloudflare
 * answers 404 "Public access" for every key). Providers now return the
 * first-party /cdn/<key> form, but the result cache keeps completed results for
 * seven days, so entries written before that fix kept replaying the dead
 * r2.dev URL to /forge, /api/gpt-forge and the Teams "Create a 3D model" card.
 * Seen live on 2026-11-16: a Teams forge settled "done" with
 * https://pub-...r2.dev/forge/nvidia/<uuid>.glb (404) while the same object
 * answered 200 at https://three.ws/cdn/forge/nvidia/<uuid>.glb.
 */
import { describe, it, expect, beforeAll } from 'vitest';

const DEAD_PUBLIC_DOMAIN = 'https://pub-0000000000000000000000000000test.r2.dev';

beforeAll(() => {
	Object.assign(process.env, {
		S3_PUBLIC_DOMAIN: DEAD_PUBLIC_DOMAIN,
		PUBLIC_APP_ORIGIN: 'https://three.ws',
	});
});

function fakeRedis() {
	const store = new Map();
	return {
		async get(k) {
			return store.has(k) ? store.get(k) : null;
		},
		async set(k, v) {
			store.set(k, v);
			return 'OK';
		},
	};
}

// Every hit is checked against its creation row; this suite is about URLs, so the
// row is a live public one.
const liveRow = async (id) => ({ id, status: 'done', visibility: 'public', safety_status: 'clear' });

describe('getCachedForgeResult URL normalization', () => {
	it('rewrites a pre-fix raw bucket URL to the /cdn/ proxy', async () => {
		const { putCachedForgeResult, getCachedForgeResult } = await import('../api/_lib/forge-cache.js');
		const redis = fakeRedis();
		const key = 'a'.repeat(40);
		await putCachedForgeResult(
			key,
			{ glb_url: `${DEAD_PUBLIC_DOMAIN}/forge/nvidia/cc3b4e67-fe43-4bb3-8a8d-0624180c8b33.glb`, creation_id: 'c1', backend: 'nvidia' },
			{ redis },
		);
		const hit = await getCachedForgeResult(key, { redis, lookup: liveRow });
		expect(hit.glb_url).toBe('https://three.ws/cdn/forge/nvidia/cc3b4e67-fe43-4bb3-8a8d-0624180c8b33.glb');
		expect(hit.backend).toBe('nvidia');
	});

	it('leaves /cdn/ and external URLs untouched', async () => {
		const { putCachedForgeResult, getCachedForgeResult } = await import('../api/_lib/forge-cache.js');
		const redis = fakeRedis();
		for (const url of ['https://three.ws/cdn/forge/x.glb', 'https://assets.example.org/model.glb']) {
			const key = Buffer.from(url).toString('hex').slice(0, 40);
			await putCachedForgeResult(key, { glb_url: url, creation_id: 'c1' }, { redis });
			expect((await getCachedForgeResult(key, { redis, lookup: liveRow })).glb_url).toBe(url);
		}
	});
});
