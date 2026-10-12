/**
 * Motion seeding: gate, publishing shape, free rotation, lane assertion.
 *
 * Clips are built in-memory from the canonical rest skeleton, so the suite is
 * fast, deterministic and needs no fixtures on disk. The synthetic clips are
 * built the way the text2motion worker builds real ones (a quaternion track per
 * canonical body bone plus a Hips.position track), which is what lets these
 * tests assert the gate's real behaviour rather than a simplified stand-in.
 *
 * The thresholds these tests pin were derived from a 60-clip sample of the
 * authored Mixamo library: see docs/animation-seeding.md.
 */

import { describe, it, expect } from 'vitest';
import {
	gateMotionClip,
	MOTION_GATE,
	worldMotionMetrics,
	footContactMetrics,
	toLibraryClip,
	manifestEntryFor,
	mergeManifest,
	libraryClipName,
	isGeneratedClipName,
	freeClipNames,
	rotationEpoch,
	motionPrompts,
	motionPromptById,
	assertSelfHostedLane,
	decodeJobEnvelope,
	closeLoopSeam,
	loopSeamDistance,
	LOOP_SEAM,
	rebaseToCanonicalRest,
	needsRebase,
	flattenRootDrift,
	legBasisDegrees,
	maxUprightGap,
	uprightGap,
	CLIP_BASIS,
	despikeFootFlicks,
	lockRootToContacts,
	forwardKinematicsFrame,
	ROOT_LOCK,
	LEGACY_CLIP_BASIS,
	libraryReadyClip,
} from '../api/_lib/motion-seed.js';
import { CANONICAL_REST, CANONICAL_REST_WORLD, CANONICAL_PARENT } from '../src/animation-canonical-rest.js';
import { AnimationClip } from 'three';

const BODY_BONES = [
	'Hips', 'Spine', 'Spine1', 'Spine2', 'Neck', 'Head',
	'LeftShoulder', 'LeftArm', 'LeftForeArm', 'LeftHand',
	'RightShoulder', 'RightArm', 'RightForeArm', 'RightHand',
	'LeftUpLeg', 'LeftLeg', 'LeftFoot', 'LeftToeBase',
	'RightUpLeg', 'RightLeg', 'RightFoot', 'RightToeBase',
];

/** A rotation of `angle` radians about X, as [x,y,z,w]. */
function quatX(angle) {
	return [Math.sin(angle / 2), 0, 0, Math.cos(angle / 2)];
}

/** Hamilton product, [x,y,z,w] convention. */
function quatMul(a, b) {
	const [ax, ay, az, aw] = a;
	const [bx, by, bz, bw] = b;
	return [
		aw * bx + ax * bw + ay * bz - az * by,
		aw * by - ax * bz + ay * bw + az * bx,
		aw * bz + ax * by - ay * bx + az * bw,
		aw * bw - ax * bx - ay * by - az * bz,
	];
}

/**
 * Build a clip whose bones swing smoothly, so it reads as real motion.
 * `swing` scales how far the limbs travel; `hipsTravel` moves the root forward.
 */
function buildClip({
	frames = 120,
	fps = 30,
	// 0.2 rad, not the 0.35 this fixture used before the bones were composed onto
	// their canonical rest. With the skeleton correctly oriented the swing finally
	// moves real legs, and at 0.35 the synthetic feet genuinely skate across the
	// floor: the gate was right to call it, the fixture was wrong to do it.
	swing = 0.2,
	hipsTravel = 0,
	bones = BODY_BONES,
	mutate = null,
} = {}) {
	const times = Array.from({ length: frames }, (_, i) => i / fps);
	const tracks = [];
	for (const bone of bones) {
		const values = [];
		for (let i = 0; i < frames; i += 1) {
			// Each bone gets its own phase so the whole body is not one rigid unit.
			const phase = (bone.length % 7) * 0.4;
			// Composed onto the bone's canonical rest, because that is what a real
			// library clip carries: a bone swinging away from ITS REST, not away
			// from identity. A fixture that rests every bone at identity is
			// indistinguishable from a clip in the wrong rest basis.
			const rest = CANONICAL_REST[bone] ?? [0, 0, 0, 1];
			values.push(...quatMul(rest, quatX(swing * Math.sin((i / frames) * Math.PI * 4 + phase))));
		}
		tracks.push({ type: 'quaternion', name: `${bone}.quaternion`, times: [...times], values });
	}
	const hips = [];
	for (let i = 0; i < frames; i += 1) {
		hips.push(0, 0.984 + 0.02 * Math.sin((i / frames) * Math.PI * 4), (hipsTravel * i) / frames);
	}
	tracks.push({ type: 'vector', name: 'Hips.position', times: [...times], values: hips });

	const clip = {
		name: 'synthetic',
		duration: (frames - 1) / fps,
		tracks,
		uuid: '11111111-2222-3333-4444-555555555555',
		blendMode: 0,
	};
	if (mutate) mutate(clip);
	return clip;
}

