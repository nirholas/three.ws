// Re-seal of every secret-box column under a new WALLET_ENCRYPTION_KEY, against a
// real in-process Postgres (PGlite) with synthetic keys. The script's contract:
// dry run by default, a row that cannot be opened is reported and never touched,
// the derived address must equal the stored one before a batch is written, a run
// that dies halfway resumes, and nothing it prints contains secret material.

import { describe, it, expect, beforeAll, beforeEach, afterEach } from 'vitest';
import { PGlite } from '@electric-sql/pglite';
import { Keypair } from '@solana/web3.js';
import { Wallet } from 'ethers';

const OLD_KEY = 'old-wallet-encryption-key-0123456789-abcdefghij';
const OLDER_KEY = 'older-retired-encryption-key-9876543210-klmnopqr';
const NEW_KEY = 'brand-new-dedicated-key-for-reseal-4455667788-zz';
const JWT = 'jwt-session-secret-value-1234567890-abcdefghijkl';
const FOREIGN_KEY = 'foreign-key-nobody-here-holds-0000000000-qwertyui';

let box;
let mod;
let pg;

const b64 = (kp) => Buffer.from(kp.secretKey).toString('base64');

beforeAll(async () => {
	process.env.NODE_ENV = 'test';
	delete process.env.VERCEL_ENV;
	process.env.JWT_SECRET = JWT;
	box = await import('../api/_lib/secret-box.js');
	mod = await import('../scripts/reseal-custodial-wallets.mjs');
});

function pgDb(handle, { failBatchAt = null } = {}) {
	let batches = 0;
	return {
		async query(text, params = []) {
			const r = await handle.query(text, params);
			return r.rows;
		},
		async batch(statements) {
			batches++;
			if (failBatchAt && batches === failBatchAt) throw new Error('simulated connection loss');
			await handle.transaction(async (tx) => {
				for (const [text, params] of statements) await tx.query(text, params);
			});
		},
	};
}

async function seal(plain, key) {
	return box.sealWithKey(plain, key);
}

async function schema(handle) {
	await handle.exec(`
		CREATE TABLE agent_identities (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), wallet_address text, meta jsonb NOT NULL DEFAULT '{}');
		CREATE TABLE x402_ring_pool (pubkey text PRIMARY KEY, encrypted_secret text NOT NULL);
		CREATE TABLE agent_cards (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), secret_enc text);
	`);
}

const ringRows = async () => (await pg.query('SELECT pubkey, encrypted_secret FROM x402_ring_pool ORDER BY pubkey')).rows;

let ring;

beforeEach(async () => {
	pg = new PGlite();
	await schema(pg);
	ring = [];
	for (let i = 0; i < 5; i++) {
		const kp = Keypair.generate();
		ring.push(kp);
		await pg.query('INSERT INTO x402_ring_pool (pubkey, encrypted_secret) VALUES ($1, $2)', [
			kp.publicKey.toBase58(),
			await seal(b64(kp), i === 4 ? OLDER_KEY : OLD_KEY),
		]);
	}
	process.env.WALLET_ENCRYPTION_KEY = OLD_KEY;
	process.env.WALLET_ENCRYPTION_KEY_PREVIOUS = OLDER_KEY;
});

afterEach(async () => {
	await pg.close();
	delete process.env.WALLET_ENCRYPTION_KEY;
	delete process.env.WALLET_ENCRYPTION_KEY_PREVIOUS;
});

const oldKeys = () => box.secretBoxKeyCandidates();
const ringTarget = () => mod.TARGETS.filter((t) => t.id === 'x402_ring_pool.encrypted_secret');

