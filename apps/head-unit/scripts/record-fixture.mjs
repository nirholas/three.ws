// Writes tests/fixtures/dongle-session.json: the wire bytes a CPC200 sends over
// USB during one short CarPlay session, as a replayable stream.
//
// Every payload value is taken from node-carplay's own test suite (file and
// test name recorded per frame, at the upstream commit below), and every frame
// is framed by node-carplay's own MessageHeader.asBuffer, so the bytes are the
// protocol as the driver defines it, not a format invented here. The order
// models a session: the dongle identifies itself, a phone joins over Wi-Fi,
// audio and video flow, the phone leaves.
//
// Run from apps/head-unit: node scripts/record-fixture.mjs

import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { MessageHeader, MessageType, CommandMapping } from 'node-carplay/node';

const UPSTREAM = {
	repo: 'https://github.com/rhysmorgan134/node-CarPlay',
	commit: '670f19eda2a0b0047a5a538b9602b263f442433a',
	package: 'node-carplay@4.1.0',
};
const READABLE = 'src/modules/messages/__tests__/readable.test.ts';
const COMMON = 'src/modules/messages/__tests__/common.test.ts';

const u32 = (...values) => {
	const b = Buffer.alloc(values.length * 4);
	values.forEach((v, i) => b.writeUInt32LE(v, i * 4));
	return b;
};

function audio(extraBytes, write) {
	const b = Buffer.alloc(12 + extraBytes);
	b.writeUInt32LE(1, 0);
	b.writeFloatLE(0.5, 4);
	b.writeUInt32LE(1, 8);
	write?.(b);
	return b;
}

function video() {
	const b = Buffer.alloc(512);
	b.writeUInt32LE(800, 0);
	b.writeUInt32LE(600, 4);
	b.writeUInt32LE(1, 8);
	b.writeUInt32LE(10, 12);
	b.writeUInt32LE(2, 16);
	return b;
}

const frames = [
	['software-version', MessageType.SoftwareVersion, Buffer.from('version 1'), READABLE, 'SoftwareVersion Message constructs message with correct values'],
	['bluetooth-address', MessageType.BluetoothAddress, Buffer.from('00:11:22:33:FF:EE'), READABLE, 'BluetoothAddress Message constructs message with correct values'],
	['plugged-carplay-wifi', MessageType.Plugged, u32(3, 1), READABLE, 'Plugged Message constructs message with wifi when it has 8 bytes of data'],
	['command-frame', MessageType.Command, u32(CommandMapping.frame), READABLE, 'Command Message constructs message with correct value'],
	['audio-command-output-start', MessageType.AudioData, audio(1, (b) => b.writeInt8(1, 12)), READABLE, 'AudioData Message constructs message with command'],
	['audio-volume-duration', MessageType.AudioData, audio(4, (b) => b.writeFloatLE(0.5, 12)), READABLE, 'AudioData Message constructs message with volume duration'],
	['audio-pcm', MessageType.AudioData, audio(500), READABLE, 'AudioData Message constructs message with raw audio data'],
	['video-800x600', MessageType.VideoData, video(), READABLE, 'VideoData Message constructs message with correct values'],
	['unplugged', MessageType.Unplugged, null, COMMON, 'toMessage constructs message based on type with no data'],
].map(([name, type, payload, file, test]) => ({
	name,
	type: MessageType[type],
	source: `${file} > ${test}`,
	hex: Buffer.concat([MessageHeader.asBuffer(type, payload ? payload.length : 0), payload || Buffer.alloc(0)]).toString('hex'),
}));

const out = fileURLToPath(new URL('../tests/fixtures/dongle-session.json', import.meta.url));
writeFileSync(out, `${JSON.stringify({ upstream: UPSTREAM, frames }, null, '\t')}\n`);
console.log(`wrote ${frames.length} frames to ${out}`);
