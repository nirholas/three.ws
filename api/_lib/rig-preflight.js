// Rig preflight: decide whether a model can be rigged BEFORE any GPU time.
//
// POST /api/forge?action=rig used to hand any GLB straight to the rig worker.
// Measured on production (2026-11-27): a katana came back with a 52-bone human
// skeleton and blendshapes, because the worker's only test is "tall and
// left-right symmetric", which a sword passes. This module runs on the API box,
// in front of the worker, and answers one of:
//
//   - refuse with a reason the user can act on: the model names an object
//     (a sword, a chair, a lamppost), is several separate pieces, is too large,
//     is not a GLB, or already carries a skeleton;
//   - accept, with a subject hint (`humanoid` or `creature`) the worker uses to
//     pick its rigger instead of guessing from the silhouette, and a URL the
//     worker can read: a Draco or meshopt compressed model is decoded to a plain
//     GLB and stored first, because the workers' trimesh loader reads neither.
//
// What the subject is comes first from the words the model was made from (the
// creation's prompt, looked up by the creation id in a Forge GLB URL), and only
// when those words say nothing decisive, from the mesh's own shape.

import { createHash } from 'node:crypto';
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { fetchModel, FetchModelError } from './fetch-model.js';
import { inspectGlb } from './glb-inspect.js';
import { loadMesh, MeshIoError, boundsOf, weldPositions } from './print/mesh-io.js';
import { classifyRigSubject } from '../../mcp-server/src/tools/_humanoid.js';
import { sql } from './db.js';
import { forgeStoreEnabled } from './forge-store.js';
import { putObject, cdnUrl, objectStorageConfigured } from './r2.js';
import { limits } from './rate-limit.js';
import { dailyPaidRefund } from './forge-scale.js';
import { acquireLock } from './cache.js';

// The rig workers fetch at most 64 MiB (workers/rig/worker_security.py
// DEFAULT_MAX_BYTES), so a bigger file would only fail there, minutes later.
export const RIG_MAX_BYTES = 64 * 1024 * 1024;
// Same ceiling the print pipeline parses (api/_lib/print/mesh-io.js), and about
// 40 times a dense Forge mesh.
export const RIG_MAX_TRIANGLES = 2_000_000;

// The codecs the workers cannot read (see workers/rig/gltf_meshopt.py: only
// meshopt is decoded there, Draco and quantized attributes are not).
const COMPRESSION_EXTENSIONS = new Set([
	'KHR_draco_mesh_compression',
	'EXT_meshopt_compression',
	'KHR_mesh_quantization',
]);

// A component under this share of the surface is a detail (an eye, a strap, a
// floating decal), not a piece in its own right.
const PIECE_MIN_AREA_SHARE = 0.05;
// Two spatially separate groups each holding at least this share of the
// surface are two models, not one figure with accessories.
const SECOND_PIECE_MIN_SHARE = 0.25;
// Stick-like or flat: the shortest side under 13% of the longest AND the convex
// hull filling under 1.5% of the longest side cubed. Measured on Forge output:
// katana 0.12 / 0.011, guitar 0.06 / 0.0099; a standing human 0.23 / 0.036 and a
// T-posed one is far above on the hull test. Read only when the prompt says nothing.
const SLENDER_SHORT_TO_LONG = 0.13;
const SLENDER_HULL_FILL = 0.015;
const HULL_SAMPLE_CAP = 20_000;

const UUID_RE = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i;

const MB = 1024 * 1024;
const fmtMb = (bytes) => `${Math.round((bytes / MB) * 10) / 10} MB`;

function refuse(status, error, title, message, extra = {}) {
	return { ok: false, status, body: { error, title, message, ...extra } };
}

/** The creation id a Forge GLB URL carries (`/cdn/forge/<hash>/<uuid>.glb`). */
export function creationIdFromGlbUrl(url) {
	try {
		const path = new URL(url).pathname;
		const last = path.split('/').pop() || '';
		const m = last.match(UUID_RE);
		return m && last.startsWith(m[0]) ? m[0].toLowerCase() : null;
	} catch {
		return null;
	}
}

