// api/cron/gmgn-seed.js -> wallet_reputation -> the oracle's known-wallet prior.
// KOLs must land labelled 'kol' (Oracle counts them proven), not 'neutral', or
// they silently drop out of the cold-start prior.

import { Readable } from 'node:stream';
import { afterEach, beforeAll, describe, it, expect, vi } from 'vitest';
import { createPgliteSql } from '../_helpers/pglite-sql.js';

const holder = vi.hoisted(() => ({ db: null }));

vi.mock('../../api/_lib/db.js', async (importActual) => {
	const actual = await importActual();
	return { ...actual, sql: (...args) => holder.db.sql(...args) };
});

process.env.DATABASE_URL ||= 'postgres://pglite.test/db';
process.env.CRON_SECRET = 'test-cron-secret';

const seed = (await import('../../api/cron/gmgn-seed.js')).default;
const { loadKnownWallets, resetKnownWallets, knownWallet } = await import('../../api/_lib/oracle/known-wallets.js');

const W = (n) => `THREEsyntheticWa11et${String(n).padStart(24, '1')}`;

beforeAll(async () => {
	holder.db = createPgliteSql();
	await holder.db.exec(`
		create table wallet_reputation (
			wallet text not null, network text not null default 'mainnet',
			coins_traded int not null default 0, smart_money_score numeric not null default 0,
			label text not null default 'unproven',
			first_seen_at timestamptz default now(), updated_at timestamptz default now(),
			primary key (wallet, network)
		);
	`);
});

afterEach(() => vi.unstubAllGlobals());

function run() {
	const req = Object.assign(new Readable({ read() {} }), {
		method: 'POST', url: '/api/cron/gmgn-seed',
		headers: { authorization: 'Bearer test-cron-secret', host: 'three.ws' },
	});
	const out = {};
	const res = {
		statusCode: 200, headersSent: false, setHeader() {}, getHeader() {},
		writeHead(s) { res.statusCode = s; }, end(b) { out.body = b; out.status = res.statusCode; },
	};
	return seed(req, res).then(() => out);
}

describe('gmgn-seed feeds the oracle prior', () => {
	it('files KOLs as kol and serves them with smart money, leaving top_dev out', async () => {
		const kolQuest = {
			smartMoney: { wallets: { smart_degen: [{ wallet_address: W(1) }], top_dev: [{ wallet_address: W(3) }] } },
			kol: { wallets: [{ wallet_address: W(2) }] },
		};
		vi.stubGlobal('fetch', async (url) => String(url).includes('raw.githubusercontent.com')
			? new Response(JSON.stringify(kolQuest), { status: 200 })
			: new Response('forbidden', { status: 403 }));

		const out = await run();
		expect(out.status).toBe(200);
		expect(JSON.parse(out.body)).toMatchObject({ ok: true, upserted: 3, fallback_used: true });

		resetKnownWallets();
		await loadKnownWallets();
		expect(knownWallet(W(1))).toMatchObject({ label: 'smart_money', score: 80 });
		expect(knownWallet(W(2))).toMatchObject({ label: 'kol', score: 74 });
		expect(knownWallet(W(3))).toBeNull();
	}, 60_000);
});
