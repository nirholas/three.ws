import assert from 'node:assert/strict';
import { test } from 'node:test';
import { decodeDataUri } from '../src/lib/media.js';
import { TOOLS, buildServer } from '../src/index.js';

const PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAFgwJ/lwV8YQAAAABJRU5ErkJggg==';

test('decodes a signed PNG data URI and reports immutable metadata', () => {
	const media = decodeDataUri(PNG);
	assert.equal(media.mimeType, 'image/png');
	assert.equal(media.byteLength, 70);
	assert.deepEqual(media.dimensions, { width: 1, height: 1 });
	assert.equal(media.sha256.length, 64);
});

test('rejects unsupported and mismatched media before it can reach a client', () => {
	assert.throws(() => decodeDataUri('data:image/svg+xml;base64,PHN2Zy8+'), /Unsupported/);
	assert.throws(() => decodeDataUri('data:image/png;base64,R0lGODlhAQABAIAAAAAAAP///ywAAAAAAQABAAACAUwAOw=='), /PNG signature/);
	assert.throws(() => decodeDataUri('data:image/png;base64,AAAA'), /PNG signature/);
});

test('the complete read-only surface is registered without a signer', () => {
	assert.deepEqual(TOOLS.map((tool) => tool.name), ['decode_solana_memo_data_uri', 'extract_solana_memo_media', 'find_solana_memo_media', 'get_solana_memo_media_status']);
	for (const tool of TOOLS) {
		assert.equal(tool.annotations.readOnlyHint, true);
		assert.equal(typeof tool.annotations.idempotentHint, 'boolean');
		assert.equal(typeof tool.annotations.openWorldHint, 'boolean');
	}
	const server = buildServer();
	for (const tool of TOOLS) assert.ok(server._registeredTools[tool.name]);
});
