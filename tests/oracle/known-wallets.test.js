// Oracle known-wallet prior: loaded from wallet_reputation (the table
// api/cron/gmgn-seed.js keeps fresh), cached in-process, folded into pedigree.
// Driven over an in-process Postgres (PGlite) seeded with the real table shape.

import { beforeAll, beforeEach, describe, it, expect, vi } from 'vitest';
import { createPgliteSql } from '../_helpers/pglite-sql.js';

const holder = vi.hoisted(() => ({ db: null }));

vi.mock('../../api/_lib/db.js', async (importActual) => {
	const actual = await importActual();
	return { ...actual, sql: (...args) => holder.db.sql(...args) };
});

process.env.DATABASE_URL ||= 'postgres://pglite.test/db';

const {
	knownWallet, knownIsProven, loadKnownWallets, resetKnownWallets, KNOWN_META,
} = await import('../../api/_lib/oracle/known-wallets.js');
const { enrichWithKnownWallets } = await import('../../api/_lib/oracle/sources.js');

// Synthetic, base58-shaped strings; not anyone's wallet.
const W = (n) => `THREEsyntheticWa11et${String(n).padStart(24, '1')}`;
const SM = W(1);
const KOL = W(2);
const SNIPER = W(3);
const JUDGED = W(4);
const NEUTRAL = W(5);
const DEVNET = W(6);

const DDL = `
	create table wallet_reputation (
		wallet text not null,
		network text not null default 'mainnet' check (network in ('mainnet','devnet')),
		coins_traded int not null default 0,
		smart_money_score numeric not null default 0,
		label text not null default 'unproven',
		primary key (wallet, network)
	);
`;

async function seed() {
	await holder.db.exec('delete from wallet_reputation');
	await holder.db.query(
		`insert into wallet_reputation (wallet, network, coins_traded, smart_money_score, label) values
		 ($1,'mainnet',0,82,'smart_money'),
		 ($2,'mainnet',0,74,'kol'),
		 ($3,'mainnet',1,65,'sniper'),
		 ($4,'mainnet',9,90,'smart_money'),
		 ($5,'mainnet',0,60,'neutral'),
		 ($6,'devnet',0,82,'smart_money')`,
		[SM, KOL, SNIPER, JUDGED, NEUTRAL, DEVNET],
	);
}

beforeAll(async () => {
	holder.db = createPgliteSql();
	await holder.db.exec(DDL);
});

beforeEach(async () => {
	resetKnownWallets();
	await seed();
});

describe('loadKnownWallets', () => {
	it('loads seeded prior rows and reports live counts', async () => {
		await loadKnownWallets();
		expect(KNOWN_META.total).toBe(3);
		expect(KNOWN_META.counts).toEqual({ smart_money: 1, kol: 1, sniper: 1 });
		expect(KNOWN_META.source).toMatch(/gmgn/i);
	});

	it('leaves brain-judged, neutral and devnet rows out of the prior', async () => {
		await loadKnownWallets();
		expect(knownWallet(JUDGED)).toBeNull();
		expect(knownWallet(NEUTRAL)).toBeNull();
		expect(knownWallet(DEVNET)).toBeNull();
	});

	it('serves an empty prior, without throwing, when the table is empty', async () => {
		await holder.db.exec('delete from wallet_reputation');
		const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
		await loadKnownWallets();
		expect(KNOWN_META.total).toBe(0);
		expect(knownWallet(SM)).toBeNull();
		expect(warn).toHaveBeenCalledWith(expect.stringContaining('empty prior'));
		warn.mockRestore();
	});

	it('caches within the TTL and re-reads on force', async () => {
		await loadKnownWallets();
		const reads = () => holder.db.calls.filter((c) => c.includes('from wallet_reputation')).length;
		const before = reads();
		await loadKnownWallets();
		expect(reads()).toBe(before);
		await holder.db.exec('delete from wallet_reputation');
		await loadKnownWallets();
		expect(knownWallet(SM)).not.toBeNull();
		await loadKnownWallets({ force: true });
		expect(knownWallet(SM)).toBeNull();
	});

	it('coalesces concurrent loads into one read', async () => {
		const reads = () => holder.db.calls.filter((c) => c.includes('from wallet_reputation')).length;
		const before = reads();
		await Promise.all([loadKnownWallets(), loadKnownWallets(), loadKnownWallets()]);
		expect(reads()).toBe(before + 1);
	});

	it('keeps the last good rows when a refresh fails', async () => {
		await loadKnownWallets();
		const real = holder.db.sql;
		holder.db.sql = () => { throw new Error('connection reset'); };
		const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
		await loadKnownWallets({ force: true });
		holder.db.sql = real;
		expect(knownWallet(SM)).not.toBeNull();
		expect(KNOWN_META.total).toBe(3);
		warn.mockRestore();
	});
});

describe('knownWallet', () => {
	beforeEach(() => loadKnownWallets());

	it('resolves a seeded smart-money wallet', () => {
		const k = knownWallet(SM);
		expect(k).toBeTruthy();
		expect(k.label).toBe('smart_money');
		expect(k.score).toBe(82);
		expect(k.source).toBe('gmgn');
	});

	it('resolves a seeded KOL wallet', () => {
		expect(knownWallet(KOL).label).toBe('kol');
	});

	it('returns null for an unknown wallet', () => {
		expect(knownWallet('1'.repeat(44))).toBeNull();
	});

	it('treats smart_money and kol as proven, not sniper', () => {
		expect(knownIsProven('smart_money')).toBe(true);
		expect(knownIsProven('kol')).toBe(true);
		expect(knownIsProven('sniper')).toBe(false);
	});
});

describe('enrichWithKnownWallets', () => {
	beforeEach(() => loadKnownWallets());

	it('injects a known wallet into pedigree and bumps the proven count', () => {
		const intel = { smartMoney: { smartWalletCount: 0, notable: [] } };
		enrichWithKnownWallets(intel, [{ wallet: SM, buy_lamports: '2000000000' }]);
		expect(intel.smartMoney.notable).toHaveLength(1);
		expect(intel.smartMoney.notable[0].label).toBe('smart_money');
		expect(intel.smartMoney.notable[0].source).toBe('gmgn');
		expect(intel.smartMoney.smartWalletCount).toBe(1);
	});

	it('upgrades an unproven brain entry with the known label', () => {
		const intel = { smartMoney: { smartWalletCount: 0, notable: [{ wallet: SM, label: 'unproven', score: 0 }] } };
		enrichWithKnownWallets(intel, [{ wallet: SM, buy_lamports: '1000000000' }]);
		expect(intel.smartMoney.notable[0].label).toBe('smart_money');
	});

	it('does not downgrade a real brain reputation', () => {
		const intel = { smartMoney: { smartWalletCount: 1, notable: [{ wallet: SM, label: 'smart_money', score: 95 }] } };
		enrichWithKnownWallets(intel, [{ wallet: SM, buy_lamports: '1000000000' }]);
		expect(intel.smartMoney.notable[0].score).toBe(95);
	});

	it('ignores unknown wallets', () => {
		const intel = { smartMoney: { smartWalletCount: 0, notable: [] } };
		enrichWithKnownWallets(intel, [{ wallet: '2'.repeat(44), buy_lamports: '5000000000' }]);
		expect(intel.smartMoney.notable).toHaveLength(0);
	});
});
