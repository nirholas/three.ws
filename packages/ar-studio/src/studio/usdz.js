// GLB to USDZ, in the browser.
//
// This is what makes "Place in your space" real on an iPhone. Apple's AR Quick
// Look is the only way to get true ARKit placement on iOS, and it reads USDZ,
// not glTF. There is no server here doing the conversion: the model is loaded
// into a scene, prepared, and exported with three.js's own USDZExporter, on the
// device, in a couple of seconds.
//
// Three preparation steps matter, and skipping any of them produces a model
// that loads but looks broken:
//
//   1. Skinned meshes are baked to static geometry. USDZExporter carries no
//      skeletons: it writes raw vertex attributes plus each node's world
//      matrix. Export a rigged character without baking and Quick Look shows a
//      collapsed pile with limbs balled at the hips.
//   2. Materials are coerced to MeshStandardMaterial. USDZ speaks
//      UsdPreviewSurface, which maps cleanly from Standard only; unlit, Phong
//      and Toon materials are dropped with a warning.
//   3. Missing normals are computed. Position-only meshes (decimated props,
//      procedural geometry) otherwise export flat and unlit.
//
// Ported from the three.ws USDZ pipeline (Apache-2.0).

import {
	Box3, BufferAttribute, Color, DoubleSide, Group, Mesh, MeshStandardMaterial, Vector3,
} from 'three';
import { clone as cloneSkinnedScene } from 'three/addons/utils/SkeletonUtils.js';
import { sharedGLTFLoaderReady } from './loaders.js';
import { fitTransform } from './scene-math.js';

/**
 * CPU-skin one SkinnedMesh at its current pose, returning deformed positions in
 * the mesh's own local space. The caller must have updated world matrices.
 *
 * @param {import('three').SkinnedMesh} mesh
 * @returns {Float32Array} vertexCount * 3
 */
export function bakedLocalPositions(mesh) {
	const posAttr = mesh.geometry.getAttribute('position');
	const out = new Float32Array(posAttr.count * 3);
	const v = new Vector3();
	for (let i = 0; i < posAttr.count; i++) {
		v.fromBufferAttribute(posAttr, i);
		mesh.applyBoneTransform(i, v);
		out[i * 3] = v.x;
		out[i * 3 + 1] = v.y;
		out[i * 3 + 2] = v.z;
	}
	return out;
}

/** Replace every SkinnedMesh with a static Mesh frozen at the current pose. */
export function bakeSkinnedMeshes(scene) {
	scene.updateMatrixWorld(true);
	const skinned = [];
	scene.traverse((obj) => {
		if (obj.isSkinnedMesh && obj.skeleton?.bones?.length) skinned.push(obj);
	});

	for (const mesh of skinned) {
		if (!mesh.geometry.getAttribute('position')) continue;
		const baked = mesh.geometry.clone();
		baked.setAttribute('position', new BufferAttribute(bakedLocalPositions(mesh), 3));
		// Skinning data is meaningless on a static mesh and confuses the exporter.
		baked.deleteAttribute('skinIndex');
		baked.deleteAttribute('skinWeight');
		// Normals were authored for the bind pose; recompute so the shading
		// matches the geometry Quick Look actually receives.
		baked.computeVertexNormals();

		const replacement = new Mesh(baked, mesh.material);
		replacement.name = mesh.name;
		replacement.visible = mesh.visible;
		// applyBoneTransform returns local-space vertices, so the replacement
		// keeps the original's local transform and the exporter applies it.
		replacement.position.copy(mesh.position);
		replacement.quaternion.copy(mesh.quaternion);
		replacement.scale.copy(mesh.scale);

		const parent = mesh.parent || scene;
		parent.add(replacement);
		parent.remove(mesh);
	}
}

