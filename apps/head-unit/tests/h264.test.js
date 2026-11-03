// tests/fixtures/testsrc-baseline.h264 is real libx264 output (three frames of
// ffmpeg's testsrc, Constrained Baseline level 3.1, Annex B), the profile a
// CarPlay phone sends. Regenerate with:
//   ffmpeg -f lavfi -i testsrc=size=160x96:rate=10 -frames:v 3 -c:v libx264 \
//     -profile:v baseline -level 3.1 -pix_fmt yuv420p -g 10 \
//     -bsf:v h264_mp4toannexb -f h264 tests/fixtures/testsrc-baseline.h264

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { codecFromSps, inspectAccessUnit, nalUnits } from '../public/h264.js';
import { decodeFrame, encodeAudio, encodeVideo } from '../public/wire.js';

const stream = new Uint8Array(readFileSync(fileURLToPath(new URL('./fixtures/testsrc-baseline.h264', import.meta.url))));

test('splits a real Annex B stream into its NAL units', () => {
	const types = nalUnits(stream).map((u) => u.type);
	assert.deepEqual(types.slice(0, 2), [7, 8], 'SPS then PPS lead the stream');
	assert.ok(types.includes(5), 'has an IDR slice');
	assert.equal(types.filter((t) => t === 1).length, 2, 'two delta slices follow');
});

test('reads the codec string WebCodecs needs from the SPS', () => {
	const sps = nalUnits(stream).find((u) => u.type === 7).data;
	assert.equal(codecFromSps(sps), 'avc1.42c01f');
	assert.equal(codecFromSps(new Uint8Array([0x67])), null);
});

test('tells the keyframe access unit from a delta one', () => {
	const units = nalUnits(stream);
	const firstDelta = units.find((u) => u.type === 1);
	assert.deepEqual(inspectAccessUnit(stream.subarray(0, firstDelta.data.byteOffset - 3)), { key: true, codec: 'avc1.42c01f' });
	const delta = new Uint8Array([0, 0, 0, 1, ...firstDelta.data]);
	assert.deepEqual(inspectAccessUnit(delta), { key: false, codec: null });
});

test('video and audio frames survive the wire unchanged', () => {
	const v = decodeFrame(encodeVideo({ width: 800, height: 600, data: stream }));
	assert.equal(v.kind, 'video');
	assert.equal(v.width, 800);
	assert.equal(v.height, 600);
	assert.deepEqual(v.data, stream);

	const samples = new Int16Array([0, 32767, -32768, 1234]);
	const a = decodeFrame(encodeAudio({ audioType: 2, channels: 2, sampleRate: 48000, samples }));
	assert.deepEqual({ ...a, samples: [...a.samples] }, { kind: 'audio', audioType: 2, channels: 2, sampleRate: 48000, samples: [...samples] });

	assert.equal(decodeFrame(new Uint8Array([9, 9, 9])), null, 'unknown kinds are dropped');
	assert.equal(decodeFrame(new Uint8Array([])), null);
});
