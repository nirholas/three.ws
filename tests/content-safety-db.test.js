// The public-listing safety screen on the real production schema (PGlite): the
// migration, the publish gate wired into setCreationVisibility, the sweep that
// promotes / holds / backfills, the admin decision, and report auto-hide. Only the
// two external signals (text classifier, vision) and the alerter are stubbed.

import { beforeAll, beforeEach, describe, it, expect, vi } from 'vitest';
import { createPgliteSql } from './_helpers/pglite-sql.js';
import { createFullSchemaDb } from './_helpers/pglite-full-schema.js';

const holder = vi.hoisted(() => ({ db: null }));

vi.mock('../api/_lib/db.js', async (importActual) => {
	const actual = await importActual();
	return { ...actual, sql: (...args) => holder.db.sql(...args) };
});
const alerts = [];
vi.mock('../api/_lib/alerts.js', () => ({ sendOpsAlert: async (...a) => { alerts.push(a); } }));
vi.mock('../api/_lib/indexnow-queue.js', () => ({ announceIndexNow: () => {} }));
vi.mock('../api/_lib/r2.js', async (importActual) => {
	const actual = await importActual();
	return { ...actual, objectStorageConfigured: () => true };
});

process.env.DATABASE_URL ||= 'postgres://pglite.test/db';

let pg;
let store;
let sweep;
let forgeStore;
let removals;
let n = 0;

const CK = 'a'.repeat(64);
const clear = { verdict: 'clear', categories: [], csam: false, models: ['m'], signals: { text: { checked: true }, image: { checked: true } } };
const blocked = { verdict: 'blocked', categories: ['sexual_explicit'], csam: false, models: ['m'], signals: null };
const csam = { verdict: 'blocked', categories: ['sexual_minors'], csam: true, models: ['m'], signals: null };
const undecided = { verdict: 'undecided', categories: [], csam: false, reasons: ['timeout'], models: [], signals: null };

async function seed(over = {}) {
	const id = crypto.randomUUID();
	n += 1;
	const row = {
		prompt: `a thing ${n}`, preview: 'https://x.test/p.png', visibility: 'unlisted', status: 'done',
		safety_status: null, publish_requested_at: null, internal: false, ...over,
	};
	await holder.db.sql`
		insert into forge_creations (id, client_key, prompt, preview_image_url, glb_url, status, outcome, visibility,
			safety_status, publish_requested_at, internal)
		values (${id}, ${CK}, ${row.prompt}, ${row.preview}, 'https://x.test/m.glb', ${row.status}, 'generated',
			${row.visibility}, ${row.safety_status}, ${row.publish_requested_at}, ${row.internal})
	`;
	return id;
}
const get = async (id) => (await holder.db.sql`select * from forge_creations where id = ${id}`)[0];
const reviews = (id) => holder.db.sql`select * from content_safety_reviews where subject_id = ${id} order by created_at`;
const stub = (v) => vi.fn(async () => v);

beforeAll(async () => {
	({ pg } = await createFullSchemaDb());
	holder.db = createPgliteSql({ pg });
	store = await import('../api/_lib/content-safety-store.js');
	sweep = await import('../api/_lib/content-safety-sweep.js');
	forgeStore = await import('../api/_lib/forge-store.js');
	removals = await import('../api/_lib/forge-removal-requests.js');
}, 300_000);

beforeEach(async () => {
	holder.db = createPgliteSql({ pg });
	alerts.length = 0;
	await holder.db.sql`delete from content_safety_reviews`;
	await holder.db.sql`delete from forge_removal_requests`;
	await holder.db.sql`delete from forge_creations`;
});

