// The /animations detail modal calls live.refit() right after a clip starts, to
// re-frame the camera once the modal has its final size. Framing samples the
// clip by driving the skeleton, and it used to do that on the live mixer with
// stopAllAction() + probe.stop(): since mixer.clipAction(clip) hands back the
// very action that is playing, refit() stopped the preview it was framing and
// the modal sat in bind pose at 0.0s for every clip in the gallery.

import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import { AnimationLivePreview } from '../src/animations-live-preview.js';

function rig() {
	const hips = new THREE.Bone();
	hips.name = 'Hips';
	const arm = new THREE.Bone();
	arm.name = 'RightArm';
	arm.position.set(0.2, 0.4, 0);
	hips.add(arm);
	hips.position.set(0, 1, 0);
	const model = new THREE.Group();
	model.add(hips);
	return { model, hips, arm };
}

function engine() {
	const live = new AnimationLivePreview();
	const { model, hips, arm } = rig();
	live._three = THREE;
	live._model = model;
	model.traverse((o) => {
		if (o.isBone) live._bones.push(o);
		live._restPose.set(o, { p: o.position.clone(), q: o.quaternion.clone(), s: o.scale.clone() });
	});
	live._camera = new THREE.PerspectiveCamera(33, 3 / 4, 0.05, 100);
	const key = new THREE.DirectionalLight();
	live._keyLight = key;
	live._mixer = new THREE.AnimationMixer(model);
	return { live, hips, arm };
}

// Raise the arm 90 degrees over two seconds.
function raiseClip() {
	const q0 = new THREE.Quaternion();
	const q1 = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 0, 1), Math.PI / 2);
	return new THREE.AnimationClip('raise', 2, [
		new THREE.QuaternionKeyframeTrack('RightArm.quaternion', [0, 2], [...q0.toArray(), ...q1.toArray()]),
	]);
}

describe('AnimationLivePreview framing', () => {
	it('refit() keeps the playing clip playing at its current time', () => {
		const { live, arm } = engine();
		const clip = raiseClip();
		const action = live._mixer.clipAction(clip);
		action.play();
		live._action = action;
		live._mixer.update(1);
		const poseBefore = arm.quaternion.clone();
		expect(poseBefore.angleTo(new THREE.Quaternion())).toBeGreaterThan(0.5);

		live.refit();

		expect(action.isRunning()).toBe(true);
		expect(action.time).toBeCloseTo(1, 5);
		expect(arm.quaternion.equals(poseBefore)).toBe(true);
		// And it keeps advancing.
		live._mixer.update(0.5);
		expect(action.time).toBeCloseTo(1.5, 5);
	});

	it('frames the motion envelope, not just the bind pose', () => {
		const { live } = engine();
		live._frameCamera(raiseClip());
		expect(live._framing).toBeTruthy();
		expect(live._framing.dist).toBeGreaterThan(0);
	});

	it('leaves an idle stage in bind pose after framing', () => {
		const { live, arm } = engine();
		live._frameCamera(raiseClip());
		expect(arm.quaternion.equals(new THREE.Quaternion())).toBe(true);
	});
});