// The prompt a Forge creation was made from. Rig outputs are recorded with the
// prompt 'auto-rig', which says nothing about the subject.
async function promptForCreation(id) {
	if (!id || !UUID_RE.test(id) || !forgeStoreEnabled()) return null;
	try {
		const rows = await sql`select prompt from forge_creations where id = ${id} limit 1`;
		const prompt = rows[0]?.prompt;
		return typeof prompt === 'string' && prompt !== 'auto-rig' ? prompt : null;
	} catch (err) {
		console.warn('[rig-preflight] prompt lookup failed:', err?.message);
		return null;
	}
}

/**
 * The words the model was made from: the stored prompt of the creation named by
 * `creationId` or by the GLB URL, else the prompt the caller sent.
 */
export async function resolveRigPrompt({ glbUrl, creationId, prompt }) {
	const ids = [creationId, creationIdFromGlbUrl(glbUrl)].filter((v) => typeof v === 'string' && UUID_RE.test(v));
	for (const id of new Set(ids)) {
		const stored = await promptForCreation(id);
		if (stored) return stored;
	}
	return typeof prompt === 'string' && prompt.trim() ? prompt.trim().slice(0, 2000) : null;
}

function triangleArea(P, a, b, c) {
	const ax = P[b] - P[a], ay = P[b + 1] - P[a + 1], az = P[b + 2] - P[a + 2];
	const bx = P[c] - P[a], by = P[c + 1] - P[a + 1], bz = P[c + 2] - P[a + 2];
	return Math.hypot(ay * bz - az * by, az * bx - ax * bz, ax * by - ay * bx) / 2;
}

// Convex hull volume of a vertex sample, via three's quickhull (already a
// server dependency through the animation tools).
async function hullVolume(P) {
	const { ConvexHull } = await import('three/examples/jsm/math/ConvexHull.js');
	const { Vector3 } = await import('three');
	const n = P.length / 3;
	const step = Math.max(1, Math.floor(n / HULL_SAMPLE_CAP));
	const pts = [];
	for (let i = 0; i < n; i += step) pts.push(new Vector3(P[i * 3], P[i * 3 + 1], P[i * 3 + 2]));
	if (pts.length < 4) return 0;
	let hull;
	try {
		hull = new ConvexHull().setFromPoints(pts);
	} catch {
		return 0;
	}
	let vol = 0;
	const cross = new Vector3();
	for (const face of hull.faces) {
		let edge = face.edge;
		const p0 = edge.head().point;
		edge = edge.next;
		do {
			const p1 = edge.tail().point;
			const p2 = edge.head().point;
			vol += p0.dot(cross.crossVectors(p1, p2)) / 6;
			edge = edge.next;
		} while (edge !== face.edge);
	}
	return Math.abs(vol);
}

/**
 * Shape facts the preflight decides on, from a loaded triangle soup.
 *
 * @param {{ positions: Float64Array|number[], indices: Uint32Array|number[] }} mesh
 * @returns {Promise<{ pieces: number[], slender: boolean, shortToLong: number, hullFill: number }>}
 *   `pieces`: surface share of each spatially separate group of significant
 *   components, largest first.
 */