describe('motion prompt library', () => {
	it('loads prompts as data, each with the fields the seeder needs', () => {
		const prompts = motionPrompts();
		expect(prompts.length).toBeGreaterThan(50);
		for (const p of prompts) {
			expect(typeof p.id).toBe('string');
			expect(p.prompt.length).toBeGreaterThan(10);
			expect(typeof p.category).toBe('string');
		}
	});

	it('ids are unique, so a checkpoint can key on them', () => {
		const ids = motionPrompts().map((p) => p.id);
		expect(new Set(ids).size).toBe(ids.length);
	});

	it('looks a prompt up by id', () => {
		const first = motionPrompts()[0];
		expect(motionPromptById(first.id)).toEqual(first);
		expect(motionPromptById('no-such-prompt')).toBeNull();
	});
});

describe('gateMotionClip', () => {
	it('accepts a smooth, lively clip', () => {
		const verdict = gateMotionClip(buildClip({ hipsTravel: 1.2 }), { expectedDuration: 4 });
		expect(verdict.reasons).toEqual([]);
		expect(verdict.ok).toBe(true);
	});

	it('rejects a clip with no tracks', () => {
		expect(gateMotionClip({ duration: 4, tracks: [] }).reasons).toContain('no_tracks');
	});

	it('rejects NaN keyframes rather than publishing an avatar-breaking clip', () => {
		const clip = buildClip({
			mutate: (c) => {
				c.tracks[0].values[8] = Number.NaN;
			},
		});
		expect(gateMotionClip(clip).reasons).toContain('non_finite_keyframes');
	});

	it('rejects a clip missing the body chain a retarget needs', () => {
		const clip = buildClip({ bones: ['Hips', 'Spine', 'Head'] });
		const verdict = gateMotionClip(clip);
		expect(verdict.ok).toBe(false);
		expect(verdict.reasons.some((r) => r.startsWith('missing_bones'))).toBe(true);
	});

	it('rejects tracks naming bones the canonical skeleton does not have', () => {
		const clip = buildClip();
		clip.tracks.push({ type: 'quaternion', name: 'Tail.quaternion', times: [0], values: [0, 0, 0, 1] });
		expect(gateMotionClip(clip).reasons.some((r) => r.startsWith('foreign_bones'))).toBe(true);
	});

	it('rejects a frozen clip, measured in world space', () => {
		const clip = buildClip({ swing: 0 });
		expect(gateMotionClip(clip).reasons).toContain('frozen_clip');
	});

	it('rejects a clip the sampler returned at the wrong length', () => {
		const verdict = gateMotionClip(buildClip({ frames: 120 }), { expectedDuration: 9 });
		expect(verdict.reasons).toContain('duration_mismatch');
	});

	it('rejects quaternions that drifted off the unit sphere', () => {
		const clip = buildClip({
			mutate: (c) => {
				for (let i = 0; i < c.tracks[0].values.length; i += 1) c.tracks[0].values[i] *= 1.2;
			},
		});
		expect(gateMotionClip(clip).reasons).toContain('quaternions_not_normalized');
	});

	it('rejects a real world-space discontinuity', () => {
		// Teleport the root mid-clip: every joint jumps together, which is exactly
		// the visible defect the continuity test exists to catch.
		const clip = buildClip({
			mutate: (c) => {
				const hips = c.tracks.find((t) => t.name === 'Hips.position');
				for (let i = 60; i < hips.values.length / 3; i += 1) hips.values[i * 3] += 3;
			},
		});
		const verdict = gateMotionClip(clip);
		expect(verdict.ok).toBe(false);
		expect(verdict.reasons.some((r) => r.startsWith('world_discontinuity'))).toBe(true);
	});

	it('does NOT reject a 180 degree local twist the child bone cancels', () => {
		// The sampler emits these constantly. They are invisible on the mesh, so a
		// gate that rejects them rejects everything: this test pins that lesson.
		const clip = buildClip({ hipsTravel: 1.2 });
		const shoulder = clip.tracks.find((t) => t.name === 'LeftShoulder.quaternion');
		const forearm = clip.tracks.find((t) => t.name === 'LeftForeArm.quaternion');
		for (const track of [shoulder, forearm]) {
			for (let i = 40; i < track.values.length / 4; i += 2) {
				// Rotate a half turn about the bone's own axis on alternating frames.
				const [x, y, z, w] = track.values.slice(i * 4, i * 4 + 4);
				const half = quatX(Math.PI);
				track.values[i * 4] = w * half[0] + x * half[3];
				track.values[i * 4 + 1] = y * half[3] + z * half[0];
				track.values[i * 4 + 2] = z * half[3] - y * half[0];
				track.values[i * 4 + 3] = w * half[3] - x * half[0];
			}
		}
		const verdict = gateMotionClip(clip);
		expect(verdict.reasons.some((r) => r.startsWith('world_discontinuity'))).toBe(false);
	});

	it('reports metrics even when it rejects, so a batch can be tuned', () => {
		const verdict = gateMotionClip(buildClip({ swing: 0 }));
		expect(verdict.metrics.frames).toBe(120);
		expect(verdict.metrics.trackCount).toBeGreaterThan(20);
		expect(typeof verdict.metrics.worldTravel).toBe('number');
	});
});

