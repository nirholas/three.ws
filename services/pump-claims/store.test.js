import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

import { makeStore } from './store.js';

function makeFakeSql() {
	const rows = new Map();
	const calls = [];
	async function sql(strings, ...values) {
		calls.push({ text: strings.join('?'), values });
		const text = strings.join(' ');
		if (text.includes('insert into pump_fee_claims')) {
			const [signature, mint, claimer, githubUserId, lamports, label, held, slot, ts] = values;
			if (rows.has(signature)) return [];
			rows.set(signature, { signature, mint, claimer, githubUserId, lamports, label, held, slot, ts });
			return [{ signature }];
		}
		if (text.includes('select count(*)')) {
			const [sinceTs] = values;
			const n = [...rows.values()].filter((r) => r.ts >= sinceTs).length;
			return [{ n }];
		}
		return [];
	}
	sql.rows = rows;
	sql.calls = calls;
	return sql;
}

describe('store.toRow', () => {
	test('maps an attributed claim to the DB row shape', () => {
		const store = makeStore(makeFakeSql());
		const row = store.toRow(
			{
				signature: 'sig1',
				mint: 'MintAAA',
				creator: 'ClaimerWallet',
				githubUserId: 42,
				lamports: 123456,
				attribution: { label: 'confirmed_match' },
				held: false,
				ts: 1_700_000_000,
			},
			{ slot: 999 },
		);
		assert.deepEqual(row, {
			signature: 'sig1',
			mint: 'MintAAA',
			claimer: 'ClaimerWallet',
			githubUserId: '42',
			lamports: '123456',
			label: 'confirmed_match',
			held: false,
			slot: 999,
			ts: 1_700_000_000,
		});
	});

	test('falls back to a null mint and the current time when the claim lacks them', () => {
		const store = makeStore(makeFakeSql());
		const before = Math.floor(Date.now() / 1000);
		const row = store.toRow({ signature: 'sig2', mint: '', creator: 'Wallet', lamports: 0, held: true });
		assert.equal(row.mint, null);
		assert.equal(row.githubUserId, null);
		assert.equal(row.label, null);
		assert.ok(row.ts >= before);
	});
});

describe('store.insertClaim', () => {
	test('stores a new signature and returns true', async () => {
		const fakeSql = makeFakeSql();
		const store = makeStore(fakeSql);
		const row = store.toRow({ signature: 'sigA', mint: 'MintX', creator: 'Wallet', lamports: 10, ts: 1_700_000_000 });
		const inserted = await store.insertClaim(row);
		assert.equal(inserted, true);
		assert.equal(fakeSql.rows.size, 1);
	});

	test('a repeat insert of the same signature is a no-op (idempotent)', async () => {
		const fakeSql = makeFakeSql();
		const store = makeStore(fakeSql);
		const row = store.toRow({ signature: 'sigB', mint: 'MintX', creator: 'Wallet', lamports: 10, ts: 1_700_000_000 });
		assert.equal(await store.insertClaim(row), true);
		assert.equal(await store.insertClaim(row), false);
		assert.equal(fakeSql.rows.size, 1);
	});
});

describe('store.countSince', () => {
	test('counts only rows at or after the cutoff', async () => {
		const fakeSql = makeFakeSql();
		const store = makeStore(fakeSql);
		await store.insertClaim(store.toRow({ signature: 'old', creator: 'W', lamports: 1, ts: 1_000 }));
		await store.insertClaim(store.toRow({ signature: 'new', creator: 'W', lamports: 1, ts: 2_000 }));
		assert.equal(await store.countSince(1_500), 1);
		assert.equal(await store.countSince(500), 2);
	});
});
