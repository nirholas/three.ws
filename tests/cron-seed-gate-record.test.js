// The forge seed cron records its quality verdict on the assets it KEEPS, not
// only on the ones it throws away.
//
// Until 2026-09-09 only a rejected row carried `gate`, so every accepted row in
// forge_seed_jobs was indistinguishable from a row that had never been gated at
// all: 9,925 publishes in 30 days, zero verdicts. That made the live accept rate
// unmeasurable from the table the cron writes, and left nothing but the failures
// to tune a threshold against. A comment in the same file claimed the full
// verdict was kept there, which is exactly the kind of claim that has to be a
// test rather than a sentence.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const queries = [];
vi.mock('../api/_lib/db.js', () => ({
	sql: (strings, ...values) => {
		const text = strings.join('?');
		queries.push({ text, values });
		// The compare-and-set that claims the row, then the avatar insert.
		if (/update forge_seed_jobs[\s\S]*status = 'done'/.test(text)) {
			// A row another tick already closed out returns nothing, which is what
			// the compare-and-set is for.
			return Promise.resolve(values.includes('taken-by-another-tick') ? [] : [{ id: 'job-1' }]);
		}
		if (/insert into avatars/.test(text)) return Promise.resolve([{ id: 'avatar-1' }]);
		return Promise.resolve([]);
	},
}));

const { publishSeedAvatar, rigStageEnabled, riggableShape } = await import('../api/cron/forge-seed-cron.js');

const JOB = {
	id: 'job-1',
	user_id: 'user-1',
	prompt: 'a lighthouse keeper in an oilskin coat',
	model_category: 'avatar',
	creation_id: 'creation-1',
};

const VERDICT = {
	accepted: true,
	gateVersion: 1,
	reasons: [],
	mesh: { flag: 'ok', score: 0.94, rigged: false, metrics: { vertexCount: 21804 } },
	vision: { status: 'ok', mean: 0.82 },
};

function closeOut() {
	return queries.find((q) => /update forge_seed_jobs[\s\S]*status = 'done'/.test(q.text));
}

describe('publishSeedAvatar', () => {
	beforeEach(() => {
		queries.length = 0;
	});

	it('writes the full verdict onto the job row it closes out', async () => {
		const id = await publishSeedAvatar({ job: JOB, verdict: VERDICT, rigged: false });
		expect(id).toBe('avatar-1');

		const update = closeOut();
		expect(update).toBeDefined();
		expect(update.text).toContain('gate =');
		const written = JSON.parse(update.values.find((v) => typeof v === 'string' && v.startsWith('{')));
		expect(written.accepted).toBe(true);
		expect(written.mesh.score).toBe(0.94);
		expect(written.vision.mean).toBe(0.82);
	});

	it('carries the summary onto the avatar row as well', async () => {
		await publishSeedAvatar({ job: JOB, verdict: VERDICT, rigged: false });
		const insert = queries.find((q) => /insert into avatars/.test(q.text));
		const meta = insert.values.find((v) => typeof v === 'string' && v.includes('quality_gate'));
		expect(JSON.parse(meta).quality_gate).toMatchObject({ accepted: true, mesh_flag: 'ok', vision: 'ok' });
	});

	it('survives a keeper published without a verdict rather than failing the tick', async () => {
		const id = await publishSeedAvatar({ job: JOB, verdict: null, rigged: false });
		expect(id).toBe('avatar-1');
		expect(closeOut().values).toContain(null);
	});

	it('publishes nothing when another tick already claimed the row', async () => {
		const lost = await publishSeedAvatar({
			job: { ...JOB, id: 'taken-by-another-tick' },
			verdict: VERDICT,
			rigged: false,
		});
		expect(lost).toBe(null);
		// The verdict write rides on the claim, so losing it must not leave a
		// second public avatar behind for the same creation.
		expect(queries.some((q) => /insert into avatars/.test(q.text))).toBe(false);
	});
});

// The rig stage: on unless something turns it off. Zero of the 17,349 avatars
// published before 2026-09-09 were rigged, because the stage was opt-in and
// nothing opted in.
describe('rigStageEnabled', () => {
	const original = process.env.SEED_CRON_RIG;
	afterEach(() => {
		if (original === undefined) delete process.env.SEED_CRON_RIG;
		else process.env.SEED_CRON_RIG = original;
	});

	it('is on when the env says nothing', () => {
		delete process.env.SEED_CRON_RIG;
		expect(rigStageEnabled()).toBe(true);
	});

	it('is off when the env turns it off', () => {
		process.env.SEED_CRON_RIG = '0';
		expect(rigStageEnabled()).toBe(false);
	});

	it('is on when the env turns it on explicitly', () => {
		process.env.SEED_CRON_RIG = '1';
		expect(rigStageEnabled()).toBe(true);
	});
});

// Which meshes may be rigged at all. Every number here is measured off real
// seeded output, not chosen: the ten proper humanoids in a 12-mesh sample were
// all thinnest front-to-back or side-to-side, and the two that were thinnest in
// Y are the two an auto-rig destroys, because the rigger skins the base slab
// along with the figure and the first clip that moves the legs tears it across
// the scene.
describe('riggableShape', () => {
	it('rigs an upright figure, thin front-to-back', () => {
		expect(riggableShape({ thinAxis: 'z', flatness: 0.3, planar: false })).toBe(true);
	});

	it('rigs an upright figure, thin side-to-side', () => {
		expect(riggableShape({ thinAxis: 'x', flatness: 0.19, planar: false })).toBe(true);
	});

	it('refuses a figure sitting in a base slab', () => {
		// The measured sky pirate: 1.99 x 0.69 x 1.99, rigged perfectly and
		// shredded on screen.
		expect(riggableShape({ thinAxis: 'y', flatness: 0.35, planar: false })).toBe(false);
	});

	it('refuses a mesh with no depth at all', () => {
		expect(riggableShape({ thinAxis: 'z', flatness: 0.005, planar: true })).toBe(false);
	});

	it('rigs when the mesh was never measured, rather than refusing on no evidence', () => {
		expect(riggableShape(null)).toBe(true);
		expect(riggableShape({})).toBe(true);
	});
});