describe('setCreationVisibility publish gate', () => {
	const asOwner = (id, visibility) => forgeStore.setCreationVisibility({ id, clientKey: CK, visibility });

	it('refuses a stranger before spending any screen on the model', async () => {
		const id = await seed();
		const screen = stub(clear);
		const out = await forgeStore.setCreationVisibility({ id, clientKey: 'b'.repeat(64), visibility: 'public' });
		expect(out.outcome).toBe('not_found');
		expect(screen).not.toHaveBeenCalled();
		expect((await get(id)).visibility).toBe('unlisted');
	});

	it('keeps a model unlisted and remembers the request while the screen cannot answer', async () => {
		const id = await seed();
		// No NVIDIA key and no vision provider in the test env: the real screen is undecided.
		const out = await asOwner(id, 'public');
		expect(out.outcome).toBe('pending');
		const row = await get(id);
		expect(row.visibility).toBe('unlisted');
		expect(row.safety_status).toBe('pending');
		expect(row.publish_requested_at).not.toBeNull();
	});

	it('lets an already-cleared model go public and clears the pending request', async () => {
		const id = await seed({ safety_status: 'clear', publish_requested_at: new Date().toISOString() });
		const out = await asOwner(id, 'public');
		expect(out).toMatchObject({ outcome: 'updated', visibility: 'public' });
		expect((await get(id)).publish_requested_at).toBeNull();
	});

	it('refuses a blocked model public and unlisted, but allows private', async () => {
		const id = await seed({ safety_status: 'blocked', visibility: 'private' });
		expect((await asOwner(id, 'public')).outcome).toBe('blocked');
		expect((await asOwner(id, 'unlisted')).outcome).toBe('blocked');
		expect((await asOwner(id, 'private')).outcome).toBe('updated');
		expect((await get(id)).visibility).toBe('private');
	});

	it('going unlisted or private cancels a pending publish', async () => {
		const id = await seed({ safety_status: 'pending', publish_requested_at: new Date().toISOString() });
		expect((await asOwner(id, 'private')).outcome).toBe('updated');
		expect((await get(id)).publish_requested_at).toBeNull();
	});
});

describe('gatePublish', () => {
	it('clears, records the review, and allows', async () => {
		const id = await seed();
		const out = await store.gatePublish(id, { screen: stub(clear) });
		expect(out).toEqual({ allow: true });
		expect((await get(id)).safety_status).toBe('clear');
		expect((await reviews(id))).toHaveLength(1);
	});

	it('hands the screen every source photo the model was made from', async () => {
		const id = await seed();
		await holder.db.sql`update forge_creations set source_image_urls = ${JSON.stringify(['https://x.test/p.png', 'https://x.test/side.png'])}::jsonb where id = ${id}`;
		const screen = stub(clear);
		await store.gatePublish(id, { screen });
		expect(screen.mock.calls[0][0]).toMatchObject({
			previewImageUrl: 'https://x.test/p.png',
			sourceImageUrls: ['https://x.test/p.png', 'https://x.test/side.png'],
		});
	});

	it('forces a blocked model private, drops the request, and alerts', async () => {
		const id = await seed({ visibility: 'public', publish_requested_at: new Date().toISOString() });
		const out = await store.gatePublish(id, { screen: stub(blocked) });
		expect(out).toEqual({ allow: false, outcome: 'blocked' });
		const row = await get(id);
		expect(row).toMatchObject({ safety_status: 'blocked', visibility: 'private', publish_requested_at: null });
		expect(alerts[0][2]).toMatchObject({ severity: 'warn' });
	});

	it('raises a critical alert and records csam on a minors verdict', async () => {
		const id = await seed();
		await store.gatePublish(id, { screen: stub(csam) });
		expect(alerts[0][0]).toMatch(/CSAM/);
		expect(alerts[0][2].severity).toBe('critical');
		expect((await reviews(id))[0].csam).toBe(true);
	});

	it('does not re-screen a pending request inside the cooldown', async () => {
		const id = await seed();
		const screen = stub(undecided);
		expect(await store.gatePublish(id, { screen })).toEqual({ allow: false, outcome: 'pending' });
		expect(await store.gatePublish(id, { screen })).toEqual({ allow: false, outcome: 'pending' });
		expect(screen).toHaveBeenCalledTimes(1);
	});

	it('a screen that throws is undecided, never clear', async () => {
		const id = await seed();
		const out = await store.gatePublish(id, { screen: vi.fn(async () => { throw new Error('boom'); }) });
		expect(out).toEqual({ allow: false, outcome: 'pending' });
		expect((await get(id)).safety_status).toBe('pending');
	});
});

