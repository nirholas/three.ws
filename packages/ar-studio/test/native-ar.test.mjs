// The device hand-off is the part of this package that only ever runs on a
// phone, which is exactly why it is pinned here. Two rules carry the whole
// feature and both are invisible on a laptop:
//
//   1. Preparation and opening are separate. iOS opens AR Quick Look only while
//      the page still holds the user gesture that asked for it, and converting a
//      GLB to USDZ takes seconds. Convert inside the tap handler and Safari
//      silently declines: the button looks dead. So `prepareNativeAr` must never
//      open anything, and the handoff it returns must open synchronously.
//   2. One conversion per model. A cache miss on the second tap is a two-second
//      stall a person reads as a bug.

import { test } from 'node:test';
import assert from 'node:assert/strict';

const IPHONE = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1';
const PIXEL = 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Mobile Safari/537.36';
const MAC = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36';

function define(name, value) {
	Object.defineProperty(globalThis, name, { value, configurable: true, writable: true });
}

/** Minimal browser surface: the module only touches these. */
function installDom(userAgent) {
	const revoked = [];
	const clicked = [];
	let n = 0;
	// Node ships a read-only `navigator`, so stubbing it needs defineProperty.
	define('navigator', { userAgent, platform: 'iPhone', maxTouchPoints: 5 });
	define('location', { href: 'https://example.test/studio' });
	globalThis.URL.createObjectURL = () => `blob:https://example.test/obj-${++n}`;
	globalThis.URL.revokeObjectURL = (u) => revoked.push(u);
	const body = { children: [], appendChild(el) { this.children.push(el); return el; } };
	define('document', {
		body,
		createElement: (tag) => ({
			tag,
			style: {},
			children: [],
			listeners: {},
			appendChild(el) { this.children.push(el); return el; },
			setAttribute(k, v) { this[k] = v; },
			addEventListener(type, fn) { this.listeners[type] = fn; },
			remove() { body.children = body.children.filter((c) => c !== this); },
			click() { clicked.push(this); },
		}),
	});
	return { revoked, clicked };
}

function uninstallDom() {
	delete globalThis.navigator;
	delete globalThis.document;
	delete globalThis.location;
}

const blob = (text = 'usdz') => ({ size: text.length, type: 'model/vnd.usdz+zip' });

test('a desktop browser reports no native AR viewer at all', async (t) => {
	installDom(MAC);
	t.after(uninstallDom);
	const { prepareNativeAr, canUseQuickLook, canUseSceneViewer } = await import(`../src/studio/native-ar.js?desktop`);
	assert.equal(canUseQuickLook(), false);
	assert.equal(canUseSceneViewer(), false);
	assert.equal(await prepareNativeAr({ src: 'https://a.test/x.glb' }), null);
});

test('Android prepares a Scene Viewer hand-off without converting anything', async (t) => {
	installDom(PIXEL);
	t.after(uninstallDom);
	const { prepareNativeAr } = await import(`../src/studio/native-ar.js?android`);
	let built = 0;
	const handoff = await prepareNativeAr(
		{ src: 'https://a.test/x.glb', title: 'Chair', build: async () => { built++; return blob(); } },
	);
	assert.equal(handoff.viewer, 'sceneviewer');
	assert.equal(built, 0, 'Scene Viewer takes the GLB directly: no USDZ is needed');
	assert.equal(handoff.href, 'https://a.test/x.glb');
});

test('iOS converts once per key, and opening never converts', async (t) => {
	const { clicked } = installDom(IPHONE);
	t.after(uninstallDom);
	const mod = await import(`../src/studio/native-ar.js?ios-cache`);
	let built = 0;
	const model = {
		src: 'https://a.test/chair.glb',
		title: 'Chair',
		key: 'chair|1.000',
		build: async () => { built++; return blob(); },
	};

	assert.equal(mod.isQuickLookReady('chair|1.000'), false);
	const first = await mod.prepareNativeAr(model);
	assert.equal(first.viewer, 'quicklook');
	assert.equal(built, 1);
	assert.match(first.href, /^blob:/);
	assert.equal(mod.isQuickLookReady('chair|1.000'), true);

	const second = await mod.prepareNativeAr(model);
	assert.equal(built, 1, 'a second tap reuses the converted USDZ');
	assert.equal(second.href, first.href);

	// The open path is synchronous on purpose: an await here loses the gesture.
	assert.equal(clicked.length, 0, 'preparing must never open the viewer');
	second.open();
	assert.equal(clicked.length, 1);
	assert.equal(clicked[0].rel, 'ar');
	assert.equal(clicked[0].href, second.href);
	assert.equal(clicked[0].children.length, 1, 'iOS needs a child element inside the anchor');
	// The bug this pins: without a filename Safari cannot tell a blob URL is a
	// USDZ, opens Quick Look in Object mode, and AR is silently unavailable.
	assert.equal(clicked[0].download, 'chair.usdz');

	assert.equal(mod.releaseQuickLook('chair|1.000'), true);
	assert.equal(mod.isQuickLookReady('chair|1.000'), false);
});

