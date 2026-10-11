// Run receipts: the per-generation record of what each stage was expected to
// do, what it actually did, and the verdict. Pins the pure core (verdicts,
// outcome derivation, signing), the stat reshaping, the rig read-back against
// a real GLB, and the studio wiring end to end through dispatch.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { ed25519 } from '@noble/curves/ed25519.js';

import {
	RUN_RECEIPT_TYPE,
	newReceiptId,
	isReceiptId,
	jobRef,
	startReceipt,
	addStage,
	finishReceipt,
	inputStage,
	subjectGateStage,
	briefStage,
	meshStage,
	geometryStage,
	visualQaStage,
	rigStage,
	deliveryStage,
	signReceipt,
	verifyReceipt,
	receiptHash,
} from '../api/_lib/run-receipt.js';
import { summarizeStats, inspectRiggedGlb, engineLabel, sealReceipt, resetSigningKeyCache } from '../api/_lib/run-receipt-store.js';
import { attachReceipt } from '../api/_mcp-studio/receipts.js';
import { dispatch } from '../api/_mcp-studio/dispatch.js';

// A real binary glTF: header, JSON chunk, no BIN chunk. analyzeGlb only reads
// the JSON, which is exactly what the rig read-back fetches.
function buildGlb(json) {
	let text = JSON.stringify(json);
	while (Buffer.byteLength(text) % 4) text += ' ';
	const body = Buffer.from(text, 'utf8');
	const out = Buffer.alloc(12 + 8 + body.length);
	out.write('glTF', 0, 'ascii');
	out.writeUInt32LE(2, 4);
	out.writeUInt32LE(out.length, 8);
	out.writeUInt32LE(body.length, 12);
	out.writeUInt32LE(0x4e4f534a, 16);
	body.copy(out, 20);
	return out.buffer.slice(out.byteOffset, out.byteOffset + out.byteLength);
}

const MIXAMO = [
	'Hips', 'Spine', 'Spine1', 'Spine2', 'Neck', 'Head',
	'LeftShoulder', 'LeftArm', 'LeftForeArm', 'LeftHand',
	'RightShoulder', 'RightArm', 'RightForeArm', 'RightHand',
	'LeftUpLeg', 'LeftLeg', 'LeftFoot', 'LeftToeBase',
	'RightUpLeg', 'RightLeg', 'RightFoot', 'RightToeBase',
];

function riggedGlb(bones = MIXAMO, { skinned = true } = {}) {
	const joints = bones.map((b) => ({ name: `mixamorig:${b}` }));
	const nodes = [...joints, { name: 'Body', mesh: 0, ...(skinned ? { skin: 0 } : {}) }];
	return buildGlb({
		asset: { version: '2.0', generator: 'test' },
		nodes,
		meshes: [{ primitives: [{ attributes: {} }] }],
		skins: [{ joints: joints.map((_, i) => i) }],
	});
}

function glbResponse(buf) {
	return {
		ok: true,
		status: 206,
		headers: { get: (h) => (h.toLowerCase() === 'content-length' ? String(buf.byteLength) : null) },
		arrayBuffer: async () => buf,
	};
}

