// GET /api/avatar/capabilities promises its "can this avatar pose and animate"
// answer is the runtime's own (api/_lib/avatar-capabilities.js says so in its
// header). It was not: the module ran a private rule, 50% of the 52 canonical
// bones plus every one of 14 core bones, so a complete body with no finger
// joints (22 of 52) came back unsupported while the viewer animated it, and the
// Ready Player Me half-body the platform ships (no arms or legs) did too. The
// /render-lab composer disables its pose controls on that answer, so creators
// lost features their avatar actually has. These tests serve real GLB bytes over
// a real HTTP server and hold the report to canonicalClipGate, the decision the
// viewer, Rig Doctor and rig-mode all share.

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createServer } from 'node:http';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { inspectGlbCapabilities } from '../api/_lib/avatar-capabilities.js';
import { CANONICAL_BONES } from '../src/glb-canonicalize.js';
import { canonicalClipGate } from '../src/canonical-clip-gate.js';
import { analyzeGlb } from '../src/rig-report.js';

const FINGER = /Hand(Index|Middle|Ring|Pinky|Thumb)\d$/;

// A JSON-only GLB: one skinned mesh node bound to a skin over `names`.
function glbRig(names) {
	const json = {
		asset: { version: '2.0', generator: 'avatar-capabilities test' },
		nodes: [{ name: 'Body', mesh: 0, skin: 0 }, ...names.map((name) => ({ name }))],
		meshes: [{ name: 'Body', primitives: [{ attributes: {} }] }],
		skins: [{ joints: names.map((_, i) => i + 1) }],
		scenes: [{ nodes: [0, 1] }],
	};
	json.nodes[1].children = names.slice(1).map((_, i) => i + 2);
	let bytes = new TextEncoder().encode(JSON.stringify(json));
	const pad = (4 - (bytes.length % 4)) % 4;
	if (pad) {
		const padded = new Uint8Array(bytes.length + pad).fill(0x20);
		padded.set(bytes);
		bytes = padded;
	}
	const out = Buffer.alloc(20 + bytes.length);
	out.writeUInt32LE(0x46546c67, 0);
	out.writeUInt32LE(2, 4);
	out.writeUInt32LE(out.length, 8);
	out.writeUInt32LE(bytes.length, 12);
	out.writeUInt32LE(0x4e4f534a, 16);
	out.set(bytes, 20);
	return out;
}

const shipped = (name) => readFileSync(resolve(process.cwd(), `public/avatars/${name}.glb`));

const FILES = {
	'fingerless.glb': glbRig(CANONICAL_BONES.filter((b) => !FINGER.test(b))),
	'arms-and-legs.glb': glbRig([
		'Hips', 'Spine', 'Neck', 'Head', 'LeftArm', 'RightArm', 'LeftForeArm', 'RightForeArm',
		'LeftUpLeg', 'RightUpLeg',
	]),
	'michelle.glb': shipped('michelle'),
	'realistic-halfbody.glb': shipped('realistic-halfbody'),
	'mannequin.glb': shipped('mannequin'),
};

let server;
let base;

beforeAll(async () => {
	server = createServer((req, res) => {
		const body = FILES[req.url.slice(1)];
		if (!body) {
			res.writeHead(404).end();
			return;
		}
		const m = /bytes=(\d+)-(\d+)/.exec(req.headers.range || '');
		const slice = m ? body.subarray(Number(m[1]), Number(m[2]) + 1) : body;
		res.writeHead(m ? 206 : 200, { 'content-type': 'model/gltf-binary', 'content-length': slice.length });
		res.end(slice);
	});
	await new Promise((ok) => server.listen(0, '127.0.0.1', ok));
	base = `http://127.0.0.1:${server.address().port}`;
});

afterAll(() => new Promise((ok) => server.close(ok)));

const report = (file) => inspectGlbCapabilities(`${base}/${file}`);

describe('avatar capabilities: pose support is the runtime gate', () => {
	it('supports a complete body that has no finger joints', async () => {
		const r = await report('fingerless.glb');
		expect(r.can.pose.supported).toBe(true);
		expect(r.rig.fingerCoverage).toBe(0);
	});

	it('supports the shipped half-body avatar the viewer animates', async () => {
		const r = await report('realistic-halfbody.glb');
		expect(analyzeGlb(new Uint8Array(FILES['realistic-halfbody.glb']).buffer).verdict.drivable).toBe(true);
		expect(r.can.pose.supported).toBe(true);
		expect(r.can.pose.reason).toMatch(/LeftUpLeg/);
	});

	it('refuses a rig under the clip floor and says why in clip tracks', async () => {
		const r = await report('arms-and-legs.glb');
		expect(r.can.pose.supported).toBe(false);
		expect(r.can.pose.reason).toMatch(/11 of 23 body clip tracks/);
	});

	it('agrees with canonicalClipGate on every fixture and shipped avatar', async () => {
		for (const file of Object.keys(FILES)) {
			const r = await report(file);
			const gate = canonicalClipGate({ hasSkinnedMesh: r.rig.isRigged, canonical: r.rig.mappedBones });
			expect(r.can.pose.supported, file).toBe(gate.ok);
		}
	});
});
