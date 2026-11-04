// The catalog vision gate runs on its own cron (api/cron/forge-seed-vision-cron.js).
//
// The seed cron has a hard 70 s wall and a history of 504s when a phase
// overruns, and a render plus two judge calls costs 10 to 20 s of it, so stage
// 2 of the gate (render + Vertex judge) never ran in production: every seeded
// asset was gated on structure but not on appearance. With SEED_VISION_PHASE=1
// the seed cron stops after the mesh gate and parks a keeper in `mesh_passed`;
// the vision cron claims those rows under a lease, judges them inside its own
// budget, and publishes or quarantines through the same path the seed cron uses.
//
// The database and object storage are the only boundaries faked. The gate
// (evaluateSeedAsset, gateMesh, decideVisionVerdict), the quarantine writer and
// the publish path are the real modules. The fake database is a small row store
// that answers each statement the crons issue, so a claim that does not
// honour the lease, or a publish that does not compare-and-set, shows up as a
// duplicate avatar.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// ── A minimal-but-valid GLB that clears the mesh gate ───────────────────────

function buildGlb(gltf, binBytes) {
	const json = Buffer.from(JSON.stringify(gltf), 'utf8');
	const jsonChunk = Buffer.concat([json, Buffer.alloc((4 - (json.length % 4)) % 4, 0x20)]);
	const binChunk = Buffer.alloc(binBytes + ((4 - (binBytes % 4)) % 4), 0);
	const total = 12 + 8 + jsonChunk.length + 8 + binChunk.length;
	const out = Buffer.alloc(total);
	out.writeUInt32LE(0x46546c67, 0);
	out.writeUInt32LE(2, 4);
	out.writeUInt32LE(total, 8);
	out.writeUInt32LE(jsonChunk.length, 12);
	out.writeUInt32LE(0x4e4f534a, 16);
	jsonChunk.copy(out, 20);
	const off = 20 + jsonChunk.length;
	out.writeUInt32LE(binChunk.length, off);
	out.writeUInt32LE(0x004e4942, off + 4);
	binChunk.copy(out, off + 8);
	return out;
}

function healthyGlb() {
	const verts = 12_000;
	return buildGlb(
		{
			asset: { version: '2.0', generator: 'TRELLIS' },
			accessors: [
				{ componentType: 5126, count: verts, type: 'VEC3', min: [-0.4, 0, -0.3], max: [0.4, 1.8, 0.3] },
				{ componentType: 5125, count: verts * 6, type: 'SCALAR' },
			],
			meshes: [{ primitives: [{ attributes: { POSITION: 0 }, indices: 1, mode: 4, material: 0 }] }],
			materials: [{ pbrMetallicRoughness: { baseColorTexture: { index: 0 } } }],
			textures: [{ source: 0 }],
			images: [{ mimeType: 'image/png', bufferView: 0 }],
			nodes: [{ mesh: 0 }],
		},
		60_000,
	);
}

// ── Fake boundaries ─────────────────────────────────────────────────────────

const db = {
	jobs: new Map(),
	avatars: [],
	statements: [],
};
const storage = { puts: [], copies: [] };

const MIN = 60_000;
const ago = (ms) => new Date(Date.now() - ms).toISOString();
const leaseFree = (row) => !row.vision_lease_until || new Date(row.vision_lease_until).getTime() < Date.now();
const findRow = (values) => values.map((v) => db.jobs.get(v)).find(Boolean);