/** Coerce every material to MeshStandardMaterial, in place. */
export function coerceMaterialsToStandard(scene) {
	scene.traverse((obj) => {
		if (!obj.isMesh) return;
		const mats = Array.isArray(obj.material) ? obj.material : [obj.material];
		mats.forEach((m, i) => {
			if (!m || m.isMeshStandardMaterial) return;
			const replacement = new MeshStandardMaterial({
				color: m.color ? m.color.clone() : new Color(0xffffff),
				map: m.map || null,
				normalMap: m.normalMap || null,
				roughness: typeof m.roughness === 'number' ? m.roughness : 0.85,
				metalness: typeof m.metalness === 'number' ? m.metalness : 0,
				transparent: !!m.transparent,
				opacity: typeof m.opacity === 'number' ? m.opacity : 1,
				side: m.side ?? DoubleSide,
			});
			if (Array.isArray(obj.material)) obj.material[i] = replacement;
			else obj.material = replacement;
		});
	});
}

/** Give every renderable mesh a normal attribute. */
export function ensureNormals(scene) {
	scene.traverse((obj) => {
		if (!obj.isMesh || !obj.geometry) return;
		if (obj.geometry.getAttribute('normal')) return;
		if (!obj.geometry.getAttribute('position')) return;
		obj.geometry.computeVertexNormals();
	});
}

/**
 * Wrap content in a fresh, identity-transform root and a `stage` node that
 * carries the export's own placement.
 *
 * THIS WRAPPER IS NOT TIDINESS, IT IS A CORRECTNESS FIX. `USDZExporter` walks
 * `scene.children` and writes each node's LOCAL matrix, so the transform on the
 * object you hand it is never written at all. Set a scale on the root and the
 * export silently comes out at the original size; set a position and it is
 * silently dropped. Everything this module needs to place a model (the pinch
 * scale, the floor offset, the recentre) therefore lives on `stage`, which is a
 * child and so does get written.
 *
 * @param {import('three').Object3D} object
 * @returns {{root: import('three').Group, stage: import('three').Group}}
 */
export function usdzExportRoot(object) {
	const root = new Group();
	root.name = 'Root';
	const stage = new Group();
	stage.name = 'Model';
	stage.add(object);
	root.add(stage);
	root.updateMatrixWorld(true);
	return { root, stage };
}

/** World-space bounds of a prepared export root, or null when it holds nothing. */
function measure(root) {
	root.updateMatrixWorld(true);
	const box = new Box3().setFromObject(root);
	if (box.isEmpty()) return null;
	const min = box.min, max = box.max;
	if (![min.x, min.y, min.z, max.x, max.y, max.z].every(Number.isFinite)) return null;
	return box;
}

/**
 * Stand the model on y=0 with its footprint centred on the origin.
 *
 * This is the single thing that decides whether AR Quick Look puts a model on
 * someone's floor or leaves it hanging in mid-air. Quick Look anchors the
 * scene's ORIGIN to the horizontal plane it detects and does not look at the
 * geometry: a GLB authored with its origin at the bounding-box centre arrives
 * half-buried, one authored around a distant scene origin arrives floating
 * across the room at eye level, and in both cases the model reads as "not
 * tracking" because it never touches the ground the person is pointing at.
 * Neither is a Quick Look bug and no anchoring property fixes it; the content
 * has to be moved.
 *
 * @param {import('three').Group} stage  The node from `usdzExportRoot`.
 * @param {import('three').Group} root
 * @returns {boolean} false when there was nothing to ground.
 */
export function groundOnFloor(stage, root) {
	const box = measure(root);
	if (!box) return false;
	const centre = box.getCenter(new Vector3());
	stage.position.x -= centre.x;
	stage.position.y -= box.min.y;
	stage.position.z -= centre.z;
	root.updateMatrixWorld(true);
	return true;
}

/**
 * Give the model a believable real-world size.
 *
 * USDZ is metres (`metersPerUnit = 1`), and a model authored in centimetres
 * arrives a hundred times too big. A ten-metre chair cannot sit on a plane
 * ARKit found in a living room, so Quick Look shows it swimming around the
 * viewer rather than resting anywhere: the same symptom as a broken anchor,
 * from a completely different cause.
 *
 * Uses the studio's own normalization rule, so a model placed through the
 * studio and the same model converted straight from its URL land at the same
 * size. Models already within 2x of a believable size are left exactly as
 * authored: real furniture scans stay real.
 *
 * @param {import('three').Group} stage
 * @param {import('three').Group} root
 * @returns {number} the scale applied (1 when the model was already sane).
 */