export async function analyzeRigGeometry(mesh) {
	const bounds = boundsOf(mesh.positions);
	if (!bounds || !(bounds.diagonal > 0)) return { pieces: [1], slender: false, shortToLong: 1, hullFill: 1 };
	const welded = weldPositions(mesh.positions, mesh.indices, bounds.diagonal * 1e-4);
	const P = welded.positions;
	const I = welded.indices;

	// Connected components over shared (welded) vertices.
	const parent = new Int32Array(P.length / 3).map((_, i) => i);
	const find = (x) => {
		while (parent[x] !== x) {
			parent[x] = parent[parent[x]];
			x = parent[x];
		}
		return x;
	};
	for (let i = 0; i < I.length; i += 3) {
		const a = find(I[i]);
		parent[find(I[i + 1])] = a;
		parent[find(I[i + 2])] = a;
	}
	const comps = new Map();
	let total = 0;
	for (let i = 0; i < I.length; i += 3) {
		const a = I[i] * 3, b = I[i + 1] * 3, c = I[i + 2] * 3;
		const area = triangleArea(P, a, b, c);
		total += area;
		const root = find(I[i]);
		let comp = comps.get(root);
		if (!comp) {
			comp = { area: 0, min: [Infinity, Infinity, Infinity], max: [-Infinity, -Infinity, -Infinity] };
			comps.set(root, comp);
		}
		comp.area += area;
		for (const v of [a, b, c]) {
			for (let k = 0; k < 3; k += 1) {
				if (P[v + k] < comp.min[k]) comp.min[k] = P[v + k];
				if (P[v + k] > comp.max[k]) comp.max[k] = P[v + k];
			}
		}
	}

	// Significant components whose (slightly padded) boxes touch are one piece:
	// a body, its clothing and its hair overlap; a pair of boots side by side do not.
	const sig = total > 0 ? [...comps.values()].filter((c) => c.area / total >= PIECE_MIN_AREA_SHARE) : [];
	const pad = bounds.diagonal * 0.02;
	const group = sig.map((_, i) => i);
	const root = (x) => {
		while (group[x] !== x) x = group[x];
		return x;
	};
	for (let i = 0; i < sig.length; i += 1) {
		for (let j = i + 1; j < sig.length; j += 1) {
			let overlap = true;
			for (let k = 0; k < 3; k += 1) {
				if (sig[i].max[k] + pad < sig[j].min[k] || sig[j].max[k] + pad < sig[i].min[k]) overlap = false;
			}
			if (overlap) group[root(j)] = root(i);
		}
	}
	const shares = new Map();
	sig.forEach((c, i) => shares.set(root(i), (shares.get(root(i)) || 0) + c.area / total));
	const pieces = [...shares.values()].sort((x, y) => y - x);

	const sides = [...bounds.size].sort((x, y) => y - x);
	const shortToLong = sides[0] > 0 ? sides[2] / sides[0] : 1;
	const hullFill = (await hullVolume(P)) / bounds.longest ** 3;
	return {
		pieces: pieces.length ? pieces : [1],
		slender: shortToLong <= SLENDER_SHORT_TO_LONG && hullFill <= SLENDER_HULL_FILL,
		shortToLong,
		hullFill,
	};
}

let decodeIoPromise = null;
async function decodeIo() {
	if (!decodeIoPromise) {
		decodeIoPromise = (async () => {
			const io = new NodeIO().registerExtensions(ALL_EXTENSIONS);
			const draco = await import('draco3dgltf');
			const create = draco.default ?? draco;
			const { MeshoptDecoder } = await import('meshoptimizer');
			await MeshoptDecoder.ready;
			io.registerDependencies({
				'draco3d.decoder': await create.createDecoderModule(),
				'meshopt.decoder': MeshoptDecoder,
			});
			return io;
		})().catch((err) => {
			decodeIoPromise = null;
			throw err;
		});
	}
	return decodeIoPromise;
}

/**
 * A plain GLB of the same model: Draco and meshopt geometry decoded, quantized
 * attributes widened back to floats, and the compression extensions dropped so
 * any glTF reader (the workers use trimesh) can load it.
 *
 * @param {Uint8Array} bytes
 * @returns {Promise<Uint8Array>}
 */
export async function decodeCompressedGlb(bytes) {
	const io = await decodeIo();
	const doc = await io.readBinary(bytes);
	const used = doc.getRoot().listExtensionsUsed().map((e) => e.extensionName);
	if (used.includes('KHR_mesh_quantization')) {
		const { dequantize } = await import('@gltf-transform/functions');
		await doc.transform(dequantize());
	}
	for (const ext of doc.getRoot().listExtensionsUsed()) {
		if (COMPRESSION_EXTENSIONS.has(ext.extensionName)) ext.dispose();
	}
	return io.writeBinary(doc);
}

// Where a decoded copy is stored for the worker to read. Content-addressed, so
// rigging the same model twice reuses one object.
async function storeDecoded(bytes) {
	const hash = createHash('sha256').update(bytes).digest('hex').slice(0, 32);
	const key = `forge/rig-input/${hash}.glb`;
	await putObject({ key, body: Buffer.from(bytes), contentType: 'model/gltf-binary' });
	return cdnUrl(key);
}

const OBJECT_TODO =
	'Rigging gives a model bones to move, so it needs a body: a person, a character or an animal. To move this object, place it in a scene and animate it there, or generate a character holding or wearing it and rig that.';

function objectRefusal(reason) {
	return refuse(422, 'rig_not_riggable', 'This model has no body to rig', `${reason} ${OBJECT_TODO}`);
}

