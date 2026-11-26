// Coverage of the Forge content-safety and takedown surface (order 169). The
// public-listing screen (api/_lib/content-safety*.js) is the one gate a model
// passes before three.ws puts its name behind it on a public page. These tests
// pin, on the real production schema (PGlite), that every other way a model can
// leave the owner's hands honours that gate, and that a takedown reaches every
// copy. Only the external signals (text classifier, vision), the alerter, the
// object store and the CDN are stubbed: the network boundary, nothing else.

import { beforeAll, beforeEach, describe, it, expect, vi } from 'vitest';
import { createPgliteSql } from '../_helpers/pglite-sql.js';
import { createFullSchemaDb } from '../_helpers/pglite-full-schema.js';

const holder = vi.hoisted(() => ({ db: null }));

vi.mock('../../api/_lib/db.js', async (importActual) => {
	const actual = await importActual();
	return { ...actual, sql: (...args) => holder.db.sql(...args) };
});
const alerts = [];
vi.mock('../../api/_lib/alerts.js', () => ({ sendOpsAlert: async (...a) => { alerts.push(a); } }));
vi.mock('../../api/_lib/indexnow-queue.js', () => ({ announceIndexNow: () => {} }));
vi.mock('../../api/_lib/r2.js', async (importActual) => {
	const actual = await importActual();
	return { ...actual, objectStorageConfigured: () => true };
});

process.env.DATABASE_URL ||= 'postgres://pglite.test/db';
process.env.CRON_SECRET = 'coverage-secret';
process.env.SKETCHFAB_UPLOADS_PER_RUN = '5';

let pg;
let n = 0;
const CK = 'a'.repeat(64);

async function seed(over = {}) {
	const id = crypto.randomUUID();
	n += 1;
	const row = {
		prompt: `a tidy wooden stool number ${n}`, visibility: 'public', status: 'done', safety_status: null,
		internal: false, outcome: 'accepted', vote_count: 0, user_id: null, client_key: CK, parent: null, ...over,
	};
	await holder.db.sql`
		insert into forge_creations (id, client_key, user_id, prompt, preview_image_url, glb_url, status, outcome,
			visibility, safety_status, internal, vote_count, parent_creation_id)
		values (${id}, ${row.client_key}, ${row.user_id}, ${row.prompt}, 'https://x.test/p.png', 'https://x.test/m.glb',
			${row.status}, ${row.outcome}, ${row.visibility}, ${row.safety_status}, ${row.internal},
			${row.vote_count}, ${row.parent})
	`;
	return id;
}

function callHandler(handler, { method = 'GET', url = '/', headers = {} } = {}) {
	return new Promise((resolve) => {
		const sent = {};
		const res = {
			statusCode: 200,
			headersSent: false,
			setHeader(k, v) { sent[k.toLowerCase()] = v; },
			getHeader(k) { return sent[k.toLowerCase()]; },
			removeHeader(k) { delete sent[k.toLowerCase()]; },
			writeHead(code, h) { this.statusCode = code; Object.entries(h || {}).forEach(([k, v]) => this.setHeader(k, v)); return this; },
			write() { return true; },
			end(out) {
				this.headersSent = true;
				resolve({ status: this.statusCode, headers: sent, text: out ? String(out) : '' });
			},
		};
		handler(
			{ method, url, headers: { host: 'three.ws', authorization: 'Bearer coverage-secret', ...headers }, socket: { remoteAddress: '203.0.113.9' } },
			res,
		);
	});
}

beforeAll(async () => {
	({ pg } = await createFullSchemaDb());
	holder.db = createPgliteSql({ pg });
}, 300_000);

beforeEach(async () => {
	holder.db = createPgliteSql({ pg });
	alerts.length = 0;
	await holder.db.sql`delete from sketchfab_uploads`;
	await holder.db.sql`delete from content_safety_reviews`;
	await holder.db.sql`delete from forge_removal_requests`;
	await holder.db.sql`delete from forge_creations`;
});

describe('the Sketchfab showcase honours visibility and the safety screen', () => {
	const select = async () => {
		const { default: handler } = await import('../../api/cron/sketchfab-showcase.js');
		const out = await callHandler(handler, { url: '/api/cron/sketchfab-showcase?dry_run=1' });
		expect(out.status).toBe(200);
		return JSON.parse(out.text).candidates.map((c) => c.id);
	};

	// The cron pushes a model to the official Sketchfab account, a third-party
	// copy under our brand. Its selection said "same bar as the forge gallery" but
	// never asked for visibility or the screen, so an accepted model that was
	// private, unlisted, held or blocked was eligible.
	it('never selects a private, unlisted, held or blocked model', async () => {
		const ok = await seed({ visibility: 'public', safety_status: 'clear' });
		const priv = await seed({ visibility: 'private', safety_status: 'clear' });
		const unlisted = await seed({ visibility: 'unlisted', safety_status: 'clear' });
		const held = await seed({ visibility: 'public', safety_status: 'held' });
		const blocked = await seed({ visibility: 'public', safety_status: 'blocked' });
		const ids = await select();
		expect(ids).toContain(ok);
		for (const id of [priv, unlisted, held, blocked]) expect(ids).not.toContain(id);
	});

	it('waits for a model whose public request is still pending the screen', async () => {
		const pending = await seed({ visibility: 'public', safety_status: 'pending' });
		const platformSeed = await seed({ visibility: null, safety_status: null, internal: true });
		const ids = await select();
		expect(ids).not.toContain(pending);
		expect(ids).toContain(platformSeed);
	});
});