export function fitToRoomScale(stage, root) {
	const box = measure(root);
	if (!box) return 1;
	let skinned = false;
	root.traverse((o) => { if (o.isSkinnedMesh) skinned = true; });
	const { scale } = fitTransform(
		{ min: { x: box.min.x, y: box.min.y, z: box.min.z }, max: { x: box.max.x, y: box.max.y, z: box.max.z } },
		{ skinned },
	);
	if (!(scale > 0) || scale === 1) return 1;
	stage.scale.multiplyScalar(scale);
	root.updateMatrixWorld(true);
	return scale;
}

/**
 * Largest footprint (m) AR Quick Look can be relied on to find a plane for.
 *
 * Quick Look does not place a model until ARKit has found a horizontal plane
 * BIG ENOUGH TO FIT IT. Until then the model hangs aligned to the camera and
 * travels with the phone, which every person reads as broken tracking rather
 * than as "still looking". Past roughly this size there is no such plane in an
 * ordinary room, so the model never lands at all.
 */
export const MAX_AR_FOOTPRINT_M = 2.5;

/** Tallest (m) a model can be and still belong in a room with a ceiling. */
export const MAX_AR_HEIGHT_M = 2.5;

/**
 * Keep the export inside a size ARKit can actually place.
 *
 * A ceiling, not a normalizer: real furniture, a person, a car-door-sized prop
 * all pass through untouched. It exists because the size someone pinched a
 * model to is now honoured (it used to be silently dropped), and the studio
 * lets that reach 4x. Four times a standing avatar is a seven-metre figure that
 * no living-room floor plane will ever fit.
 *
 * @param {import('three').Group} stage
 * @param {import('three').Group} root
 * @param {{maxFootprint?: number, maxHeight?: number}} [limits]
 * @returns {number} the scale applied (1 when it already fit).
 */
export function clampToPlaceableSize(stage, root, {
	maxFootprint = MAX_AR_FOOTPRINT_M, maxHeight = MAX_AR_HEIGHT_M,
} = {}) {
	const box = measure(root);
	if (!box) return 1;
	const size = box.getSize(new Vector3());
	const footprint = Math.max(size.x, size.z);
	// The floor plane has to fit the footprint; the room has to fit the height.
	// Whichever is tighter decides.
	const scale = Math.min(
		footprint > 0 ? maxFootprint / footprint : 1,
		size.y > 0 ? maxHeight / size.y : 1,
	);
	if (!(scale < 1) || !Number.isFinite(scale)) return 1;
	stage.scale.multiplyScalar(scale);
	root.updateMatrixWorld(true);
	return scale;
}

/**
 * Convert a loaded scene to USDZ bytes. Mutates the scene, so pass a clone or a
 * scene you are done with.
 *
 * The model is always grounded before it is written: see `groundOnFloor` for
 * why that, and not any anchoring flag, is what makes AR Quick Look put it on
 * the floor.
 *
 * @param {import('three').Object3D} scene
 * @param {object} [options]
 * @param {boolean} [options.fit] Normalize an absurdly authored size to a
 *   believable real-world one. On for a raw file straight off the network, off
 *   for a model the studio has already normalized and the person has resized.
 *   Everything else is passed through to three's USDZExporter.
 * @returns {Promise<Blob>} model/vnd.usdz+zip
 */