test('a scaled model is a different cache entry, because the size is baked in', async (t) => {
	installDom(IPHONE);
	t.after(uninstallDom);
	const mod = await import(`../src/studio/native-ar.js?ios-scale`);
	const keys = [];
	const make = (key) => mod.prepareNativeAr({
		src: 'https://a.test/chair.glb', key, build: async () => { keys.push(key); return blob(); },
	});
	await make('chair|1.000');
	await make('chair|0.500');
	assert.deepEqual(keys, ['chair|1.000', 'chair|0.500']);
	mod.clearQuickLookCache();
});

test('the cache is bounded, and eviction revokes the blob it was holding', async (t) => {
	const { revoked } = installDom(IPHONE);
	t.after(uninstallDom);
	const mod = await import(`../src/studio/native-ar.js?ios-evict`);
	const hrefs = [];
	for (let i = 0; i < 6; i++) {
		const h = await mod.cachedUsdzUrl(`m${i}`, async () => blob());
		hrefs.push(h);
	}
	assert.equal(mod.isQuickLookReady('m0'), false, 'the oldest entry is gone');
	assert.equal(mod.isQuickLookReady('m5'), true);
	assert.ok(revoked.includes(hrefs[0]), 'eviction is the only thing that frees that memory');
	mod.clearQuickLookCache();
	assert.equal(mod.isQuickLookReady('m5'), false);
});

test('a failed conversion is retryable rather than cached forever', async (t) => {
	installDom(IPHONE);
	t.after(uninstallDom);
	const mod = await import(`../src/studio/native-ar.js?ios-fail`);
	let attempts = 0;
	const build = async () => {
		attempts++;
		if (attempts === 1) throw new Error('exporter blew up');
		return blob();
	};
	await assert.rejects(mod.cachedUsdzUrl('flaky', build), /exporter blew up/);
	assert.equal(mod.isQuickLookReady('flaky'), false);
	assert.match(await mod.cachedUsdzUrl('flaky', build), /^blob:/);
	assert.equal(attempts, 2);
	mod.clearQuickLookCache();
});

test('a blob URL always reaches Quick Look under a .usdz filename', async (t) => {
	const { clicked } = installDom(IPHONE);
	t.after(uninstallDom);
	const { openQuickLook, usdzFilename } = await import(`../src/studio/native-ar.js?filename`);

	assert.equal(usdzFilename('Adjustable Wrench'), 'adjustable-wrench.usdz');
	assert.equal(usdzFilename('  ~!@#  '), 'model.usdz', 'a title with no usable characters still names the file');
	assert.equal(usdzFilename(''), 'model.usdz');
	assert.equal(usdzFilename('x'.repeat(200)).length, 60 + '.usdz'.length);

	openQuickLook('blob:https://a.test/abc', { name: 'Trench Car' });
	assert.equal(clicked[0].download, 'trench-car.usdz');

	// A real https .usdz already carries its extension; adding `download` there
	// would only risk turning an AR launch into a file save.
	openQuickLook('https://a.test/chair.usdz');
	assert.equal(clicked[1].download, undefined);
});

test('the checkout banner is all-or-nothing, the way Quick Look renders it', async (t) => {
	installDom(IPHONE);
	t.after(uninstallDom);
	const { withQuickLookBanner } = await import(`../src/studio/native-ar.js?banner`);
	assert.equal(withQuickLookBanner('blob:x'), 'blob:x', 'no fields, no fragment');
	// A title with no action would render a banner with an empty button.
	assert.equal(withQuickLookBanner('blob:x', { title: 'Chair' }), 'blob:x');
	assert.equal(
		withQuickLookBanner('blob:x', { title: 'a & b', callToAction: 'Buy' }),
		'blob:x#checkoutTitle=a%20%26%20b&callToAction=Buy',
	);
	const long = withQuickLookBanner('blob:x', { title: 'z'.repeat(200), callToAction: 'Buy' });
	assert.equal(long.length, 'blob:x#checkoutTitle='.length + 80 + '&callToAction=Buy'.length);
	assert.equal(
		withQuickLookBanner('blob:x#already', { subtitle: 'sub', callToAction: 'Buy' }),
		'blob:x#already&checkoutSubtitle=sub&callToAction=Buy',
	);
});

test('nothing to place is a thrown error, not a silent no-op', async (t) => {
	installDom(IPHONE);
	t.after(uninstallDom);
	const { prepareNativeAr } = await import(`../src/studio/native-ar.js?empty`);
	await assert.rejects(prepareNativeAr({}), /nothing to place/);
});