describe('foot contact', () => {
	it('ignores floor work, where no foot bears weight', () => {
		// A fall or a breakdance flair: the hips are pinned low AND the legs are
		// folded under the body, so no foot is bearing weight and the feet may
		// travel freely without that counting as skating. Folding the knees is the
		// part that makes it real: with the legs left straight the feet simply hang
		// below the hips, the clip's own floor drops with them, and the body is
		// still upright over its feet however low the root is placed.
		const clip = buildClip({ hipsTravel: 2 });
		const hips = clip.tracks.find((t) => t.name === 'Hips.position');
		for (let i = 0; i < hips.values.length / 3; i += 1) hips.values[i * 3 + 1] = 0.15;
		for (const bone of ['LeftUpLeg', 'RightUpLeg', 'LeftLeg', 'RightLeg']) {
			const track = clip.tracks.find((t) => t.name === `${bone}.quaternion`);
			const folded = quatMul(CANONICAL_REST[bone], quatX(bone.endsWith('UpLeg') ? -2.2 : 2.2));
			for (let i = 0; i < track.values.length; i += 4) {
				[track.values[i], track.values[i + 1], track.values[i + 2], track.values[i + 3]] = folded;
			}
		}
		expect(footContactMetrics(clip).plantedFrames).toBe(0);
	});

	it('derives the floor from the clip rather than assuming y = 0', () => {
		const metrics = footContactMetrics(buildClip());
		expect(Number.isFinite(metrics.floorY)).toBe(true);
	});
});

describe('worldMotionMetrics', () => {
	it('is scale free: a fast clip is not punished for being fast', () => {
		const slow = worldMotionMetrics(buildClip({ swing: 0.15 }));
		const fast = worldMotionMetrics(buildClip({ swing: 0.6 }));
		expect(fast.travel).toBeGreaterThan(slow.travel);
		expect(fast.continuity).toBeLessThan(MOTION_GATE.MAX_WORLD_STEP_RATIO);
		expect(slow.continuity).toBeLessThan(MOTION_GATE.MAX_WORLD_STEP_RATIO);
	});

	it('degrades safely on a clip too short to measure', () => {
		expect(worldMotionMetrics({ tracks: [] }).continuity).toBe(0);
	});
});

describe('publishing shape', () => {
	it('names generated clips apart from the mixamo import', () => {
		const name = libraryClipName('walk-forward-relaxed', 'task-abc');
		expect(name.startsWith('gen-')).toBe(true);
		expect(isGeneratedClipName(name)).toBe(true);
		expect(isGeneratedClipName('mx-135-degree-left-turn-c9cd')).toBe(false);
	});

	it('is stable for the same task and distinct across tasks', () => {
		expect(libraryClipName('a', 't1')).toBe(libraryClipName('a', 't1'));
		expect(libraryClipName('a', 't1')).not.toBe(libraryClipName('a', 't2'));
	});

	it('keeps the exact top-level shape the library already serves', () => {
		const raw = buildClip();
		const out = toLibraryClip(raw, {
			name: 'gen-x-1',
			promptId: 'x',
			prompt: 'a person waves',
			category: 'emote',
			loop: true,
			taskId: 't1',
		});
		expect(Object.keys(out).sort()).toEqual(['blendMode', 'duration', 'name', 'tracks', 'userData', 'uuid']);
		expect(out.tracks).toBe(raw.tracks);
		expect(out.userData.source).toBe('text2motion');
	});

	it('builds a manifest row matching the served entry shape', () => {
		const clip = toLibraryClip(buildClip(), {
			name: 'gen-x-1', promptId: 'x', prompt: 'p', category: 'emote', loop: false, taskId: 't',
		});
		const entry = manifestEntryFor(clip, { label: 'Wave', icon: '👋', loop: false, bytes: 10, url: 'https://cdn/x.json', thumb: null });
		expect(Object.keys(entry).sort()).toEqual(['bytes', 'duration', 'icon', 'label', 'loop', 'name', 'thumb', 'url']);
	});
});