export async function sceneToUsdzBlob(scene, { fit = false, ...options } = {}) {
	const { root, stage } = usdzExportRoot(scene);
	bakeSkinnedMeshes(root);
	coerceMaterialsToStandard(root);
	ensureNormals(root);
	// Size first, then stand it on the floor: grounding measures the model at the
	// size it will actually be exported at, and a model too big for any plane in
	// the room never gets placed on one at all.
	if (fit) fitToRoomScale(stage, root);
	clampToPlaceableSize(stage, root);
	groundOnFloor(stage, root);
	// Loaded on demand: nobody who never taps "Place in your space" should pay
	// for the exporter.
	const { USDZExporter } = await import('three/addons/exporters/USDZExporter.js');
	const bytes = await new USDZExporter().parseAsync(root, {
		// Quick Look is the only thing that ever reads these bytes, and it applies
		// texture repeat and offset in a different order to every other USD
		// renderer (Apple FB10036297). This flag pre-compensates, so a model with
		// tiled textures does not arrive in someone's room with the tiling
		// visibly wrong. It is a no-op on the untiled default.
		quickLookCompatible: true,
		// Rest the model on the horizontal surface the person points at, which is
		// what "place it on your floor" means. Stated rather than left to the
		// exporter's default so a future default cannot quietly change it.
		includeAnchoringProperties: true,
		ar: { anchoring: { type: 'plane' }, planeAnchoring: { alignment: 'horizontal' } },
		...options,
	});
	return new Blob([bytes], { type: 'model/vnd.usdz+zip' });
}

/**
 * Convert an object that is ALREADY in a live scene to USDZ, without touching
 * the network.
 *
 * This is the fast path, and on a phone the difference is the whole feature.
 * Re-fetching and re-parsing the GLB costs seconds and a second CORS round trip
 * on a file the page has already decoded; worse, it exports the model's rest
 * pose at its authored size. Cloning the live object exports what the person is
 * actually looking at: the current animation pose, and the size they pinched it
 * to, which is the size Quick Look will stand in their room.
 *
 * The clone is what gets baked and mutated, so the live scene is untouched.
 * Position and yaw are zeroed because the AR viewer re-anchors the model to the
 * surface the user picks; carrying the studio's floor coordinates through would
 * only offset it from their own reticle. World scale is preserved: it is the
 * real-world size, and `sceneToUsdzBlob` is what makes it survive the export.
 *
 * No `fit`: this model went through the studio's own normalization when it was
 * placed, and the size on top of that is the one the person pinched.
 *
 * @param {import('three').Object3D} object
 * @returns {Promise<Blob>} model/vnd.usdz+zip
 */
export async function objectToUsdzBlob(object) {
	object.updateMatrixWorld(true);
	// SkeletonUtils.clone rebinds skinned meshes to the cloned bones and copies
	// their current transforms, so the pose survives; Object3D.clone does not.
	const copy = cloneSkinnedScene(object);
	copy.position.set(0, 0, 0);
	copy.rotation.set(0, 0, 0);
	copy.scale.copy(object.getWorldScale(new Vector3()));
	copy.updateMatrixWorld(true);
	return sceneToUsdzBlob(copy);
}

/**
 * Fetch a GLB and convert it to a USDZ blob.
 *
 * @param {string} glbUrl
 * @param {{signal?: AbortSignal, onProgress?: (stage: string) => void}} [opts]
 * @returns {Promise<Blob>}
 */
export async function glbUrlToUsdzBlob(glbUrl, { signal, onProgress } = {}) {
	onProgress?.('download');
	const res = await fetch(glbUrl, { signal });
	if (!res.ok) throw new Error(`model fetch ${res.status}`);
	const buffer = await res.arrayBuffer();

	onProgress?.('parse');
	// Awaited rather than taken synchronously: a meshopt-compressed GLB handed to
	// a loader whose decoder is still downloading fails on a valid file.
	const loader = await sharedGLTFLoaderReady();
	const gltf = await new Promise((resolve, reject) => {
		loader.parse(buffer, '', resolve, reject);
	});
	const scene = gltf.scene || gltf.scenes?.[0];
	if (!scene) throw new Error('that model contains no scene');

	onProgress?.('convert');
	// Straight off the network and never seen by the studio's normalizer, so this
	// is the one path that has to defend against a model authored in centimetres.
	return sceneToUsdzBlob(scene, { fit: true });
}
