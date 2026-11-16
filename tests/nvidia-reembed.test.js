import { describe, it, expect } from 'vitest';
import {
	parseCliArgs,
	classifyResult,
	withBackoff,
	phaseOf,
	summarizeCounts,
	knownItemQuery,
	verifyRows,
	runTable,
	TABLES,
	deployGate,
	READER_COMMIT,
} from '../scripts/nvidia-reembed.mjs';

const NEW = 'nvidia/nemotron-3.5-embed-8b@2048';
const OLD = 'nvidia/nemotron-3-embed-1b@2048';
const E5 = 'intfloat/e5-large@1024';
const servable = (tag) => tag === NEW || tag === OLD;

// In-memory agent_memories + embedding_migrations, routed on SQL text.
function fakeDb(rows) {
	const table = rows.map((r) => ({ embedding_prev: null, embedder_prev: null, ...r }));
	const cursors = new Map();
	const sql = async (strings, ...v) => {
		const text = strings.join('?');
		if (text.includes('FROM embedding_migrations WHERE')) {
			const row = cursors.get(`${v[0]}|${v[1]}`);
			return row ? [row] : [];
		}
		if (text.includes('INSERT INTO embedding_migrations')) {
			const [t, target, cursor, scanned, moved, backfilled, kept, skipped, completed] = v;
			const key = `${t}|${target}`;
			const prev = cursors.get(key) || { scanned: 0, moved: 0, backfilled: 0, kept: 0, skipped: 0, completed_at: null };
			cursors.set(key, {
				table_name: t,
				target,
				cursor,
				scanned: prev.scanned + scanned,
				moved: prev.moved + moved,
				backfilled: prev.backfilled + backfilled,
				kept: prev.kept + kept,
				skipped: prev.skipped + skipped,
				completed_at: completed || prev.completed_at,
			});
			return [];
		}
		if (text.includes('FROM agent_memories') && text.includes('ORDER BY agent_memories.id')) {
			const [target, cursor, , limit] = v;
			return table
				.filter((r) => r.embedder !== target && (cursor == null || r.id > cursor))
				.sort((a, b) => (a.id < b.id ? -1 : 1))
				.slice(0, limit)
				.map((r) => ({ id: r.id, content: r.content, embedder: r.embedder, has_vector: r.embedding != null }));
		}
		if (text.includes('UPDATE agent_memories') && text.includes('embedding_prev = embedding')) {
			const [noPrevious, vec, tag, id, embedder, content] = v;
			const r = table.find((x) => x.id === id && (x.embedder ?? null) === (embedder ?? null) && x.content === content);
			if (!r) return [];
			Object.assign(r, { embedding_prev: r.embedding, embedder_prev: r.embedder ?? noPrevious, embedding: JSON.parse(vec), embedder: tag });
			return [{ id }];
		}
		throw new Error(`unexpected query: ${text}`);
	};
	return { sql, table, cursors };
}

const noSleep = async () => {};

describe('parseCliArgs', () => {
	it('defaults to a full run over every table', () => {
		const o = parseCliArgs([]);
		expect(o.mode).toBe('run');
		expect(o.tables).toEqual(['agent_memories', 'agent_knowledge_chunks', 'widget_knowledge_chunks']);
		expect(o.batch).toBe(16);
	});
	it('reads modes and pacing flags, and rejects unknown input', () => {
		expect(parseCliArgs(['--status']).mode).toBe('status');
		expect(parseCliArgs(['--table', 'agent_memories', '--batch', '8', '--pause-ms', '0', '--limit', '5'])).toMatchObject({
			tables: ['agent_memories'],
			batch: 8,
			pauseMs: 0,
			limit: 5,
		});
		expect(() => parseCliArgs(['--table', 'users'])).toThrow(/unknown table/);
		expect(() => parseCliArgs(['--restore'])).toThrow(/one table at a time/);
		expect(() => parseCliArgs(['--nope'])).toThrow(/unknown argument/);
	});
});

describe('classifyResult', () => {
	it('moves rows the target accepted', () => {
		expect(classifyResult({ has_vector: true, embedder: OLD }, NEW, NEW, servable)).toBe('move');
	});
	it('keeps a refused row whose old vector still serves', () => {
		expect(classifyResult({ has_vector: true, embedder: OLD }, OLD, NEW, servable)).toBe('keep');
	});
	it('backfills a refused row that had no vector or a retired space', () => {
		expect(classifyResult({ has_vector: false, embedder: null }, OLD, NEW, servable)).toBe('backfill');
		expect(classifyResult({ has_vector: true, embedder: E5 }, OLD, NEW, servable)).toBe('backfill');
	});
});