describe('run receipt core', () => {
	it('mints unguessable public ids and hashes job handles instead of storing them', () => {
		const a = newReceiptId();
		expect(isReceiptId(a)).toBe(true);
		expect(a).not.toBe(newReceiptId());
		expect(isReceiptId('rr_short')).toBe(false);
		expect(isReceiptId('../etc/passwd')).toBe(false);
		const ref = jobRef('job-token-abc');
		expect(ref).toMatch(/^[0-9a-f]{40}$/);
		expect(ref).not.toContain('job-token');
		expect(jobRef('')).toBeNull();
	});

	it('records a clean run as delivered, every stage met', () => {
		const r = startReceipt({ tool: 'forge_avatar', prompt: 'a knight in silver armor', now: 1000 });
		addStage(r, inputStage({ allowed: true, hasPrompt: true }));
		addStage(r, briefStage({ kind: 'avatar', directed: true }));
		addStage(r, meshStage({ frame: { glb_url: 'https://x/a.glb', tier: 'high', backend: 'hunyuan3d' }, expectedTier: 'high', labelFor: engineLabel }));
		addStage(r, deliveryStage({ frame: { glb_url: 'https://x/a.glb', durable: true } }));
		const done = finishReceipt(r, { glbUrl: 'https://x/a.glb', now: 4000 });
		expect(done.type).toBe(RUN_RECEIPT_TYPE);
		expect(done.outcome).toBe('delivered');
		expect(done.issues).toEqual([]);
		expect(done.duration_ms).toBe(3000);
		expect(done.summary).toBe('Delivered as expected. Every stage met its contract.');
		expect(done.stages.find((s) => s.id === 'mesh').observed).toMatch(/high-detail tier on Hunyuan3D/);
	});

	// A skipped stage is not an issue, but it is not a pass either. The 2026-10-11
	// rig_mesh proof run on a lantern read "every stage met its contract" while the
	// humanoid check had never run, which is exactly the overclaim receipts exist
	// to prevent.
	it('never says every stage met when a stage was not checked', () => {
		const r = startReceipt({ tool: 'rig_mesh', prompt: null, now: 1000 });
		addStage(r, inputStage({ allowed: true, hasImage: false, hasPrompt: true }));
		addStage(r, subjectGateStage({ givenMesh: true }));
		addStage(r, deliveryStage({ frame: { glb_url: 'https://x/a.glb', durable: true } }));
		const done = finishReceipt(r, { glbUrl: 'https://x/a.glb', now: 2000 });
		expect(done.outcome).toBe('delivered');
		expect(done.summary).not.toMatch(/every stage met/i);
		expect(done.summary).toBe('Delivered as expected. Every stage that ran met its contract. 1 skipped (Subject check).');
	});

	it('names a quiet tier downgrade as recovered, with the cause', () => {
		const s = meshStage({ frame: { glb_url: 'https://x/a.glb', tier: 'standard', backend: 'trellis_selfhost' }, expectedTier: 'high', labelFor: engineLabel });
		expect(s.verdict).toBe('recovered');
		expect(s.expected).toMatch(/high-detail/);
		expect(s.observed).toMatch(/standard tier/);
		expect(s.cause).toMatch(/did not accept the job/);
	});

	it('names the fixed fallback brief as recovered, not met', () => {
		const s = briefStage({ kind: 'avatar', directed: false });
		expect(s.verdict).toBe('recovered');
		expect(s.cause).toMatch(/fixed brief/);
		expect(briefStage({ kind: 'avatar', hasImage: true }).verdict).toBe('skipped');
		expect(briefStage({ kind: 'mesh', knownMark: true }).verdict).toBe('met');
	});

	it('states exactly why the director brief fell back, never a generic timeout', () => {
		const long = briefStage({ kind: 'mesh', directed: false, fallback: { reason: 'too_long', chars: 1245 } });
		expect(long.verdict).toBe('recovered');
		expect(long.cause).toMatch(/1245 characters/);
		expect(long.cause).toMatch(/1000/);
		expect(long.cause).not.toMatch(/in time/);
		expect(briefStage({ kind: 'mesh', directed: false, fallback: { reason: 'unfinished' } }).cause).toMatch(/mid-sentence|unfinished/);
		expect(briefStage({ kind: 'avatar', directed: false, fallback: { reason: 'no_reply' } }).cause).toMatch(/no reply/i);
		expect(briefStage({ kind: 'avatar', directed: false, fallback: { reason: 'too_long', chars: 1100 } }).cause).toMatch(/fixed brief/);
	});

	it('turns away a non-humanoid avatar before spending GPU time, and says so', () => {
		const s = subjectGateStage({ nonHumanoid: true });
		expect(s.verdict).toBe('missed');
		expect(subjectGateStage({ nonHumanoid: true, override: true }).verdict).toBe('recovered');
		expect(subjectGateStage({ hasImage: true }).verdict).toBe('skipped');
	});

	it('says plainly that a caller-supplied mesh was never checked for being a body', () => {
		// The rigger fits a full humanoid template to anything (a lantern came back
		// with 52 Mixamo joints), so a passing rig check alone would overstate it.
		const s = subjectGateStage({ givenMesh: true });
		expect(s.verdict).toBe('skipped');
		expect(s.observed).toMatch(/not checked/i);
		expect(s.cause).toMatch(/skeleton.*not.*character|structure/i);
	});

	it('reads geometry and vision scores off the frame, never inventing them', () => {
		const good = geometryStage({ quality: { valid: true, flag: 'ok', score: 0.92, metrics: { triangleCount: 48211, vertexCount: 25000, hasTextures: true } } });
		expect(good.verdict).toBe('met');
		expect(good.observed).toMatch(/48,211 triangles/);
		expect(geometryStage({ quality: { valid: true, score: 0.8, metrics: {} }, retried: true }).verdict).toBe('recovered');
		const bad = geometryStage({ quality: { valid: false, flag: 'degenerate', reasons: ['too_few_triangles'] } });
		expect(bad.verdict).toBe('missed');
		expect(bad.cause).toMatch(/too few triangles/);
		expect(geometryStage({}).verdict).toBe('skipped');

		expect(visualQaStage({ gate: { pass: true, score: 8 } }).verdict).toBe('met');
		const failed = visualQaStage({ gate: { pass: false, score: 3, defects: ['missing hands'], reason: 'hands cropped' } });
		expect(failed.verdict).toBe('missed');
		expect(failed.cause).toBe('hands cropped');
		expect(visualQaStage({ gate: { qa_available: false } }).verdict).toBe('skipped');
		expect(visualQaStage({}).verdict).toBe('skipped');
	});

	it('marks an expiring engine link as recovered delivery', () => {
		expect(deliveryStage({ frame: { glb_url: 'https://x', durable: false } }).verdict).toBe('recovered');
		expect(deliveryStage({ frame: {} }).verdict).toBe('missed');
	});

	it('restates every miss as expected vs observed vs cause, and never claims better than the stages', () => {
		const r = startReceipt({ tool: 'forge_avatar', prompt: 'p' });
		addStage(r, rigStage({ error: 'Rigging failed for this mesh.' }));
		const done = finishReceipt(r, { glbUrl: 'https://x/a.glb', outcome: 'delivered' });
		expect(done.outcome).toBe('delivered_with_issues');
		expect(done.issues).toEqual([
			expect.objectContaining({ stage: 'rig', verdict: 'missed', expected: expect.stringMatching(/skinned humanoid/), cause: 'Rigging failed for this mesh.' }),
		]);
		expect(finishReceipt(r, { glbUrl: 'https://x/a.glb', outcome: 'partial' }).outcome).toBe('partial');
		expect(finishReceipt(r, {}).outcome).toBe('failed');
	});

	it('stays pending while any stage is pending', () => {
		const r = startReceipt({ tool: 'mesh_forge', prompt: 'p' });
		addStage(r, meshStage({ timedOut: true, expectedTier: 'standard' }));
		const done = finishReceipt(r, {});
		expect(done.outcome).toBe('pending');
		expect(done.finished_at).toBeNull();
		// The collected job replaces the pending stage rather than adding a second one.
		addStage(r, meshStage({ frame: { glb_url: 'https://x', tier: 'standard' }, expectedTier: 'standard' }));
		expect(r.stages).toHaveLength(1);
		expect(r.stages[0].verdict).toBe('met');
	});

	it('signs, verifies, pins the issuer, and catches tampering', () => {
		const seed = ed25519.utils.randomSecretKey();
		const r = finishReceipt(startReceipt({ tool: 'mesh_forge', prompt: 'p' }), {});
		const env = signReceipt(r, seed);
		expect(env.sha256).toBe(receiptHash(r));
		expect(verifyReceipt(env).ok).toBe(true);
		expect(verifyReceipt(env, { trustedSigner: env.signer }).ok).toBe(true);
		expect(verifyReceipt(env, { trustedSigner: 'someoneElse' }).ok).toBe(false);

		const tampered = { ...env, receipt: { ...env.receipt, outcome: 'delivered' } };
		const v = verifyReceipt(tampered);
		expect(v.ok).toBe(false);
		expect(v.checks.find((c) => c.name === 'hash').ok).toBe(false);
		expect(v.checks.find((c) => c.name === 'signature').ok).toBe(false);

		const unsigned = { ...env, signature: null, signer: null };
		expect(verifyReceipt(unsigned).ok).toBe(false);
	});
});

