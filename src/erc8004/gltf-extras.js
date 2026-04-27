/**
 * Embed and extract agent manifests from glTF/GLB extras.
 *
 * The manifest lives at document.extras.agent so that standard glTF tools
 * ignore it gracefully while any ERC-8004-aware renderer can find it.
 *
 * Usage:
 *   const glb = await embedAgentExtras(originalGlb, manifest);
 *   const manifest = await readAgentExtras(glb);
 */

import { Document, NodeIO } from '@gltf-transform/core';

const io = new NodeIO();

/**
 * Embed an agent manifest into a GLB's extras field.
 *
 * @param {ArrayBuffer|Uint8Array} glb  Source GLB bytes
 * @param {object} manifest             Agent manifest (agent-manifest/0.1 shape)
 * @returns {Promise<Uint8Array>}       Modified GLB bytes
 */
export async function embedAgentExtras(glb, manifest) {
	const buffer = glb instanceof ArrayBuffer ? new Uint8Array(glb) : glb;
	const doc = await io.readBinary(buffer);
	const root = doc.getRoot();

	const existing = root.getExtras() || {};
	root.setExtras({ ...existing, agent: manifest });

	return io.writeBinary(doc);
}

/**
 * Read the agent manifest embedded in a GLB's extras field.
 *
 * @param {ArrayBuffer|Uint8Array} glb
 * @returns {Promise<object|null>}  The manifest, or null if not present
 */
export async function readAgentExtras(glb) {
	const buffer = glb instanceof ArrayBuffer ? new Uint8Array(glb) : glb;
	const doc = await io.readBinary(buffer);
	const extras = doc.getRoot().getExtras() || {};
	return extras.agent ?? null;
}

/**
 * Check whether a GLB has an embedded agent manifest.
 *
 * @param {ArrayBuffer|Uint8Array} glb
 * @returns {Promise<boolean>}
 */
export async function hasAgentExtras(glb) {
	const manifest = await readAgentExtras(glb);
	return manifest !== null;
}
