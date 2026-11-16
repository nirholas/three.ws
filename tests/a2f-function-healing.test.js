// The Audio2Face lane survives NVIDIA rotating the hosted function id.
//
// Bug this pins (2026 history, twice): NVIDIA retires the NVCF function behind
// `ai-a2x-service` and the pinned id starts answering gRPC 5 NOT_FOUND ("Not
// found for account"). Every /api/a2f call then 502'd until someone noticed,
// ran scripts/verify-nvidia-a2f.mjs --list by hand, and redeployed with a new
// NVIDIA_A2F_FUNCTION_ID. On 2026-11-16 the pinned id 462f7853 was again listed
// INACTIVE/DEGRADING while 945ed566 was ACTIVE. The lane must notice the
// rotation, discover the ACTIVE function from NVCF's own function list, retry on
// it, and remember it, without a deploy.
//
// The gRPC transport is replaced by an in-process stand-in that speaks the same
// call surface grpc-js exposes (write/end/cancel + data/error/end events), so
// the healing loop runs for real; the live round trip is
// scripts/verify-nvidia-a2f.mjs.

import { describe, it, expect } from 'vitest';
import { EventEmitter } from 'node:events';
import {
	animateNvidiaA2F,
	openA2fSession,
	createFunctionHealer,
	pickActiveA2fFunction,
	isFunctionRotationError,
	StreamingResampler,
} from '../api/_lib/a2f-nvidia.js';

const DEAD = '9327c39f-a361-4e02-bd72-e11b4c9b7b5e';
const DEGRADING = '462f7853-60e8-474a-9728-7b598e58472c';
const ACTIVE = '945ed566-a023-4677-9a49-61ede107fd5a';

// NVCF's real /v2/nvcf/functions shape: one row per function VERSION.
const LISTING = [
	{
		id: '877104f7-e885-42b9-8de8-f6e4c6303969',
		status: 'ACTIVE',
		name: 'ai-magpie-tts-multilingual',
	},
	{ id: DEGRADING, status: 'INACTIVE', name: 'ai-a2x-service' },
	{ id: ACTIVE, status: 'ACTIVE', name: 'ai-a2x-service' },
	{ id: DEGRADING, status: 'DEGRADING', name: 'ai-a2x-service' },
	{ id: ACTIVE, status: 'INACTIVE', name: 'ai-a2x-service' },
];

function wav16k(seconds = 0.5) {
	const samples = Math.round(16000 * seconds);
	const buf = Buffer.alloc(44 + samples * 2);
	buf.write('RIFF', 0);
	buf.writeUInt32LE(36 + samples * 2, 4);
	buf.write('WAVE', 8);
	buf.write('fmt ', 12);
	buf.writeUInt32LE(16, 16);
	buf.writeUInt16LE(1, 20);
	buf.writeUInt16LE(1, 22);
	buf.writeUInt32LE(16000, 24);
	buf.writeUInt32LE(32000, 28);
	buf.writeUInt16LE(2, 32);
	buf.writeUInt16LE(16, 34);
	buf.write('data', 36);
	buf.writeUInt32LE(samples * 2, 40);
	for (let i = 0; i < samples; i++)
		buf.writeInt16LE(Math.round(Math.sin(i / 8) * 8000), 44 + i * 2);
	return buf;
}

// A stand-in A2F service: `live` ids animate, everything else is NOT_FOUND,
// exactly the failure NVCF returns for a retired function.
function fakeA2fTransport(live) {
	const calls = [];
	const client = {
		processAudioStream(metadata) {
			const fnId = metadata.get('function-id')[0];
			const call = new EventEmitter();
			const record = { fnId, audioBytes: 0 };
			calls.push(record);
			call.write = (msg) => {
				if (msg.audio_with_emotion)
					record.audioBytes += msg.audio_with_emotion.audio_buffer.length;
				if (msg.end_of_audio) {
					setImmediate(() => {
						if (!live.has(fnId)) {
							call.emit('error', {
								code: 5,
								details: `failed to open stateful work request: Function '${fnId}': Not found for account 'x'`,
							});
							return;
						}
						call.emit('data', {
							animation_data_stream_header: {
								skel_animation_header: { blend_shapes: ['JawOpen', 'MouthClose'] },
							},
						});
						call.emit('data', {
							animation_data: {
								skel_animation: {
									blend_shape_weights: [
										{ time_code: 0, values: [0.1, 0] },
										{ time_code: 1 / 30, values: [0.6, 0] },
									],
								},
							},
						});
						call.emit('end');
					});
				}
				return true;
			};
			call.end = () => {};
			call.cancel = () => {};
			return call;
		},
	};
	const grpc = {
		Metadata: class {
			constructor() {
				this.m = new Map();
			}
			set(k, v) {
				this.m.set(k, [v]);
			}
			get(k) {
				return this.m.get(k) || [];
			}
		},
	};
	return { calls, getClient: async () => ({ grpc, client }) };
}

describe('pickActiveA2fFunction', () => {
	it('picks the ai-a2x-service id that has an ACTIVE version', () => {
		expect(pickActiveA2fFunction(LISTING)).toBe(ACTIVE);
	});

	it('never hands back the id that just failed', () => {
		const onlyFailing = LISTING.filter((f) => f.id !== ACTIVE);
		expect(pickActiveA2fFunction(onlyFailing, { exclude: DEGRADING })).toBe(null);
	});

	it('ignores non-A2F functions even when ACTIVE', () => {
		expect(
			pickActiveA2fFunction([
				{ id: 'x', status: 'ACTIVE', name: 'ai-magpie-tts-multilingual' },
			]),
		).toBe(null);
	});
});