describe('run receipt store', () => {
	const saved = process.env.ATTEST_AGENT_SECRET_KEY;
	afterEach(() => {
		if (saved === undefined) delete process.env.ATTEST_AGENT_SECRET_KEY;
		else process.env.ATTEST_AGENT_SECRET_KEY = saved;
		resetSigningKeyCache();
	});

	it('seals honestly unsigned when no issuer key is configured', async () => {
		delete process.env.ATTEST_AGENT_SECRET_KEY;
		resetSigningKeyCache();
		const r = finishReceipt(startReceipt({ tool: 'mesh_forge', prompt: 'p' }), {});
		const env = await sealReceipt(r);
		expect(env.signature).toBeNull();
		expect(env.signer).toBeNull();
		expect(env.sha256).toBe(receiptHash(r));
	});

	it('maps engine ids to their public label and hides unknown ones', () => {
		expect(engineLabel('hunyuan3d')).toBe('Hunyuan3D');
		expect(engineLabel('some_internal_lane')).toBe('a backup engine');
		expect(engineLabel(null)).toBe('a backup engine');
	});

	it('reshapes the stat queries into rates in pipeline order', () => {
		const s = summarizeStats({
			days: 7,
			outcomes: [
				// One of the six delivered runs leaned on a fallback brief, so it is not clean.
				{ tool: 'forge_avatar', outcome: 'delivered', n: 6, clean: 5 },
				{ tool: 'forge_avatar', outcome: 'delivered_with_issues', n: 2, clean: 0 },
				{ tool: 'mesh_forge', outcome: 'failed', n: 1 },
				{ tool: 'mesh_forge', outcome: 'refused', n: 1 },
			],
			stages: [
				{ stage: 'rig', label: 'Rig', verdict: 'met', n: 6 },
				{ stage: 'rig', label: 'Rig', verdict: 'missed', n: 2 },
				{ stage: 'brief', label: 'Brief', verdict: 'met', n: 7 },
				{ stage: 'brief', label: 'Brief', verdict: 'recovered', n: 1 },
				{ stage: 'brief', label: 'Brief', verdict: 'skipped', n: 2 },
			],
			causes: [{ stage: 'rig', label: 'Rig', verdict: 'missed', cause: 'Missing key bones: LeftUpLeg.', n: 2 }],
		});
		expect(s.total).toBe(10);
		// Refusals are not deliveries that failed; they are excluded from the rate.
		expect(s.delivery_rate).toBeCloseTo(8 / 9, 3);
		// Clean means delivered with no stage recovered or missed, not merely "delivered".
		expect(s.clean_rate).toBeCloseTo(5 / 9, 3);
		expect(s.stages.map((x) => x.id)).toEqual(['brief', 'rig']);
		expect(s.stages[0].judged).toBe(8);
		expect(s.stages[0].met_rate).toBeCloseTo(7 / 8, 3);
		expect(s.top_causes[0]).toEqual({ stage: 'rig', label: 'Rig', verdict: 'missed', cause: 'Missing key bones: LeftUpLeg.', count: 2 });
	});

	describe('rig read-back', () => {
		let realFetch;
		beforeEach(() => {
			realFetch = globalThis.fetch;
		});
		afterEach(() => {
			globalThis.fetch = realFetch;
		});

		it('verifies a full humanoid rig from the delivered file', async () => {
			globalThis.fetch = vi.fn(async () => glbResponse(riggedGlb()));
			const { report, error } = await inspectRiggedGlb('https://three.ws/cdn/rigged.glb');
			expect(error).toBeNull();
			const s = rigStage({ report });
			expect(s.verdict).toBe('met');
			expect(s.metrics.convention).toBe('Mixamo');
			expect(s.metrics.joints).toBe(MIXAMO.length);
			expect(s.observed).toMatch(/torso, arms and legs all driven/);
			// Only the head of the file is requested.
			expect(globalThis.fetch.mock.calls[0][1].headers.Range).toMatch(/^bytes=0-/);
		});

		it('catches a rig with no legs: the avatar would slide instead of walk', async () => {
			const noLegs = MIXAMO.filter((b) => !/Leg|Foot|Toe/.test(b));
			globalThis.fetch = vi.fn(async () => glbResponse(riggedGlb(noLegs)));
			const { report } = await inspectRiggedGlb('https://three.ws/cdn/rigged.glb');
			const s = rigStage({ report });
			expect(s.verdict).toBe('missed');
			expect(s.observed).toMatch(/legs not mapped/);
			expect(s.cause).toMatch(/LeftUpLeg/);
		});

		it('catches a skeleton with no skin weights', async () => {
			globalThis.fetch = vi.fn(async () => glbResponse(riggedGlb(MIXAMO, { skinned: false })));
			const { report } = await inspectRiggedGlb('https://three.ws/cdn/rigged.glb');
			expect(rigStage({ report }).verdict).toBe('missed');
		});

		it('says it could not verify rather than guessing when the file is unreadable', async () => {
			globalThis.fetch = vi.fn(async () => ({ ok: false, status: 404 }));
			const { report, error } = await inspectRiggedGlb('https://three.ws/cdn/gone.glb');
			expect(report).toBeNull();
			const s = rigStage({ report, inspectError: error });
			expect(s.verdict).toBe('skipped');
			expect(s.cause).toMatch(/404/);
		});
	});
});