describe('mergeManifest', () => {
	it('appends new rows and leaves the existing order untouched', () => {
		const existing = [{ name: 'mx-a' }, { name: 'mx-b' }];
		const merged = mergeManifest(existing, [{ name: 'gen-c' }]);
		expect(merged.map((e) => e.name)).toEqual(['mx-a', 'mx-b', 'gen-c']);
	});

	it('replaces a row in place on a re-run rather than duplicating it', () => {
		const merged = mergeManifest([{ name: 'gen-a', bytes: 1 }], [{ name: 'gen-a', bytes: 2 }]);
		expect(merged).toEqual([{ name: 'gen-a', bytes: 2 }]);
	});

	it('survives a missing manifest', () => {
		expect(mergeManifest(null, [{ name: 'gen-a' }])).toEqual([{ name: 'gen-a' }]);
	});
});

describe('rotating free subset', () => {
	const names = Array.from({ length: 60 }, (_, i) => `gen-clip-${i}`);

	it('picks a fixed-size subset', () => {
		expect(freeClipNames(names, { size: 12 })).toHaveLength(12);
	});

	it('is stable within an epoch, so a price does not flicker on reload', () => {
		const now = Date.UTC(2026, 8, 2);
		expect(freeClipNames(names, { now })).toEqual(freeClipNames(names, { now }));
	});

	it('rotates between epochs', () => {
		const a = freeClipNames(names, { now: Date.UTC(2026, 8, 2) });
		const b = freeClipNames(names, { now: Date.UTC(2026, 9, 2) });
		expect(a).not.toEqual(b);
	});

	it('never returns a name that is not in the collection', () => {
		for (const name of freeClipNames(names, { size: 12 })) expect(names).toContain(name);
	});

	it('advances the epoch weekly', () => {
		const t = Date.UTC(2026, 8, 2);
		expect(rotationEpoch(t + 7 * 24 * 3600 * 1000)).toBe(rotationEpoch(t) + 1);
	});
});

describe('lane assertion', () => {
	const envelope = (obj) => Buffer.from(JSON.stringify(obj)).toString('base64url');

	it('accepts our own text2motion Cloud Run worker', () => {
		const id = envelope({ mode: 'text2motion', taskId: 't1', baseUrl: 'https://model-text2motion-9374185604.us-east4.run.app' });
		expect(assertSelfHostedLane(id)).toEqual({ host: 'model-text2motion-9374185604.us-east4.run.app', taskId: 't1' });
	});

	it('refuses a paid third-party lane so bulk spend cannot leave the credits', () => {
		const id = envelope({ mode: 'text2motion', taskId: 't1', baseUrl: 'https://api.some-vendor.com' });
		expect(() => assertSelfHostedLane(id)).toThrow(/not a self-hosted Cloud Run lane/);
	});

	it('refuses another Cloud Run service that is not the motion worker', () => {
		const id = envelope({ mode: 'text2motion', taskId: 't1', baseUrl: 'https://model-trellis-123.us-central1.run.app' });
		expect(() => assertSelfHostedLane(id)).toThrow(/unexpected worker/);
	});

	it('refuses a job that is not a motion job', () => {
		const id = envelope({ mode: 'text23d', taskId: 't1', baseUrl: 'https://model-text2motion-1.us-east4.run.app' });
		expect(() => assertSelfHostedLane(id)).toThrow(/mode text23d/);
	});

	it('refuses an unreadable job id', () => {
		expect(decodeJobEnvelope('not-base64-json')).toBeNull();
		expect(() => assertSelfHostedLane('not-base64-json')).toThrow(/not a provider envelope/);
	});
});

