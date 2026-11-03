// WebGPURenderer cannot draw GLSL ShaderMaterials. The viewer's WebGPU path
// rebuilds three-vrm's MToon as MeshToonMaterial and hides its outline pass;
// every built-in material must pass through untouched.
import { describe, it, expect } from 'vitest';
import { Mesh, BoxGeometry, Group, Color, MeshStandardMaterial, ShaderMaterial, Texture } from 'three';
import { MToonMaterial } from '@pixiv/three-vrm';
import {
	needsNodeConversion,
	convertMaterial,
	convertForNodeRenderer,
} from '../src/render/webgpu-material-compat.js';

describe('webgpu-material-compat', () => {
	it('leaves built-in materials alone', () => {
		const std = new MeshStandardMaterial();
		expect(needsNodeConversion(std)).toBe(false);
		expect(convertMaterial(std)).toBe(std);
	});

	it('rebuilds MToon as MeshToonMaterial with its look', () => {
		const map = new Texture();
		const m = new MToonMaterial();
		m.name = 'Face';
		m.color = new Color(0.8, 0.4, 0.2);
		m.map = map;
		m.transparent = true;
		m.opacity = 0.7;
		m.alphaTest = 0.3;
		m.emissive = new Color(0.1, 0.2, 0.3);
		m.emissiveIntensity = 2;
		const out = convertMaterial(m);
		expect(out.isMeshToonMaterial).toBe(true);
		expect(out.name).toBe('Face');
		expect(out.color.getHex()).toBe(m.color.getHex());
		expect(out.map).toBe(map);
		expect(out.transparent).toBe(true);
		expect(out.opacity).toBeCloseTo(0.7);
		expect(out.alphaTest).toBeCloseTo(0.3);
		expect(out.emissive.getHex()).toBe(m.emissive.getHex());
		expect(out.emissiveIntensity).toBe(2);
		expect(out.userData.convertedFrom).toBe('MToonMaterial');
	});

	it('hides the MToon outline pass', () => {
		const outline = new MToonMaterial();
		outline.isOutline = true;
		const out = convertMaterial(outline);
		expect(out.visible).toBe(false);
	});

	it('maps a generic ShaderMaterial onto MeshStandardMaterial', () => {
		const map = new Texture();
		const sm = new ShaderMaterial({ uniforms: { map: { value: map } } });
		const out = convertMaterial(sm);
		expect(out.isMeshStandardMaterial).toBe(true);
		expect(out.map).toBe(map);
	});

	it('converts each shared material once and keeps the sharing', () => {
		const shared = new MToonMaterial();
		const outline = new MToonMaterial();
		outline.isOutline = true;
		const geo = new BoxGeometry();
		const a = new Mesh(geo, shared);
		const b = new Mesh(geo, [shared, outline]);
		const c = new Mesh(geo, new MeshStandardMaterial());
		const keep = c.material;
		const root = new Group();
		root.add(a, b, c);
		expect(convertForNodeRenderer(root)).toBe(2);
		expect(a.material).toBe(b.material[0]);
		expect(a.material.isMeshToonMaterial).toBe(true);
		expect(b.material[1].visible).toBe(false);
		expect(c.material).toBe(keep);
	});
});
