// IndexNow outbox (api/_lib/indexnow-queue.js) on a real Postgres (PGlite)
// built from the production migration, so dedupe, the resubmit floor and the
// keyset cursor are checked against real ON CONFLICT and row-comparison
// semantics rather than against SQL text.

import { readFileSync } from 'node:fs';
import { beforeAll, beforeEach, describe, it, expect, vi } from 'vitest';

const holder = vi.hoisted(() => ({ db: null }));

vi.mock('../api/_lib/db.js', async () => {
	const { createPgliteSql } = await import('./_helpers/pglite-sql.js');
	holder.db ??= createPgliteSql();
	return { sql: (...args) => holder.db.sql(...args) };
});

let q;

const ENTITY_DDL = `
create table agent_identities (
	id uuid primary key, name text, description text, is_public boolean default true,
	deleted_at timestamptz, created_at timestamptz default now(), updated_at timestamptz default now()
);
create table avatars (
	id uuid primary key, name text, description text, alt_text text, visibility text default 'public',
	deleted_at timestamptz, created_at timestamptz default now(), updated_at timestamptz default now()
);
create table forge_creations (
	id uuid primary key, status text, glb_url text, outcome text, visibility text,
	created_at timestamptz default now(), updated_at timestamptz default now()
);
create table widgets (
	id text primary key, is_public boolean default true,
	deleted_at timestamptz, created_at timestamptz default now(), updated_at timestamptz default now()
);
create table users (
	id uuid primary key, username text, service_account boolean default false,
	deleted_at timestamptz, created_at timestamptz default now(), updated_at timestamptz default now()
);
`;

const uuid = (n) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const AGENT = (n) => `https://three.ws/agents/${uuid(n)}`;

function sender(responses = []) {
	const calls = [];
	const send = async (urls) => {
		calls.push([...urls]);
		return responses.length ? responses.shift() : { ok: true, status: 200 };
	};
	return { send, calls };
}

async function outbox() {
	return holder.db.query('select url, reason, submitted_at, attempts, last_status from indexnow_urls order by url');
}

beforeAll(async () => {
	const { createPgliteSql } = await import('./_helpers/pglite-sql.js');
	holder.db ??= createPgliteSql();
	await holder.db.exec(ENTITY_DDL);
	await holder.db.exec(readFileSync(new URL('../api/_lib/migrations/20261111163200_indexnow.sql', import.meta.url), 'utf8'));
	q = await import('../api/_lib/indexnow-queue.js');
});

beforeEach(async () => {
	await holder.db.exec(`
		delete from indexnow_urls; delete from indexnow_submissions; delete from indexnow_cursors;
		delete from agent_identities; delete from avatars; delete from forge_creations; delete from widgets; delete from users;
	`);
});

describe('enqueue', () => {
	it('collapses repeated changes to one resource into one pending row', async () => {
		await q.enqueueIndexNow([{ type: 'agent', key: uuid(1), reason: 'create' }]);
		await q.enqueueIndexNow([{ type: 'agent', key: uuid(1), reason: 'update' }]);
		await q.enqueueIndexNow([
			{ type: 'agent', key: uuid(1), reason: 'update' },
			{ type: 'agent', key: uuid(1), reason: 'update' },
		]);
		const rows = await outbox();
		expect(rows).toHaveLength(1);
		expect(rows[0]).toMatchObject({ url: AGENT(1), reason: 'update', submitted_at: null });
	});

	it('writes the canonical URL each resource type lives at and drops what cannot name a page', async () => {
		await q.enqueueIndexNow([
			{ type: 'creation', key: 'AAAAAAAA-0000-4000-8000-000000000001' },
			{ type: 'avatar', key: uuid(2) },
			{ type: 'widget', key: 'w_abc' },
			{ type: 'profile', key: 'nova' },
			{ type: 'page', key: '/forge' },
			{ type: 'page', key: '/agents/:id' },
			{ type: 'token', key: 'x' },
			{ type: 'agent', key: '' },
		]);
		expect((await outbox()).map((r) => r.url)).toEqual([
			'https://three.ws/avatars/00000000-0000-4000-8000-000000000002',
			'https://three.ws/forge',
			'https://three.ws/m/aaaaaaaa-0000-4000-8000-000000000001',
			'https://three.ws/u/nova',
			'https://three.ws/w/w_abc',
		]);
	});

	it('never throws into the request that called it', async () => {
		await holder.db.exec('alter table indexnow_urls rename to indexnow_urls_gone');
		try {
			await expect(q.enqueueIndexNow([{ type: 'agent', key: uuid(1) }])).resolves.toBe(0);
		} finally {
			await holder.db.exec('alter table indexnow_urls_gone rename to indexnow_urls');
		}
	});
});