describe('sweepContentSafety', () => {
	const old = () => new Date(Date.now() - 7 * 3_600_000).toISOString();

	it('promotes a requested model once it clears', async () => {
		const id = await seed({ safety_status: 'pending', publish_requested_at: new Date().toISOString() });
		const stats = await sweep.sweepContentSafety({}, { screen: stub(clear) });
		expect(stats.promoted).toBe(1);
		expect(await get(id)).toMatchObject({ visibility: 'public', safety_status: 'clear', publish_requested_at: null });
	});

	it('promotes a born-public request (safety_status null) once it clears', async () => {
		const id = await seed({ publish_requested_at: new Date().toISOString() });
		await sweep.sweepContentSafety({}, { screen: stub(clear) });
		expect((await get(id)).visibility).toBe('public');
	});

	it('promotes an admin-approved held request without re-screening', async () => {
		const id = await seed({ safety_status: 'clear', publish_requested_at: new Date().toISOString() });
		const screen = stub(blocked);
		await sweep.sweepContentSafety({}, { screen });
		expect(screen).not.toHaveBeenCalled();
		expect((await get(id)).visibility).toBe('public');
	});

	it('blocks instead of promoting an unsafe one', async () => {
		const id = await seed({ safety_status: 'pending', publish_requested_at: new Date().toISOString() });
		const stats = await sweep.sweepContentSafety({}, { screen: stub(blocked) });
		expect(stats.blocked).toBe(1);
		expect(await get(id)).toMatchObject({ visibility: 'private', safety_status: 'blocked' });
	});

	it('holds a request that stays unscreenable past the deadline and alerts', async () => {
		const id = await seed({ safety_status: 'pending', publish_requested_at: old() });
		const stats = await sweep.sweepContentSafety({}, { screen: stub(undecided) });
		expect(stats.held).toBe(1);
		expect((await get(id)).safety_status).toBe('held');
		expect(alerts.some((a) => /held for manual/.test(a[0]))).toBe(true);
	});

	it('leaves a fresh undecided request pending', async () => {
		const id = await seed({ safety_status: 'pending', publish_requested_at: new Date().toISOString() });
		await sweep.sweepContentSafety({}, { screen: stub(undecided) });
		expect((await get(id)).safety_status).toBe('pending');
	});

	it('never touches a held or blocked request', async () => {
		const held = await seed({ safety_status: 'held', publish_requested_at: old() });
		const bad = await seed({ safety_status: 'blocked', visibility: 'private' });
		const screen = stub(clear);
		await sweep.sweepContentSafety({}, { screen });
		expect(screen).not.toHaveBeenCalled();
		expect((await get(held)).visibility).toBe('unlisted');
		expect((await get(bad)).visibility).toBe('private');
	});

	it('backfills already-public models: clears the clean, takes down the unsafe, skips seeds and unlisted', async () => {
		const good = await seed({ visibility: 'public' });
		const bad = await seed({ visibility: 'public', prompt: 'unsafe one' });
		const legacy = await seed({ visibility: null });
		const seedModel = await seed({ visibility: 'public', internal: true });
		const hidden = await seed({ visibility: 'unlisted' });
		const screen = vi.fn(async ({ prompt }) => (prompt === 'unsafe one' ? blocked : clear));
		const stats = await sweep.sweepContentSafety({}, { screen });
		expect(stats.backfilled).toBe(3);
		expect((await get(good)).safety_status).toBe('clear');
		expect(await get(bad)).toMatchObject({ safety_status: 'blocked', visibility: 'private' });
		expect((await get(legacy)).safety_status).toBe('clear');
		expect((await get(seedModel)).safety_status).toBeNull();
		expect((await get(hidden)).safety_status).toBeNull();
	});

	it('leaves an undecided backfill row public and unscreened for a later run', async () => {
		const id = await seed({ visibility: 'public' });
		await sweep.sweepContentSafety({}, { screen: stub(undecided) });
		const row = await get(id);
		expect(row.visibility).toBe('public');
		expect(row.safety_status).toBeNull();
		expect(row.safety_checked_at).not.toBeNull();
	});

	it('pages when every screen in a run is undecided', async () => {
		for (let i = 0; i < 3; i++) await seed({ visibility: 'public' });
		await sweep.sweepContentSafety({}, { screen: stub(undecided) });
		expect(alerts.some((a) => /not answering/.test(a[0]))).toBe(true);
	});
});

