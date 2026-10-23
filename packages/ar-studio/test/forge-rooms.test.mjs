// Generation and shared-room plumbing: the safety gate, the pending-job loop,
// and the coordinate frame two devices have to agree on.

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { checkPromptSafety, validatePrompt } from '../src/forge/safety.js';
import { stageNarration, promptTitle, laneLabel } from '../src/forge/narration.js';
import { createForgeClient, ForgeError } from '../src/forge/client.js';
import { unwrapToolResult } from '../src/forge/mcp-http.js';
import {
	generateRoomCode, normalizeRoomCode, roomKeyForCode, roomShareUrl,
	localToShared, sharedToLocal, normDeg, normRad,
} from '../src/studio/coords.js';
import {
	createPinchState, pinchStart, pinchMove, pinchEnd, clampPinScale,
	PINCH_SCALE_MAX, PINCH_SCALE_MIN, PINCH_DEADZONE_PX,
} from '../src/studio/pinch.js';

test('the safety gate refuses the highest-harm categories and lets creative work through', () => {
	for (const allowed of ['a brass desk lamp', 'a knight with a sword', 'an assassin bug', 'a CP/M terminal', 'a scunthorpe road sign']) {
		assert.equal(checkPromptSafety(allowed).allowed, true, allowed);
	}
	for (const [prompt, category] of [['a nude figure', 'sexual'], ['a dismembered body', 'gore'], ['a swastika banner', 'hate'], ['an AK-47', 'weapon_drug']]) {
		const verdict = checkPromptSafety(prompt);
		assert.equal(verdict.allowed, false, prompt);
		assert.equal(verdict.category, category);
		assert.ok(verdict.message.length > 20, 'a refusal must say what to do instead');
	}
});

test('validatePrompt rejects the too-short as well as the disallowed', () => {
	assert.equal(validatePrompt('ab').ok, false);
	assert.equal(validatePrompt('  a lamp  ').prompt, 'a lamp');
	assert.equal(validatePrompt('a nude figure').ok, false);
});

test('narration never invents a stage or a number', () => {
	assert.match(stageNarration({ status: 'queued' }), /Queued on the free lane/);
	assert.match(stageNarration({ status: 'queued', etaSeconds: 42 }), /~42s/);
	// No ETA reported means no ETA shown.
	assert.ok(!stageNarration({ status: 'running' }).includes('~'));
	assert.match(stageNarration({ status: 'queued', coldStart: true, coldSeconds: 30, backend: 'nvidia' }), /Waking up the free NVIDIA NIM GPU worker \(about 30s\)/);
	assert.match(stageNarration({ status: 'failed' }), /try a more concrete/);
	assert.equal(laneLabel('nvidia'), 'free NVIDIA NIM');
	assert.equal(laneLabel('nope'), null);
});

test('a card label is the first clause of a long prompt, never a mid-word cut', () => {
	assert.equal(promptTitle('a brass desk lamp, mid-century, glossy'), 'a brass desk lamp');
	assert.ok(!promptTitle('a'.repeat(80)).includes(' '));
	assert.equal(promptTitle(''), 'Model');
});

test('the forge client polls a pending job through check_job until it lands', async () => {
	const calls = [];
	const fetchImpl = async (_url, init) => {
		const body = JSON.parse(init.body);
		calls.push(body.params.name);
		const result = calls.length === 1
			? { structuredContent: { status: 'pending', jobId: 'job-1', etaRemainingSeconds: 5 }, content: [] }
			: { structuredContent: { glbUrl: 'https://cdn.example.com/out.glb', viewerUrl: 'https://v/x', arUrl: 'https://a/x' }, content: [] };
		return {
			ok: true,
			headers: new Map([['content-type', 'application/json']]),
			json: async () => ({ jsonrpc: '2.0', id: body.id, result }),
		};
	};
	const client = createForgeClient({ pollMs: 1, fetchImpl });
	const seen = [];
	const model = await client.generate('a brass desk lamp', { onProgress: (s) => seen.push(s.status) });
	assert.deepEqual(calls, ['forge_free', 'check_job']);
	assert.equal(model.src, 'https://cdn.example.com/out.glb');
	assert.ok(seen.includes('submitting') && seen.includes('queued') && seen.includes('done'));
});

