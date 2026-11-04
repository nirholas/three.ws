// reconcileLandedAnchors (api/_lib/custody-proof.js): an epoch stored as
// anchor_failed because the confirm wait gave up ("Transaction <sig> expired" /
// "not confirmed within") is promoted to anchored only when that exact
// transaction is finalized on the anchor cluster, without error, signed by the
// attester, and carries a custody memo for the same epoch and root. Anything
// short of that leaves the row alone: the page must never claim a timestamp the
// chain does not hold.
//
// Production, 2026-11-03/04: epochs 525-527 and 529 landed on mainnet but were
// stored as "expired: block height exceeded".
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Keypair } from '@solana/web3.js';

const ATTESTER = Keypair.generate();
const OTHER = Keypair.generate();
const ROOT = 'ab'.repeat(32);
// Real-shaped base58 signatures (the reconciler only accepts base58).
const SIG = Object.fromEntries(['sigA', 'sigD', 'sigErr', 'sigOk', 'sigP', 'sigT', 'sigX'].map((k) => [k, Keypair.generate().publicKey.toBase58() + Keypair.generate().publicKey.toBase58()]));

const db = vi.hoisted(() => ({ rows: [], statements: [] }));
vi.mock('../api/_lib/db.js', () => ({
	sql: (strings, ...values) => {
		const text = strings.join('?');
		db.statements.push({ text, values });
		if (text.includes('SELECT epoch, merkle_root, anchor_error')) return Promise.resolve(db.rows);
		return Promise.resolve([]);
	},
}));

const chain = vi.hoisted(() => ({ txs: {}, calls: [] }));
vi.mock('../api/_lib/solana/connection.js', () => ({
	solanaConnection: () => ({
		getParsedTransaction: async (sig, opts) => {
			chain.calls.push({ sig, opts });
			const t = chain.txs[sig];
			if (t instanceof Error) throw t;
			return t ?? null;
		},
	}),
}));
vi.mock('../api/_lib/solana/confirm.js', () => ({ sendAndConfirm: async () => 'unused' }));
vi.mock('../api/_lib/attest-event.js', () => ({ loadAttesterKeypair: () => ATTESTER }));
vi.mock('../api/_lib/avatar-wallet.js', () => ({ explorerTxUrl: (n, s) => `x/${n}/${s}` }));

const { reconcileLandedAnchors } = await import('../api/_lib/custody-proof.js');

function memoTx({ epoch, root = ROOT, signer = ATTESTER.publicKey, err = null, kind = 'threews.custody.v1', blockTime = 1793728311 }) {
	return {
		blockTime,
		meta: { err },
		transaction: {
			message: {
				accountKeys: [{ pubkey: signer, signer: true, writable: true }],
				instructions: [
					{
						program: 'spl-memo',
						programId: 'MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr',
						parsed: JSON.stringify({ v: 1, kind, epoch, root, wallet_count: 2, snapshot_network: 'mainnet', ts: blockTime }),
					},
				],
			},
		},
	};
}

const promoted = () => db.statements.filter((s) => s.text.includes("SET anchor_sig = ") && s.text.includes("'anchored'"));

beforeEach(() => {
	db.rows = [];
	db.statements = [];
	chain.txs = {};
	chain.calls = [];
});

