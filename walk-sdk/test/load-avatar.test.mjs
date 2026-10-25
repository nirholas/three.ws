// @three-ws/walk: concurrent-load coalescing for the same avatar URL.
// ====================================================================
// Production telemetry (three.ws order 426) showed a steady stream of
// unhandled `TypeError: Failed to fetch` rejections whose async stack traces
// resolve to three.js's own FileLoader.load(): a floating `fetch().then()...`
// chain that FileLoader never returns or awaits. Its `.catch()` rethrows with
// nothing after it when `loading[url]` (FileLoader's own module-level
// duplicate-request table, keyed only by URL) was already cleared by the time
// the rejection runs: a bookkeeping edge that only exists when more than one
// caller has registered a callback for the same URL. No try/catch in
// loadWalkAvatar()/companion.js can intercept that: it rejects a promise
// walk-sdk never created a handle to.
//
// loadWalkAvatar() cannot change FileLoader's internals (vendored
// dependency), but it can make sure it never hands FileLoader more than one
// in-flight request for the same URL itself. coalesceLoad() is that guard:
// a second concurrent request for a URL already loading joins the first
// caller's promise instead of starting a second `loader.loadAsync()` call.
// Pure; exercised directly the same way resolveEmotes() is elsewhere in this
// file, no GLTFLoader/network/WASM needed to prove the coalescing itself.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { coalesceLoad } from '../src/internal/load-avatar.js';

test('coalesceLoad starts the underlying load only once for concurrent requests to the same key', async () => {
	let starts = 0;
	const start = () => {
		starts++;
		return Promise.resolve({ n: starts });
	};
	const [a, b] = await Promise.all([
		coalesceLoad('same-url', start),
		coalesceLoad('same-url', start),
	]);
	assert.equal(starts, 1, 'a second concurrent caller must not trigger its own load');
	assert.equal(a.owner, true, 'the first caller owns the load');
	assert.equal(b.owner, false, 'the second caller joined instead of starting its own');
	assert.deepEqual(a.value, { n: 1 });
	assert.deepEqual(b.value, { n: 1 });
});

test('coalesceLoad starts a fresh load once the prior one for that key has settled', async () => {
	let starts = 0;
	const start = () => {
		starts++;
		return Promise.resolve({ n: starts });
	};
	await coalesceLoad('same-url-sequential', start);
	await coalesceLoad('same-url-sequential', start);
	assert.equal(starts, 2, 'a load that already finished must not be reused for a later, separate request');
});

test('coalesceLoad propagates a rejection to every waiter instead of swallowing it', async () => {
	const start = () => Promise.reject(new TypeError('Failed to fetch'));
	await assert.rejects(
		Promise.all([coalesceLoad('same-url-reject', start), coalesceLoad('same-url-reject', start)]),
		/Failed to fetch/,
	);
});

test('coalesceLoad tracks each key independently', async () => {
	let startsA = 0;
	let startsB = 0;
	const [a, b] = await Promise.all([
		coalesceLoad('key-a', () => {
			startsA++;
			return Promise.resolve('a');
		}),
		coalesceLoad('key-b', () => {
			startsB++;
			return Promise.resolve('b');
		}),
	]);
	assert.equal(startsA, 1);
	assert.equal(startsB, 1);
	assert.equal(a.value, 'a');
	assert.equal(b.value, 'b');
});
