// Settlement verification when two quote legs land on the same token account.
// REWARDS_SINK falls back to the treasury, so a deployment without a distinct
// rewards wallet pays both legs into one account. Each leg must then be funded
// in addition to the other, not satisfied by one shared balance delta.
import { describe, it, expect, vi, beforeEach } from 'vitest';

process.env.GAME_TOKEN_SECRET = 'test-secret-for-game-token-legs';
import { Keypair } from '@solana/web3.js';
const TREASURY_KEY = Keypair.generate().publicKey.toBase58();
const OTHER_KEY = Keypair.generate().publicKey.toBase58();
process.env.GAME_TOKEN_TREASURY = TREASURY_KEY;

const state = { tx: null };
vi.mock('@solana/web3.js', async (orig) => {
	const real = await orig();
	class Connection {
		async getParsedTransaction() {
			return state.tx;
		}
	}
	return { ...real, Connection };
});

const gt = await import('../multiplayer/src/game-token.js');
const { PublicKey } = await import('@solana/web3.js');
const { getAssociatedTokenAddress } = await import('@solana/spl-token');

const SIG = 's'.repeat(64);
const TREASURY = process.env.GAME_TOKEN_TREASURY;
const MINT = gt.TOKEN_MINT;

async function ata(wallet) {
	return (await getAssociatedTokenAddress(new PublicKey(MINT), new PublicKey(wallet))).toBase58();
}

async function txPaying(nonce, deltas) {
	const keys = Object.keys(deltas);
	return {
		meta: {
			err: null,
			preTokenBalances: keys.map((k, i) => ({ mint: MINT, accountIndex: i, uiTokenAmount: { amount: '0' } })),
			postTokenBalances: keys.map((k, i) => ({
				mint: MINT,
				accountIndex: i,
				uiTokenAmount: { amount: String(deltas[k]) },
			})),
		},
		transaction: {
			message: {
				accountKeys: keys.map((k) => ({ pubkey: { toBase58: () => k } })),
				instructions: [{ programId: { toString: () => 'MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr' }, parsed: nonce }],
			},
		},
	};
}

describe('shared rewards/treasury token account', () => {
	beforeEach(() => {
		state.tx = null;
	});

	it('verifySpinPayment rejects a single half-price transfer into the shared account', async () => {
		const quoteToken = gt.signQuote({
			purpose: 'spin',
			nonce: 'n1',
			buyer: 'buyer',
			rewardsAddr: TREASURY,
			treasuryAddr: TREASURY,
			rewardsRaw: '500',
			treasuryRaw: '500',
		});
		state.tx = await txPaying('n1', { [await ata(TREASURY)]: 500 });
		const r = await gt.verifySpinPayment({ quoteToken, txSig: SIG });
		expect(r.ok).toBe(false);
	});

	it('verifySpinPayment accepts the full combined amount', async () => {
		const quoteToken = gt.signQuote({
			purpose: 'spin',
			nonce: 'n2',
			buyer: 'buyer',
			rewardsAddr: TREASURY,
			treasuryAddr: TREASURY,
			rewardsRaw: '500',
			treasuryRaw: '500',
		});
		state.tx = await txPaying('n2', { [await ata(TREASURY)]: 1000 });
		const r = await gt.verifySpinPayment({ quoteToken, txSig: SIG });
		expect(r.ok).toBe(true);
	});

	it('verifyTokenPurchase rejects a half payment and counts the creator leg on the same account', async () => {
		const quoteToken = gt.signQuote({
			purpose: 'boutique',
			nonce: 'n3',
			buyer: 'buyer',
			rewardsAddr: TREASURY,
			treasuryAddr: TREASURY,
			creatorAddr: TREASURY,
			rewardsRaw: '300',
			treasuryRaw: '300',
			creatorRaw: '400',
		});
		state.tx = await txPaying('n3', { [await ata(TREASURY)]: 400 });
		expect((await gt.verifyTokenPurchase({ quoteToken, txSig: SIG, purpose: 'boutique' })).ok).toBe(false);
		state.tx = await txPaying('n3', { [await ata(TREASURY)]: 1000 });
		expect((await gt.verifyTokenPurchase({ quoteToken, txSig: SIG, purpose: 'boutique' })).ok).toBe(true);
	});

	it('distinct accounts still verify per leg', async () => {
		const other = OTHER_KEY;
		const quoteToken = gt.signQuote({
			purpose: 'spin',
			nonce: 'n4',
			buyer: 'buyer',
			rewardsAddr: other,
			treasuryAddr: TREASURY,
			rewardsRaw: '500',
			treasuryRaw: '500',
		});
		state.tx = await txPaying('n4', { [await ata(other)]: 500, [await ata(TREASURY)]: 500 });
		expect((await gt.verifySpinPayment({ quoteToken, txSig: SIG })).ok).toBe(true);
	});
});