vi.mock('../api/_lib/db.js', () => ({
	sql: (strings, ...values) => {
		const text = strings.join('?');
		db.statements.push({ text, values });
		const ok = (rows) => Promise.resolve(rows);

		// Vision claim: lease up to N mesh_passed rows nobody else holds.
		if (/set vision_lease_until = now\(\) \+/.test(text)) {
			const limit = values[values.length - 1];
			const claimed = [...db.jobs.values()]
				.filter((r) => r.status === 'mesh_passed' && leaseFree(r))
				.sort((a, b) => new Date(a.mesh_passed_at) - new Date(b.mesh_passed_at))
				.slice(0, limit);
			for (const r of claimed) r.vision_lease_until = new Date(Date.now() + 120_000).toISOString();
			return ok(claimed.map((r) => ({ ...r })));
		}
		// Stale sweep (seed cron failsafe): read-only select of unleased stale rows.
		if (/from forge_seed_jobs[\s\S]*status = 'mesh_passed'[\s\S]*mesh_passed_at </.test(text) && /^\s*select/i.test(text)) {
			return ok(
				[...db.jobs.values()]
					.filter((r) => r.status === 'mesh_passed' && leaseFree(r)
						&& Date.now() - new Date(r.mesh_passed_at).getTime() > 30 * MIN)
					.map((r) => ({ ...r })),
			);
		}
		// Seed cron gate phase reads its 'generated' rows.
		if (/^\s*select[\s\S]*from forge_seed_jobs[\s\S]*status = 'generated'/i.test(text)) {
			return ok([...db.jobs.values()].filter((r) => r.status === 'generated').map((r) => ({ ...r })));
		}
		if (/select glb_key from forge_creations/.test(text)) {
			return ok([{ glb_key: `forge/creations/${values[0]}.glb` }]);
		}
		// Publish compare-and-set.
		if (/update forge_seed_jobs[\s\S]*set status = 'done'/.test(text)) {
			const row = findRow(values);
			const from = /and status = \?/.test(text) ? values[values.length - 1] : null;
			if (!row || row.status === 'done' || (from && row.status !== from)) return ok([]);
			row.status = 'done';
			row.gate = JSON.parse(values[0]);
			row.vision_lease_until = null;
			return ok([{ id: row.id }]);
		}
		if (/insert into avatars/.test(text)) {
			const meta = JSON.parse(values.find((v) => typeof v === 'string' && v.includes('forge_creation_id')));
			const id = `avatar-${db.avatars.length + 1}`;
			db.avatars.push({ id, meta });
			return ok([{ id }]);
		}
		if (/set avatar_id/.test(text)) {
			const row = findRow(values);
			if (row) row.avatar_id = values[0];
			return ok([]);
		}
		// Mesh gate pass under the vision phase.
		if (/set status = 'mesh_passed'/.test(text)) {
			const row = findRow(values);
			if (!row || row.status !== 'generated') return ok([]);
			row.status = 'mesh_passed';
			row.gate = JSON.parse(values[0]);
			row.mesh_passed_at = new Date().toISOString();
			row.gate_attempts = 0;
			row.vision_lease_until = null;
			return ok([{ id: row.id }]);
		}
		if (/set status = 'rejected'/.test(text)) {
			const row = findRow(values);
			const from = values[values.length - 1];
			if (!row || row.status !== from) return ok([]);
			row.status = 'rejected';
			row.gate = JSON.parse(values[0]);
			row.vision_lease_until = null;
			return ok([{ id: row.id }]);
		}
		// Vision retry: count the attempt and give the lease back.
		if (/set gate_attempts = \?[\s\S]*vision_lease_until = null/.test(text)) {
			const row = findRow(values);
			if (row) {
				row.gate_attempts = values[0];
				row.vision_lease_until = null;
				row.error = values[1];
			}
			return ok([]);
		}
		// Release a lease the tick ran out of budget for.
		if (/set vision_lease_until = null/.test(text)) {
			for (const id of values.flat()) {
				const row = db.jobs.get(id);
				if (row) row.vision_lease_until = null;
			}
			return ok([]);
		}
		return ok([]);
	},
}));

vi.mock('../api/_lib/r2.js', () => ({
	getObjectBuffer: async () => healthyGlb(),
	publicUrl: (key) => `https://three.ws/cdn/${key}`,
	putObject: async ({ key, body }) => {
		storage.puts.push({ key, body: body.toString('utf8') });
	},
	copyObject: async ({ fromKey, toKey }) => {
		storage.copies.push({ fromKey, toKey });
	},
}));

const { advanceVision, visionAssetBudgetMs } = await import('../api/cron/forge-seed-vision-cron.js');
const { advanceGates, sweepStaleMeshPassed } = await import('../api/cron/forge-seed-cron.js');

// ── Fixtures ────────────────────────────────────────────────────────────────

function meshVerdict() {
	return {
		gateVersion: 'test',
		accepted: true,
		reasons: [],
		mesh: { pass: true, reasons: [], flag: 'ok', score: 9, rigged: false, jointCount: 0, metrics: {} },
		vision: { status: 'skipped' },
		transport: null,
	};
}

function addRow(id, over = {}) {
	db.jobs.set(id, {
		id,
		user_id: `user-${id}`,
		raw_client_id: `client-${id}`,
		prompt: 'a lighthouse keeper in an oilskin coat',
		model_category: 'avatar',
		creation_id: `creation-${id}`,
		glb_url: null,
		backend: 'trellis',
		status: 'mesh_passed',
		gate: meshVerdict(),
		gate_attempts: 0,
		mesh_passed_at: ago(2 * MIN),
		vision_lease_until: null,
		started_at: ago(5 * MIN),
		...over,
	});
	return db.jobs.get(id);
}

