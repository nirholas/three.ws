/**
 * A blank poster must not become a creation's description. Seen on 2026-11-16
 * in production: 87 described creations carried the Florence-2 caption
 * "unanswerable" and a detailed caption such as "The image is completely
 * black. ... The picture was taken at night time.", with tags "night time" and
 * "time". The model page used that text as its meta description and alt text,
 * which is worse than falling back to the prompt. Their stored posters were
 * blank (an all-black or all-white image), while the GLB itself renders fine.
 *
 * Expected: a blank result is never stored as 'done'. When it came from the
 * stored preview, the row is re-queued to be described from the GLB render;
 * when the render is blank too, the row is skipped. Rows already stored blank
 * are re-queued by requeueBlankDescriptions.
 *
 * Runs the real migration on an in-process Postgres (PGlite).
 */
import { readFileSync } from 'node:fs';
import { beforeAll, beforeEach, describe, it, expect, vi } from 'vitest';
import { PGlite } from '@electric-sql/pglite';
import { pg_trgm } from '@electric-sql/pglite/contrib/pg_trgm';
import { createPgliteSql } from './_helpers/pglite-sql.js';

const holder = vi.hoisted(() => ({ db: null }));

vi.mock('../api/_lib/db.js', async (importActual) => {
	const actual = await importActual();
	return { ...actual, sql: (...args) => holder.db.sql(...args) };
});
vi.mock('../api/_lib/r2.js', () => ({ normalizeStoredUrl: (u) => (typeof u === 'string' && u ? u : null) }));

process.env.DATABASE_URL ||= 'postgres://pglite.test/db';

const migration = readFileSync(
	new URL('../api/_lib/migrations/20261111161856_forge_creation_descriptions.sql', import.meta.url),
	'utf8',
);

const A = '11111111-1111-4111-8111-111111111111';
const B = '22222222-2222-4222-8222-222222222222';
const C = '33333333-3333-4333-8333-333333333333';
const PREVIEW = 'https://three.ws/cdn/forge/abc/poster.webp';
const GLB = 'https://three.ws/cdn/forge/abc/model.glb';

// Real Florence-2 outputs from the production table on 2026-11-16.
const BLACK = {
	caption: 'unanswerable',
	detailed:
		'The image is completely black. The image has no color in it. There are no shadows on the image. The picture was taken at night time.',
	tags: ['night time', 'time'],
	objects: [],
};
const WHITE = {
	caption: 'A blank white square with no image in it',
	detailed: 'The image is blank. It is a simple, plain white image. The image has no color in it.',
	tags: ['envelope', 'word'],
	objects: [],
};
const BLANK_PAGE = {
	caption: 'A blank page with no image on it.',
	detailed: 'The image is blank. There is no image in the image. The image has no color in it.',
	tags: ['page'],
	objects: [],
};
const DARK_WITH_CONTENT = {
	caption: 'A white model of a building against a black background.',
	detailed: 'The image is completely black. There is a small model of the White House on the left side of the image.',
	tags: ['building', 'white house'],
	objects: [],
};
const LANTERN = {
	caption: 'A brass lantern on a wooden table.',
	detailed: 'A brass lantern with a glass chimney sits on a wooden table.',
	tags: ['lantern', 'table'],
	objects: [],
};

let lib;

beforeAll(async () => {
	lib = await import('../api/_lib/creation-descriptions.js');
});

beforeEach(async () => {
	holder.db = createPgliteSql({ pg: new PGlite({ extensions: { pg_trgm } }) });
	await holder.db.exec(`
		create extension if not exists pg_trgm;
		create table forge_creations (
			id uuid primary key, status text not null default 'done', preview_image_url text,
			glb_url text, web_glb_url text, size_bytes bigint, web_size_bytes bigint,
			created_at timestamptz not null default now()
		);
		insert into forge_creations (id, preview_image_url, glb_url, size_bytes) values
			('${A}', '${PREVIEW}', '${GLB}', 1000),
			('${B}', '${PREVIEW}', null, null),
			('${C}', '${PREVIEW}', '${GLB}', 1000);
	`);
	await holder.db.exec(migration);
});

async function row(id) {
	const r = await holder.db.sql`select * from forge_creation_descriptions where creation_id = ${id}`;
	return r[0];
}

