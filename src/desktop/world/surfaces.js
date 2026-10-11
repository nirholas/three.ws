// Real materials for the campus: scanned PBR surfaces (grass, paving,
// plaster, brick, wood, marble, concrete, rock, roof tiles) from Poly Haven,
// CC0, resized into public/campus by scripts/build-campus-textures.mjs.
// One material per surface role is shared by every mesh that wears it; the
// geometry's UVs are scaled to the surface's real metres-per-tile instead of
// cloning textures, so a 9 m wall and a 2 m counter tile the same plaster at
// the same size. Every material exists at once with a flat base colour and
// takes its maps as the images arrive, so the first frame is never bare.

import { Color, MeshStandardMaterial, RepeatWrapping, SRGBColorSpace, TextureLoader } from 'three';

export const MANIFEST_URL = '/campus/manifest.json';

/** Base colours (and material tuning) per role, shown until the scans load and under them. */
const ROLES = {
	ground: { color: 0x5f7a3e, roughness: 1 },
	plaza: { color: 0x9a948c, roughness: 0.9 },
	path: { color: 0xa09c96, roughness: 0.95 },
	wall: { color: 0xd9d4cb, roughness: 0.85 },
	brick: { color: 0x9a6a55, roughness: 0.9 },
	'floor-wood': { color: 0x8c6a4a, roughness: 0.6 },
	'floor-marble': { color: 0xd8d6d0, roughness: 0.3 },
	'floor-concrete': { color: 0x8e8d8a, roughness: 0.8 },
	rock: { color: 0x6c655c, roughness: 1 },
	// Roof tiles photograph dark and sit at a grazing angle to the sun: lift them so they read as slate, not a hole.
	roof: { color: 0x5a5b60, roughness: 0.85, tint: 2.2 },
};

/** Fallback metres-per-tile when the manifest has not arrived yet. */
const TILE = { ground: 3, plaza: 3, path: 2.5, wall: 3, brick: 2.5, 'floor-wood': 2.5, 'floor-marble': 3, 'floor-concrete': 3, rock: 4, roof: 2.5 };

/**
 * @param {{ normals?: boolean, anisotropy?: number }} [o] `normals: false` skips normal maps (phones)
 */
export function createSurfaces({ normals = true, anisotropy = 8 } = {}) {
	const loader = new TextureLoader();
	const materials = {};
	const textures = [];
	for (const [role, tune] of Object.entries(ROLES)) materials[role] = new MeshStandardMaterial({ color: tune.color, roughness: tune.roughness, metalness: 0 });
	let disposed = false;

	function texture(url, srgb) {
		const tex = loader.load(url);
		tex.wrapS = tex.wrapT = RepeatWrapping;
		tex.anisotropy = anisotropy;
		tex.channel = 0;
		if (srgb) tex.colorSpace = SRGBColorSpace;
		textures.push(tex);
		return tex;
	}

	const ready = fetch(MANIFEST_URL)
		.then((r) => (r.ok ? r.json() : Promise.reject(new Error(`campus manifest ${r.status}`))))
		.then((manifest) => {
			if (disposed) return manifest;
			for (const set of Object.values(manifest.sets || {})) {
				const mat = materials[set.role];
				if (!mat) continue;
				TILE[set.role] = set.metresPerTile || TILE[set.role];
				mat.map = texture(set.diff, true);
				const arm = texture(set.arm, false);
				mat.aoMap = arm;
				mat.roughnessMap = arm;
				mat.metalnessMap = arm;
				mat.aoMapIntensity = 0.9;
				mat.roughness = 1;
				mat.metalness = 1;
				if (normals) mat.normalMap = texture(set.nor, false);
				mat.color = new Color().setScalar(ROLES[set.role].tint ?? 1);
				mat.needsUpdate = true;
			}
			return manifest;
		});

	return {
		/** The shared material for a role. */
		material: (role) => materials[role] || materials.wall,
		/** Metres one tile of a role covers; UV scaling uses it. */
		metresPerTile: (role) => TILE[role] || 3,
		/** Resolves once the manifest is read (maps keep streaming in after). Errors surface to the caller. */
		ready,
		dispose() {
			disposed = true;
			for (const t of textures) t.dispose();
			for (const m of Object.values(materials)) m.dispose();
		},
	};
}

/**
 * Scale a BoxGeometry's UVs so each face tiles every `m` metres. Faces are
 * emitted +x, -x, +y, -y, +z, -z with four vertices each.
 */
export function tileBox(geom, w, h, d, m) {
	const uv = geom.attributes.uv;
	const dims = [[d, h], [d, h], [w, d], [w, d], [w, h], [w, h]];
	for (let i = 0; i < uv.count; i++) {
		const face = Math.min(5, Math.floor(i / 4));
		const [fw, fh] = dims[face];
		uv.setXY(i, uv.getX(i) * (fw / m), uv.getY(i) * (fh / m));
	}
	uv.needsUpdate = true;
	return geom;
}

/** Scale a plane or circle's UVs so it tiles every `m` metres (`w`, `h` are its full extents). */
export function tilePlane(geom, w, h, m) {
	const uv = geom.attributes.uv;
	for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * (w / m), uv.getY(i) * (h / m));
	uv.needsUpdate = true;
	return geom;
}