describe('adminDecision and the attention queue', () => {
	it('lists held and blocked models with their latest verdict, and counts statuses', async () => {
		const bad = await seed({ visibility: 'private' });
		await store.gatePublish(bad, { screen: stub(blocked) });
		await seed({ safety_status: 'held' });
		await seed({ visibility: 'public' });
		const items = await store.listAttention();
		expect(items).toHaveLength(2);
		const blockedItem = items.find((i) => i.id === bad);
		expect(blockedItem.last_review).toMatchObject({ verdict: 'blocked', csam: false });
		const counts = await store.safetyCounts();
		expect(counts).toMatchObject({ blocked: 1, held: 1, unscreened: 1 });
	});

	it('approve marks clear and audits the actor and reason', async () => {
		const id = await seed({ safety_status: 'held' });
		const out = await store.adminDecision({ id, action: 'approve', note: 'reviewed, fine', actor: 'ops@test' });
		expect(out.ok).toBe(true);
		expect((await get(id)).safety_status).toBe('clear');
		const [r] = await reviews(id);
		expect(r).toMatchObject({ verdict: 'clear', reviewer: 'admin:ops@test', note: 'reviewed, fine' });
	});

	it('puts an evidence hold on a model with any csam review, which the takedown CLI checks', async () => {
		const hit = await seed({ visibility: 'private' });
		await store.gatePublish(hit, { screen: stub(csam) });
		const other = await seed({ visibility: 'private' });
		await store.gatePublish(other, { screen: stub(blocked) });
		expect(await store.hasEvidenceHold(hit)).toBe(true);
		expect(await store.hasEvidenceHold(other)).toBe(false);
		expect(await store.hasEvidenceHold(crypto.randomUUID())).toBe(false);
		// A later clear verdict never lifts the hold: the evidence row is append-only.
		await store.adminDecision({ id: hit, action: 'approve', note: 'mistaken approve', actor: 'ops@test' });
		expect(await store.hasEvidenceHold(hit)).toBe(true);
	});

	it('approve of a missing model is not_found', async () => {
		const out = await store.adminDecision({ id: crypto.randomUUID(), action: 'approve', note: 'x', actor: 'a' });
		expect(out).toEqual({ ok: false, reason: 'not_found' });
	});
});

describe('report auto-hide', () => {
	const file = (id, key, reason = 'harmful') =>
		removals.fileRemovalRequest({
			creationId: id, reason, details: 'this is harmful content, please look', reporterKey: key, alert: async () => {},
		});

	it('hides a public model once three distinct reporters flag it, and holds it for review', async () => {
		const id = await seed({ visibility: 'public', safety_status: 'clear' });
		expect((await file(id, 'r1')).hidden).toBe(false);
		expect((await file(id, 'r2')).hidden).toBe(false);
		expect((await file(id, 'r2')).duplicate).toBe(true);
		expect((await file(id, 'r3')).hidden).toBe(true);
		expect(await get(id)).toMatchObject({ visibility: 'unlisted', safety_status: 'held' });
	});

	it('does not count copyright claims toward the hide threshold', async () => {
		const id = await seed({ visibility: 'public', safety_status: 'clear' });
		for (const k of ['r1', 'r2', 'r3']) await file(id, k, 'copyright');
		expect((await get(id)).visibility).toBe('public');
	});

	it('does not demote a model that is not public', async () => {
		const id = await seed({ visibility: 'private' });
		for (const k of ['r1', 'r2', 'r3']) await file(id, k);
		expect((await get(id)).visibility).toBe('private');
	});
});