const judgeAccepts = () => ({
	name: 'test',
	calls: 0,
	async render() { this.calls += 1; return Buffer.from('png'); },
	judgeRealism: async () => ({ photorealism: 8, geometryIntegrity: 8, textureFidelity: 8, promptAdherence: 8 }),
	judgeRigReadiness: async () => ({ subjectPresent: true, singleSubject: true, complete: true, limbsSeparated: true, blob: false }),
});

const judgeRejects = () => ({
	...judgeAccepts(),
	judgeRigReadiness: async () => ({ subjectPresent: true, singleSubject: true, complete: false, limbsSeparated: true, blob: false }),
});

const judgeDown = () => ({
	...judgeAccepts(),
	render: async () => { throw new Error('vertex 503 unavailable'); },
});

const tick = (transport, extra = {}) =>
	advanceVision({ origin: 'https://three.ws', transport, ...extra });

beforeEach(() => {
	db.jobs.clear();
	db.avatars.length = 0;
	db.statements.length = 0;
	storage.puts.length = 0;
	storage.copies.length = 0;
	// Keep these runs on the publish path; the rig route is covered by
	// cron-seed-gate-record.test.js and does not change here.
	vi.stubEnv('SEED_CRON_RIG', '0');
});

afterEach(() => {
	vi.unstubAllEnvs();
});

// ── The vision cron ─────────────────────────────────────────────────────────

describe('forge-seed-vision-cron', () => {
	it('publishes a mesh_passed row the judge accepts, carrying the judged verdict', async () => {
		addRow('a');
		const results = await tick(judgeAccepts());

		expect(results).toEqual([expect.objectContaining({ job_id: 'a', status: 'published' })]);
		const row = db.jobs.get('a');
		expect(row.status).toBe('done');
		expect(row.gate.vision.status).toBe('judged');
		expect(row.gate.vision.mean).toBe(8);
		expect(db.avatars).toHaveLength(1);
		expect(db.avatars[0].meta.quality_gate.vision).toBe('judged');
	});

	it('quarantines a row the judge rejects under forge/rejected/ with the verdict sidecar', async () => {
		addRow('b');
		const results = await tick(judgeRejects());

		expect(results[0]).toMatchObject({ job_id: 'b', status: 'rejected', reasons: ['vision_incomplete_body'] });
		expect(db.jobs.get('b').status).toBe('rejected');
		expect(db.avatars).toHaveLength(0);
		expect(storage.copies).toEqual([{ fromKey: 'forge/creations/creation-b.glb', toKey: 'forge/rejected/creation-b.glb' }]);
		const sidecar = storage.puts.find((p) => p.key === 'forge/rejected/creation-b.reason.json');
		expect(sidecar).toBeTruthy();
		const body = JSON.parse(sidecar.body);
		expect(body.reasons).toEqual(['vision_incomplete_body']);
		expect(body.verdict.vision.status).toBe('judged');
		expect(body.source).toBe('forge-seed-vision-cron');
	});

	it('retries a judge that throws, then publishes on the verdict once it answers', async () => {
		addRow('c');
		let failures = 2;
		const flaky = {
			...judgeAccepts(),
			async render() {
				if (failures > 0) { failures -= 1; throw new Error('vertex 429 quota'); }
				return Buffer.from('png');
			},
		};

		const first = await tick(flaky);
		expect(first[0]).toMatchObject({ job_id: 'c', status: 'vision_retry', attempt: 1 });
		expect(db.jobs.get('c').status).toBe('mesh_passed');
		expect(db.jobs.get('c').vision_lease_until).toBeNull();

		const second = await tick(flaky);
		expect(second[0]).toMatchObject({ status: 'vision_retry', attempt: 2 });

		const third = await tick(flaky);
		expect(third[0]).toMatchObject({ status: 'published' });
		expect(db.jobs.get('c').gate.vision.status).toBe('judged');
		expect(db.avatars).toHaveLength(1);
	});

	it('publishes on the mesh verdict, marked vision_unavailable, once the attempts are spent', async () => {
		addRow('d', { gate_attempts: 2 });
		const results = await tick(judgeDown());

		expect(results[0]).toMatchObject({ job_id: 'd', status: 'published', vision: 'unavailable' });
		const row = db.jobs.get('d');
		expect(row.status).toBe('done');
		expect(row.gate.vision.status).toBe('unavailable');
		expect(row.gate.vision.error).toMatch(/vertex 503/);
		// Never counted as a quality reject.
		expect(row.gate.reasons).toEqual([]);
		expect(db.avatars[0].meta.quality_gate.vision).toBe('unavailable');
	});

	it('publishes vision_unavailable straight away once a row has waited past the 30 minute bound', async () => {
		addRow('e', { mesh_passed_at: ago(31 * MIN) });
		const results = await tick(judgeDown());

		expect(results[0]).toMatchObject({ job_id: 'e', status: 'published', vision: 'unavailable' });
		expect(db.jobs.get('e').gate.vision.status).toBe('unavailable');
	});

	it('never lets two concurrent ticks claim the same row', async () => {
		for (const id of ['r1', 'r2', 'r3']) addRow(id);
		vi.stubEnv('SEED_VISION_BATCH', '2');

		const [a, b] = await Promise.all([tick(judgeAccepts()), tick(judgeAccepts())]);

		const handled = [...a, ...b].map((r) => r.job_id).sort();
		expect(handled).toEqual(['r1', 'r2', 'r3']);
		expect(db.avatars).toHaveLength(3);
		expect(new Set(db.avatars.map((x) => x.meta.forge_creation_id)).size).toBe(3);
		for (const id of ['r1', 'r2', 'r3']) expect(db.jobs.get(id).status).toBe('done');
	});

	it('gives back the lease of a claimed row the tick has no budget left for', async () => {
		addRow('f');
		addRow('g', { mesh_passed_at: ago(1 * MIN) });
		vi.stubEnv('SEED_VISION_BATCH', '2');

		// A tick whose budget is already spent judges nothing and holds nothing.
		const results = await tick(judgeAccepts(), { budgetMs: 0 });

		expect(results.map((r) => r.status)).toEqual(['deferred', 'deferred']);
		expect(db.jobs.get('f').vision_lease_until).toBeNull();
		expect(db.jobs.get('g').vision_lease_until).toBeNull();
		expect(db.avatars).toHaveLength(0);
	});

	it('gives one asset 40 s by default, sized to the measured render + judge, not the 20 s inline budget', () => {
		const prior = process.env.SEED_VISION_ASSET_MS;
		try {
			delete process.env.SEED_VISION_ASSET_MS;
			expect(visionAssetBudgetMs()).toBe(40_000);
			process.env.SEED_VISION_ASSET_MS = '5000';
			expect(visionAssetBudgetMs()).toBe(10_000);
			process.env.SEED_VISION_ASSET_MS = '90000';
			expect(visionAssetBudgetMs()).toBe(55_000);
		} finally {
			if (prior == null) delete process.env.SEED_VISION_ASSET_MS;
			else process.env.SEED_VISION_ASSET_MS = prior;
		}
	});

	it('does nothing when no row is waiting', async () => {
		expect(await tick(judgeAccepts())).toEqual([]);
	});
});