/**
 * Run every check that can refuse a rig request before the worker is called.
 *
 * @param {{ glbUrl: string, creationId?: string|null, prompt?: string|null }} input
 * @returns {Promise<
 *   | { ok: true, sourceUrl: string, subject: 'humanoid'|'creature'|null, decoded: boolean, prompt: string|null, report: object }
 *   | { ok: false, status: number, body: { error: string, title: string, message: string } }
 * >}
 */
export async function preflightRig({ glbUrl, creationId = null, prompt = null }) {
	let fetched;
	try {
		fetched = await fetchModel(glbUrl, { maxBytes: RIG_MAX_BYTES, timeoutMs: 30_000 });
	} catch (err) {
		if (err instanceof FetchModelError && err.code === 'file_too_large') {
			return refuse(
				413,
				'rig_too_large',
				'This model is too large to rig',
				`The rigger takes files up to ${fmtMb(RIG_MAX_BYTES)}. Shrink it first (Remesh lowers the triangle count and texture size) and rig the smaller copy.`,
				{ limit_bytes: RIG_MAX_BYTES },
			);
		}
		if (err instanceof FetchModelError && err.code === 'scheme_not_allowed') {
			return refuse(400, 'invalid_glb_url', 'That link cannot be rigged', 'glb_url must be an https link to a .glb file.');
		}
		if (err instanceof FetchModelError && ['private_address', 'invalid_url', 'dns_failed', 'dns_timeout', 'host_pin_mismatch'].includes(err.code)) {
			return refuse(400, 'invalid_glb_url', 'That link cannot be rigged', 'glb_url must point at a publicly reachable host.');
		}
		const upstream = err instanceof FetchModelError && err.code === 'upstream_error' ? /\b(4\d\d)\b/.exec(err.message) : null;
		if (upstream) {
			return refuse(
				422,
				'rig_fetch_failed',
				'Could not download the model',
				`The link answered HTTP ${upstream[1]}, so there is no model there to rig. Check the link, or upload the .glb again.`,
			);
		}
		return refuse(
			502,
			'rig_fetch_failed',
			'Could not download the model',
			'Forge could not download this model to check it before rigging. Nothing was charged. Try again in a moment.',
		);
	}
	const bytes = fetched.bytes;

	const info = inspectGlb(bytes);
	if (!info) {
		return refuse(
			422,
			'rig_invalid_model',
			'This file is not a GLB model',
			'The rigger reads binary glTF (.glb) files. Export the model as .glb with its textures embedded and try again.',
		);
	}
	if (info.isRigged || info.skeletonJointCount > 0) {
		return refuse(
			409,
			'already_rigged',
			'This model is already rigged',
			`It already has a skeleton with ${info.skeletonJointCount} joints, so it can be posed and animated as it is. Open it in Pose Studio to animate it.`,
			{ glb_url: glbUrl, joint_count: info.skeletonJointCount },
		);
	}

	let mesh;
	try {
		mesh = await loadMesh(bytes, { color: false, maxBytes: RIG_MAX_BYTES, maxTriangles: RIG_MAX_TRIANGLES });
	} catch (err) {
		if (err instanceof MeshIoError && err.code === 'too_complex') {
			return refuse(
				413,
				'rig_too_complex',
				'This model has too many triangles to rig',
				`The rigger takes up to ${RIG_MAX_TRIANGLES.toLocaleString('en-US')} triangles. Lower the count with Remesh and rig the lighter copy.`,
				{ limit_triangles: RIG_MAX_TRIANGLES },
			);
		}
		return refuse(
			422,
			'rig_invalid_model',
			'This model has no surface to rig',
			'The rigger needs a triangle mesh, and this file has none it can read (a point cloud or a lines-only export). Export it as a solid mesh and try again.',
		);
	}
	if (!mesh.triangleCount) {
		return refuse(
			422,
			'rig_invalid_model',
			'This model has no surface to rig',
			'The rigger needs a triangle mesh, and this file has none it can read (a point cloud or a lines-only export). Export it as a solid mesh and try again.',
		);
	}

	const words = await resolveRigPrompt({ glbUrl, creationId, prompt });
	const verdict = classifyRigSubject(words || '');
	if (verdict.subject === 'object') {
		const named = verdict.hits.object[0];
		return objectRefusal(`It was made as ${/^[aeiou]/i.test(named) ? 'an' : 'a'} ${named}, which has no limbs to move.`);
	}

	const shape = await analyzeRigGeometry(mesh);
	if (verdict.subject === 'unknown' && shape.slender) {
		return objectRefusal('Its shape is a thin rod or flat panel with no limbs to move.');
	}
	if (shape.pieces.length > 1 && shape.pieces[1] >= SECOND_PIECE_MIN_SHARE) {
		return refuse(
			422,
			'rig_multiple_pieces',
			'This model is several separate pieces',
			`It is ${shape.pieces.length} separate pieces that do not touch, and one skeleton cannot drive pieces that are apart. Rig one figure at a time: split it with Segment and rig the piece you want, or generate a single figure.`,
			{ pieces: shape.pieces.length },
		);
	}

	let sourceUrl = glbUrl;
	let decoded = false;
	if (info.extensionsUsed.some((e) => COMPRESSION_EXTENSIONS.has(e))) {
		let plain;
		try {
			plain = await decodeCompressedGlb(bytes);
		} catch (err) {
			console.warn('[rig-preflight] decode failed:', err?.message);
			return refuse(
				422,
				'rig_invalid_model',
				'Could not unpack this model',
				'The model is compressed in a way Forge could not unpack. Export it again without Draco or meshopt compression and try again.',
			);
		}
		if (plain.byteLength > RIG_MAX_BYTES) {
			return refuse(
				413,
				'rig_too_large',
				'This model is too large to rig',
				`Unpacked, it is ${fmtMb(plain.byteLength)}, and the rigger takes files up to ${fmtMb(RIG_MAX_BYTES)}. Shrink it with Remesh and rig the smaller copy.`,
				{ limit_bytes: RIG_MAX_BYTES },
			);
		}
		if (!objectStorageConfigured()) {
			return refuse(
				503,
				'storage_unavailable',
				'Could not prepare the model',
				'This model is compressed and Forge cannot store the unpacked copy the rigger needs right now. Nothing was charged. Try again in a few minutes.',
			);
		}
		try {
			sourceUrl = await storeDecoded(plain);
		} catch (err) {
			console.warn('[rig-preflight] storing decoded copy failed:', err?.message);
			return refuse(
				503,
				'storage_unavailable',
				'Could not prepare the model',
				'This model is compressed and Forge could not store the unpacked copy the rigger needs. Nothing was charged. Try again in a few minutes.',
			);
		}
		decoded = true;
	}

	return {
		ok: true,
		sourceUrl,
		subject: verdict.subject === 'humanoid' || verdict.subject === 'creature' ? verdict.subject : null,
		decoded,
		prompt: words,
		report: {
			bytes: bytes.byteLength,
			triangles: mesh.triangleCount,
			compression: info.extensionsUsed.filter((e) => COMPRESSION_EXTENSIONS.has(e)),
			words_subject: verdict.subject,
			pieces: shape.pieces.length,
			short_to_long: Math.round(shape.shortToLong * 1000) / 1000,
			hull_fill: Math.round(shape.hullFill * 10000) / 10000,
		},
	};
}

/** Give back the hourly tool allowance a refused rig request took. */
export async function refundRigAllowance(rigKey) {
	await limits.mcp3dGenerateRefund(rigKey).catch(() => {});
}

/**
 * A rig job that failed on the worker does not count against the caller's
 * allowance: refund the hourly and daily slots once per job. `meta` is the
 * creation row (findByJob); rig jobs are recorded with the prompt 'auto-rig'.
 * Returns true when this call issued the refund.
 */
export async function refundFailedRigJob({ meta, upstreamId }) {
	if (!meta || meta.prompt !== 'auto-rig' || !meta.user_id || !upstreamId) return false;
	if (meta.status === 'failed' || meta.status === 'done') return false;
	const first = await acquireLock(`rig:refund:${upstreamId}`, 2 * 24 * 3600);
	if (!first) return false;
	const key = `user:${meta.user_id}`;
	await Promise.all([limits.mcp3dGenerateRefund(key).catch(() => {}), dailyPaidRefund(key).catch(() => {})]);
	return true;
}