describe('withBackoff', () => {
	it('retries 429s and 5xx, then succeeds', async () => {
		let n = 0;
		const waits = [];
		const out = await withBackoff(
			async () => {
				if (++n < 3) throw Object.assign(new Error('rl'), { status: n === 1 ? 429 : 503 });
				return 'ok';
			},
			{ sleep: async (ms) => waits.push(ms), baseMs: 10 },
		);
		expect(out).toBe('ok');
		expect(waits).toEqual([10, 20]);
	});
	it('does not retry a client error and gives up after the retry budget', async () => {
		let n = 0;
		await expect(withBackoff(async () => { n++; throw Object.assign(new Error('bad'), { status: 400 }); }, { sleep: noSleep })).rejects.toThrow('bad');
		expect(n).toBe(1);
		n = 0;
		await expect(withBackoff(async () => { n++; throw Object.assign(new Error('rl'), { status: 429 }); }, { sleep: noSleep, retries: 2 })).rejects.toThrow('rl');
		expect(n).toBe(3);
	});
});

describe('status helpers', () => {
	it('summarizes spaces per table', () => {
		const s = summarizeCounts(
			'agent_memories',
			[
				{ embedder: NEW, has_vector: true, has_prev: true, n: 5 },
				{ embedder: OLD, has_vector: true, has_prev: false, n: 3 },
				{ embedder: null, has_vector: false, has_prev: false, n: 2 },
			],
			NEW,
		);
		expect(s).toMatchObject({ total: 10, target: 5, withPrev: 5, noVector: 2, spaces: { [NEW]: 5, [OLD]: 3, '(no vector)': 2 } });
	});
	it('derives the phase', () => {
		expect(phaseOf(null, 4)).toBe('not started');
		expect(phaseOf(null, 0)).toBe('cut over');
		expect(phaseOf({ cursor: 'a' }, 4)).toBe('in progress');
		expect(phaseOf({ completed_at: 'x' }, 0)).toBe('cut over');
		expect(phaseOf({ completed_at: 'x', verified_at: 'y' }, 0)).toBe('verified');
	});
	it('builds known-item queries from the leading words', () => {
		expect(knownItemQuery('  the user   prefers dark mode and short replies always please ok ', 4)).toBe('the user prefers dark');
	});
});