describe('reseal-custodial-wallets', () => {
	it('dry run reports counts per table and writes nothing', async () => {
		const before = await ringRows();
		const report = await mod.resealAll({ db: pgDb(pg), oldKeys: oldKeys(), newKey: NEW_KEY, apply: false, targets: mod.TARGETS });
		const ringReport = report.targets.find((t) => t.id === 'x402_ring_pool.encrypted_secret');
		expect(ringReport).toMatchObject({ rows: 5, resealable: 5, current: 0, undecryptable: 0, mismatch: 0, written: 0 });
		expect(report.targets.find((t) => t.id === 'master_wallets.encrypted_solana_secret').status).toBe('table_absent');
		expect(await ringRows()).toEqual(before);
		const tables = (await pg.query("SELECT to_regclass('custodial_reseal_backup') AS t")).rows[0].t;
		expect(tables).toBeNull();
	});

	it('apply re-encrypts every row under the new key alone and keeps each address', async () => {
		const report = await mod.resealAll({ db: pgDb(pg), oldKeys: oldKeys(), newKey: NEW_KEY, apply: true, batchSize: 2, targets: ringTarget() });
		expect(report.targets[0]).toMatchObject({ rows: 5, written: 5, undecryptable: 0 });
		for (const row of await ringRows()) {
			const opened = await box.openWithKeys(row.encrypted_secret, [NEW_KEY]);
			expect(opened).not.toBeNull();
			const kp = Keypair.fromSecretKey(Buffer.from(opened.plaintext, 'base64'));
			expect(kp.publicKey.toBase58()).toBe(row.pubkey);
		}
		const backups = (await pg.query('SELECT count(*)::int AS n FROM custodial_reseal_backup')).rows[0].n;
		expect(backups).toBe(5);
	});

	it('leaves a row it cannot open untouched and reports it without failing', async () => {
		const foreign = Keypair.generate();
		const sealedForeign = await seal(b64(foreign), FOREIGN_KEY);
		await pg.query('INSERT INTO x402_ring_pool (pubkey, encrypted_secret) VALUES ($1, $2)', [foreign.publicKey.toBase58(), sealedForeign]);
		const report = await mod.resealAll({ db: pgDb(pg), oldKeys: oldKeys(), newKey: NEW_KEY, apply: true, targets: ringTarget() });
		expect(report.targets[0]).toMatchObject({ rows: 6, written: 5, undecryptable: 1 });
		expect(report.targets[0].undecryptable_ids).toEqual([foreign.publicKey.toBase58()]);
		const row = (await ringRows()).find((r) => r.pubkey === foreign.publicKey.toBase58());
		expect(row.encrypted_secret).toBe(sealedForeign);
		expect(report.ok).toBe(true);
	});

	it('resumes after an interrupted run without redoing finished rows', async () => {
		const db = pgDb(pg, { failBatchAt: 2 });
		await expect(
			mod.resealAll({ db, oldKeys: oldKeys(), newKey: NEW_KEY, apply: true, batchSize: 2, targets: ringTarget() }),
		).rejects.toThrow(/simulated connection loss/);
		const done = [];
		for (const row of await ringRows()) if (await box.openWithKeys(row.encrypted_secret, [NEW_KEY])) done.push(row.pubkey);
		expect(done).toHaveLength(2);
		const report = await mod.resealAll({ db: pgDb(pg), oldKeys: oldKeys(), newKey: NEW_KEY, apply: true, batchSize: 2, targets: ringTarget() });
		expect(report.targets[0]).toMatchObject({ rows: 5, current: 2, written: 3 });
		for (const row of await ringRows()) expect(await box.openWithKeys(row.encrypted_secret, [NEW_KEY])).not.toBeNull();
	});

	it('aborts the batch when a secret derives a different address than the one stored', async () => {
		const stranger = Keypair.generate();
		const liar = Keypair.generate();
		const sealedLiar = await seal(b64(stranger), OLD_KEY);
		await pg.query('INSERT INTO x402_ring_pool (pubkey, encrypted_secret) VALUES ($1, $2)', [liar.publicKey.toBase58(), sealedLiar]);
		const before = await ringRows();
		const report = await mod.resealAll({ db: pgDb(pg), oldKeys: oldKeys(), newKey: NEW_KEY, apply: true, batchSize: 100, targets: ringTarget() });
		expect(report.targets[0].mismatch).toBe(1);
		expect(report.targets[0].mismatch_ids).toEqual([liar.publicKey.toBase58()]);
		expect(report.targets[0].written).toBe(0);
		expect(report.targets[0].aborted).toBe(true);
		expect(report.ok).toBe(false);
		expect(await ringRows()).toEqual(before);
	});

	it('with hold-mismatched it skips the lying row, reseals the rest and a dry run never fails on it', async () => {
		const stranger = Keypair.generate();
		const liar = Keypair.generate();
		const sealedLiar = await seal(b64(stranger), OLD_KEY);
		await pg.query('INSERT INTO x402_ring_pool (pubkey, encrypted_secret) VALUES ($1, $2)', [liar.publicKey.toBase58(), sealedLiar]);
		const dry = await mod.resealAll({ db: pgDb(pg), oldKeys: oldKeys(), newKey: NEW_KEY, apply: false, targets: ringTarget() });
		expect(dry.targets[0]).toMatchObject({ mismatch: 1, resealable: 5, aborted: false });
		expect(dry.ok).toBe(true);
		const report = await mod.resealAll({ db: pgDb(pg), oldKeys: oldKeys(), newKey: NEW_KEY, apply: true, holdMismatched: true, targets: ringTarget() });
		expect(report.targets[0]).toMatchObject({ mismatch: 1, written: 5 });
		expect(report.ok).toBe(true);
		const row = (await ringRows()).find((r) => r.pubkey === liar.publicKey.toBase58());
		expect(row.encrypted_secret).toBe(sealedLiar);
	});

	it('reseals a secret nested in agent_identities.meta and an opaque column', async () => {
		const sol = Keypair.generate();
		const evm = Wallet.createRandom();
		const [agent] = (
			await pg.query(
				'INSERT INTO agent_identities (wallet_address, meta) VALUES ($1, $2::jsonb) RETURNING id',
				[
					evm.address,
					JSON.stringify({
						solana_address: sol.publicKey.toBase58(),
						encrypted_solana_secret: await seal(b64(sol), OLD_KEY),
						encrypted_wallet_key: await seal(evm.privateKey, OLD_KEY),
						persona: 'keep me',
					}),
				],
			)
		).rows;
		const [card] = (await pg.query('INSERT INTO agent_cards (secret_enc) VALUES ($1) RETURNING id', [await seal('{"pan":"0000"}', OLD_KEY)])).rows;
		const report = await mod.resealAll({ db: pgDb(pg), oldKeys: oldKeys(), newKey: NEW_KEY, apply: true, targets: mod.TARGETS });
		expect(report.ok).toBe(true);
		const row = (await pg.query('SELECT meta FROM agent_identities WHERE id = $1', [agent.id])).rows[0];
		expect(row.meta.persona).toBe('keep me');
		expect((await box.openWithKeys(row.meta.encrypted_solana_secret, [NEW_KEY])).plaintext).toBe(b64(sol));
		expect((await box.openWithKeys(row.meta.encrypted_wallet_key, [NEW_KEY])).plaintext).toBe(evm.privateKey);
		const cardRow = (await pg.query('SELECT secret_enc FROM agent_cards WHERE id = $1', [card.id])).rows[0];
		expect((await box.openWithKeys(cardRow.secret_enc, [NEW_KEY])).plaintext).toBe('{"pan":"0000"}');
	});

	it('never prints secret bytes or plaintext in the report or its rendering', async () => {
		const report = await mod.resealAll({ db: pgDb(pg), oldKeys: oldKeys(), newKey: NEW_KEY, apply: true, targets: mod.TARGETS });
		const text = JSON.stringify(report) + mod.renderReport(report);
		for (const kp of ring) {
			expect(text).not.toContain(b64(kp));
			expect(text).not.toContain(Buffer.from(kp.secretKey).toString('hex'));
		}
		for (const row of await ringRows()) expect(text).not.toContain(row.encrypted_secret);
		for (const key of [OLD_KEY, OLDER_KEY, NEW_KEY, JWT]) expect(text).not.toContain(key);
	});

	it('rollback restores the previous ciphertext only where the row still holds the resealed one', async () => {
		const before = await ringRows();
		await mod.resealAll({ db: pgDb(pg), oldKeys: oldKeys(), newKey: NEW_KEY, apply: true, targets: ringTarget() });
		const target = ring[0].publicKey.toBase58();
		await pg.query('UPDATE x402_ring_pool SET encrypted_secret = $1 WHERE pubkey = $2', ['v2:changed-by-someone-else', target]);
		const result = await mod.rollbackReseal({ db: pgDb(pg), targets: ringTarget() });
		expect(result.restored).toBe(4);
		expect(result.skipped).toBe(1);
		const after = await ringRows();
		for (const row of after) {
			if (row.pubkey === target) expect(row.encrypted_secret).toBe('v2:changed-by-someone-else');
			else expect(row.encrypted_secret).toBe(before.find((b) => b.pubkey === row.pubkey).encrypted_secret);
		}
	});

	it('refuses a new key that is short, equals JWT_SECRET, or is already the current key', () => {
		expect(() => mod.assertNewKey('short', oldKeys())).toThrow(/at least 32/);
		expect(() => mod.assertNewKey(JWT, oldKeys())).toThrow(/JWT_SECRET/);
		expect(() => mod.assertNewKey(OLD_KEY, oldKeys())).toThrow(/already/);
		expect(() => mod.assertNewKey(NEW_KEY, oldKeys())).not.toThrow();
	});
});