describe('drain', () => {
	it('posts pending URLs in batches no larger than the batch size and logs each request', async () => {
		await q.enqueueIndexNow(Array.from({ length: 25 }, (_, i) => ({ type: 'agent', key: uuid(i + 1), reason: 'create' })));
		const { send, calls } = sender();
		const out = await q.drainIndexNow({ send, batchSize: 10, maxBatches: 5 });
		expect(calls.map((c) => c.length)).toEqual([10, 10, 5]);
		expect(new Set(calls.flat()).size).toBe(25);
		expect(out.submitted).toBe(25);
		const log = await holder.db.query('select url_count, status, ok, sample_urls from indexnow_submissions order by id');
		expect(log.map((l) => [l.url_count, l.status, l.ok])).toEqual([[10, 200, true], [10, 200, true], [5, 200, true]]);
		expect(log[0].sample_urls).toHaveLength(5);
		expect((await outbox()).every((r) => r.submitted_at && r.last_status === 200)).toBe(true);
	});

	it('never caps a batch above the 10,000-URL IndexNow limit', async () => {
		await q.enqueueIndexNow([{ type: 'agent', key: uuid(1) }]);
		const { send } = sender();
		const out = await q.drainIndexNow({ send, batchSize: 50_000 });
		expect(out.submitted).toBe(1);
	});

	it('holds an update to a URL submitted in the last 24 hours, but lets a delete through', async () => {
		await q.enqueueIndexNow([{ type: 'agent', key: uuid(1) }, { type: 'agent', key: uuid(2) }]);
		await q.drainIndexNow({ send: sender().send });

		await q.enqueueIndexNow([
			{ type: 'agent', key: uuid(1), reason: 'update' },
			{ type: 'agent', key: uuid(2), reason: 'delete' },
		]);
		const { send, calls } = sender();
		await q.drainIndexNow({ send });
		expect(calls).toEqual([[AGENT(2)]]);

		await holder.db.exec(`update indexnow_urls set submitted_at = now() - interval '25 hours' where url = '${AGENT(1)}'`);
		const later = sender();
		await q.drainIndexNow({ send: later.send });
		expect(later.calls).toEqual([[AGENT(1)]]);
	});

	it('ignores a re-read of a resource that has not changed since it was submitted', async () => {
		// Changed 40 hours ago, submitted 30 hours ago: past the resubmit floor,
		// but nothing changed after the submission, so there is nothing to send.
		const changedAt = new Date(Date.now() - 40 * 3_600_000);
		await q.enqueueIndexNow([{ type: 'agent', key: uuid(1), changedAt }]);
		await q.drainIndexNow({ send: sender().send });
		await holder.db.exec(`update indexnow_urls set submitted_at = now() - interval '30 hours'`);
		expect(await q.enqueueIndexNow([{ type: 'agent', key: uuid(1), changedAt }])).toBe(0);
		const { send, calls } = sender();
		await q.drainIndexNow({ send });
		expect(calls).toEqual([]);
	});

	it('keeps a URL re-enqueued while its batch is in flight pending for the next run', async () => {
		await q.enqueueIndexNow([{ type: 'agent', key: uuid(1), changedAt: new Date(Date.now() - 60_000) }]);
		const send = async (urls) => {
			await q.enqueueIndexNow([{ type: 'agent', key: uuid(1), reason: 'delete' }]);
			return { ok: true, status: 200, urls };
		};
		await q.drainIndexNow({ send });
		const [row] = await outbox();
		expect(row.reason).toBe('delete');
		const next = sender();
		await q.drainIndexNow({ send: next.send });
		expect(next.calls).toEqual([[AGENT(1)]]);
	});

	it('stops on a 429, logs it, and sits out the cooldown', async () => {
		await q.enqueueIndexNow(Array.from({ length: 3 }, (_, i) => ({ type: 'agent', key: uuid(i + 1) })));
		const { send, calls } = sender([{ ok: false, status: 429, error: 'HTTP 429' }]);
		const first = await q.drainIndexNow({ send, batchSize: 1, maxBatches: 3 });
		expect(calls).toHaveLength(1);
		expect(first.submitted).toBe(0);
		const [log] = await holder.db.query('select status, ok, error from indexnow_submissions');
		expect(log).toEqual({ status: 429, ok: false, error: 'HTTP 429' });

		const again = sender();
		const second = await q.drainIndexNow({ send: again.send });
		expect(second.skipped).toBe('rate_limited');
		expect(again.calls).toEqual([]);
	});

	it('parks a URL after five failed requests until the resource changes again', async () => {
		await q.enqueueIndexNow([{ type: 'agent', key: uuid(1) }]);
		for (let i = 0; i < 5; i++) {
			await q.drainIndexNow({ send: sender([{ ok: false, status: 503, error: 'HTTP 503' }]).send });
		}
		const [row] = await outbox();
		expect(row.attempts).toBe(5);
		const parked = sender();
		await q.drainIndexNow({ send: parked.send });
		expect(parked.calls).toEqual([]);

		await q.enqueueIndexNow([{ type: 'agent', key: uuid(1) }]);
		const retried = sender();
		await q.drainIndexNow({ send: retried.send });
		expect(retried.calls).toEqual([[AGENT(1)]]);
	});
});