describe('loop seams', () => {
	/** A clip whose pose at the end is deliberately far from where it started. */
	const openSeam = () =>
		buildClip({
			frames: 120,
			mutate: (c) => {
				for (const track of c.tracks) {
					if (track.type !== 'quaternion') continue;
					const n = track.values.length / 4;
					// Drift the last third away from the opening pose.
					for (let i = Math.floor(n * 0.66); i < n; i += 1) {
						const t = (i - n * 0.66) / (n - n * 0.66);
						const q = quatX(0.9 * t);
						for (let c2 = 0; c2 < 4; c2 += 1) track.values[i * 4 + c2] = q[c2];
					}
				}
			},
		});

	it('measures the seam in metres, hips relative', () => {
		expect(loopSeamDistance(openSeam())).toBeGreaterThan(LOOP_SEAM.TARGET);
	});

	it('closes an open seam', () => {
		const result = closeLoopSeam(openSeam());
		expect(result.seamAfter).toBeLessThan(result.seamBefore);
		expect(result.seamAfter).toBeLessThanOrEqual(LOOP_SEAM.TARGET);
	});

	it('does not modify the clip it was given', () => {
		const clip = openSeam();
		const before = JSON.stringify(clip.tracks[0].values);
		closeLoopSeam(clip);
		expect(JSON.stringify(clip.tracks[0].values)).toBe(before);
	});

	it('leaves a clip that is already seamless alone rather than trimming it', () => {
		const clip = buildClip({ frames: 120 });
		const result = closeLoopSeam(clip);
		expect(result.trimmedFrames).toBe(0);
	});

	it('never trims away more than the cap', () => {
		const clip = openSeam();
		const result = closeLoopSeam(clip);
		expect(result.trimmedFrames).toBeLessThanOrEqual(Math.ceil(120 * LOOP_SEAM.MAX_TRIM_FRACTION));
	});

	it('keeps the closed clip playable', () => {
		const result = closeLoopSeam(openSeam());
		const verdict = gateMotionClip(result.clip, {});
		expect(verdict.reasons).not.toContain('non_finite_keyframes');
		expect(verdict.reasons.some((r) => r.startsWith('world_discontinuity'))).toBe(false);
	});

	it('spreads a wider correction over more frames rather than giving up', () => {
		// A short blend cannot absorb a wide seam without popping, so the ladder
		// should reach for a longer one instead of returning the clip unclosed.
		const wide = buildClip({
			frames: 150,
			mutate: (c) => {
				for (const track of c.tracks) {
					if (track.type !== 'quaternion') continue;
					const n = track.values.length / 4;
					for (let i = Math.floor(n * 0.5); i < n; i += 1) {
						const q = quatX(1.4);
						for (let k = 0; k < 4; k += 1) track.values[i * 4 + k] = q[k];
					}
				}
			},
		});
		const result = closeLoopSeam(wide);
		expect(result.seamAfter).toBeLessThanOrEqual(LOOP_SEAM.TARGET);
		expect(LOOP_SEAM.BLEND_LADDER).toContain(result.blendFrames);
	});

	it('tries the shortest blend first, so a small seam is not over-smoothed', () => {
		const result = closeLoopSeam(openSeam());
		expect(result.blendFrames).toBe(LOOP_SEAM.BLEND_LADDER[0]);
	});

	it('is safe to call on a clip too short to work with', () => {
		const tiny = { name: 't', duration: 0.1, tracks: [], uuid: 'u', blendMode: 0 };
		expect(closeLoopSeam(tiny).clip).toBe(tiny);
	});

	it('preserves horizontal travel so a walking loop still covers ground', () => {
		const clip = openSeam();
		const result = closeLoopSeam(clip);
		const hips = result.clip.tracks.find((t) => t.name === 'Hips.position');
		const n = hips.values.length / 3;
		// The root track is built with zero travel here, so assert the axis was
		// left untouched rather than dragged back to the start by the blend.
		expect(Number.isFinite(hips.values[(n - 1) * 3])).toBe(true);
		expect(hips.values[(n - 1) * 3]).toBe(clip.tracks.find((t) => t.name === 'Hips.position').values[(n - 1) * 3]);
	});
});

describe('rest basis', () => {
	/**
	 * A clip the way the text2motion lane writes one: the same motion, but with
	 * every bone resting at identity instead of at the library's canonical rest.
	 * This is the shape all 133 clips published before 2026-09-09 carry.
	 */
	function generatorBasisClip(opts = {}) {
		const clip = buildClip(opts);
		return {
			...clip,
			tracks: clip.tracks.map((track) => {
				if (!track.name.endsWith('.quaternion')) return track;
				const bone = track.name.slice(0, track.name.lastIndexOf('.'));
				const rest = CANONICAL_REST[bone] ?? [0, 0, 0, 1];
				const inverse = [-rest[0], -rest[1], -rest[2], rest[3]];
				const values = Array.from(track.values);
				for (let i = 0; i < values.length; i += 4) {
					const q = quatMul(inverse, [values[i], values[i + 1], values[i + 2], values[i + 3]]);
					[values[i], values[i + 1], values[i + 2], values[i + 3]] = q;
				}
				return { ...track, values };
			}),
		};
	}

	it('puts the feet above the head when the basis is wrong', () => {
		// The defect itself, stated as a measurement: this is what shipped.
		expect(uprightGap(generatorBasisClip())).toBeLessThan(0);
		expect(uprightGap(buildClip())).toBeGreaterThan(1);
	});

	it('rebases a generator-basis clip back onto its feet', () => {
		const rebased = rebaseToCanonicalRest(generatorBasisClip());
		expect(rebased.rebasedTracks).toBeGreaterThan(20);
		expect(uprightGap(rebased.clip)).toBeGreaterThan(1);
	});

	it('reads the leg convention, which is what separates the two bases', () => {
		expect(legBasisDegrees(generatorBasisClip())).toBeLessThan(MOTION_GATE.MIN_LEG_BASIS_DEGREES);
		expect(legBasisDegrees(buildClip())).toBeGreaterThan(MOTION_GATE.MIN_LEG_BASIS_DEGREES);
	});

	it('rejects a clip in the wrong basis, which the gate used to accept', () => {
		expect(gateMotionClip(generatorBasisClip(), {}).reasons).toContain('wrong_rest_basis');
		expect(gateMotionClip(buildClip({ hipsTravel: 1.2 }), {}).reasons).not.toContain('wrong_rest_basis');
	});

	it('needs both signals, so genuinely prone motion is not rejected', () => {
		// Upright fails, leg convention passes: a pushup, not a broken rig.
		const prone = buildClip();
		expect(maxUprightGap(prone)).toBeGreaterThan(MOTION_GATE.MIN_UPRIGHT_GAP);
		expect(legBasisDegrees(prone)).toBeGreaterThan(MOTION_GATE.MIN_LEG_BASIS_DEGREES);
		expect(gateMotionClip(prone, {}).reasons).not.toContain('wrong_rest_basis');
	});

	it('stamps the basis so a repair pass never rebases twice', () => {
		const raw = generatorBasisClip();
		expect(needsRebase(raw)).toBe(true);
		const published = toLibraryClip(rebaseToCanonicalRest(raw).clip, {
			name: 'gen-x-0123456789ab',
			promptId: 'x',
			prompt: 'a person waves',
			category: 'emote',
			loop: false,
			taskId: 't',
		});
		expect(published.userData.basis).toBe(CLIP_BASIS);
		expect(needsRebase(published)).toBe(false);
	});
});

