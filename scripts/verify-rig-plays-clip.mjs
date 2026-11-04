// Prove a rigged GLB actually animates in the real three.ws viewer.
//
// "Rigged" in a worker's task record only means a skin was written. This
// checks the claim the way a user experiences it:
//
//   1. Rig Doctor (src/rig-report.js) reads the GLB: skinned or not, joint
//      count, whether the rig maps to the canonical humanoid set.
//   2. If the GLB carries no clip of its own, one is authored on ITS OWN
//      predicted joints (a sway on every non-root joint), so a non-humanoid
//      rig with no canonical mapping is exercised through the same
//      gltf.animations path the viewer autoplays, which is exactly the
//      fallback `supportsCanonicalClips()` leaves such rigs with.
//   3. The GLB is opened at /app#model= in headless Chromium against the dev
//      server, the viewer's own mixer plays clip 1, and skinned vertex
//      positions (three.js applyBoneTransform, the GPU skinning math) are
//      sampled twice. Pass = the skin visibly deforms and the page logged no
//      errors.
//
// Usage:
//   npm run dev   (port 3000), then
//   node scripts/verify-rig-plays-clip.mjs <glb url or path> [--base http://localhost:3000] [--out report.json]
//   PLAYWRIGHT_CHROMIUM=<path to chrome> overrides Playwright's bundled browser.

import { readFile, writeFile } from 'node:fs/promises';
import { NodeIO } from '@gltf-transform/core';
import { chromium } from 'playwright';
import { analyzeGlb } from '../src/rig-report.js';

function arg(name, fallback) {
	const i = process.argv.indexOf(`--${name}`);
	return i > -1 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
}

const source = process.argv[2];
if (!source || source.startsWith('--')) {
	console.error('usage: node scripts/verify-rig-plays-clip.mjs <glb url or path> [--base URL] [--out report.json]');
	process.exit(2);
}
const BASE = String(arg('base', 'http://localhost:3000')).replace(/\/+$/, '');
const OUT = arg('out', '');

async function loadBytes(src) {
	if (/^https?:\/\//.test(src)) {
		const res = await fetch(src);
		if (!res.ok) throw new Error(`GET ${src} -> HTTP ${res.status}`);
		return new Uint8Array(await res.arrayBuffer());
	}
	return new Uint8Array(await readFile(src));
}

// Quaternion product a*b, glTF [x, y, z, w] order.
function qmul(a, b) {
	const [ax, ay, az, aw] = a;
	const [bx, by, bz, bw] = b;
	return [
		aw * bx + ax * bw + ay * bz - az * by,
		aw * by - ax * bz + ay * bw + az * bx,
		aw * bz + ax * by - ay * bx + az * bw,
		aw * bw - ax * bx - ay * by - az * bz,
	];
}

function axisAngle(axis, rad) {
	const s = Math.sin(rad / 2);
	return [axis[0] * s, axis[1] * s, axis[2] * s, Math.cos(rad / 2)];
}

// Author a 2 s looping sway on every joint that has a parent joint, relative
// to that joint's own rest rotation, so it works for any hierarchy.
async function withAuthoredClip(bytes) {
	const io = new NodeIO();
	const doc = await io.readBinary(bytes);
	const root = doc.getRoot();
	const joints = new Set(root.listSkins().flatMap((s) => s.listJoints()));
	const animated = [...joints].filter((j) => j.getParentNode() && joints.has(j.getParentNode()));
	if (!animated.length) throw new Error('rig has no parented joints to animate');
	const buffer = root.listBuffers()[0] || doc.createBuffer();
	const times = [0, 0.5, 1, 1.5, 2];
	const angles = [0, 0.35, 0, -0.35, 0];
	const anim = doc.createAnimation('verify-sway');
	const input = doc.createAccessor().setType('SCALAR').setArray(new Float32Array(times)).setBuffer(buffer);
	animated.forEach((joint, i) => {
		const rest = joint.getRotation();
		const axis = [[1, 0, 0], [0, 0, 1], [0, 1, 0]][i % 3];
		const values = new Float32Array(times.length * 4);
		angles.forEach((a, k) => values.set(qmul(rest, axisAngle(axis, a)), k * 4));
		const output = doc.createAccessor().setType('VEC4').setArray(values).setBuffer(buffer);
		const sampler = doc.createAnimationSampler().setInput(input).setOutput(output).setInterpolation('LINEAR');
		anim.addSampler(sampler);
		anim.addChannel(doc.createAnimationChannel().setTargetNode(joint).setTargetPath('rotation').setSampler(sampler));
	});
	return { bytes: await io.writeBinary(doc), animatedJoints: animated.length };
}