describe('isFunctionRotationError', () => {
	it('treats NOT_FOUND and an unavailable function as rotation', () => {
		expect(isFunctionRotationError({ grpcCode: 5 })).toBe(true);
		expect(isFunctionRotationError({ grpcCode: 14, message: 'function is inactive' })).toBe(
			true,
		);
		expect(isFunctionRotationError({ message: "Function 'abc': Not found for account" })).toBe(
			true,
		);
	});

	it('does not treat throttling, auth or bad input as rotation', () => {
		expect(isFunctionRotationError({ grpcCode: 8 })).toBe(false);
		expect(isFunctionRotationError({ grpcCode: 16 })).toBe(false);
		expect(isFunctionRotationError({ grpcCode: 3 })).toBe(false);
	});
});

describe('animateNvidiaA2F self-heals a rotated function id', () => {
	it('recovers from NOT_FOUND by discovering the ACTIVE function and retrying', async () => {
		const transport = fakeA2fTransport(new Set([ACTIVE]));
		const healer = createFunctionHealer({ listFunctions: async () => LISTING });
		const out = await animateNvidiaA2F(
			{ wav: wav16k(), functionId: DEAD, apiKey: 'nvapi-test' },
			{ getClient: transport.getClient, healer },
		);
		expect(out.frameCount).toBe(2);
		expect(out.functionId).toBe(ACTIVE);
		expect(out.healedFrom).toBe(DEAD);
		expect(transport.calls.map((c) => c.fnId)).toEqual([DEAD, ACTIVE]);
		// The retry replays the whole clip, not just what was left.
		expect(transport.calls[1].audioBytes).toBe(transport.calls[0].audioBytes);
	});

	it('remembers the healed id so the next call goes straight to it', async () => {
		const transport = fakeA2fTransport(new Set([ACTIVE]));
		const healer = createFunctionHealer({ listFunctions: async () => LISTING });
		await animateNvidiaA2F(
			{ wav: wav16k(), functionId: DEAD, apiKey: 'k' },
			{ getClient: transport.getClient, healer },
		);
		await animateNvidiaA2F(
			{ wav: wav16k(), functionId: DEAD, apiKey: 'k' },
			{ getClient: transport.getClient, healer },
		);
		expect(transport.calls.map((c) => c.fnId)).toEqual([DEAD, ACTIVE, ACTIVE]);
		expect(healer.state()).toMatchObject({ healedId: ACTIVE, from: DEAD });
	});

	it('surfaces the original error when no ACTIVE replacement exists', async () => {
		const transport = fakeA2fTransport(new Set());
		const healer = createFunctionHealer({ listFunctions: async () => [] });
		await expect(
			animateNvidiaA2F(
				{ wav: wav16k(), functionId: DEAD, apiKey: 'k' },
				{ getClient: transport.getClient, healer },
			),
		).rejects.toMatchObject({ grpcCode: 5 });
	});

	it('does not retry when the failure is not a rotation', async () => {
		let listed = 0;
		const transport = fakeA2fTransport(new Set([ACTIVE]));
		const healer = createFunctionHealer({
			listFunctions: async () => {
				listed++;
				return LISTING;
			},
		});
		const out = await animateNvidiaA2F(
			{ wav: wav16k(), functionId: ACTIVE, apiKey: 'k' },
			{ getClient: transport.getClient, healer },
		);
		expect(out.functionId).toBe(ACTIVE);
		expect(listed).toBe(0);
	});
});

describe('openA2fSession streams frames and heals mid-stream', () => {
	it('replays the buffered audio on the discovered function when the first one is gone', async () => {
		const transport = fakeA2fTransport(new Set([ACTIVE]));
		const healer = createFunctionHealer({ listFunctions: async () => LISTING });
		const frames = [];
		let names = null;
		const session = await openA2fSession(
			{
				functionId: DEAD,
				apiKey: 'k',
				onHeader: (n) => {
					names = n;
				},
				onFrames: (f) => frames.push(...f),
			},
			{ getClient: transport.getClient, healer },
		);
		const pcm = new Int16Array(16000).fill(1200);
		session.write(pcm.subarray(0, 8000));
		session.write(pcm.subarray(8000));
		session.end();
		const result = await session.done;
		expect(names).toEqual(['JawOpen', 'MouthClose']);
		expect(frames).toHaveLength(2);
		expect(result.functionId).toBe(ACTIVE);
		expect(result.healedFrom).toBe(DEAD);
		expect(transport.calls[1].audioBytes).toBe(32000);
	});
});

describe('StreamingResampler', () => {
	it('resamples a chunked stream to the same length as one whole-buffer pass', () => {
		const src = new Int16Array(44100);
		for (let i = 0; i < src.length; i++) src[i] = Math.round(Math.sin(i / 20) * 10000);
		const rs = new StreamingResampler(44100, 16000);
		let total = 0;
		for (let i = 0; i < src.length; i += 4410)
			total += rs.push(src.subarray(i, i + 4410)).length;
		expect(Math.abs(total - 16000)).toBeLessThanOrEqual(1);
	});

	it('is continuous across chunk boundaries', () => {
		const src = new Int16Array(4410);
		for (let i = 0; i < src.length; i++) src[i] = i * 4;
		const rs = new StreamingResampler(44100, 16000);
		const out = [...rs.push(src.subarray(0, 1000)), ...rs.push(src.subarray(1000))];
		for (let i = 1; i < out.length; i++) {
			const step = out[i] - out[i - 1];
			expect(step).toBeGreaterThan(9);
			expect(step).toBeLessThan(13);
		}
	});
});