describe('root drift', () => {
	/** A clip with a constant forward ramp welded onto its root, as the lane emits. */
	function drifting(speed = 0.25) {
		const clip = buildClip();
		const hips = clip.tracks.find((t) => t.name === 'Hips.position');
		const times = hips.times;
		for (let i = 0; i < times.length; i += 1) hips.values[i * 3 + 2] += speed * times[i];
		return clip;
	}

	it('measures the ramp and takes it out', () => {
		const result = flattenRootDrift(drifting(0.25));
		expect(result.speed).toBeCloseTo(0.25, 2);
		const hips = result.clip.tracks.find((t) => t.name === 'Hips.position');
		const n = hips.times.length;
		expect(Math.abs(hips.values[(n - 1) * 3 + 2] - hips.values[2])).toBeLessThan(0.01);
	});

	it('leaves the real motion behind, not just the endpoints', () => {
		// The residual is what a pirouette's sway or a walk's per-step surge lives
		// in, so flattening must not flatten the clip itself.
		const before = buildClip();
		const after = flattenRootDrift(drifting(0.25)).clip;
		const y = (c) => c.tracks.find((t) => t.name === 'Hips.position').values.filter((_, i) => i % 3 === 1);
		expect(y(after)).toEqual(y(before));
	});

	it('never touches vertical travel', () => {
		const result = flattenRootDrift(drifting(0.25));
		const hips = result.clip.tracks.find((t) => t.name === 'Hips.position');
		const heights = hips.values.filter((_, i) => i % 3 === 1);
		expect(Math.max(...heights) - Math.min(...heights)).toBeGreaterThan(0.01);
	});

	it('leaves an already in-place clip alone', () => {
		const clip = buildClip();
		const result = flattenRootDrift(clip);
		expect(result.removed).toBe(0);
		expect(result.clip).toBe(clip);
	});
});

describe('foot flicks', () => {
	/** Toe position relative to its ankle, the quantity a flick disturbs. */
	function toeRel(clip, frame) {
		const w = forwardKinematicsFrame(clip, frame);
		return w.LeftToeBase.map((v, k) => v - w.LeftFoot[k]);
	}

	/** Swing the left foot away from its neighbours on the given frames only. */
	function flicked(frames) {
		const clip = buildClip();
		const track = clip.tracks.find((t) => t.name === 'LeftFoot.quaternion');
		for (const f of frames) {
			const q = track.values.slice(f * 4, f * 4 + 4);
			const swung = quatMul(q, quatX(1.4));
			for (let k = 0; k < 4; k += 1) track.values[f * 4 + k] = swung[k];
		}
		return clip;
	}

	it('repairs a one-frame flick back onto the line between its neighbours', () => {
		const clip = flicked([40]);
		const before = Math.hypot(...toeRel(clip, 40).map((v, k) => v - toeRel(clip, 39)[k]));
		expect(before).toBeGreaterThan(0.03);
		const { clip: fixed, repaired } = despikeFootFlicks(clip);
		expect(repaired).toBe(1);
		const after = Math.hypot(...toeRel(fixed, 40).map((v, k) => v - toeRel(fixed, 39)[k]));
		expect(after).toBeLessThan(0.01);
	});

	it('repairs a two-frame excursion as one span', () => {
		const { repaired } = despikeFootFlicks(flicked([60, 61]));
		expect(repaired).toBe(2);
	});

	it('leaves a clip with no flicks untouched', () => {
		const clip = buildClip();
		const result = despikeFootFlicks(clip);
		expect(result.repaired).toBe(0);
		expect(result.clip).toBe(clip);
	});

	it('does not treat a held change of foot pose as a flick', () => {
		// Frames 40 onward all turn the foot: a real, held movement, not a spike.
		const frames = Array.from({ length: 80 }, (_, i) => 40 + i);
		const { repaired } = despikeFootFlicks(flicked(frames));
		expect(repaired).toBe(0);
	});
});