const original = await loadBytes(source);
const doctor = analyzeGlb(original.buffer.slice(original.byteOffset, original.byteOffset + original.byteLength), {
	fileName: source.split('/').pop(),
});
console.log('Rig Doctor:');
const skel = doctor.skeleton;
console.log(`  verdict: ${doctor.verdict.level}: ${doctor.verdict.headline}`);
console.log(`  skinned: ${skel.skinned}, joints: ${skel.jointCount}, convention: ${skel.convention.label}`);
console.log(`  canonical bones mapped: ${skel.mapped}/${skel.total} (drivable by the clip library: ${doctor.verdict.drivable})`);
console.log(`  skinned vertices: ${skel.skinnedVertices}, unweighted: ${skel.unweightedVertices}, max influences: ${skel.maxInfluences}`);
console.log(`  own clips: ${doctor.animations.length}`);
if (!skel.skinned) {
	console.error('FAIL: GLB has no skinned mesh, nothing can deform it');
	process.exit(1);
}

let glb = original;
let authored = 0;
if (!doctor.animations.length) {
	const out = await withAuthoredClip(original);
	glb = out.bytes;
	authored = out.animatedJoints;
	console.log(`  authored clip "verify-sway" on ${authored} of the rig's own joints`);
}

const servedPath = '/__verify-rig/model.glb';
const browser = await chromium.launch({
	executablePath: process.env.PLAYWRIGHT_CHROMIUM || undefined,
	args: ['--no-sandbox', '--disable-dev-shm-usage', '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
});
const page = await browser.newPage({ viewport: { width: 960, height: 720 } });
const errors = [];
page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
page.on('console', (m) => {
	if (m.type() === 'error') errors.push(`console.error: ${m.text()} (${m.location()?.url || 'no url'})`);
});
page.on('response', (r) => {
	if (r.status() >= 400) errors.push(`HTTP ${r.status()}: ${r.url()}`);
});
await page.route(`**${servedPath}`, (route) =>
	route.fulfill({ status: 200, contentType: 'model/gltf-binary', body: Buffer.from(glb) }),
);

const url = `${BASE}/app#model=${encodeURIComponent(servedPath)}`;
console.log(`\nViewer: ${url}`);
await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 180000 });
await page.waitForFunction(
	() => {
		let found = false;
		window.VIEWER?.scene?.traverse((o) => {
			if (o.isSkinnedMesh) found = true;
		});
		return found;
	},
	null,
	{ timeout: 120000 },
);

// Sample the same vertices twice through three.js's own skinning math.
const sample = () =>
	page.evaluate(() => {
		const meshes = [];
		window.VIEWER.scene.traverse((o) => o.isSkinnedMesh && meshes.push(o));
		const out = [];
		for (const mesh of meshes) {
			mesh.updateMatrixWorld(true);
			const pos = mesh.geometry.attributes.position;
			const step = Math.max(1, Math.floor(pos.count / 400));
			const v = new mesh.position.constructor();
			for (let i = 0; i < pos.count; i += step) {
				mesh.getVertexPosition(i, v);
				v.applyMatrix4(mesh.matrixWorld);
				out.push([v.x, v.y, v.z]);
			}
		}
		return { verts: out, meshes: meshes.length, bones: meshes[0]?.skeleton?.bones.length || 0 };
	});

const t0 = await sample();
await page.waitForTimeout(700);
const t1 = await sample();

let maxMove = 0;
let moved = 0;
let lo = [Infinity, Infinity, Infinity];
let hi = [-Infinity, -Infinity, -Infinity];
t0.verts.forEach((a, i) => {
	const b = t1.verts[i];
	const d = Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
	maxMove = Math.max(maxMove, d);
	a.forEach((c, k) => {
		lo[k] = Math.min(lo[k], c);
		hi[k] = Math.max(hi[k], c);
	});
	if (d > 1e-5) moved++;
});
const diag = Math.hypot(hi[0] - lo[0], hi[1] - lo[1], hi[2] - lo[2]) || 1;
const relMove = maxMove / diag;
await browser.close();

const pass = relMove > 0.005 && errors.length === 0;
const report = {
	source,
	rigDoctor: {
		verdict: doctor.verdict.level,
		headline: doctor.verdict.headline,
		skinned: skel.skinned,
		joints: skel.jointCount,
		canonicalMapped: skel.mapped,
		drivableByClipLibrary: doctor.verdict.drivable,
		skinnedVertices: skel.skinnedVertices,
		unweightedVertices: skel.unweightedVertices,
		ownClips: doctor.animations.length,
	},
	authoredClipJoints: authored,
	viewer: {
		skinnedMeshes: t0.meshes,
		bones: t0.bones,
		sampledVertices: t0.verts.length,
		movedVertices: moved,
		maxDisplacement: maxMove,
		maxDisplacementOfBboxDiagonal: relMove,
	},
	errors,
	pass,
};
console.log(JSON.stringify(report.viewer, null, 2));
if (errors.length) console.log(errors.join('\n'));
if (OUT) await writeFile(OUT, JSON.stringify(report, null, 2));
console.log(pass ? '\nPASS: the skin deforms under the viewer\'s own mixer with no page errors' : '\nFAIL');
process.exit(pass ? 0 : 1);
