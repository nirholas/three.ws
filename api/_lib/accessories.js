// Baked preset allowlist — IDs mirror public/accessories/presets.json.
// Inline constant avoids runtime fs I/O in Vercel serverless.
// When the preset pack changes, update both files together.

const PRESET_IDS = new Set([
	'outfit-casual',
	'outfit-formal',
	'outfit-sporty',
	'hat-baseball',
	'hat-beanie',
	'hat-cowboy',
	'glasses-round',
	'glasses-shades',
	'earrings-hoops',
	'earrings-studs',
]);

export function isValidPresetId(id) {
	return PRESET_IDS.has(id);
}

export function validateAppearance(appearance) {
	if (!appearance) return null;

	if (appearance.outfit !== undefined && appearance.outfit !== null) {
		if (typeof appearance.outfit !== 'string') return 'appearance.outfit must be a string or null';
		if (!isValidPresetId(appearance.outfit)) return `unknown preset id: ${appearance.outfit}`;
	}

	if (appearance.accessories !== undefined) {
		if (!Array.isArray(appearance.accessories)) return 'appearance.accessories must be an array';
		if (appearance.accessories.length > 8) return 'appearance.accessories max length is 8';
		for (const id of appearance.accessories) {
			if (typeof id !== 'string') return 'appearance.accessories entries must be strings';
			if (!isValidPresetId(id)) return `unknown preset id: ${id}`;
		}
	}

	if (appearance.morphs !== undefined) {
		if (typeof appearance.morphs !== 'object' || Array.isArray(appearance.morphs)) {
			return 'appearance.morphs must be an object';
		}
		const entries = Object.entries(appearance.morphs);
		if (entries.length > 32) return 'appearance.morphs max 32 keys';
		for (const [k, v] of entries) {
			if (typeof v !== 'number' || v < 0 || v > 1) {
				return `appearance.morphs["${k}"] must be a number 0..1`;
			}
		}
	}

	return null;
}