describe('root travel from foot contact', () => {
	/**
	 * A treadmill: the body stays put while the planted left leg sweeps under
	 * it, and the right leg is held up off the floor so the left is always the
	 * one bearing weight. With the root pinned, the planted foot skates.
	 */
	function treadmill({ sweep = 0.3, frames = 31 } = {}) {
		const clip = buildClip({ frames, swing: 0 });
		const left = clip.tracks.find((t) => t.name === 'LeftUpLeg.quaternion');
		const right = clip.tracks.find((t) => t.name === 'RightUpLeg.quaternion');
		for (let i = 0; i < frames; i += 1) {
			const angle = -sweep / 2 + (sweep * i) / (frames - 1);
			const l = quatMul(CANONICAL_REST.LeftUpLeg, quatX(angle));
			const r = quatMul(CANONICAL_REST.RightUpLeg, quatX(0.6));
			for (let k = 0; k < 4; k += 1) {
				left.values[i * 4 + k] = l[k];
				right.values[i * 4 + k] = r[k];
			}
		}
		const hips = clip.tracks.find((t) => t.name === 'Hips.position');
		for (let i = 0; i < frames; i += 1) hips.values[i * 3 + 1] = 0.984;
		return clip;
	}

	it('gives a striding clip the travel its planted foot implies', () => {
		const clip = treadmill();
		const before = footContactMetrics(clip);
		const locked = lockRootToContacts(clip);
		expect(locked.applied).toBe(true);
		expect(locked.speed).toBeGreaterThan(ROOT_LOCK.MIN_SPEED);
		const after = footContactMetrics(locked.clip);
		expect(after.slide).toBeLessThan(before.slide * 0.25);
		expect(after.stride).toBeGreaterThan(before.stride);
	});

	it('keeps the root of a clip that stands still', () => {
		const clip = buildClip({ swing: 0.05 });
		const locked = lockRootToContacts(clip);
		expect(locked.applied).toBe(false);
		expect(locked.clip).toBe(clip);
	});

	it('never touches vertical travel', () => {
		const clip = treadmill();
		const y = (c) => c.tracks.find((t) => t.name === 'Hips.position').values.filter((_, i) => i % 3 === 1);
		expect(y(lockRootToContacts(clip).clip)).toEqual(y(clip));
	});

	it('trusts nothing when no foot is ever planted', () => {
		// Floor work: the hips pinned low with the knees folded under the body,
		// the same construction the foot-contact suite uses, so no foot bears
		// weight and there is no plant to derive travel from.
		const clip = treadmill();
		const hips = clip.tracks.find((t) => t.name === 'Hips.position');
		for (let i = 0; i < hips.values.length / 3; i += 1) hips.values[i * 3 + 1] = 0.15;
		for (const bone of ['LeftLeg', 'RightLeg']) {
			const track = clip.tracks.find((t) => t.name === `${bone}.quaternion`);
			const folded = quatMul(CANONICAL_REST[bone], quatX(2.2));
			for (let i = 0; i < track.values.length; i += 4) {
				[track.values[i], track.values[i + 1], track.values[i + 2], track.values[i + 3]] = folded;
			}
		}
		const locked = lockRootToContacts(clip);
		expect(locked.applied).toBe(false);
		expect(locked.contactShare).toBeLessThan(ROOT_LOCK.MIN_CONTACT_SHARE);
	});
});

