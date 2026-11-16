// Audio2Face-3D emotion: the wire contract and the face/head layer.
//
// The fixture is a real hosted A2F response (tests/fixtures/a2f-emotion-response.json,
// captured 2026-11-16 from the live NVCF function): the same Magpie line animated
// with intent joy, intent sad and emotion off, plus three raw emotion_aggregate
// Any payloads exactly as grpc proto-loader hands them over. The gRPC transport
// is an in-process stand-in that replays those payloads, so the request
// building, metadata decoding and track assembly run for real; the live round
// trip is scripts/verify-nvidia-a2f.mjs.

import { describe, it, expect } from 'vitest';
import { EventEmitter } from 'node:events';
import { readFileSync } from 'node:fs';
import { Object3D, Bone, Quaternion } from 'three';
import { animateNvidiaA2F, createFunctionHealer } from '../api/_lib/a2f-nvidia.js';
import {
	decodeEmotionAggregate,
	EmotionTrackBuilder,
	emotionHeaderFields,
	toEmotionKeyframes,
} from '../api/_lib/a2f-emotion-wire.js';
import {
	A2F_EMOTIONS,
	intentToA2fEmotion,
	faceTargetsFor,
	sampleEmotionTrack,
	detectRigKind,
	EmotionLayer,
} from '../src/voice/a2f-emotion.js';
import { A2FPlayer } from '../src/voice/a2f-player.js';

const FIXTURE = JSON.parse(readFileSync(new URL('./fixtures/a2f-emotion-response.json', import.meta.url), 'utf8'));
const anyOf = (a) => ({ type_url: a.type_url, value: Buffer.from(a.value_b64, 'base64') });

function mean(track, name) {
	const i = track.blendShapeNames.findIndex((n) => n.toLowerCase() === name.toLowerCase());
	return track.frames.reduce((s, f) => s + f.w[i], 0) / track.frames.length;
}

describe('fixture: real A2F output with and without emotion', () => {
	it('emotion on visibly changes the face A2F returns for the same audio', () => {
		// The measured number for this feature: intent joy lifts the mean smile ~9x.
		const joy = mean(FIXTURE.joy, 'mouthSmileLeft');
		const off = mean(FIXTURE.off, 'mouthSmileLeft');
		expect(joy).toBeGreaterThan(0.2);
		expect(off).toBeLessThan(0.05);
		expect(joy / off).toBeGreaterThan(5);
	});

	it('A2F reports the emotion it applied, dominated by the intent', () => {
		expect(FIXTURE.joy.emotion.dominant).toBe('joy');
		expect(FIXTURE.joy.emotion.input).toEqual({ cheekiness: 0.15, joy: 0.85 });
		expect(FIXTURE.sad.emotion.dominant).toBe('sadness');
		expect(FIXTURE.off.emotion).toBe(null);
	});
});

describe('emotion_aggregate decoding', () => {
	it('decodes a real Any payload into input, Audio2Emotion and smoothed lists', () => {
		const agg = decodeEmotionAggregate(anyOf(FIXTURE.aggregates[0]));
		expect(agg.input[0].emotion.joy).toBeCloseTo(0.9, 3);
		expect(agg.smoothed.length).toBeGreaterThan(0);
		for (const k of Object.keys(agg.smoothed[0].emotion)) expect(A2F_EMOTIONS).toContain(k);
	});

	it('ignores payloads of another type and empty metadata', () => {
		expect(decodeEmotionAggregate(undefined)).toBe(null);
		expect(decodeEmotionAggregate({ type_url: 'type.googleapis.com/other.Msg', value: Buffer.alloc(0) })).toBe(null);
	});

	it('builds a time-sorted, de-duplicated track in A2F channel order', () => {
		const b = new EmotionTrackBuilder();
		// Feed out of order and twice: the track must still be sorted and unique.
		for (const a of [FIXTURE.aggregates[2], FIXTURE.aggregates[0], FIXTURE.aggregates[1], FIXTURE.aggregates[2]]) {
			b.addAnimationData({ metadata: { emotion_aggregate: anyOf(a) } });
		}
		const track = b.build();
		expect(track.names).toEqual([...A2F_EMOTIONS]);
		const ts = track.frames.map((f) => f.t);
		expect(ts).toEqual([...new Set(ts)].sort((x, y) => x - y));
		expect(track.input.joy).toBeCloseTo(0.9, 3);
		expect(track.peak.joy).toBeGreaterThan(0.2);
	});

	it('returns null when the stream carried no emotion', () => {
		expect(new EmotionTrackBuilder().build()).toBe(null);
	});
});

