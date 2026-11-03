// The connection state machine, driven through the real node-carplay
// DongleDriver by a recorded dongle session (tests/fixtures/dongle-session.json).
// Only the USB device is a double; see tests/helpers/usb.js.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { MessageHeader, CommandMapping, MessageType } from 'node-carplay/node';
import { createDongle, DONGLE_IDS, formatUsbId } from '../src/dongle.js';
import { createSession } from '../src/session.js';
import { bus, fixture, frameBytes, manualTimers, recordedDongle, until } from './helpers/usb.js';

const SESSION_ORDER = [
	'software-version',
	'bluetooth-address',
	'plugged-carplay-wifi',
	'command-frame',
	'audio-command-output-start',
	'audio-volume-duration',
	'audio-pcm',
	'video-800x600',
	'unplugged',
];

function rig({ stream, openError, plugged = true } = {}) {
	const usb = bus();
	const timers = manualTimers();
	const dongle = createDongle({ webusb: usb, sleep: async () => {}, resetSettleMs: 0 });
	const session = createSession({ dongle, timers, now: () => 1_000 });
	const states = [];
	session.onChange((s) => states.push(s.state));
	const hw = recordedDongle({ stream, openError });
	if (plugged) usb.plug(hw.device);
	return { usb, timers, dongle, session, states, hw };
}

test('the fixture is the protocol node-carplay itself parses', () => {
	assert.equal(fixture.upstream.package, 'node-carplay@4.1.0');
	for (const frame of fixture.frames) {
		const bytes = Buffer.from(frame.hex, 'hex');
		const header = MessageHeader.fromBuffer(bytes.subarray(0, 16));
		assert.equal(MessageType[header.type], frame.type, frame.name);
		assert.equal(header.length, bytes.length - 16, frame.name);
		assert.ok(header.toMessage(header.length ? bytes.subarray(16) : undefined), `${frame.name} parses to a message`);
	}
});

test('reports the CPC200 USB ids the empty state shows', () => {
	assert.deepEqual(DONGLE_IDS.map(formatUsbId), ['1314:1520', '1314:1521']);
});

test('with nothing on the bus it rests in disconnected and keeps probing', async () => {
	const { session, states, timers } = rig({ plugged: false });
	await session.start();
	assert.deepEqual(states, ['probing', 'disconnected']);
	const snap = session.snapshot();
	assert.equal(snap.error, null);
	assert.deepEqual(snap.usbIds, ['1314:1520', '1314:1521']);
	assert.equal(snap.nextAt, 1_000 + 3000);
	assert.deepEqual(timers.delays(), [3000]);
	await timers.fireAll();
	assert.deepEqual(states, ['probing', 'disconnected', 'probing', 'disconnected']);
	await session.stop();
});