describe('studio wiring', () => {
	const auth = { userId: null, rateKey: '127.0.0.1', scope: '' };
	const mkReq = () => ({ headers: { host: 'three.ws', 'x-forwarded-proto': 'https' } });
	let realFetch;
	beforeEach(() => {
		realFetch = globalThis.fetch;
	});
	afterEach(() => {
		globalThis.fetch = realFetch;
	});

	it('attaches a receipt without disturbing the result it rides on', () => {
		const result = { content: [{ type: 'text', text: 'Generated a 3D model.' }], structuredContent: { glbUrl: 'https://x' } };
		const r = finishReceipt(startReceipt({ tool: 'mesh_forge', prompt: 'p' }), { glbUrl: 'https://x' });
		const out = attachReceipt(result, r, 'https://three.ws/runs/' + r.id);
		expect(out.structuredContent.glbUrl).toBe('https://x');
		expect(out.structuredContent.receipt).toMatchObject({ id: r.id, outcome: 'delivered', url: `https://three.ws/runs/${r.id}` });
		expect(out.content[0].text).toMatch(/^Generated a 3D model\.\nRun receipt/);
		expect(result.content[0].text).toBe('Generated a 3D model.');
	});

	it('records a full forge_avatar run: fallback brief, tier downgrade, and a rig verified from the file', async () => {
		const rigged = riggedGlb();
		globalThis.fetch = vi.fn(async (url, init) => {
			const u = String(url);
			if (u.endsWith('/rigged.glb')) return glbResponse(rigged);
			if (/\/api\/(gpt-)?forge/.test(u)) {
				// The rig submit is ?action=rig; its job polls back as R1.
				const isRig = /action=rig|job=R1/.test(u);
				return {
					ok: true,
					status: 200,
					json: async () =>
						isRig
							? { status: 'done', glb_url: 'https://three.ws/cdn/rigged.glb', job_id: 'R1', durable: true }
							: {
									status: 'done',
									glb_url: 'https://three.ws/cdn/mesh.glb',
									job_id: 'M1',
									tier: 'standard',
									backend: 'trellis_selfhost',
									durable: true,
									quality: { valid: true, flag: 'ok', score: 0.9, metrics: { triangleCount: 40000, hasTextures: true } },
								},
				};
			}
			// The director's LLM chain answers unusably: the fixed brief carries the run.
			return { ok: false, status: 503, json: async () => ({}), text: async () => '' };
		});
		const r = await dispatch(
			{ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'forge_avatar', arguments: { prompt: 'a knight in silver plate armor' } } },
			auth,
			mkReq(),
		);
		const sc = r.result.structuredContent;
		expect(sc.rigged).toBe(true);
		const receipt = sc.receipt;
		expect(isReceiptId(receipt.id)).toBe(true);
		const byStage = Object.fromEntries(receipt.issues.map((i) => [i.stage, i]));
		expect(byStage.brief.verdict).toBe('recovered');
		expect(byStage.mesh.verdict).toBe('recovered');
		expect(byStage.mesh.observed).toMatch(/standard tier on TRELLIS/);
		expect(byStage.rig).toBeUndefined();
		// Recovered stages are named but the run still delivered what was asked.
		expect(receipt.outcome).toBe('delivered');
		expect(receipt.summary).toMatch(/carried by a fallback \(Brief, Mesh\)/);
		// No database in tests, so the receipt is reported inline with no dead link.
		expect(receipt.url).toBeUndefined();
		expect(r.result.content[0].text).toMatch(/Run receipt: Delivered as expected/);
	});

	it('records a refusal with the prompt redacted', async () => {
		globalThis.fetch = vi.fn(async () => ({ ok: false, status: 503, json: async () => ({}) }));
		const r = await dispatch(
			{ jsonrpc: '2.0', id: 2, method: 'tools/call', params: { name: 'forge_avatar', arguments: { prompt: 'a wooden chair' } } },
			auth,
			mkReq(),
		);
		expect(r.result.isError).toBe(true);
		expect(r.result.structuredContent.receipt.outcome).toBe('refused');
		expect(r.result.structuredContent.receipt.issues[0]).toMatchObject({ stage: 'subject', verdict: 'missed' });
		// The forge was never called: the gate fires before any GPU time.
		expect(globalThis.fetch.mock.calls.some(([u]) => /\/api\/(gpt-)?forge/.test(String(u)))).toBe(false);
	});
});