describe('emotion request fields', () => {
	it('off sends emotion_strength 0 and no preferred emotion', () => {
		expect(emotionHeaderFields({ enabled: false })).toEqual({
			emotion_post_processing_params: { emotion_strength: 0, enable_preferred_emotion: false, preferred_emotion_strength: 0 },
		});
	});

	it('an intent enables the preferred emotion and starts the stream in it', () => {
		const f = emotionHeaderFields({ strength: 0.8, hasInput: true, beginning: { joy: 0.7 } });
		expect(f.emotion_post_processing_params).toEqual({ emotion_strength: 0.8, enable_preferred_emotion: true, preferred_emotion_strength: 0.6 });
		expect(f.emotion_params).toEqual({ beginning_emotion: { joy: 0.7 } });
	});

	it('normalizes maps and keyframes, dropping unknown channels', () => {
		expect(toEmotionKeyframes({ Joy: 1.4, bogus: 1, anger: 0 })).toEqual([{ time_code: 0, emotion: { joy: 1 } }]);
		expect(toEmotionKeyframes([{ t: 1.5, emotion: { sadness: 0.5 } }, { t: 0, emotion: { joy: 0.5 } }]).map((k) => k.time_code)).toEqual([0, 1.5]);
		expect(toEmotionKeyframes(null)).toEqual([]);
	});
});

