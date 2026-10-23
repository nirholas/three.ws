// The scene format is a contract: it is persisted to localStorage, sent over the
// wire to other people's browsers, and pasted into URLs by strangers. These
// tests pin both halves of that: that a legitimate arrangement round-trips
// exactly, and that hostile input degrades to an empty scene instead of
// smuggling a non-GLB URL or a NaN transform into the renderer.

import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
	deserializeScene, fitTransform, normalizeGlbUrl, parseSrcParams, roomLightFromPixels,
	sceneFromHashParam, sceneToHashParam, serializeScene, spawnPointInFront,
	studioSceneUrl, studioShareUrl, twistDelta, MAX_PLACEMENTS, SCALE_MIN, SCALE_MAX,
} from '../src/studio/scene-math.js';

test('normalizeGlbUrl accepts https and site-relative, rejects everything else', () => {
	assert.equal(normalizeGlbUrl('https://a.com/x.glb'), 'https://a.com/x.glb');
	assert.equal(normalizeGlbUrl('/models/x.glb'), '/models/x.glb');
	for (const hostile of [
		'http://a.com/x.glb', 'javascript:alert(1)', 'data:model/gltf-binary;base64,AAA',
		'blob:https://a.com/1', '//evil.com/x.glb', '', null, undefined, 42,
	]) {
		assert.equal(normalizeGlbUrl(hostile), null, `${String(hostile)} must be rejected`);
	}
});

test('a placed arrangement round-trips through the hash exactly', () => {
	const placements = [
		{ src: 'https://a.com/lamp.glb', title: 'Lamp', x: 0.4, z: -1.8, yaw: 1.2, scale: 1.4 },
		{ src: 'https://a.com/fern.glb', title: 'Fern', x: -0.9, z: -2.2, yaw: 0, scale: 0.8 },
	];
	const restored = sceneFromHashParam(sceneToHashParam(placements));
	assert.equal(restored.length, 2);
	assert.deepEqual(restored[0], placements[0]);
	assert.deepEqual(restored[1], placements[1]);
});

test('a hostile or corrupt scene payload degrades to empty, never throws', () => {
	for (const bad of [null, undefined, '', 'not json', '{}', '[]', '{"v":2,"items":[]}', 'eyJhIjox']) {
		assert.deepEqual(deserializeScene(bad), []);
		assert.deepEqual(sceneFromHashParam(bad), []);
	}
	const smuggled = JSON.stringify({ v: 1, items: [{ src: 'javascript:alert(1)', x: 0, z: 0 }] });
	assert.deepEqual(deserializeScene(smuggled), []);
	const nan = JSON.stringify({ v: 1, items: [{ src: 'https://a.com/x.glb', x: 'NaN', z: 0 }] });
	assert.deepEqual(deserializeScene(nan), []);
});

test('scale and position are clamped on the way back in', () => {
	const wild = JSON.stringify({
		v: 1,
		items: [{ src: 'https://a.com/x.glb', x: 9999, z: -9999, yaw: 0, scale: 500 }],
	});
	const [item] = deserializeScene(wild);
	assert.equal(item.scale, SCALE_MAX);
	assert.equal(item.x, 50);
	assert.equal(item.z, -50);
});

test('serialization is capped at the placement limit', () => {
	const many = Array.from({ length: MAX_PLACEMENTS + 12 }, (_, i) => ({
		src: `https://a.com/${i}.glb`, x: 0, z: 0, yaw: 0, scale: 1,
	}));
	assert.equal(JSON.parse(serializeScene(many)).items.length, MAX_PLACEMENTS);
});

test('share URLs carry the models, and the scene URL adds the arrangement', () => {
	const placements = [{ src: 'https://a.com/x.glb', title: 'X', x: 1, z: 2, yaw: 0.5, scale: 1.2 }];
	const short = studioShareUrl('https://acme.com/ar/', placements);
	assert.match(short, /^https:\/\/acme\.com\/ar\/\?src=https%3A%2F%2Fa\.com%2Fx\.glb&title=X$/);
	assert.ok(studioSceneUrl('https://acme.com/ar/', placements).includes('#s='));
	// An existing query string is preserved rather than clobbered.
	assert.ok(studioShareUrl('https://acme.com/ar/?utm=x', placements).includes('?utm=x&src='));
});

