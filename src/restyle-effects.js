// Restyle view effects that run on whichever backend the renderer factory chose.
//
// The Restyle Studio edits plain glTF PBR materials. A view effect is something
// the live preview adds on top of those materials without changing the exported
// asset, so it must never leak into the GLB. Two implementations of the same
// look share one parameter set:
//
//   webgl   MeshStandardMaterial + an `onBeforeCompile` patch that adds a
//           Fresnel rim term to `totalEmissiveRadiance`.
//   webgpu  MeshStandardNodeMaterial / MeshPhysicalNodeMaterial with an
//           `emissiveNode` built from TSL (`three/tsl`), the same term.
//
// Because node materials are not glTF-exportable, the WebGPU path swaps the
// loaded materials for node materials on mount and `withClassicMaterials`
// swaps the original classic materials back for the duration of an export, so
// the exported GLB is identical regardless of backend.

import { Color } from 'three';

export const RIM_POWER = 3;

const classicOf = new WeakMap(); // node material -> the glTF material it replaced

function isGltfPbr(m) {
	return !!m && 'metalness' in m && 'roughness' in m && !!m.color && typeof m.color.getHex === 'function';
}

function eachMaterialSlot(root, visit) {
	root.traverse((node) => {
		if (!node.material) return;
		if (Array.isArray(node.material)) {
			node.material = node.material.map((m) => visit(m, node));
		} else {
			node.material = visit(node.material, node);
		}
	});
}

/**
 * Backend adapter for one Restyle session.
 *
 * @param {'webgpu' | 'webgl'} backend
 * @returns {Promise<{
 *   backend: string,
 *   adopt: (root: import('three').Object3D) => void,
 *   setRim: (p: { strength?: number, color?: string }) => void,
 *   withClassicMaterials: <T>(root: import('three').Object3D, fn: () => Promise<T>) => Promise<T>,
 * }>}
 */
export async function createRestyleEffects(backend) {
	const rim = { color: new Color('#6ea8ff'), strength: 0 };
	const webgpu = backend === 'webgpu';

	let tsl = null;
	let nodes = null;
	let rimNodeUniforms = null;
	if (webgpu) {
		const [tslMod, webgpuMod] = await Promise.all([import('three/tsl'), import('three/webgpu')]);
		tsl = tslMod;
		nodes = webgpuMod;
		rimNodeUniforms = { color: tsl.uniform(rim.color), strength: tsl.uniform(rim.strength) };
	}
	const glslUniforms = { uRimColor: { value: rim.color }, uRimStrength: { value: rim.strength } };

	const patched = new WeakSet();

	function patchClassic(m) {
		if (!isGltfPbr(m) || patched.has(m)) return m;
		m.onBeforeCompile = (shader) => {
			shader.uniforms.uRimColor = glslUniforms.uRimColor;
			shader.uniforms.uRimStrength = glslUniforms.uRimStrength;
			shader.fragmentShader = shader.fragmentShader
				.replace(
					'#include <common>',
					'#include <common>\nuniform vec3 uRimColor;\nuniform float uRimStrength;',
				)
				.replace(
					'#include <emissivemap_fragment>',
					`#include <emissivemap_fragment>
totalEmissiveRadiance += uRimColor * uRimStrength * pow(1.0 - clamp(dot(normalize(normal), normalize(vViewPosition)), 0.0, 1.0), ${RIM_POWER.toFixed(1)});`,
				);
		};
		m.customProgramCacheKey = () => 'restyle-rim';
		// A WeakSet, not userData: userData is serialised into the GLB.
		patched.add(m);
		m.needsUpdate = true;
		return m;
	}

	function toNodeMaterial(m) {
		if (!isGltfPbr(m) || m.isNodeMaterial) return m;
		const Cls = m.isMeshPhysicalMaterial ? nodes.MeshPhysicalNodeMaterial : nodes.MeshStandardNodeMaterial;
		const node = new Cls();
		for (const key in m) node[key] = m[key];
		const { materialEmissive, normalView, positionViewDirection, dot, saturate, oneMinus, pow, float } = tsl;
		const fresnel = pow(oneMinus(saturate(dot(normalView, positionViewDirection))), float(RIM_POWER));
		node.emissiveNode = materialEmissive.add(rimNodeUniforms.color.mul(rimNodeUniforms.strength).mul(fresnel));
		classicOf.set(node, m);
		node.needsUpdate = true;
		return node;
	}

	function adopt(root) {
		const done = new Map();
		eachMaterialSlot(root, (m) => {
			if (done.has(m)) return done.get(m);
			const next = webgpu ? toNodeMaterial(m) : patchClassic(m);
			done.set(m, next);
			return next;
		});
	}

	function setRim({ strength, color } = {}) {
		if (typeof strength === 'number' && Number.isFinite(strength)) {
			rim.strength = Math.max(0, strength);
			glslUniforms.uRimStrength.value = rim.strength;
			if (rimNodeUniforms) rimNodeUniforms.strength.value = rim.strength;
		}
		if (color) {
			rim.color.set(color);
			// The uniforms hold the same Color instance, so both paths follow it.
		}
	}

	async function withClassicMaterials(root, fn) {
		if (!webgpu) return fn();
		const restore = new Map(); // classic -> node material
		eachMaterialSlot(root, (m) => {
			const classic = classicOf.get(m);
			if (!classic) return m;
			// Sync every live edit made on the node material back onto the classic
			// one it replaced, so the export carries the user's changes.
			for (const key of SYNCED_KEYS) if (key in m) copyProp(classic, key, m[key]);
			restore.set(classic, m);
			return classic;
		});
		try {
			return await fn();
		} finally {
			eachMaterialSlot(root, (m) => restore.get(m) ?? m);
		}
	}

	return { backend, adopt, setRim, withClassicMaterials };
}

const SYNCED_KEYS = [
	'color', 'metalness', 'roughness', 'emissive', 'emissiveIntensity', 'opacity', 'transparent',
	'map', 'normalMap', 'roughnessMap', 'metalnessMap', 'emissiveMap', 'aoMap', 'alphaMap',
	'envMapIntensity', 'side', 'alphaTest',
	'clearcoat', 'clearcoatRoughness', 'transmission', 'thickness', 'ior', 'sheen', 'sheenRoughness',
	'sheenColor', 'iridescence', 'iridescenceIOR', 'specularIntensity', 'specularColor',
];

function copyProp(target, key, value) {
	const cur = target[key];
	if (cur && cur.isColor && value && value.isColor) cur.copy(value);
	else target[key] = value;
}
