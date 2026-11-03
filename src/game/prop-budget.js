// Size budget for props that enter a shared /play world from outside the
// hand-authored catalog (forge-in-world today, any generated model tomorrow).
//
// Why it exists: a placed prop is delivered raw to every player in the world.
// ambient-crowd.js documents how uncapped user models killed iOS tabs, so the
// crowd got per-tier byte ceilings. A forged prop is the same hazard with a
// worse failure mode (one heavy generation reaches every phone in the room), so
// it gets a ceiling built from the same tiers.
//
// Ceilings (the single source of truth; docs/play-forge-in-world.md quotes them):
//
//   tier     max triangles   max file size
//   high        100,000         8 MB   (CROWD high is 12 MB, capped at the room's 8 MB prop limit)
//   medium       60,000         6 MB
//   low          30,000         3 MB
//
// The tier is the shared club-perf render profile, stepped down one notch on a
// coarse-pointer device (a phone), exactly as the crowd does: Safari reports
// neither deviceMemory nor hardwareConcurrency, so the profile calls a phone
// "plenty" and the phone is the device that actually gets killed.
//
// Pure module: no DOM, no three.js. The GLB is measured from its JSON chunk
// (accessor counts survive EXT_meshopt_compression and Draco, so nothing has to
// be decoded to count triangles).

import { detectProfile } from '../club-perf.js';

export const MB = 1024 * 1024;

/** Per-tier model byte ceiling. ambient-crowd.js reads its `maxModelBytes` from here. */
export const CROWD_MODEL_BYTES = Object.freeze({ high: 12 * MB, medium: 6 * MB, low: 3 * MB });

/** The room's hard per-prop limit (PROP_ASSET_MAX_BYTES in multiplayer/src/build-limits.js). */
export const ROOM_PROP_MAX_BYTES = 8 * MB;

/** Per-tier triangle ceiling for one placed prop. */
export const PROP_TRIANGLES = Object.freeze({ high: 100_000, medium: 60_000, low: 30_000 });

/** Never download more than this just to measure a model (a runaway result must not stall a tab). */
export const MEASURE_MAX_BYTES = 64 * MB;

/** A simplify pass aims this far under the ceiling so the re-check passes with margin. */
export const SIMPLIFY_HEADROOM = 0.8;

/** The remesh worker's lower bound on target faces (api/forge-remesh.js). */
export const REMESH_MIN_FACES = 1_000;

const TIERS = ['high', 'medium', 'low'];

/**
 * The tier a device is held to: its render profile, one step down on a coarse
 * pointer. Shared by the crowd and by prop budgets so the two cannot drift.
 * @param {'high'|'medium'|'low'} profile
 * @param {boolean} coarsePointer
 */
export function budgetTier(profile, coarsePointer) {
	let i = Math.max(0, TIERS.indexOf(profile));
	if (coarsePointer) i = Math.min(TIERS.length - 1, i + 1);
	return TIERS[i];
}

/** Read the live device: club-perf profile and the primary pointer type. */
export function currentBudgetTier() {
	const coarse = typeof matchMedia === 'function' && matchMedia('(pointer: coarse)').matches;
	return budgetTier(detectProfile(), coarse);
}

/**
 * The ceiling for one placed prop on this device (or on the given one).
 * @returns {{tier:string, maxTriangles:number, maxBytes:number}}
 */
export function propBudget({ profile, coarse } = {}) {
	const tier = profile === undefined && coarse === undefined ? currentBudgetTier() : budgetTier(profile ?? 'medium', !!coarse);
	return {
		tier,
		maxTriangles: PROP_TRIANGLES[tier],
		maxBytes: Math.min(CROWD_MODEL_BYTES[tier], ROOM_PROP_MAX_BYTES),
	};
}

/** Does a measured model fit the ceiling? Returns the reasons it does not (empty when it fits). */
export function overBudget(measured, budget) {
	const reasons = [];
	if (measured.triangles > budget.maxTriangles) reasons.push('triangles');
	if (measured.bytes > budget.maxBytes) reasons.push('bytes');
	return reasons;
}

/** Face target to hand the remesh worker so the result lands under the ceiling. */
export function simplifyTarget(budget) {
	return Math.max(REMESH_MIN_FACES, Math.floor(budget.maxTriangles * SIMPLIFY_HEADROOM));
}

/** "48,200 triangles" / "9.4 MB" fragments for user-facing copy. */
export function describeSize({ triangles, bytes }) {
	return `${Number(triangles).toLocaleString('en-US')} triangles, ${(bytes / MB).toFixed(1)} MB`;
}

const GLB_MAGIC = 0x46546c67; // 'glTF'
const CHUNK_JSON = 0x4e4f534a; // 'JSON'

/**
 * Count the triangles in a GLB from its JSON chunk. Handles indexed and
 * non-indexed primitives, strips and fans, and a mesh instanced by several nodes
 * (each instance is drawn, so each counts). Throws on anything that is not a GLB.
 * @param {ArrayBuffer} buffer
 * @returns {number}
 */
export function countGlbTriangles(buffer) {
	const view = new DataView(buffer);
	if (buffer.byteLength < 20 || view.getUint32(0, true) !== GLB_MAGIC) {
		throw new Error('not a GLB file');
	}
	const jsonLength = view.getUint32(12, true);
	if (view.getUint32(16, true) !== CHUNK_JSON || 20 + jsonLength > buffer.byteLength) {
		throw new Error('GLB has no JSON chunk');
	}
	const gltf = JSON.parse(new TextDecoder().decode(new Uint8Array(buffer, 20, jsonLength)));
	const accessors = gltf.accessors || [];
	const meshes = gltf.meshes || [];

	const perMesh = meshes.map((mesh) => {
		let tris = 0;
		for (const prim of mesh.primitives || []) {
			const mode = prim.mode ?? 4;
			if (mode < 4) continue; // points and lines draw no triangles
			const source = prim.indices !== undefined ? accessors[prim.indices] : accessors[prim.attributes?.POSITION];
			const n = source?.count || 0;
			if (mode === 4) tris += Math.floor(n / 3);
			else tris += Math.max(0, n - 2); // strip (5) or fan (6)
		}
		return tris;
	});

	const nodes = gltf.nodes || [];
	let total = 0;
	let instanced = false;
	for (const node of nodes) {
		if (node.mesh !== undefined && perMesh[node.mesh] !== undefined) {
			total += perMesh[node.mesh];
			instanced = true;
		}
	}
	// A file with meshes but no node referencing them still renders nothing, but
	// count the meshes so a malformed file cannot sneak under the ceiling.
	if (!instanced) total = perMesh.reduce((a, b) => a + b, 0);
	return total;
}