describe('runTable', () => {
	const rows = () => [
		{ id: 'a', content: 'alpha', embedder: OLD, embedding: [1, 0] },
		{ id: 'b', content: 'refused', embedder: OLD, embedding: [0, 1] },
		{ id: 'c', content: 'gamma', embedder: null, embedding: null },
		{ id: 'd', content: 'refused too', embedder: null, embedding: null },
		{ id: 'e', content: 'already', embedder: NEW, embedding: [1, 1] },
	];
	const embed = async (texts) => texts.map((t) => ({ tag: t.startsWith('refused') ? OLD : NEW, vector: [t.length, 1] }));

	it('moves accepted rows, keeps old vectors in prev, and backfills only rows with nothing to serve', async () => {
		const db = fakeDb(rows());
		const r = await runTable(db.sql, 'agent_memories', { target: NEW, embed, isServable: servable, batch: 2, pauseMs: 0, limit: Infinity, sleep: noSleep });
		expect(r).toMatchObject({ scanned: 4, moved: 2, backfilled: 1, kept: 1, skipped: 0, completed: true });
		const by = Object.fromEntries(db.table.map((x) => [x.id, x]));
		expect(by.a).toMatchObject({ embedder: NEW, embedder_prev: OLD, embedding_prev: [1, 0] });
		expect(by.b).toMatchObject({ embedder: OLD, embedding: [0, 1], embedder_prev: null });
		// It had no vector: the sentinel marks it migrated so --restore can undo it.
		expect(by.c).toMatchObject({ embedder: NEW, embedder_prev: '', embedding_prev: null });
		expect(by.d).toMatchObject({ embedder: OLD, embedding: [11, 1] });
		expect(by.e).toMatchObject({ embedder: NEW, embedding: [1, 1], embedder_prev: null });
		expect(db.cursors.get(`agent_memories|${NEW}`).completed_at).toBeTruthy();
	});

	it('resumes from its cursor and never re-embeds a row twice', async () => {
		const db = fakeDb(rows());
		const seen = [];
		const counting = async (texts) => {
			seen.push(...texts);
			return embed(texts);
		};
		const opts = { target: NEW, embed: counting, isServable: servable, batch: 2, pauseMs: 0, sleep: noSleep };
		const first = await runTable(db.sql, 'agent_memories', { ...opts, limit: 2 });
		expect(first).toMatchObject({ scanned: 2, completed: false, cursor: 'b' });
		const second = await runTable(db.sql, 'agent_memories', { ...opts, limit: Infinity });
		expect(second.completed).toBe(true);
		// The refused row 'b' sits behind the cursor: it is not retried forever.
		expect(seen).toEqual(['alpha', 'refused', 'gamma', 'refused too']);
		const again = await runTable(db.sql, 'agent_memories', { ...opts, limit: Infinity });
		expect(again.scanned).toBe(0);
	});

	it('skips a row edited mid-run instead of writing a vector for stale content', async () => {
		const db = fakeDb(rows());
		const racing = async (texts) => {
			db.table.find((x) => x.id === 'a').content = 'alpha, edited';
			return embed(texts);
		};
		const r = await runTable(db.sql, 'agent_memories', { target: NEW, embed: racing, isServable: servable, batch: 8, pauseMs: 0, limit: Infinity, sleep: noSleep });
		expect(r.skipped).toBe(1);
		expect(db.table.find((x) => x.id === 'a')).toMatchObject({ embedder: OLD, embedder_prev: null });
	});

	it('stops with the cursor saved when the lane stays down, writing nothing in the old space', async () => {
		const db = fakeDb(rows());
		const down = async () => {
			throw Object.assign(new Error('rate limited'), { status: 429 });
		};
		await expect(
			runTable(db.sql, 'agent_memories', { target: NEW, embed: down, isServable: servable, batch: 2, pauseMs: 0, limit: Infinity, sleep: noSleep }),
		).rejects.toThrow('rate limited');
		expect(db.table.filter((x) => x.embedder_prev)).toEqual([]);
		expect(db.cursors.size).toBe(0);
	});
});

describe('verifyRows', () => {
	it('ranks each known-item query within its scope in both spaces', async () => {
		// Two orthogonal rows per scope; the query for a row embeds onto that row
		// in the new space, and onto the wrong row in the old space.
		const rows = [
			{ id: '1', scope: 'agent', content: 'one', vec: [1, 0], prev_tag: OLD, prev_vec: [1, 0] },
			{ id: '2', scope: 'agent', content: 'two', vec: [0, 1], prev_tag: OLD, prev_vec: [0, 1] },
		];
		const embedQueryIn = async (tag, text) => {
			const own = text === 'one' ? [1, 0] : [0, 1];
			return tag === NEW ? own : [own[1], own[0]];
		};
		const r = await verifyRows(rows, NEW, embedQueryIn);
		expect(r).toMatchObject({ queries: 2, scopes: 1, new: { recall_at_1: 100, mrr: 100 }, old: { recall_at_1: 0, mrr: 50 }, passed: true });
	});
	it('does not pass with nothing to compare', async () => {
		const r = await verifyRows([{ id: '1', scope: 's', content: 'x', vec: [1], prev_tag: OLD, prev_vec: [1] }], NEW, async () => [1]);
		expect(r).toMatchObject({ queries: 0, passed: false });
	});
});

async function pgliteDb() {
	const { PGlite } = await import('@electric-sql/pglite');
	const pg = new PGlite();
	const sql = async (strings, ...values) => {
		const text = strings.reduce((acc, s, i) => acc + `$${i}` + s);
		return (await pg.query(text, values)).rows;
	};
	await pg.exec(`
		CREATE TABLE widget_knowledge_chunks (id bigserial PRIMARY KEY, widget_id text, content text,
			embedding jsonb, embedder text, embedding_prev jsonb, embedder_prev text);
		CREATE TABLE embedding_migrations (table_name text, target text, cursor text,
			scanned int NOT NULL DEFAULT 0, moved int NOT NULL DEFAULT 0, backfilled int NOT NULL DEFAULT 0,
			kept int NOT NULL DEFAULT 0, skipped int NOT NULL DEFAULT 0, started_at timestamptz NOT NULL DEFAULT now(),
			updated_at timestamptz NOT NULL DEFAULT now(), completed_at timestamptz, verified_at timestamptz,
			verification jsonb, PRIMARY KEY (table_name, target));
	`);
	return { pg, sql };
}

