import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { MeshStandardMaterial, Mesh, BoxGeometry, Group } from 'three';

const createWebGL = vi.fn((options) => ({ kind: 'webgl', options, domElement: { dataset: {} } }));
vi.mock('../src/webgl-support.js', () => ({ createRenderer: (...a) => createWebGL(...a) }));

const { resolveRendererPreference, isWebGPUAvailable, createAutoRenderer } = await import('../src/renderer-factory.js');
const { createRestyleEffects } = await import('../src/restyle-effects.js');

describe('resolveRendererPreference', () => {
	it('defaults to webgl with no opt-in', () => {
		expect(resolveRendererPreference()).toBe('webgl');
		expect(resolveRendererPreference({ search: '?url=x.glb' })).toBe('webgl');
	});
	it('opts in from the query string, case-insensitively', () => {
		expect(resolveRendererPreference({ search: '?renderer=webgpu' })).toBe('webgpu');
		expect(resolveRendererPreference({ search: '?a=1&renderer=WebGPU' })).toBe('webgpu');
	});
	it('treats any other value as webgl', () => {
		expect(resolveRendererPreference({ search: '?renderer=vulkan' })).toBe('webgl');
		expect(resolveRendererPreference({ search: '?renderer=' })).toBe('webgl');
	});
	it('lets the element attribute win over the query string both ways', () => {
		expect(resolveRendererPreference({ search: '?renderer=webgl', attr: 'webgpu' })).toBe('webgpu');
		expect(resolveRendererPreference({ search: '?renderer=webgpu', attr: 'webgl' })).toBe('webgl');
		expect(resolveRendererPreference({ search: '?renderer=webgpu', attr: '' })).toBe('webgpu');
	});
});

describe('createAutoRenderer fallback', () => {
	beforeEach(() => createWebGL.mockClear());
	afterEach(() => vi.unstubAllGlobals());

	it('never touches WebGPU unless asked', async () => {
		const gpu = { requestAdapter: vi.fn() };
		vi.stubGlobal('navigator', { gpu });
		const r = await createAutoRenderer({ antialias: true });
		expect(r.backend).toBe('webgl');
		expect(gpu.requestAdapter).not.toHaveBeenCalled();
		expect(r.renderer.domElement.dataset.renderer).toBe('webgl');
		expect(createWebGL).toHaveBeenCalledWith({ antialias: true }, { fallback: undefined });
	});

	it('falls back when navigator.gpu is missing', async () => {
		vi.stubGlobal('navigator', {});
		expect(await isWebGPUAvailable()).toBe(false);
		const r = await createAutoRenderer({}, { prefer: 'webgpu' });
		expect(r.backend).toBe('webgl');
		expect(r.reason).toMatch(/no adapter/);
	});

	it('falls back when the adapter request resolves to null', async () => {
		vi.stubGlobal('navigator', { gpu: { requestAdapter: async () => null } });
		expect(await isWebGPUAvailable()).toBe(false);
		expect((await createAutoRenderer({}, { prefer: 'webgpu' })).backend).toBe('webgl');
	});

	it('falls back when requestAdapter throws', async () => {
		vi.stubGlobal('navigator', {
			gpu: {
				requestAdapter: async () => {
					throw new Error('blocked');
				},
			},
		});
		expect(await isWebGPUAvailable()).toBe(false);
	});
});

describe('restyle effects (webgl path)', () => {
	it('patches glTF PBR materials with a rim term that stays out of the export', async () => {
		const fx = await createRestyleEffects('webgl');
		const mat = new MeshStandardMaterial();
		const root = new Group();
		root.add(new Mesh(new BoxGeometry(), mat));
		fx.adopt(root);
		expect(root.children[0].material).toBe(mat);
		expect(mat.userData).toEqual({});

		const shader = {
			uniforms: {},
			fragmentShader: '#include <common>\n#include <emissivemap_fragment>\n',
		};
		mat.onBeforeCompile(shader);
		expect(shader.fragmentShader).toContain('uniform vec3 uRimColor;');
		expect(shader.fragmentShader).toMatch(/totalEmissiveRadiance \+= uRimColor \* uRimStrength/);

		fx.setRim({ strength: 2, color: '#ff0000' });
		expect(shader.uniforms.uRimStrength.value).toBe(2);
		expect(shader.uniforms.uRimColor.value.r).toBeGreaterThan(0.9);
	});

	it('runs the export callback untouched when no node materials are in play', async () => {
		const fx = await createRestyleEffects('webgl');
		const out = await fx.withClassicMaterials(new Group(), async () => 'glb');
		expect(out).toBe('glb');
	});

	it('ignores non-finite strengths', async () => {
		const fx = await createRestyleEffects('webgl');
		const mat = new MeshStandardMaterial();
		const root = new Group();
		root.add(new Mesh(new BoxGeometry(), mat));
		fx.adopt(root);
		const shader = { uniforms: {}, fragmentShader: '#include <common>\n#include <emissivemap_fragment>' };
		mat.onBeforeCompile(shader);
		fx.setRim({ strength: 1 });
		fx.setRim({ strength: Number.NaN });
		expect(shader.uniforms.uRimStrength.value).toBe(1);
	});
});
