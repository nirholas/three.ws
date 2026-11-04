// Every server-signed attestation memo must be accepted by SPL Memo v2 AND
// still be discoverable under getSignaturesForAddress(subject).
//
// SPL Memo v2 (MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr) treats every
// account handed to it as a required signer: an account that did not sign
// fails the instruction with MissingRequiredSignature. Five lanes passed the
// attestation subject (the agent asset, the trader wallet, the champion) to the
// memo as a read-only NON-signer so the crawler (crawlAgentAttestations) could
// find the tx by that address. Mainnet rejected every one of them in
// simulation, so trader scores, reviews, GLB validations, tournament podiums
// and hire attestations never landed (zero tradescore rows ever recorded).
//
// The fake sendAndConfirm below enforces the program's real rule, and the
// assertions pin the second requirement: the subject still appears in the
// compiled message's account keys, which is what signature indexing reads.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Keypair } from '@solana/web3.js';

const MEMO = 'MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr';
const attester = Keypair.generate();
const subject = Keypair.generate().publicKey.toBase58();
const sent = [];

process.env.ATTEST_AGENT_SECRET_KEY = JSON.stringify(Array.from(attester.secretKey));

vi.mock('../api/_lib/db.js', () => ({
	sql: (strings) => {
		const text = strings.join('?');
		if (text.includes('insert into solana_attest_event_claims')) return Promise.resolve([{ claimed_at: new Date() }]);
		if (text.includes('from agent_identities')) return Promise.resolve([{ agent_asset: subject }]);
		return Promise.resolve([]);
	},
}));
vi.mock('../api/_lib/solana/connection.js', () => ({ solanaConnection: () => ({}) }));
vi.mock('../api/_lib/solana/confirm.js', () => ({
	sendAndConfirm: async (_conn, tx, signers) => {
		const signerKeys = new Set(signers.map((s) => s.publicKey.toBase58()));
		for (const ix of tx.instructions) {
			if (ix.programId.toBase58() !== MEMO) continue;
			for (const k of ix.keys) {
				if (!k.isSigner || !signerKeys.has(k.pubkey.toBase58())) {
					throw new Error(
						'Simulation failed. Program MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr failed: missing required signature for instruction',
					);
				}
			}
		}
		tx.feePayer = signers[0].publicKey;
		tx.recentBlockhash = '11111111111111111111111111111111';
		sent.push(tx);
		return `sig${sent.length}`;
	},
}));
vi.mock('../api/_lib/validation-attest.js', () => ({
	validateGlb: async () => ({ report: { ok: true }, passed: true, sha256: 'ab'.repeat(32) }),
}));
vi.mock('../api/_lib/r2.js', () => ({
	putObject: async () => {},
	publicUrl: (key) => `https://cdn.example/${key}`,
}));

function accountKeysOf(tx) {
	return tx.compileMessage().accountKeys.map((k) => k.toBase58());
}

function expectLandsAndIsIndexed(out) {
	expect(out.status).toBe('minted');
	const tx = sent.at(-1);
	expect(tx).toBeTruthy();
	const memo = tx.instructions.find((ix) => ix.programId.toBase58() === MEMO);
	expect(memo).toBeTruthy();
	expect(memo.keys.every((k) => k.isSigner)).toBe(true);
	expect(accountKeysOf(tx)).toContain(subject);
}

beforeEach(() => {
	sent.length = 0;
});

describe('server attestation memos satisfy SPL Memo v2 and stay indexable by subject', () => {
	it('trader score attestation', async () => {
		const { attestTraderScore } = await import('../api/_lib/trader-score-attest.js');
		const out = await attestTraderScore({
			network: 'mainnet', wallet: subject, agentId: 'agent-1', window: 'all',
			metrics: { score: 42, verified: true, closed_count: 33, win_rate: 0.5, realized_pnl_sol: 1, max_drawdown_pct: 10, unique_coins: 4 },
		});
		expectLandsAndIsIndexed(out);
	});

	it('review attestation', async () => {
		const { attestReview } = await import('../api/_lib/review-attest.js');
		const out = await attestReview({
			reviewId: 'r1', updatedAt: '2026-11-04T00:00:00Z', agentId: 'agent-1',
			rating: 5, body: 'solid', reviewType: 'agent', network: 'mainnet',
		});
		expectLandsAndIsIndexed(out);
	});

	it('GLB validation attestation', async () => {
		const { attestValidationSolana } = await import('../api/_lib/solana-validation-attest.js');
		const out = await attestValidationSolana({
			network: 'mainnet', agentAsset: subject, glbUrl: 'https://cdn.example/a.glb', validatedAt: '2026-11-04T00:00:00Z',
		});
		expectLandsAndIsIndexed(out);
	});

	it('tournament podium attestation with a champion wallet as subject', async () => {
		const { attestTournamentStandings } = await import('../api/_lib/tournament-attest.js');
		const out = await attestTournamentStandings({
			tournament: {
				id: 't1', name: 'Weekly', network: 'mainnet', scoring: 'pnl', bracket: 'open',
				starts_at: '2026-11-01T00:00:00Z', ends_at: '2026-11-03T00:00:00Z',
			},
			standings: [{ rank: 1, agent_id: 'agent-1', wallet: subject, score_value: 9, metrics: {}, in_window_trades: 3, eligible: true }],
		});
		expectLandsAndIsIndexed(out);
	});

	it('hire / event attestation', async () => {
		const { mintAttestation } = await import('../api/_lib/attest-event.js');
		const out = await mintAttestation({
			event_id: 'e1', event_type: 'whale_trade', source: 'test', agent_asset: subject,
			network: 'mainnet', token_mint: Keypair.generate().publicKey.toBase58(), task_id: 'job-1',
		});
		expectLandsAndIsIndexed(out);
	});
});