test('a generator error surfaces as a ForgeError with the server\'s own message', async () => {
	const fetchImpl = async (_url, init) => ({
		ok: true,
		headers: new Map([['content-type', 'application/json']]),
		json: async () => ({
			jsonrpc: '2.0',
			id: JSON.parse(init.body).id,
			result: { isError: true, structuredContent: { message: 'The 3D generator is busy right now.' }, content: [] },
		}),
	});
	const client = createForgeClient({ fetchImpl });
	await assert.rejects(
		client.generate('a brass desk lamp'),
		(err) => err instanceof ForgeError && /busy/.test(err.message),
	);
});

test('the client speaks the SSE half of streamable HTTP too', async () => {
	const fetchImpl = async (_url, init) => ({
		ok: true,
		headers: new Map([['content-type', 'text/event-stream']]),
		text: async () => `event: message\ndata: ${JSON.stringify({
			jsonrpc: '2.0',
			id: JSON.parse(init.body).id,
			result: { structuredContent: { glbUrl: 'https://cdn.example.com/sse.glb' }, content: [] },
		})}\n\n`,
	});
	const client = createForgeClient({ fetchImpl });
	assert.equal((await client.generate('a teapot')).src, 'https://cdn.example.com/sse.glb');
});

test('unwrapToolResult pulls out both halves of a tool result', () => {
	const unwrapped = unwrapToolResult({ content: [{ type: 'text', text: 'hi' }], structuredContent: { a: 1 } });
	assert.deepEqual(unwrapped, { structured: { a: 1 }, text: 'hi', isError: false });
});

test('room codes are unambiguous, and typos are rejected rather than guessed at', () => {
	const code = generateRoomCode(() => 0.5);
	assert.equal(code.length, 6);
	assert.ok(!/[01OIL]/.test(code), 'the alphabet must have no look-alike glyphs');
	assert.equal(normalizeRoomCode(' abc-234 '), 'ABC234');
	assert.equal(normalizeRoomCode('https://acme.com/ar/?room=ABC234'), 'ABC234');
	assert.equal(normalizeRoomCode('ABC23'), '', 'too short is a mistype, not a near miss');
	assert.equal(normalizeRoomCode('ABC2O4'), '', 'a letter the generator never emits is a mistype');
	assert.equal(roomKeyForCode('abc234'), 'c-ABC234');
	assert.equal(roomShareUrl('https://acme.com/ar/', 'abc234'), 'https://acme.com/ar/?room=ABC234');
	assert.equal(roomShareUrl('https://acme.com/ar/', 'nope'), 'https://acme.com/ar/');
});

test('a transform survives the trip through the shared logical frame', () => {
	const local = { x: 1.5, z: -2.25, yaw: Math.PI / 3, scale: 1.4, height: 1.7 };
	const back = sharedToLocal(localToShared(local));
	assert.ok(Math.abs(back.x - local.x) < 1e-9);
	assert.ok(Math.abs(back.z - local.z) < 1e-9);
	assert.ok(Math.abs(back.yaw - local.yaw) < 1e-9);
	assert.equal(back.scale, 1.4);
	// Forward (-z) is north, so a model in front of you is north of you.
	assert.ok(localToShared({ x: 0, z: -2, yaw: 0 }).relNorth > 0);
	assert.equal(normDeg(-90), 270);
	assert.ok(Math.abs(normRad(-Math.PI) - Math.PI) < 1e-9);
});

test('pinch scaling composes across gestures and clamps at both ends', () => {
	const p = createPinchState();
	assert.equal(pinchStart(p, 10, 1), false, 'a palm-width spread is not a pinch');
	assert.equal(pinchStart(p, 100, 1), true);
	assert.ok(Math.abs(pinchMove(p, 200) - 2) < 1e-9);
	assert.equal(pinchEnd(p), 2);
	// A second pinch starts from where the first left off.
	pinchStart(p, 100, 2);
	assert.ok(Math.abs(pinchMove(p, 150) - 3) < 1e-9);
	assert.equal(pinchMove(p, 100000), PINCH_SCALE_MAX);
	assert.equal(pinchMove(p, 1), PINCH_SCALE_MIN);
	assert.equal(pinchEnd(createPinchState()), null, 'a plain tap has nothing to persist');
	assert.equal(clampPinScale(null), 1);
	assert.equal(clampPinScale(99), PINCH_SCALE_MAX);
	assert.ok(PINCH_DEADZONE_PX > 0);
});
