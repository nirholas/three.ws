// AR Studio photo scenes (packages/ar-studio/src/studio/scene-math.js).
//
// A scene-from-a-photo GLB holds one node per object. Each object becomes its
// own placement through a `#node=` reference, so the contract pinned here: the
// reference survives every path a `src` travels (normalize, persist, share),
// hostile fragments never resolve, the whole scene shares one scale, and the
// photo's layout turns as one around the anchor.

import { describe, expect, it } from 'vitest';

import {
	deserializeScene,
	glbBaseUrl,
	nodeRefSrc,
	normalizeGlbUrl,
	PHOTO_SCENE_SPAN_M,
	photoObjectPlacements,
	photoSceneFit,
	serializeScene,
	splitNodeRef,
} from '../packages/ar-studio/src/studio/scene-math.js';

const SCENE = 'https://storage.googleapis.com/three-ws-avatar-reconstructions/raw-meshes/sam3d-objects/t1.glb';

describe('node references', () => {
	it('round-trips a node reference', () => {
		const src = nodeRefSrc(SCENE, 'object_03');
		expect(src).toBe(`${SCENE}#node=object_03`);
		expect(splitNodeRef(src)).toEqual({ base: SCENE, node: 'object_03' });
		expect(glbBaseUrl(src)).toBe(SCENE);
	});

	it('works for site-relative scenes too', () => {
		expect(splitNodeRef('/results/t1.glb#node=object_01')).toEqual({ base: '/results/t1.glb', node: 'object_01' });
	});

	it('survives normalize, localStorage and back', () => {
		const src = nodeRefSrc(SCENE, 'object_02');
		expect(normalizeGlbUrl(src)).toBe(src);
		const back = deserializeScene(serializeScene([{ src, title: 'Photo object 2', x: 1, z: -2, yaw: 0.5, scale: 1 }]));
		expect(back[0].src).toBe(src);
		expect(splitNodeRef(back[0].src).node).toBe('object_02');
	});

	it('refuses plain URLs and hostile fragments', () => {
		expect(splitNodeRef(SCENE)).toBeNull();
		expect(splitNodeRef(`${SCENE}#other=1`)).toBeNull();
		expect(splitNodeRef(`${SCENE}#node=`)).toBeNull();
		expect(splitNodeRef(`${SCENE}#node=<img onerror=x>`)).toBeNull();
		expect(splitNodeRef(`${SCENE}#node=${'a'.repeat(65)}`)).toBeNull();
		expect(splitNodeRef('javascript:alert(1)#node=object_01')).toBeNull();
		expect(splitNodeRef('http://example.com/a.glb#node=object_01')).toBeNull();
		expect(nodeRefSrc('data:x', 'object_01')).toBeNull();
		expect(nodeRefSrc(SCENE, '../x')).toBeNull();
	});
});

describe('photoSceneFit', () => {
	it('brings a tiny scene up to room size with one scale', () => {
		const fit = photoSceneFit({ min: { x: -0.2, y: 0, z: -0.1 }, max: { x: 0.2, y: 0.3, z: 0.1 } });
		expect(fit.scale).toBeCloseTo(PHOTO_SCENE_SPAN_M / 0.4);
		expect(fit.yOffset).toBeCloseTo(0);
	});

	it('keeps a scene already near room size at its own scale', () => {
		expect(photoSceneFit({ min: { x: -1.5, y: 0, z: -1 }, max: { x: 1.5, y: 1, z: 1 } }).scale).toBe(1);
	});

	it('grounds a scene that does not start at y = 0', () => {
		const fit = photoSceneFit({ min: { x: -5, y: -1, z: -5 }, max: { x: 5, y: 1, z: 5 } });
		expect(fit.scale).toBeCloseTo(0.24);
		expect(fit.yOffset).toBeCloseTo(0.24);
	});

	it('degrades to identity on broken bounds', () => {
		expect(photoSceneFit({ min: { x: NaN, y: 0, z: 0 }, max: { x: 1, y: 1, z: 1 } })).toEqual({ scale: 1, yOffset: 0 });
		expect(photoSceneFit({ min: { x: 0, y: 0, z: 0 }, max: { x: 0, y: 0, z: 0 } })).toEqual({ scale: 1, yOffset: 0 });
	});
});

describe('photoObjectPlacements', () => {
	const scene = { min: { x: -1, z: -1 }, max: { x: 1, z: 1 } };
	const nodes = [
		{ node: 'object_01', box: { min: { x: -1, z: -0.2 }, max: { x: -0.6, z: 0.2 } } }, // left
		{ node: 'object_02', box: { min: { x: 0.6, z: -1 }, max: { x: 1, z: -0.6 } } }, // right, far
	];

	it('keeps the photo layout around the anchor when facing straight on', () => {
		const out = photoObjectPlacements(scene, nodes, { scale: 1, anchor: { x: 0, z: -3 }, yaw: 0 });
		expect(out[0]).toMatchObject({ node: 'object_01', yaw: 0 });
		expect(out[0].x).toBeCloseTo(-0.8);
		expect(out[0].z).toBeCloseTo(-3);
		expect(out[1].x).toBeCloseTo(0.8);
		expect(out[1].z).toBeCloseTo(-3.8);
	});

	it('scales spacing and turns the arrangement as one', () => {
		const out = photoObjectPlacements(scene, nodes, { scale: 2, anchor: { x: 0, z: 0 }, yaw: Math.PI / 2 });
		// three.js rotation.y = +90deg maps local +X to world -Z.
		expect(out[0].x).toBeCloseTo(0);
		expect(out[0].z).toBeCloseTo(1.6);
		expect(out.every((p) => p.yaw === Math.PI / 2)).toBe(true);
		// distances between objects scale with the scene
		const d = Math.hypot(out[0].x - out[1].x, out[0].z - out[1].z);
		expect(d).toBeCloseTo(2 * Math.hypot(1.6, 0.8));
	});
});