describe('reconcile', () => {
	const ago = (h) => new Date(Date.now() - h * 3_600_000).toISOString();

	it('announces public changes, skips what was never public, and drops what was', async () => {
		await holder.db.query(
			`insert into agent_identities (id, name, description, is_public, deleted_at, created_at, updated_at) values
				($1, 'Nova', 'A chrome scout.', true, null, $6, $6),
				($2, 'My First Agent', 'A friendly starter agent', true, null, $6, $6),
				($3, 'Secret', 'Private.', false, null, $6, $6),
				($4, 'Gone', 'Deleted while public.', true, $6, $7, $6),
				($5, 'Old', 'Unchanged for days.', true, null, $7, $7)`,
			[uuid(1), uuid(2), uuid(3), uuid(4), uuid(5), ago(1), ago(72)],
		);
		const { send, calls } = sender();
		const out = await q.reconcileIndexNow({ types: ['agent'], send });
		const agent = out.types[0];
		expect(agent).toMatchObject({ scanned: 4, live: 1, gone: 1, hidden: 2 });
		expect(calls).toHaveLength(1);
		expect(calls[0].sort()).toEqual([AGENT(1), AGENT(4)].sort());
		expect(calls.flat()).not.toContain(AGENT(3));
		expect(calls.flat()).not.toContain(AGENT(2));
	});

	it('announces a resource that went private only when it was announced before', async () => {
		await holder.db.query(
			`insert into avatars (id, name, description, visibility, updated_at) values ($1, 'Kite', 'A paper kite.', 'public', $3), ($2, 'Moth', 'Never public.', 'private', $3)`,
			[uuid(1), uuid(2), ago(1)],
		);
		await q.reconcileIndexNow({ types: ['avatar'], send: sender().send });

		await holder.db.query(`update avatars set visibility = 'private', updated_at = now() where id = $1`, [uuid(1)]);
		await holder.db.query(`update avatars set updated_at = now() where id = $1`, [uuid(2)]);
		const { send, calls } = sender();
		await q.reconcileIndexNow({ types: ['avatar'], send });
		expect(calls).toEqual([[`https://three.ws/avatars/${uuid(1)}`]]);
		const rows = await outbox();
		expect(rows).toHaveLength(1);
		expect(rows[0].reason).toBe('delete');
	});

	it('lists only finished, public, non-rejected forge creations', async () => {
		await holder.db.query(
			`insert into forge_creations (id, status, glb_url, outcome, visibility, updated_at) values
				($1, 'done', 'https://cdn/a.glb', null, null, $5),
				($2, 'done', 'https://cdn/b.glb', null, 'unlisted', $5),
				($3, 'done', 'https://cdn/c.glb', 'rejected', 'public', $5),
				($4, 'pending', null, null, 'public', $5)`,
			[uuid(1), uuid(2), uuid(3), uuid(4), ago(1)],
		);
		const { send, calls } = sender();
		await q.reconcileIndexNow({ types: ['creation'], send });
		expect(calls).toEqual([[`https://three.ws/m/${uuid(1)}`]]);
	});

	it('advances a keyset cursor so the next run reads only newer rows, ties included', async () => {
		const t = ago(1);
		await holder.db.query(
			`insert into widgets (id, updated_at) values ('w_a', $1), ('w_b', $1), ('w_c', $1)`,
			[t],
		);
		await q.reconcileIndexNow({ types: ['widget'], dryRun: false, drain: false });
		const [cur] = await holder.db.query(`select cursor_id from indexnow_cursors where resource_type = 'widget'`);
		expect(cur.cursor_id).toBe('w_c');
		await holder.db.query(`insert into widgets (id, updated_at) values ('w_d', $1)`, [t]);
		const second = await q.reconcileIndexNow({ types: ['widget'], drain: false });
		expect(second.types[0].scanned).toBe(1);
		expect(second.types[0].urls).toEqual(['https://three.ws/w/w_d']);
	});

	it('pages a backlog larger than one read', async () => {
		const values = Array.from({ length: 12 }, (_, i) => `('w_${String(i).padStart(2, '0')}', now() - interval '${60 - i} minutes')`);
		await holder.db.exec(`insert into widgets (id, updated_at) values ${values.join(',')}`);
		const out = await q.reconcileIndexNow({ types: ['widget'], drain: false, pageSize: 5 });
		expect(out.types[0].scanned).toBe(12);
		expect(await outbox()).toHaveLength(12);
		const [cur] = await holder.db.query(`select cursor_id from indexnow_cursors where resource_type = 'widget'`);
		expect(cur.cursor_id).toBe('w_11');
	});

	it('keeps service accounts and username-less users out of profiles', async () => {
		await holder.db.query(
			`insert into users (id, username, service_account, updated_at) values ($1, 'nova', false, $4), ($2, 'seed_bot_1', true, $4), ($3, null, false, $4)`,
			[uuid(1), uuid(2), uuid(3), ago(1)],
		);
		const { send, calls } = sender();
		await q.reconcileIndexNow({ types: ['profile'], send });
		expect(calls).toEqual([['https://three.ws/u/nova']]);
	});

	it('writes nothing and sends nothing on a dry run', async () => {
		await holder.db.query(`insert into widgets (id, updated_at) values ('w_a', $1)`, [ago(1)]);
		const { send, calls } = sender();
		const out = await q.reconcileIndexNow({ types: ['widget'], dryRun: true, send });
		expect(out.types[0].urls).toEqual(['https://three.ws/w/w_a']);
		expect(out.drain).toBeNull();
		expect(calls).toEqual([]);
		expect(await outbox()).toEqual([]);
		expect(await holder.db.query('select * from indexnow_cursors')).toEqual([]);
	});
});