describe('--restore on a real Postgres engine (PGlite)', () => {
	it('returns a row that had no vector to no vector, and leaves rows the run never touched alone', async () => {
		const { pg, sql } = await pgliteDb();
		await pg.query(`INSERT INTO widget_knowledge_chunks (widget_id, content, embedding, embedder) VALUES ('w', 'had old', '[1,0]', $1)`, [OLD]);
		await pg.query(`INSERT INTO widget_knowledge_chunks (widget_id, content, embedding, embedder) VALUES ('w', 'had none', NULL, NULL)`);
		const embed = async (texts) => texts.map(() => ({ tag: NEW, vector: [0, 1] }));
		await runTable(sql, 'widget_knowledge_chunks', { target: NEW, embed, isServable: servable, batch: 8, pauseMs: 0, limit: Infinity, sleep: noSleep });
		// A row written by new code after the run: in the target space, never migrated.
		await pg.query(`INSERT INTO widget_knowledge_chunks (widget_id, content, embedding, embedder) VALUES ('w', 'fresh', '[0,1]', $1)`, [NEW]);
		const restored = await TABLES.widget_knowledge_chunks.restore(sql, NEW);
		expect(restored).toHaveLength(2);
		const rows = (await pg.query(`SELECT content, embedding, embedder, embedding_prev, embedder_prev FROM widget_knowledge_chunks ORDER BY id`)).rows;
		expect(rows).toEqual([
			{ content: 'had old', embedding: [1, 0], embedder: OLD, embedding_prev: null, embedder_prev: null },
			{ content: 'had none', embedding: null, embedder: null, embedding_prev: null, embedder_prev: null },
			{ content: 'fresh', embedding: [0, 1], embedder: NEW, embedding_prev: null, embedder_prev: null },
		]);
		await pg.close();
	}, 30000);
});

describe('runTable on a real Postgres engine (PGlite)', () => {
	it('resumes a bigint-id table in numeric order, so ids past 9 are not skipped', async () => {
		const { pg, sql } = await pgliteDb();
		// 20 rows: sorted as text, the first batch of 5 is 1, 10, 11, 12, 13 and a
		// cursor at 13 would leave 2..9 behind.
		for (let i = 1; i <= 20; i++) {
			await pg.query(`INSERT INTO widget_knowledge_chunks (widget_id, content, embedding, embedder) VALUES ('w', $1, '[1,0]', $2)`, [`chunk ${i}`, OLD]);
		}
		const embed = async (texts) => texts.map(() => ({ tag: NEW, vector: [0, 1] }));
		const opts = { target: NEW, embed, isServable: servable, batch: 5, pauseMs: 0, sleep: noSleep };
		await runTable(sql, 'widget_knowledge_chunks', { ...opts, limit: 5 });
		const r = await runTable(sql, 'widget_knowledge_chunks', { ...opts, limit: Infinity });
		expect(r.completed).toBe(true);
		const left = (await pg.query(`SELECT id FROM widget_knowledge_chunks WHERE embedder <> $1 ORDER BY id`, [NEW])).rows;
		expect(left).toEqual([]);
		await pg.close();
	}, 30000);
});

describe('deployGate', () => {
	// Moving rows into a space the deployed readers do not know drops them out of
	// live search (measured 2026-11-16: production skipped every moved memory).
	const ancestry = (deployed) => async (a, b) => a === READER_COMMIT && b === deployed;
	it('allows a writing run once the deployed commit contains the reader change', async () => {
		expect(await deployGate({ commit: 'new' }, ancestry('new'))).toEqual({ ok: true, commit: 'new' });
	});
	it('refuses while production runs code that cannot read the target space', async () => {
		const r = await deployGate({ commit: 'old' }, async () => false);
		expect(r.ok).toBe(false);
		expect(r.reason).toMatch(/deploy three-ws-api first/);
	});
	it('refuses when the deployed commit is unknown', async () => {
		expect((await deployGate({ commit: 'unknown' }, ancestry('x'))).ok).toBe(false);
		expect((await deployGate(null, ancestry('x'))).ok).toBe(false);
	});
});