describe('reconcileLandedAnchors', () => {
	it('promotes an "expired" epoch whose memo is finalized with the same epoch and root', async () => {
		db.rows = [{ epoch: '525', merkle_root: ROOT, anchor_error: `Transaction ${SIG.sigA} expired: block height exceeded` }];
		chain.txs[SIG.sigA] = memoTx({ epoch: 525 });
		const out = await reconcileLandedAnchors();
		expect(out).toMatchObject({ checked: 1, promoted: [{ epoch: '525', signature: SIG.sigA }] });
		expect(chain.calls[0].opts).toMatchObject({ commitment: 'finalized' });
		const [upd] = promoted();
		expect(upd.values).toEqual(expect.arrayContaining([SIG.sigA, 1793728311, '525']));
		expect(upd.text).toContain("anchor_status = 'anchor_failed'");
	});

	it('also reads a "not confirmed within" timeout message', async () => {
		db.rows = [{ epoch: '7', merkle_root: ROOT, anchor_error: `Transaction ${SIG.sigT} not confirmed within 45s` }];
		chain.txs[SIG.sigT] = memoTx({ epoch: 7 });
		expect((await reconcileLandedAnchors()).promoted).toHaveLength(1);
	});

	it.each([
		['the tx is not on chain', null],
		['the tx reverted', memoTx({ epoch: 9, err: { InstructionError: [0, 'Custom'] } })],
		['the memo root differs', memoTx({ epoch: 9, root: 'cd'.repeat(32) })],
		['the memo is for another epoch', memoTx({ epoch: 10 })],
		['someone else signed it', memoTx({ epoch: 9, signer: OTHER.publicKey })],
		['the memo kind differs', memoTx({ epoch: 9, kind: 'threews.other.v1' })],
	])('leaves the row alone when %s', async (_label, tx) => {
		db.rows = [{ epoch: '9', merkle_root: ROOT, anchor_error: `Transaction ${SIG.sigX} expired: block height exceeded` }];
		chain.txs[SIG.sigX] = tx;
		const out = await reconcileLandedAnchors();
		expect(out.promoted).toEqual([]);
		expect(promoted()).toEqual([]);
	});

	it('ignores a failure message that names no real signature', async () => {
		db.rows = [{ epoch: '15', merkle_root: ROOT, anchor_error: 'Transaction simulation failed: blockhash not found' }];
		const out = await reconcileLandedAnchors();
		expect(out).toEqual({ checked: 0, promoted: [], errors: [] });
		expect(chain.calls).toEqual([]);
	});

	it('skips a row on an RPC error and keeps going', async () => {
		db.rows = [
			{ epoch: '11', merkle_root: ROOT, anchor_error: `Transaction ${SIG.sigErr} expired: block height exceeded` },
			{ epoch: '12', merkle_root: ROOT, anchor_error: `Transaction ${SIG.sigOk} expired: block height exceeded` },
		];
		chain.txs[SIG.sigErr] = new Error('429');
		chain.txs[SIG.sigOk] = memoTx({ epoch: 12 });
		const out = await reconcileLandedAnchors();
		expect(out.promoted.map((p) => p.epoch)).toEqual(['12']);
		expect(out.errors).toEqual([{ epoch: '11', error: '429' }]);
	});

	it('dry run reports what it would promote without writing', async () => {
		db.rows = [{ epoch: '13', merkle_root: ROOT, anchor_error: `Transaction ${SIG.sigD} expired: block height exceeded` }];
		chain.txs[SIG.sigD] = memoTx({ epoch: 13 });
		const out = await reconcileLandedAnchors({ dryRun: true });
		expect(out.promoted).toHaveLength(1);
		expect(promoted()).toEqual([]);
	});

	it('only selects failed rows on the anchor network that recorded a signature', async () => {
		await reconcileLandedAnchors();
		const sel = db.statements.find((s) => s.text.includes('SELECT epoch, merkle_root, anchor_error'));
		expect(sel.text).toContain("anchor_status = 'anchor_failed'");
		expect(sel.text).toContain('anchor_network = ');
		expect(sel.text).toContain('anchor_error ~ ');
		const pattern = new RegExp(sel.values.find((v) => typeof v === 'string' && v.startsWith('^Transaction')));
		expect(pattern.test(`Transaction ${SIG.sigA} expired: block height exceeded`)).toBe(true);
		expect(pattern.test('Transaction simulation failed: blockhash not found')).toBe(false);
		expect(sel.text).toContain('make_interval(days => ');
		expect(sel.values).toContain(14);
	});

	it('stops before an RPC lookup once its deadline has passed', async () => {
		db.rows = [{ epoch: '16', merkle_root: ROOT, anchor_error: `Transaction ${SIG.sigA} expired: block height exceeded` }];
		chain.txs[SIG.sigA] = memoTx({ epoch: 16 });
		const out = await reconcileLandedAnchors({ deadline: Date.now() - 1 });
		expect(out).toMatchObject({ checked: 0, promoted: [], out_of_time: true });
		expect(chain.calls).toEqual([]);
	});

	it('accepts an explicit attester pubkey for operators without the secret key', async () => {
		db.rows = [{ epoch: '14', merkle_root: ROOT, anchor_error: `Transaction ${SIG.sigP} expired: block height exceeded` }];
		chain.txs[SIG.sigP] = memoTx({ epoch: 14, signer: OTHER.publicKey });
		const out = await reconcileLandedAnchors({ attester: OTHER.publicKey.toBase58() });
		expect(out.promoted).toHaveLength(1);
	});
});