test('replays a recorded CarPlay session: connect, phone, media, phone leaves', async () => {
	const stream = Buffer.concat(SESSION_ORDER.map(frameBytes));
	const { session, dongle, states, hw } = rig({ stream });
	const phones = [];
	const video = [];
	const audio = [];
	const info = [];
	dongle.onInfo((i) => info.push(i));
	dongle.onPhone((p) => phones.push(p));
	dongle.onVideo((v) => video.push(v));
	dongle.onAudio((a) => audio.push(a));

	await session.start();
	assert.deepEqual(states.slice(0, 2), ['probing', 'connected']);
	assert.equal(hw.device.resets, 1, 'reset once before claiming, as node-carplay requires');

	await until(() => phones.length === 2, 'plugged then unplugged');
	assert.deepEqual(phones, [{ type: 'carplay', wireless: true }, null]);
	assert.deepEqual(info, [{ firmware: 'version 1' }, { bluetoothAddress: '00:11:22:33:FF:EE' }], 'firmware and address reported for the owner log');

	assert.equal(video.length, 1);
	assert.equal(video[0].width, 800);
	assert.equal(video[0].height, 600);
	assert.equal(video[0].data.length, 512 - 20);

	const pcm = audio.find((a) => a.kind === 'pcm');
	assert.equal(pcm.sampleRate, 44100);
	assert.equal(pcm.channels, 2);
	assert.equal(pcm.samples.length, 250);
	assert.deepEqual(
		audio.find((a) => a.kind === 'command'),
		{ kind: 'command', audioType: 1, command: 'AudioOutputStart' },
	);
	assert.deepEqual(audio.find((a) => a.kind === 'volume'), { kind: 'volume', audioType: 1, volume: 0.5, duration: 0.5 });
	assert.equal(session.snapshot().phone, null, 'the phone left');

	// The init handshake went out over the OUT endpoint, framed by node-carplay.
	const types = hw.sent.map((b) => MessageHeader.fromBuffer(b.subarray(0, 16)).type);
	assert.ok(types.includes(MessageType.Open), 'sent Open');
	assert.ok(types.includes(MessageType.BoxSettings), 'sent BoxSettings');

	// A touch and a key reach the dongle as node-carplay frames.
	hw.sent.length = 0;
	assert.equal(dongle.sendTouch(0.5, 0.25, 'down'), true);
	assert.equal(dongle.sendKey('home'), true);
	assert.equal(dongle.sendKey('rm -rf'), false, 'unknown keys never reach the car');
	await until(() => hw.sent.length === 2, 'touch and key written');
	const touch = hw.sent[0];
	assert.equal(MessageHeader.fromBuffer(touch.subarray(0, 16)).type, MessageType.Touch);
	assert.deepEqual([touch.readUInt32LE(16), touch.readUInt32LE(20), touch.readUInt32LE(24)], [14, 5000, 2500]);
	assert.equal(hw.sent[1].readUInt32LE(16), CommandMapping.home);

	await session.stop();
	assert.equal(hw.device.opened, false, 'stop releases the dongle');
});

test('a dongle that stops answering lands in error, backs off, and recovers on retry', async () => {
	const { session, states, hw, usb, timers } = rig({ stream: frameBytes('software-version') });
	await session.start();
	assert.equal(session.snapshot().state, 'connected');

	usb.remove(hw.device);
	hw.unplug();
	await until(() => session.snapshot().state === 'error', 'error after the read loop gives up');
	const snap = session.snapshot();
	assert.match(snap.error, /stopped answering/);
	assert.equal(snap.attempts, 1);
	assert.deepEqual(timers.delays(), [2000]);

	// Still unplugged: the retry finds nothing, which is a state, not an error.
	assert.equal(await session.retryNow(), true);
	assert.equal(session.snapshot().state, 'disconnected');
	assert.equal(session.snapshot().attempts, 0);

	// Plugged back in: the next probe connects.
	const fresh = recordedDongle({ stream: frameBytes('software-version') });
	usb.plug(fresh.device);
	await timers.fireAll();
	assert.equal(session.snapshot().state, 'connected');
	assert.deepEqual(states.slice(-2), ['probing', 'connected']);
	await session.stop();
});

test('an open that fails retries with exponential backoff and explains a permissions fault', async () => {
	const { session, timers } = rig({ openError: new Error('LIBUSB_ERROR_ACCESS') });
	await session.start();
	let snap = session.snapshot();
	assert.equal(snap.state, 'error');
	assert.match(snap.error, /udev rule/);
	assert.deepEqual(timers.delays(), [2000]);
	await timers.fireAll();
	assert.deepEqual(timers.delays(), [4000]);
	await timers.fireAll();
	assert.deepEqual(timers.delays(), [8000]);
	snap = session.snapshot();
	assert.equal(snap.attempts, 3);
	await session.stop();
});

test('retry is refused while connected, so a stray tap cannot drop a live session', async () => {
	const { session } = rig({ stream: frameBytes('software-version') });
	await session.start();
	assert.equal(await session.retryNow(), false);
	assert.equal(session.snapshot().state, 'connected');
	await session.stop();
});