// ── The seed cron, with and without the vision phase ────────────────────────

describe('forge-seed-cron gate phase under SEED_VISION_PHASE', () => {
	it('parks a mesh keeper in mesh_passed instead of publishing it when the flag is on', async () => {
		vi.stubEnv('SEED_VISION_PHASE', '1');
		addRow('h', { status: 'generated', gate: null, mesh_passed_at: null });

		const results = await advanceGates('https://three.ws');

		expect(results[0]).toMatchObject({ job_id: 'h', status: 'mesh_passed' });
		const row = db.jobs.get('h');
		expect(row.status).toBe('mesh_passed');
		expect(row.gate.mesh.pass).toBe(true);
		expect(row.gate.vision.status).toBe('skipped');
		expect(db.avatars).toHaveLength(0);
	});

	it('publishes after the mesh gate exactly as before when the flag is off', async () => {
		addRow('i', { status: 'generated', gate: null, mesh_passed_at: null });

		const results = await advanceGates('https://three.ws');

		expect(results[0]).toMatchObject({ job_id: 'i', status: 'published' });
		expect(db.jobs.get('i').status).toBe('done');
		expect(db.avatars).toHaveLength(1);
		expect(db.statements.some((s) => /mesh_passed/.test(s.text) && /^\s*update/i.test(s.text))).toBe(false);
	});

	it('publishes a mesh_passed row the vision cron never reached, marked vision_unavailable', async () => {
		addRow('j', { mesh_passed_at: ago(45 * MIN) });
		addRow('k', { mesh_passed_at: ago(5 * MIN) });

		const results = await sweepStaleMeshPassed('https://three.ws');

		expect(results).toEqual([expect.objectContaining({ job_id: 'j', status: 'published', vision: 'unavailable' })]);
		expect(db.jobs.get('j').gate.vision.status).toBe('unavailable');
		expect(db.jobs.get('j').gate.vision.error).toMatch(/30m/);
		expect(db.jobs.get('k').status).toBe('mesh_passed');
	});
});