test('a scene too dense for a scannable QR falls back to the models-only link', () => {
	const placements = Array.from({ length: 12 }, (_, i) => ({
		src: `https://cdn.example.com/very/long/path/segment/number/${i}/model-${i}.glb`,
		title: `Model number ${i} with a fairly long descriptive name`,
		x: i * 0.31, z: -i * 0.47, yaw: i * 0.19, scale: 1 + i * 0.05,
	}));
	assert.ok(!studioSceneUrl('https://acme.com/ar/', placements, 400).includes('#s='));
});

test('duplicate sources collapse to one entry in a share link', () => {
	const same = Array.from({ length: 5 }, () => ({ src: 'https://a.com/crate.glb', title: 'Crate' }));
	assert.equal(studioShareUrl('https://acme.com/ar/', same).match(/src=/g).length, 1);
});

test('parseSrcParams pairs sources with titles and drops bad ones', () => {
	const params = new URLSearchParams();
	params.append('src', 'https://a.com/1.glb');
	params.append('title', 'One');
	params.append('src', 'javascript:alert(1)');
	params.append('title', 'Bad');
	const parsed = parseSrcParams(params);
	assert.equal(parsed.length, 1);
	assert.deepEqual(parsed[0], { src: 'https://a.com/1.glb', title: 'One' });
});

test('fitTransform normalizes props by size and characters by height', () => {
	// A 40 m statue of a person is scaled to human height and rests on the floor.
	const giant = fitTransform({ min: { x: -1, y: 0, z: -1 }, max: { x: 1, y: 40, z: 1 } }, { skinned: true });
	assert.ok(Math.abs(giant.scale * 40 - 1.65) < 1e-6);
	assert.ok(Object.is(giant.yOffset, 0) || Object.is(giant.yOffset, -0));
	// A prop authored below the floor is lifted onto it.
	const sunken = fitTransform({ min: { x: 0, y: -2, z: 0 }, max: { x: 1, y: 0, z: 1 } });
	assert.ok(sunken.yOffset > 0);
	// Anything already close to real-world size is left alone.
	assert.equal(fitTransform({ min: { x: 0, y: 0, z: 0 }, max: { x: 1, y: 1, z: 1 } }).scale, 1);
	// A degenerate box still renders rather than vanishing.
	assert.deepEqual(fitTransform({ min: { x: 0, y: 0, z: 0 }, max: { x: 0, y: 0, z: 0 } }), { scale: 1, yOffset: 0 });
	assert.deepEqual(fitTransform(null), { scale: 1, yOffset: 0 });
});

test('a model spawns on the floor in front of the camera, even looking straight up', () => {
	const front = spawnPointInFront({ x: 0, y: 1.5, z: 0 }, { x: 0, y: 0, z: -1 }, 2);
	assert.ok(Math.abs(front.z + 2) < 1e-6);
	// Straight up has no horizontal heading: fall back to the initial facing.
	const up = spawnPointInFront({ x: 0, y: 1.5, z: 0 }, { x: 0, y: 1, z: 0 }, 2);
	assert.ok(Math.abs(up.z + 2) < 1e-6);
});

test('twist never spins the long way round the boundary', () => {
	assert.ok(Math.abs(twistDelta(3.0, -3.0) - (2 * Math.PI - 6)) < 1e-9);
	assert.equal(twistDelta(NaN, 1), 0);
});

test('room light reads brightness and colour cast from camera pixels', () => {
	const pixels = (r, g, b, n = 64) => {
		const out = new Uint8ClampedArray(n * 4);
		for (let i = 0; i < n; i++) { out[i * 4] = r; out[i * 4 + 1] = g; out[i * 4 + 2] = b; out[i * 4 + 3] = 255; }
		return out;
	};
	const dark = roomLightFromPixels(pixels(4, 4, 4));
	const bright = roomLightFromPixels(pixels(240, 240, 240));
	assert.ok(dark.intensity < bright.intensity);
	// A near-black frame carries no reliable cast, so the tint stays neutral.
	assert.deepEqual(dark.tint, { r: 1, g: 1, b: 1 });
	const warm = roomLightFromPixels(pixels(220, 170, 120));
	assert.ok(warm.tint.r > 1 && warm.tint.b < 1);
	assert.deepEqual(roomLightFromPixels([]), { intensity: 0.4, tint: { r: 1, g: 1, b: 1 } });
});

test('SCALE bounds are the ones the pinch gesture clamps to', () => {
	assert.equal(SCALE_MIN, 0.25);
	assert.equal(SCALE_MAX, 4);
});
