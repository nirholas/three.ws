// The "preserve" contract an edit operation declares before it touches a GLB:
// which of topology, UVs, skeleton, skin and clips it promises to keep intact.
// verifyPreserved() checks that promise against the REAL output with
// @three-ws/glb-diff instead of trusting the operation's own say-so: an
// operation that promises `uv` but hands back a GLB whose UVs moved never
// gets to report success; it throws a PreserveViolationError instead.
//
// Isomorphic (only depends on @three-ws/glb-diff, which takes bytes), so the
// same contract runs in a Node API handler, a Cloud Run worker, or a browser
// tab, wherever the before/after bytes of an edit happen to meet.

import { describeModel, diffDescriptions } from '@three-ws/glb-diff';

export const PRESERVE_KINDS = ['topology', 'uv', 'skeleton', 'skin', 'clips'];

export class PreserveViolationError extends Error {
	constructor(message, { status = 502, code = 'preserve_violation', violations = [] } = {}) {
		super(message);
		this.name = 'PreserveViolationError';
		this.status = status;
		this.code = code;
		this.violations = violations;
	}
}

function assertKnownKinds(kinds) {
	const unknown = kinds.filter((k) => !PRESERVE_KINDS.includes(k));
	if (unknown.length) {
		throw new Error(`preserve-contract: unknown kind(s) ${unknown.join(', ')}, known: ${PRESERVE_KINDS.join(', ')}`);
	}
}

// Mesh-section fields each geometry-level kind depends on. 'skin' here means
// the per-vertex JOINTS_0/WEIGHTS_0 binding baked into the mesh, as distinct
// from the Skin *resource* (joint list, bind matrices) checked below.
const MESH_FIELDS = {
	topology: ['topology', 'vertices', 'triangles', 'primitives'],
	uv: ['uv'],
	skin: ['skinWeights'],
};

function meshViolations(sections, kind) {
	const fields = MESH_FIELDS[kind];
	const out = [];
	for (const mesh of sections.meshes.modified) {
		for (const change of mesh.changes) {
			if (fields.includes(change.field)) {
				out.push({ kind, section: 'meshes', name: mesh.name, field: change.field, detail: change.note || `${change.field} changed` });
			}
		}
	}
	for (const mesh of sections.meshes.removed) {
		out.push({ kind, section: 'meshes', name: mesh.name, field: 'removed', detail: mesh.detail || 'mesh removed' });
	}
	for (const mesh of sections.meshes.added) {
		out.push({ kind, section: 'meshes', name: mesh.name, field: 'added', detail: mesh.detail || 'mesh added' });
	}
	return out;
}

// The skeleton itself: which joints exist, their names, and where the skin is
// rooted: the shape every clip and every attachment addresses by name.
function skeletonViolations(sections) {
	const out = [];
	for (const skin of sections.skins.modified) {
		for (const change of skin.changes) {
			if (change.field === 'joints' || change.field === 'jointCount' || change.field === 'skeleton') {
				out.push({ kind: 'skeleton', section: 'skins', name: skin.name, field: change.field, detail: change.note || `${change.field} changed` });
			}
		}
	}
	for (const skin of sections.skins.removed) {
		out.push({ kind: 'skeleton', section: 'skins', name: skin.name, field: 'removed', detail: skin.detail || 'skeleton removed' });
	}
	for (const skin of sections.skins.added) {
		out.push({ kind: 'skeleton', section: 'skins', name: skin.name, field: 'added', detail: skin.detail || 'skeleton added' });
	}
	for (const node of sections.nodes.modified) {
		for (const change of node.changes) {
			if (change.field === 'skin') {
				out.push({ kind: 'skeleton', section: 'nodes', name: node.name, field: 'skin', detail: 'node skin assignment changed' });
			}
		}
	}
	return out;
}

// The skin BINDING: the bind pose (inverse bind matrices) plus the per-vertex
// weights baked into the mesh. Either one changing deforms the same clip
// differently, even when the skeleton's joint names are untouched.
function skinBindViolations(sections) {
	const out = [];
	for (const skin of sections.skins.modified) {
		for (const change of skin.changes) {
			if (change.field === 'inverseBindMatrices') {
				out.push({ kind: 'skin', section: 'skins', name: skin.name, field: change.field, detail: change.note || 'bind pose changed' });
			}
		}
	}
	return [...out, ...meshViolations(sections, 'skin')];
}

function clipViolations(sections) {
	const out = [];
	for (const clip of sections.animations.removed) {
		out.push({ kind: 'clips', section: 'animations', name: clip.name, field: 'removed', detail: clip.detail || 'animation removed' });
	}
	for (const clip of sections.animations.modified) {
		for (const change of clip.changes) {
			out.push({ kind: 'clips', section: 'animations', name: clip.name, field: change.field, detail: change.note || `${change.field} changed` });
		}
	}
	return out;
}

const KIND_CHECKS = {
	topology: (sections) => meshViolations(sections, 'topology'),
	uv: (sections) => meshViolations(sections, 'uv'),
	skeleton: skeletonViolations,
	skin: skinBindViolations,
	clips: clipViolations,
};

/**
 * Check that an edit kept the properties it promised to keep.
 *
 * @param {Uint8Array|Buffer} beforeBytes the GLB before the edit
 * @param {Uint8Array|Buffer} afterBytes the GLB after the edit
 * @param {string[]} kinds which PRESERVE_KINDS the edit declares it keeps
 * @param {{ label?: string }} [opts] a short name for the operation, used in the thrown message
 * @returns {Promise<{ changes: object, violations: [] }>} the full glb-diff change set when every declared kind held
 * @throws {PreserveViolationError} when any declared kind changed
 */
export async function verifyPreserved(beforeBytes, afterBytes, kinds, { label } = {}) {
	const list = Array.isArray(kinds) ? [...new Set(kinds)] : [];
	assertKnownKinds(list);
	if (!list.length) return { changes: null, violations: [] };

	const [before, after] = await Promise.all([
		describeModel(beforeBytes, { name: 'before' }),
		describeModel(afterBytes, { name: 'after' }),
	]);
	const changes = diffDescriptions(before, after);

	const violations = list.flatMap((kind) => KIND_CHECKS[kind](changes.sections));
	if (violations.length) {
		const kindsHit = [...new Set(violations.map((v) => v.kind))].join(', ');
		const detail = violations.map((v) => `${v.kind}:${v.section}/${v.name}.${v.field}`).join('; ');
		throw new PreserveViolationError(
			`${label ? `${label}: ` : ''}edit did not preserve ${kindsHit} (${detail})`,
			{ violations },
		);
	}
	return { changes, violations: [] };
}