describe('manifest pages', () => {
	it('skips catalog pages production does not serve yet and keeps the page cursor for them', async () => {
		// A manual run from a checkout ahead of production reads a pages.json
		// that lists pages not deployed yet. IndexNow fetches what it is sent,
		// so those must wait, and the cursor must not move past them.
		const today = new Date().toISOString().slice(0, 10);
		const manifest = { sections: [{ id: 'make', pages: [{ path: '/forge', added: today }, { path: '/unreleased', added: today }] }] };
		const checked = [];
		const isLive = async (url) => {
			checked.push(url);
			return !url.endsWith('/unreleased');
		};
		const { send, calls } = sender();
		const out = await q.reconcileIndexNow({ types: ['page'], manifest, isLive, send });
		expect(checked.sort()).toEqual(['https://three.ws/forge', 'https://three.ws/unreleased']);
		expect(out.types[0]).toMatchObject({ scanned: 2, live: 1, notLive: 1, enqueued: 1 });
		expect(out.types[0].skipped).toEqual(['https://three.ws/unreleased']);
		expect(calls).toEqual([['https://three.ws/forge']]);
		expect(await holder.db.query(`select * from indexnow_cursors where resource_type = 'page'`)).toEqual([]);

		const after = await q.reconcileIndexNow({ types: ['page'], manifest, isLive: async () => true, send });
		expect(after.types[0]).toMatchObject({ live: 2, notLive: 0 });
		expect(calls.at(-1)).toEqual(['https://three.ws/unreleased']);
		expect(await holder.db.query(`select resource_type from indexnow_cursors where resource_type = 'page'`)).toHaveLength(1);
	});

	it('picks public pages changed on or after the cursor day, by the same rule as core.xml', () => {
		const manifest = {
			sections: [
				{
					id: 'make',
					pages: [
						{ path: '/forge', added: '2026-11-10' },
						{ path: '/studio', added: '2026-01-01', lastmod: '2026-11-11' },
						{ path: '/old', added: '2026-01-01' },
						{ path: '/settings', added: '2026-11-11', auth: 'required' },
						{ path: '/hidden', added: '2026-11-11', indexable: false },
						{ path: '/agents/:id', added: '2026-11-11' },
					],
				},
				{ id: 'news', pages: [{ path: '/news/today', added: '2026-11-11' }] },
			],
		};
		const out = q.changedManifestPages(manifest, new Date('2026-11-10T12:00:00Z'));
		expect(out.map((p) => [p.key, p.reason])).toEqual([
			['/forge', 'create'],
			['/studio', 'update'],
		]);
	});
});
