#!/usr/bin/env node
/**
 * Build deterministic, project-authored animation clips.
 *
 * These clips deliberately live outside the FBX retarget path. Their source of
 * truth is the keyframe choreography below, while the first frame of the
 * already-cleared canonical `idle` clip supplies the rig's neutral local bone
 * transforms. This keeps every build reproducible and avoids adding an
 * unlicensed third-party motion file.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Quaternion, Vector3 } from 'three';
import { compactClipJson } from './compact-clips.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const CLIPS_DIR = resolve(ROOT, 'public/animations/clips');
const IDLE_PATH = resolve(CLIPS_DIR, 'idle.json');
const BOW_PATH = resolve(CLIPS_DIR, 'bow.json');

const TIMES = [0, 0.3, 0.65, 1.15, 1.5, 1.8];
const WEIGHTS = [0, 0.25, 1, 1, 0.25, 0];
const X_AXIS = new Vector3(1, 0, 0);

// Distributed across the spine so the motion reads as a respectful bow rather
// than a hinge at one joint. The head follows the torso and the knees soften
// slightly while the feet remain planted.
const BONE_ANGLES_DEG = {
	Spine: 12,
	Spine1: 15,
	Spine2: 15,
	Neck: 5,
	Head: 4,
	LeftUpLeg: -3,
	RightUpLeg: -3,
	LeftLeg: 5,
	RightLeg: 5,
};

function firstFrame(track) {
	const size = track.type === 'quaternion' ? 4 : track.type === 'vector' ? 3 : 1;
	return track.values.slice(0, size);
}

function animateQuaternion(base, angleDeg) {
	return WEIGHTS.flatMap((weight) => {
		const pose = new Quaternion().fromArray(base);
		const delta = new Quaternion().setFromAxisAngle(
			X_AXIS,
			(angleDeg * weight * Math.PI) / 180,
		);
		return pose.multiply(delta).normalize().toArray();
	});
}

export function createBowClip(idle) {
	const tracks = idle.tracks.map((track) => {
		const base = firstFrame(track);
		const bone = track.name.slice(0, track.name.indexOf('.'));

		if (track.type === 'quaternion' && BONE_ANGLES_DEG[bone] !== undefined) {
			return {
				name: track.name,
				type: track.type,
				times: TIMES,
				values: animateQuaternion(base, BONE_ANGLES_DEG[bone]),
			};
		}

		if (track.name === 'Hips.position') {
			return {
				name: track.name,
				type: track.type,
				times: TIMES,
				values: WEIGHTS.flatMap((weight) => [base[0], base[1] - 0.015 * weight, base[2]]),
			};
		}

		return {
			name: track.name,
			type: track.type,
			times: TIMES,
			values: WEIGHTS.flatMap(() => base),
		};
	});

	return compactClipJson({
		name: 'bow',
		duration: TIMES.at(-1),
		tracks,
		blendMode: idle.blendMode,
		userData: JSON.stringify({
			source: 'three.ws original keyframes',
			neutralPose: 'public/animations/clips/idle.json:first-frame',
		}),
	});
}

export function buildOriginalAnimations() {
	const idle = JSON.parse(readFileSync(IDLE_PATH, 'utf8'));
	const bow = createBowClip(idle);
	writeFileSync(BOW_PATH, `${JSON.stringify(bow)}\n`);
	console.log(`[animations] ORIGINAL bow         ${bow.tracks.length} tracks, ${(JSON.stringify(bow).length / 1024).toFixed(0)}kB`);
	return bow;
}

if (resolve(process.argv[1] || '') === fileURLToPath(import.meta.url)) {
	buildOriginalAnimations();
}