describe('isBlankDescribeResult', () => {
	it('flags the blank-poster outputs seen in production', () => {
		expect(lib.isBlankDescribeResult(BLACK)).toBe(true);
		expect(lib.isBlankDescribeResult(WHITE)).toBe(true);
		expect(lib.isBlankDescribeResult(BLANK_PAGE)).toBe(true);
	});

	it('keeps a real description, including a dark render with a subject', () => {
		expect(lib.isBlankDescribeResult(LANTERN)).toBe(false);
		expect(lib.isBlankDescribeResult(DARK_WITH_CONTENT)).toBe(false);
		expect(lib.isBlankDescribeResult(null)).toBe(false);
	});
});

describe('storeDescription with a blank poster', () => {
	it('re-queues a blank stored preview for the GLB render instead of storing it', async () => {
		await expect(lib.storeDescription({ creationId: A, result: BLACK, sourceImageUrl: PREVIEW })).resolves.toBe(false);
		const r = await row(A);
		expect(r).toMatchObject({ status: 'queued', error: lib.BLANK_POSTER_ERROR, caption: null, detailed: null });
		expect(r.tags).toEqual([]);
	});

	it('next claim describes that row from the GLB render, not the blank preview', async () => {
		await lib.storeDescription({ creationId: A, result: BLACK, sourceImageUrl: PREVIEW });
		const { items, skipped } = await lib.claimDescribeBatch({ limit: 1, backfill: false });
		expect(skipped).toEqual([]);
		expect(items).toHaveLength(1);
		expect(items[0].id).toBe(A);
		expect(items[0].imageUrl).toMatch(/^https:\/\/three\.ws\/api\/render\/glb\?/);
		expect(items[0].imageUrl).toContain(encodeURIComponent(GLB));
	});

	it('skips a blank preview when there is no GLB to render', async () => {
		await lib.storeDescription({ creationId: B, result: WHITE, sourceImageUrl: PREVIEW });
		const { items, skipped } = await lib.claimDescribeBatch({ limit: 1, backfill: false });
		expect(items).toEqual([]);
		expect(skipped).toEqual([B]);
		expect((await row(B)).status).toBe('skipped');
	});

	it('skips the row when the GLB render is blank too', async () => {
		const render = `https://three.ws/api/render/glb?glbUrl=${encodeURIComponent(GLB)}&width=1200&height=630`;
		await expect(lib.storeDescription({ creationId: A, result: BLACK, sourceImageUrl: render })).resolves.toBe(false);
		expect(await row(A)).toMatchObject({ status: 'skipped', caption: null });
	});

	it('still stores a real description', async () => {
		await expect(lib.storeDescription({ creationId: A, result: DARK_WITH_CONTENT, sourceImageUrl: PREVIEW })).resolves.toBe(true);
		expect(await row(A)).toMatchObject({ status: 'done', caption: DARK_WITH_CONTENT.caption });
	});
});

describe('requeueBlankDescriptions', () => {
	beforeEach(async () => {
		// Stored before the rule existed: insert directly as 'done'.
		await holder.db.sql`
			insert into forge_creation_descriptions (creation_id, status, caption, detailed, tags, generated_tags, attempts, described_at)
			values
				(${A}, 'done', ${BLACK.caption}, ${BLACK.detailed}, ${BLACK.tags}, ${BLACK.tags}, 1, now()),
				(${B}, 'done', ${LANTERN.caption}, ${LANTERN.detailed}, ${LANTERN.tags}, ${LANTERN.tags}, 1, now())
		`;
		await holder.db.sql`
			insert into forge_creation_descriptions (creation_id, status, caption, detailed, tags, generated_tags, attempts, described_at, tags_edited_at)
			values (${C}, 'done', ${WHITE.caption}, ${WHITE.detailed}, ${['my tag']}, ${WHITE.tags}, 1, now(), now())
		`;
	});

	it('counts without writing on a dry run', async () => {
		await expect(lib.requeueBlankDescriptions({ dryRun: true })).resolves.toEqual({ scanned: 3, requeued: 2 });
		expect((await row(A)).status).toBe('done');
	});

	it('re-queues blank rows with a fresh attempt budget and leaves real ones alone', async () => {
		await expect(lib.requeueBlankDescriptions()).resolves.toEqual({ scanned: 3, requeued: 2 });
		expect(await row(A)).toMatchObject({ status: 'queued', error: lib.BLANK_POSTER_ERROR, attempts: 0, caption: null });
		expect((await row(A)).tags).toEqual([]);
		expect(await row(B)).toMatchObject({ status: 'done', caption: LANTERN.caption });
		// The owner's own tags survive; only the generated text is cleared.
		const c = await row(C);
		expect(c).toMatchObject({ status: 'queued', caption: null });
		expect(c.tags).toEqual(['my tag']);
	});
});
