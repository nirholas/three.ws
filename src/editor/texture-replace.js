/**
 * Texture replacement for the editor: validate a picked image, preview it live
 * on the Three.js material, and describe it for the session so the export can
 * write the same bytes into the GLB.
 */
import { SRGBColorSpace, NoColorSpace, Texture } from 'three';

export const ACCEPTED_TEXTURE_TYPES = ['image/png', 'image/jpeg', 'image/webp'];
/** Generous for a single map; the whole GLB is capped by the publish API (500 MB). */
export const MAX_TEXTURE_BYTES = 32 * 1024 * 1024;

/** Editable export slot -> the Three.js material properties that render it. */
export const SLOT_TO_MAPS = {
	baseColor: ['map'],
	normal: ['normalMap'],
	metallicRoughness: ['metalnessMap', 'roughnessMap'],
	occlusion: ['aoMap'],
	emissive: ['emissiveMap'],
};

const SRGB_SLOTS = new Set(['baseColor', 'emissive']);

/** Three.js material property -> editable slot id, or null when the slot is not replaceable. */
export function slotForMap(prop) {
	for (const [slot, props] of Object.entries(SLOT_TO_MAPS)) if (props.includes(prop)) return slot;
	return null;
}

/**
 * @param {File} file
 * @returns {string|null} a human reason the file cannot be used, or null when it is fine
 */
export function validateTextureFile(file) {
	if (!file) return 'Choose an image file.';
	if (!ACCEPTED_TEXTURE_TYPES.includes(file.type)) {
		return `${file.type || 'This file type'} is not supported. Use a PNG, JPEG or WebP image.`;
	}
	if (file.size > MAX_TEXTURE_BYTES) {
		return `That image is ${(file.size / 1048576).toFixed(1)} MB. The limit is ${MAX_TEXTURE_BYTES / 1048576} MB.`;
	}
	if (file.size === 0) return 'That file is empty.';
	return null;
}

function decode(bytes, mime) {
	return new Promise((resolve, reject) => {
		const url = URL.createObjectURL(new Blob([bytes], { type: mime }));
		const img = new Image();
		img.onload = () => {
			URL.revokeObjectURL(url);
			resolve(img);
		};
		img.onerror = () => {
			URL.revokeObjectURL(url);
			reject(new Error('The browser could not decode that image.'));
		};
		img.src = url;
	});
}

/**
 * Show `bytes` on `material` in `slot`, keeping the wrap and UV channel of the
 * texture it replaces. Resolves to the properties it changed.
 * @returns {Promise<string[]>}
 */
export async function previewTexture(material, slot, bytes, mime) {
	const props = SLOT_TO_MAPS[slot];
	if (!props) throw new Error(`Unknown texture slot "${slot}"`);
	const image = await decode(bytes, mime);
	const changed = [];
	for (const prop of props) {
		const previous = material[prop];
		const tex = new Texture(image);
		tex.flipY = false; // glTF UV convention
		tex.colorSpace = SRGB_SLOTS.has(slot) ? SRGBColorSpace : NoColorSpace;
		tex.wrapS = previous?.wrapS ?? tex.wrapS;
		tex.wrapT = previous?.wrapT ?? tex.wrapT;
		tex.channel = previous?.channel ?? 0;
		tex.needsUpdate = true;
		material[prop] = tex;
		changed.push(prop);
	}
	material.needsUpdate = true;
	return changed;
}
