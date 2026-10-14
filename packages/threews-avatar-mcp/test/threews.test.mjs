// A raw `model` url is the one tool argument that flows straight from the
// caller into HTML (escaped, so not an XSS vector, but unbounded in length).
// An oversized or control-character-laden url should be rejected before it
// ever reaches modelViewerHtml's output, not merely HTML-escaped.

import test from 'node:test';
import assert from 'node:assert/strict';

import { isSafeModelUrl, modelViewerHtml, ThreewsError } from '../src/threews.js';

test('isSafeModelUrl rejects an oversized url', () => {
	const huge = `https://example.com/${'a'.repeat(10_000)}.glb`;
	assert.equal(isSafeModelUrl(huge), false);
});

test('modelViewerHtml throws ThreewsError for an oversized model url instead of passing it through', () => {
	const huge = `https://example.com/${'a'.repeat(10_000)}.glb`;
	assert.throws(() => modelViewerHtml({ model_url: huge, name: 'Avatar' }), ThreewsError);
});

test('isSafeModelUrl still accepts a normal https GLB url', () => {
	assert.equal(isSafeModelUrl('https://three.ws/models/avatar.glb'), true);
});

test('modelViewerHtml clamps an overlong name instead of emitting it verbatim', () => {
	const longName = 'A'.repeat(5000);
	const html = modelViewerHtml({ model_url: 'https://three.ws/models/avatar.glb', name: longName });
	assert.ok(!html.includes(longName), 'overlong name must not reach the HTML output unclamped');
	const titleMatch = html.match(/<title>([^<]*)<\/title>/);
	assert.ok(titleMatch, 'title tag must still be present');
	assert.ok(titleMatch[1].length <= 200, `clamped title should be short, got ${titleMatch[1].length} chars`);
});
