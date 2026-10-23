// Configuration and asset sources: the two surfaces a host actually touches.
// The URL-override path is the one that takes untrusted input, so it gets the
// most attention here.

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { DEFAULTS, mergeConfig, resolveConfig, safeUrl } from '../src/config.js';
import { resolveSources } from '../src/sources/index.js';
import { catalogueItems, filenameTitle, normalizeCatalogue } from '../src/sources/manifest.js';
import { staticSource } from '../src/sources/static.js';
import { cdnUrl } from '../src/sources/three-ws.js';

test('mergeConfig deep-merges objects and replaces arrays', () => {
	const merged = mergeConfig(
		{ a: { b: 1, c: 2 }, list: [1, 2] },
		{ a: { c: 3 }, list: [9] },
	);
	assert.deepEqual(merged, { a: { b: 1, c: 3 }, list: [9] });
	// The base is never mutated.
	assert.deepEqual(mergeConfig({ x: 1 }, undefined), { x: 1 });
});

test('safeUrl accepts https and site-relative paths only', () => {
	assert.equal(safeUrl('https://a.com/m.json'), 'https://a.com/m.json');
	assert.equal(safeUrl('/models.json'), '/models.json');
	assert.equal(safeUrl('http://a.com/m.json'), null);
	assert.equal(safeUrl('javascript:alert(1)'), null);
	assert.equal(safeUrl('//evil.com/m.json'), null);
});

test('URL parameters can retarget the catalogue, but only over https', () => {
	assert.equal(resolveConfig({}, '?assets=https://a.com/m.json').assets, 'https://a.com/m.json');
	assert.equal(resolveConfig({}, '?assets=http://a.com/m.json').assets, DEFAULTS.assets);
	assert.equal(resolveConfig({}, '?assets=javascript:alert(1)').assets, DEFAULTS.assets);
});

test('a host can switch URL overrides off entirely', () => {
	const cfg = resolveConfig({ allowUrlOverride: false }, '?assets=https://a.com/m.json&src=https://a.com/x.glb&room=ABC234');
	assert.equal(cfg.assets, DEFAULTS.assets);
	assert.deepEqual(cfg.urlModels, []);
	assert.equal(cfg.urlRoom, '');
});

test('deep-linked models are paired with titles and validated', () => {
	const cfg = resolveConfig({}, '?src=https://a.com/1.glb&title=One&src=http://a.com/2.glb&title=Two');
	assert.deepEqual(cfg.urlModels, [{ src: 'https://a.com/1.glb', title: 'One' }]);
});

test('resolveSources turns every accepted shape into a tab list', () => {
	assert.deepEqual(resolveSources('three.ws', {}).map((s) => s.id), ['recent', 'objects', 'link']);
	assert.deepEqual(resolveSources('https://a.com/m.json', {}).map((s) => s.id), ['models', 'link']);
	assert.deepEqual(
		resolveSources(['recent', staticSource({ id: 'ours', items: [] }), 'objects'], {}).map((s) => s.id),
		['recent', 'ours', 'objects', 'link'],
	);
	// A link tab is always available, and never duplicated.
	assert.equal(resolveSources(['link', 'link'], {}).filter((s) => s.id === 'link').length, 1);
	assert.throws(() => resolveSources('nonsense', {}), /unknown asset source/);
});

test('catalogues are read in every common shape', () => {
	const entry = { url: 'https://a.com/x.glb', name: 'X' };
	for (const shape of [[entry], { items: [entry] }, { objects: [entry] }, { creations: [entry] }, { models: [entry] }]) {
		assert.equal(catalogueItems(shape).length, 1, JSON.stringify(shape));
	}
	assert.deepEqual(catalogueItems({ nothing: true }), []);
});

test('catalogue entries are normalized and hostile URLs dropped', () => {
	const items = normalizeCatalogue({
		objects: [
			{ url: 'https://a.com/wrench.glb', label: 'Wrench', thumb: 'https://a.com/w.png', categories: ['tools'], tags: ['metal'] },
			{ glb_url: 'https://a.com/lamp.glb', prompt: 'a brass lamp' },
			{ url: 'javascript:alert(1)', name: 'Bad' },
			{ name: 'No URL at all' },
		],
	});
	assert.equal(items.length, 2);
	assert.equal(items[0].title, 'Wrench');
	assert.ok(items[0].keywords.includes('tools') && items[0].keywords.includes('metal'));
	assert.equal(items[1].title, 'a brass lamp');
});

test('a rewriteUrl hook can route a catalogue through another host', () => {
	const items = normalizeCatalogue([{ url: 'https://pub-abc123.r2.dev/objects/x.glb' }], {
		rewriteUrl: (u) => cdnUrl(u, 'https://three.ws'),
	});
	assert.equal(items[0].src, 'https://three.ws/cdn/objects/x.glb');
	// Anything that is not a bucket URL passes through untouched.
	assert.equal(cdnUrl('https://acme.com/x.glb'), 'https://acme.com/x.glb');
});

test('filenames become readable labels when a catalogue has no titles', () => {
	assert.equal(filenameTitle('https://a.com/alarm_clock_01.glb'), 'Alarm clock 01');
	assert.equal(filenameTitle('https://a.com/x.glb?v=2'), 'X');
});

test('staticSource normalizes what it is given, once', async () => {
	const source = staticSource({ items: [{ src: 'https://a.com/x.glb', title: 'X' }, { src: 'ftp://nope' }] });
	assert.deepEqual(await source.list(), [{ src: 'https://a.com/x.glb', title: 'X', poster: '', keywords: 'x' }]);
});
