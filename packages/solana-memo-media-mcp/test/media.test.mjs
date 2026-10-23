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
	assert.deepEqual(TOOLS.map((tool) => tool.name), ['decode_solana_memo_data_uri', 'extract_solana_memo_media', 'find_solana_memo_media', 'read_inscription', 'get_solana_memo_media_status']);
	for (const tool of TOOLS) {
		assert.equal(tool.annotations.readOnlyHint, true);
		assert.equal(typeof tool.annotations.idempotentHint, 'boolean');
		assert.equal(typeof tool.annotations.openWorldHint, 'boolean');
	}
	const server = buildServer();
	for (const tool of TOOLS) assert.ok(server._registeredTools[tool.name]);
});

function dataUri(mimeType, bytes) {
	return `data:${mimeType};base64,${Buffer.from(bytes).toString('base64')}`;
}

test('reports dimensions for GIF, JPEG, and every WebP bitstream', () => {
	assert.deepEqual(decodeDataUri('data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///ywAAAAAAQABAAACAUwAOw==').dimensions, { width: 1, height: 1 });

	const jpeg = [0xff, 0xd8, 0xff, 0xe0, 0x00, 0x04, 0x00, 0x00, 0xff, 0xc0, 0x00, 0x11, 0x08, 0x00, 0x30, 0x00, 0x2a, 0x03, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0xff, 0xd9];
	assert.deepEqual(decodeDataUri(dataUri('image/jpeg', jpeg)).dimensions, { width: 42, height: 48 });

	const riff = (chunk, body) => Buffer.concat([Buffer.from('RIFF'), Buffer.alloc(4), Buffer.from('WEBP'), Buffer.from(chunk), Buffer.alloc(4), Buffer.from(body)]);
	const vp8x = riff('VP8X', [0, 0, 0, 0, 41, 0, 0, 47, 0, 0]);
	assert.deepEqual(decodeDataUri(dataUri('image/webp', vp8x)).dimensions, { width: 42, height: 48 });
	const bits = Buffer.alloc(4); bits.writeUInt32LE(41 | (47 << 14));
	const vp8l = riff('VP8L', [0x2f, ...bits]);
	assert.deepEqual(decodeDataUri(dataUri('image/webp', vp8l)).dimensions, { width: 42, height: 48 });
	const vp8 = riff('VP8 ', [0, 0, 0, 0x9d, 0x01, 0x2a, 42, 0, 48, 0]);
	assert.deepEqual(decodeDataUri(dataUri('image/webp', vp8)).dimensions, { width: 42, height: 48 });
});

test('refuses oversized and non-canonical payloads before decoding them', () => {
	assert.throws(() => decodeDataUri(PNG, { maxBytes: 10 }), (error) => error.code === 'media_too_large');
	assert.throws(() => decodeDataUri('data:image/png;base64,iVBORw0KGgo'), (error) => error.code === 'invalid_data_uri');
	assert.throws(() => decodeDataUri('not a data uri'), (error) => error.code === 'invalid_data_uri');
});