// A stand-in A2F service that records what was sent and answers with the real
// fixture frames plus the real emotion_aggregate payloads.
function fakeTransport() {
	const sent = [];
	const client = {
		processAudioStream() {
			const call = new EventEmitter();
			call.write = (msg) => {
				sent.push(msg);
				if (msg.end_of_audio) {
					setImmediate(() => {
						call.emit('data', { animation_data_stream_header: { skel_animation_header: { blend_shapes: FIXTURE.joy.blendShapeNames } } });
						FIXTURE.joy.frames.slice(0, 3).forEach((f, i) => {
							call.emit('data', {
								animation_data: {
									skel_animation: { blend_shape_weights: [{ time_code: f.t, values: f.w }] },
									metadata: FIXTURE.aggregates[i] ? { emotion_aggregate: anyOf(FIXTURE.aggregates[i]) } : {},
								},
							});
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
	const grpc = { Metadata: class { set() {} get() { return []; } } };
	return { sent, getClient: async () => ({ grpc, client }) };
}

function pcm(seconds) {
	return Buffer.alloc(Math.round(16000 * seconds) * 2);
}

describe('animateNvidiaA2F emotion round trip', () => {
	const healer = createFunctionHealer({ listFunctions: async () => [] });

	it('sends the intent on the first audio message only and returns the applied track', async () => {
		const t = fakeTransport();
		const out = await animateNvidiaA2F(
			{ pcm: pcm(2.5), sampleRateHz: 16000, apiKey: 'k', emotion: { input: { joy: 0.85 }, strength: 0.7 } },
			{ getClient: t.getClient, healer },
		);
		const header = t.sent[0].audio_stream_header;
		expect(header.emotion_post_processing_params.emotion_strength).toBe(0.7);
		expect(header.emotion_post_processing_params.enable_preferred_emotion).toBe(true);
		expect(header.emotion_params.beginning_emotion).toEqual({ joy: 0.85 });
		const audio = t.sent.filter((m) => m.audio_with_emotion).map((m) => m.audio_with_emotion);
		expect(audio.length).toBe(3);
		expect(audio[0].emotions).toEqual([{ time_code: 0, emotion: { joy: 0.85 } }]);
		expect(audio[1].emotions).toBeUndefined();
		expect(out.emotion.names).toEqual([...A2F_EMOTIONS]);
		expect(out.emotion.frames.length).toBeGreaterThan(0);
		expect(out.frameCount).toBe(3);
	});

	it('emotion off asks A2F for a neutral face and returns no emotion track', async () => {
		const t = fakeTransport();
		const out = await animateNvidiaA2F(
			{ pcm: pcm(1), sampleRateHz: 16000, apiKey: 'k', emotion: { enabled: false, input: { joy: 1 } } },
			{ getClient: t.getClient, healer },
		);
		expect(t.sent[0].audio_stream_header.emotion_post_processing_params.emotion_strength).toBe(0);
		expect(out.emotion).toBe(null);
	});

	it('a corrupt emotion payload never costs the animation', async () => {
		const t = fakeTransport();
		const real = FIXTURE.aggregates[0];
		FIXTURE.aggregates[0] = { type_url: real.type_url, value_b64: Buffer.from([0xff, 0xff, 0xff]).toString('base64') };
		try {
			const out = await animateNvidiaA2F({ pcm: pcm(1), sampleRateHz: 16000, apiKey: 'k' }, { getClient: t.getClient, healer });
			expect(out.frameCount).toBe(3);
			expect(typeof out.emotionError).toBe('string');
		} finally {
			FIXTURE.aggregates[0] = real;
		}
	});
});

describe('agent intent → A2F emotion input', () => {
	it('maps the agent vocabulary, scaled by intensity', () => {
		expect(intentToA2fEmotion('joy')).toEqual({ off: false, label: 'joy', emotion: { joy: 0.85, cheekiness: 0.15 } });
		expect(intentToA2fEmotion('concern', 0.5).emotion).toEqual({ sadness: 0.225, fear: 0.175 });
		expect(intentToA2fEmotion('Anger').emotion).toEqual({ anger: 0.85 });
		expect(intentToA2fEmotion('thinking').emotion).toEqual({});
	});

	it('recognises the off switch and ignores unknown labels', () => {
		expect(intentToA2fEmotion('off').off).toBe(true);
		expect(intentToA2fEmotion('melancholic')).toEqual({ off: false, label: null, emotion: {} });
		expect(intentToA2fEmotion({ grief: 0.4, joy: 0.1 }).label).toBe('grief');
	});
});

// ── Rig layer ───────────────────────────────────────────────────────────────

function morphMesh(name, morphNames) {
	const m = new Object3D();
	m.isMesh = true;
	m.name = name;
	m.morphTargetDictionary = Object.fromEntries(morphNames.map((n, i) => [n, i]));
	m.morphTargetInfluences = new Array(morphNames.length).fill(0);
	return m;
}

function rigWithHead(meshes) {
	const root = new Object3D();
	const hips = new Bone();
	hips.name = 'Hips';
	const neck = new Bone();
	neck.name = 'Neck';
	neck.rotation.set(0.2, 0.1, 0); // a non-identity parent frame
	const head = new Bone();
	head.name = 'Head';
	const eyeL = new Bone();
	eyeL.name = 'LeftEye';
	root.add(hips);
	hips.add(neck);
	neck.add(head);
	head.add(eyeL);
	for (const m of meshes) root.add(m);
	root.updateMatrixWorld(true);
	return { root, head, eyeL };
}

const ARKIT_FACE = ['jawOpen', 'mouthSmileLeft', 'cheekSquintLeft', 'cheekSquintRight', 'eyeSquintLeft', 'browInnerUp', 'browDownLeft', 'browOuterUpLeft'];

function play(player, track, until = track.durationSec) {
	for (let t = 0; t <= until; t += 1 / 60) player.update(t);
}

describe('EmotionLayer · face targets', () => {
	it('stays off the mouth and jaw', () => {
		const all = faceTargetsFor(Object.fromEntries(A2F_EMOTIONS.map((e) => [e, 1])));
		for (const k of Object.keys(all)) expect(k).not.toMatch(/^(mouth|jaw|tongue)/);
	});

	it('samples and interpolates an emotion track', () => {
		const track = { names: ['joy'], frames: [{ t: 0, v: [0] }, { t: 1, v: [1] }] };
		expect(sampleEmotionTrack(track, 0.25).joy).toBeCloseTo(0.25, 5);
		expect(sampleEmotionTrack(track, 5).joy).toBe(1);
	});
});

describe('A2FPlayer · emotion on an ARKit rig (real fixture)', () => {
	function setup(enabled) {
		const face = morphMesh('Face', ARKIT_FACE);
		const { root, head } = rigWithHead([face]);
		const p = new A2FPlayer();
		p.attach(root);
		p.setEmotionOptions({ enabled, strength: 1 });
		p.setTrack(FIXTURE.joy);
		return { p, face, head };
	}

	it('is detected as an ARKit rig', () => {
		const { p } = setup(true);
		expect(p.rigKind).toBe('arkit');
	});

	it('lifts the cheeks above what A2F alone drives, and only when enabled', () => {
		const on = setup(true);
		const off = setup(false);
		play(on.p, FIXTURE.joy, 2);
		play(off.p, FIXTURE.joy, 2);
		const idx = on.face.morphTargetDictionary.cheekSquintLeft;
		expect(on.face.morphTargetInfluences[idx]).toBeGreaterThan(off.face.morphTargetInfluences[idx] + 0.05);
		// The mouth stays exactly A2F's: the layer never writes it.
		const smile = on.face.morphTargetDictionary.mouthSmileLeft;
		expect(on.face.morphTargetInfluences[smile]).toBeCloseTo(off.face.morphTargetInfluences[smile], 6);
	});

	it('tilts the head while speaking, and restores the rest pose on reset', () => {
		const { p, head } = setup(true);
		const rest = head.quaternion.clone();
		play(p, FIXTURE.joy, 2);
		expect(head.quaternion.angleTo(rest)).toBeGreaterThan(0.005);
		expect(head.quaternion.angleTo(rest)).toBeLessThan(0.2); // subtle
		p.reset();
		expect(head.quaternion.angleTo(rest)).toBeLessThan(1e-6);
	});

	it('layers on top of an animation clip without accumulating', () => {
		const { p, head } = setup(true);
		const clipPose = new Quaternion().setFromAxisAngle({ x: 0, y: 1, z: 0, isVector3: true }, 0.3);
		const angles = [];
		for (let t = 0; t <= 2; t += 1 / 60) {
			head.quaternion.copy(clipPose); // the mixer rewrites the bone each frame
			p.update(t);
			angles.push(head.quaternion.angleTo(clipPose));
		}
		// Bounded offset from the clip pose every frame (no drift away from it).
		expect(Math.max(...angles)).toBeLessThan(0.2);
		expect(Math.max(...angles.slice(-30))).toBeGreaterThan(0.005);
	});

	it('leaves the head alone with emotion off', () => {
		const { p, head } = setup(false);
		const rest = head.quaternion.clone();
		play(p, FIXTURE.joy, 2);
		expect(head.quaternion.angleTo(rest)).toBeLessThan(1e-6);
	});
});

describe('A2FPlayer · emotion on a viseme rig', () => {
	it('drives the single smile morph and the head on an Oculus viseme rig', () => {
		const face = morphMesh('Wolf3D_Head', ['viseme_sil', 'viseme_aa', 'viseme_O', 'viseme_E', 'mouthOpen', 'mouthSmile', 'eyesLookDown']);
		const { root, head } = rigWithHead([face]);
		const p = new A2FPlayer();
		p.attach(root);
		expect(p.rigKind).toBe('viseme');
		expect(p.hasCoverage()).toBe(true);
		p.setEmotionOptions({ enabled: true, strength: 1 });
		p.setTrack(FIXTURE.joy);
		const rest = head.quaternion.clone();
		play(p, FIXTURE.joy, 2);
		expect(face.morphTargetInfluences[face.morphTargetDictionary.mouthSmile]).toBeGreaterThan(0.05);
		expect(head.quaternion.angleTo(rest)).toBeGreaterThan(0.005);
	});

	it('lowers the gaze for a sad line', () => {
		const { root, eyeL } = rigWithHead([morphMesh('Head', ['viseme_aa'])]);
		const layer = new EmotionLayer();
		layer.attach(root);
		layer.setOptions({ enabled: true, strength: 1 });
		layer.setTrack(FIXTURE.sad.emotion);
		const rest = eyeL.quaternion.clone();
		for (let t = 0; t < 2; t += 1 / 60) {
			layer.sample(t, 1 / 60);
			layer.applyRig({}, 1 / 60);
		}
		expect(eyeL.quaternion.angleTo(rest)).toBeGreaterThan(0.01);
	});
});

describe('A2FPlayer · VRM expression rig', () => {
	function vrmRig() {
		const values = {};
		const presets = new Set(['aa', 'ih', 'ou', 'ee', 'oh', 'blink', 'happy', 'angry', 'sad', 'relaxed', 'surprised']);
		const expressionManager = {
			getExpression: (n) => (presets.has(n) ? { name: n } : null),
			setValue: (n, v) => {
				values[n] = v;
			},
		};
		// VRoid face: every morph is Fcl_* and only reachable through presets.
		const face = morphMesh('Face', ['Fcl_MTH_A', 'Fcl_MTH_I', 'Fcl_ALL_Joy']);
		const { root, head } = rigWithHead([face]);
		root.userData.vrm = { expressionManager, humanoid: { getRawBoneNode: (b) => (b === 'head' ? head : null) } };
		return { root, head, values };
	}

	it('gives a VRoid-style VRM lip-sync coverage through expression presets', () => {
		const { root } = vrmRig();
		const p = new A2FPlayer();
		p.attach(root);
		expect(detectRigKind(root)).toBe('vrm');
		expect(p.hasCoverage()).toBe(true);
	});

	it('drives the visemes and the happy preset from a joyful line', () => {
		const { root, head, values } = vrmRig();
		const p = new A2FPlayer();
		p.attach(root);
		p.setEmotionOptions({ enabled: true, strength: 1 });
		p.setTrack(FIXTURE.joy);
		const rest = head.quaternion.clone();
		let maxAa = 0;
		for (let t = 0; t <= 2.5; t += 1 / 60) {
			p.update(t);
			maxAa = Math.max(maxAa, values.aa || 0);
		}
		expect(maxAa).toBeGreaterThan(0.1);
		expect(values.happy).toBeGreaterThan(0.05);
		expect(head.quaternion.angleTo(rest)).toBeGreaterThan(0.005);
		p.reset();
		expect(values.happy).toBe(0);
	});

	it('keeps the emotion presets at zero with emotion off', () => {
		const { root, values } = vrmRig();
		const p = new A2FPlayer();
		p.attach(root);
		p.setEmotionOptions({ enabled: false });
		p.setTrack(FIXTURE.joy);
		play(p, FIXTURE.joy, 2);
		expect(values.happy || 0).toBe(0);
	});
});
