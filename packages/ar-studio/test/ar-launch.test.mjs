// AR launch routing decides which native viewer a person's phone opens. Getting
// it wrong is invisible on the developer's laptop and total on the user's phone,
// so every branch is pinned here.

import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
	assertArAssetUrl, buildArLaunchUrl, buildSceneViewerUrl, buildViewerUrl,
	detectArTarget, planArLaunch, ArUrlError,
} from '../src/ar-launch.js';

const IPHONE = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1';
const PIXEL = 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Mobile Safari/537.36';
const MAC = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36';

test('devices are classified from the User-Agent', () => {
	assert.equal(detectArTarget(IPHONE), 'ios');
	assert.equal(detectArTarget(PIXEL), 'android');
	assert.equal(detectArTarget(MAC), 'desktop');
	assert.equal(detectArTarget(''), 'desktop');
	assert.equal(detectArTarget(undefined), 'desktop');
});

test('only an https .glb or .gltf is ever handed to a device AR intent', () => {
	assert.equal(assertArAssetUrl('https://a.com/x.glb'), 'https://a.com/x.glb');
	assert.equal(assertArAssetUrl('https://a.com/x.gltf?v=2'), 'https://a.com/x.gltf?v=2');
	for (const [bad, code] of [
		['http://a.com/x.glb', 'not_https'],
		['https://a.com/x.png', 'not_glb'],
		['not a url', 'invalid_url'],
	]) {
		assert.throws(() => assertArAssetUrl(bad), (err) => err instanceof ArUrlError && err.code === code, bad);
	}
});

test('Android gets a Scene Viewer redirect for a prop', () => {
	const plan = planArLaunch({ glbUrl: 'https://a.com/x.glb', userAgent: PIXEL, title: 'Crate' });
	assert.equal(plan.target, 'android');
	assert.equal(plan.action, 'redirect');
	assert.match(plan.sceneViewerUrl, /^intent:\/\/arvr\.google\.com\/scene-viewer\/1\.2\?/);
	// The browser fallback keeps a device without ARCore out of an error screen.
	assert.match(plan.sceneViewerUrl, /S\.browser_fallback_url=/);
});

test('iOS and desktop get the launch page rather than a redirect', () => {
	assert.equal(planArLaunch({ glbUrl: 'https://a.com/x.glb', userAgent: IPHONE }).action, 'page');
	assert.equal(planArLaunch({ glbUrl: 'https://a.com/x.glb', userAgent: MAC }).action, 'page');
});

test('a rigged avatar always gets the page, so the animated path stays reachable', () => {
	const plan = planArLaunch({ glbUrl: 'https://a.com/hero.glb', userAgent: PIXEL, live: true });
	assert.equal(plan.action, 'page');
	assert.match(plan.launchUrl, /kind=avatar/);
});

test('links are built against the configured origin', () => {
	assert.equal(
		buildViewerUrl('https://acme.com/', 'https://a.com/x.glb', 'Crate'),
		'https://acme.com/viewer?src=https%3A%2F%2Fa.com%2Fx.glb&title=Crate',
	);
	assert.match(buildArLaunchUrl('https://acme.com', 'https://a.com/x.glb'), /^https:\/\/acme\.com\/api\/ar\?src=/);
	// A host running its own launcher points the endpoint wherever it likes.
	assert.match(
		buildArLaunchUrl('https://acme.com', 'https://a.com/x.glb', '', { endpoint: 'https://acme.com/ar/open' }),
		/^https:\/\/acme\.com\/ar\/open\?src=/,
	);
	assert.ok(!buildSceneViewerUrl('https://a.com/x.glb').includes('title='));
});