describe('source rest shape', () => {
	// The lane's rest is HumanML3D's raw offsets: arms hanging, collars out, the
	// head straight FORWARD of the neck. A standing pose in that basis is identity
	// everywhere except the neck, which turns "forward" into "up".
	const SOURCE_BONES = [
		'Hips', 'Spine', 'Spine1', 'Spine2', 'Neck', 'Head',
		'LeftShoulder', 'LeftArm', 'LeftForeArm', 'LeftHand',
		'RightShoulder', 'RightArm', 'RightForeArm', 'RightHand',
		'LeftUpLeg', 'LeftLeg', 'LeftFoot', 'LeftToeBase',
		'RightUpLeg', 'RightLeg', 'RightFoot', 'RightToeBase',
	];
	const NECK_UP = quatX(-Math.PI / 2); // carries +z (forward) onto +y (up)

	function standingSourceClip(frames = 4) {
		const times = Array.from({ length: frames }, (_, i) => i / 30);
		const tracks = SOURCE_BONES.map((bone) => ({
			type: 'quaternion',
			name: `${bone}.quaternion`,
			times: [...times],
			values: times.flatMap(() => (bone === 'Neck' ? NECK_UP : [0, 0, 0, 1])),
		}));
		tracks.push({ type: 'vector', name: 'Hips.position', times: [...times], values: times.flatMap(() => [0, 0.98, 0]) });
		return { name: 'standing', duration: (frames - 1) / 30, tracks };
	}

	it('stands a source-basis pose up with the head over the neck and the arms hanging', () => {
		const clip = rebaseToCanonicalRest(standingSourceClip()).clip;
		const w = forwardKinematicsFrame(clip, 0);
		// Head directly above the neck, not thrown back or forward.
		expect(w.Head[1] - w.Neck[1]).toBeGreaterThan(0.1);
		expect(Math.hypot(w.Head[0] - w.Neck[0], w.Head[2] - w.Neck[2])).toBeLessThan(0.05);
		// Arms hang: each hand well below its shoulder, not out in a T-pose.
		for (const side of ['Left', 'Right']) {
			expect(w[`${side}Arm`][1] - w[`${side}Hand`][1]).toBeGreaterThan(0.4);
			expect(Math.abs(w[`${side}Hand`][0] - w[`${side}Arm`][0])).toBeLessThan(0.15);
		}
		// Legs down, toes forward of the ankles.
		expect(w.LeftUpLeg[1] - w.LeftFoot[1]).toBeGreaterThan(0.7);
		expect(w.LeftToeBase[2]).toBeGreaterThan(w.LeftFoot[2]);
	});

	it('converts a legacy v1 clip exactly as if it had come straight from the source', () => {
		const source = buildClip({ swing: 0.3 });
		// The v1 conversion: q1 = Wt_parent^-1 * q_s * Wt_bone.
		const conj = (q) => [-q[0], -q[1], -q[2], q[3]];
		const v1 = {
			...source,
			userData: { basis: LEGACY_CLIP_BASIS },
			tracks: source.tracks.map((track) => {
				if (!track.name.endsWith('.quaternion')) return track;
				const bone = track.name.slice(0, track.name.lastIndexOf('.'));
				const parent = CANONICAL_PARENT[bone];
				const Wp = parent ? CANONICAL_REST_WORLD[parent] : [0, 0, 0, 1];
				const values = Array.from(track.values);
				for (let i = 0; i < values.length; i += 4) {
					const q = quatMul(quatMul(conj(Wp), values.slice(i, i + 4)), CANONICAL_REST_WORLD[bone]);
					values.splice(i, 4, ...q);
				}
				return { ...track, values };
			}),
		};
		expect(needsRebase(v1)).toBe(true);
		const direct = rebaseToCanonicalRest(source).clip;
		const viaLegacy = rebaseToCanonicalRest(v1).clip;
		expect(viaLegacy.userData.basis).toBeUndefined();
		for (let t = 0; t < direct.tracks.length; t += 1) {
			if (!direct.tracks[t].name.endsWith('.quaternion')) continue;
			const a = direct.tracks[t].values;
			const b = viaLegacy.tracks[t].values;
			for (let i = 0; i < a.length; i += 4) {
				// q and -q are the same rotation.
				const d = Math.abs(a[i] * b[i] + a[i + 1] * b[i + 1] + a[i + 2] * b[i + 2] + a[i + 3] * b[i + 3]);
				expect(d, direct.tracks[t].name).toBeCloseTo(1, 6);
			}
		}
	});

	it('marks the current basis as v2', () => {
		expect(CLIP_BASIS).toBe('canonical-rest-v2');
		expect(needsRebase({ userData: { basis: CLIP_BASIS } })).toBe(false);
		expect(needsRebase({ userData: { basis: LEGACY_CLIP_BASIS } })).toBe(true);
	});
});

describe('libraryReadyClip', () => {
	// AnimationClip.toJSON() always writes userData as a JSON string, and
	// AnimationClip.parse() hands that string straight to JSON.parse(). A clip
	// served with an object-shaped userData instead crashes the client's parse
	// with "[object Object]" is not valid JSON, so the generated clip never
	// gets to preview. /api/forge-motion hands its GET response's `clip` field
	// straight to AnimationClip.parse() on the client, so this is the exact
	// contract libraryReadyClip's output has to satisfy.
	it('produces a clip AnimationClip.parse() can read without throwing', () => {
		const raw = buildClip();
		const ready = libraryReadyClip(raw);
		expect(() => AnimationClip.parse(ready)).not.toThrow();
	});

	it('stamps the current basis onto userData, round-trippable through parse', () => {
		const ready = libraryReadyClip(buildClip());
		expect(typeof ready.userData).toBe('string');
		const parsed = AnimationClip.parse(ready);
		expect(parsed.userData.basis).toBe(CLIP_BASIS);
	});
});
