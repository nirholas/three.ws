// A resource can quote several tokens on one network: every Solana paid endpoint
// advertises USDC and $THREE side by side. verifyPayment has to judge a payment
// against the accepts[] entry the buyer actually chose. Matching by network
// alone sent every $THREE payment to the facilitator as a USDC requirement, so
// the facilitator looked for a USDC recipient account inside a $THREE
// transaction and refused it (ata_create_wrong_account in production), and the
// second token was quoted everywhere and payable nowhere.
//
// These tests pin the selection: by the payload's echoed `accepted.asset` when
// present, by the mint the signed transaction moves when it is not, and with a
// named refusal when the payload asks for an asset the resource never offered.

import { beforeAll, beforeEach, afterEach, describe, it, expect, vi } from 'vitest';

vi.mock('@coinbase/x402', () => ({
	createCdpAuthHeaders: vi.fn(async () => ({})),
}));
vi.mock('@x402/extensions', () => ({
	EIP2612_GAS_SPONSORING: { key: 'eip2612GasSponsoring' },
	ERC20_APPROVAL_GAS_SPONSORING: { key: 'erc20ApprovalGasSponsoring' },
	declareEip2612GasSponsoringExtension: () => ({ eip2612GasSponsoring: { info: {}, schema: {} } }),
	declareErc20ApprovalGasSponsoringExtension: () => ({ erc20ApprovalGasSponsoring: { info: {}, schema: {} } }),
}));
vi.mock('../../api/_lib/x402-bsc-direct.js', () => ({
	PAYMENT_EVENT_TOPIC: '0x' + 'a'.repeat(64),
	settleDirectPayment: vi.fn(async () => ({ success: true })),
	verifyDirectPayment: vi.fn(async () => ({ isValid: true })),
}));

vi.setConfig({ testTimeout: 15_000, hookTimeout: 60_000 });

const SOLANA = 'solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp';
const USDC = 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v';
const THREE = 'FeMbDoX7R1Psc4GEcvJdsbNbZA3bfztcyDCatJVJpump';
const PAY_TO = 'wwwwwDxFWRn7grgr3Esrsg5C6NvDoDHSA4gaCffccrU';

const usdcAccept = { scheme: 'exact', network: SOLANA, payTo: PAY_TO, asset: USDC, amount: '10000' };
const threeAccept = { scheme: 'exact', network: SOLANA, payTo: PAY_TO, asset: THREE, amount: '10000000' };
// Same order the live challenge uses: USDC first, $THREE second.
const requirements = [usdcAccept, threeAccept];

let spec;
let web3;
let splToken;
beforeAll(async () => {
	spec = await import('../../api/_lib/x402-spec.js');
	web3 = await import('@solana/web3.js');
	splToken = await import('@solana/spl-token');
}, 60_000);

const ORIG_ENV = { ...process.env };
const REAL_FETCH = global.fetch;
let sentRequirement;
beforeEach(() => {
	process.env.X402_FACILITATOR_URL_SOLANA = 'https://facilitator.test';
	process.env.X402_FACILITATOR_TOKEN_SOLANA = 'tok';
	sentRequirement = null;
	global.fetch = vi.fn(async (_url, init) => {
		const body = JSON.parse(init.body);
		sentRequirement = body.paymentRequirements;
		return {
			ok: true,
			status: 200,
			text: async () =>
				JSON.stringify({ isValid: true, payer: 'PAYER', network: SOLANA, asset: sentRequirement.asset }),
		};
	});
});
afterEach(() => {
	for (const k of Object.keys(process.env)) if (!(k in ORIG_ENV)) delete process.env[k];
	Object.assign(process.env, ORIG_ENV);
	global.fetch = REAL_FETCH;
	vi.restoreAllMocks();
});

// A signed-shape transaction transferring `amount` of `mint` to PAY_TO under
// the given token program ('classic' for USDC, 'token2022' for $THREE).
function txPaying({ mint, amount, program }) {
	const { Keypair, PublicKey, TransactionMessage, VersionedTransaction } = web3;
	const {
		createTransferCheckedInstruction,
		getAssociatedTokenAddressSync,
		TOKEN_PROGRAM_ID,
		TOKEN_2022_PROGRAM_ID,
		ASSOCIATED_TOKEN_PROGRAM_ID,
	} = splToken;
	const tokenProgram = program === 'token2022' ? TOKEN_2022_PROGRAM_ID : TOKEN_PROGRAM_ID;
	const owner = Keypair.generate().publicKey;
	const mintPk = new PublicKey(mint);
	const senderAta = getAssociatedTokenAddressSync(mintPk, owner, false, tokenProgram, ASSOCIATED_TOKEN_PROGRAM_ID);
	const receiverAta = getAssociatedTokenAddressSync(mintPk, new PublicKey(PAY_TO), false, tokenProgram, ASSOCIATED_TOKEN_PROGRAM_ID);
	const ix = createTransferCheckedInstruction(senderAta, mintPk, receiverAta, owner, amount, 6, [], tokenProgram);
	const msg = new TransactionMessage({
		payerKey: owner,
		recentBlockhash: '11111111111111111111111111111111',
		instructions: [ix],
	}).compileToV0Message();
	return Buffer.from(new VersionedTransaction(msg).serialize()).toString('base64');
}

function header({ transaction, accepted }) {
	const payload = {
		x402Version: 2,
		scheme: 'exact',
		network: SOLANA,
		...(accepted ? { accepted } : {}),
		payload: { transaction },
	};
	return Buffer.from(JSON.stringify(payload)).toString('base64');
}

describe('verifyPayment: picks the accept the buyer chose on a multi-token network', () => {
	it('verifies a $THREE payment against the $THREE accept, not the first Solana entry', async () => {
		const transaction = txPaying({ mint: THREE, amount: 10_000_000, program: 'token2022' });
		const result = await spec.verifyPayment({
			paymentHeader: header({ transaction, accepted: threeAccept }),
			requirements,
			builderCode: null,
		});
		expect(sentRequirement.asset).toBe(THREE);
		expect(sentRequirement.amount).toBe('10000000');
		expect(result.requirement.asset).toBe(THREE);
	});

	it('still verifies a USDC payment against the USDC accept', async () => {
		const transaction = txPaying({ mint: USDC, amount: 10_000, program: 'classic' });
		const result = await spec.verifyPayment({
			paymentHeader: header({ transaction, accepted: usdcAccept }),
			requirements,
			builderCode: null,
		});
		expect(sentRequirement.asset).toBe(USDC);
		expect(result.requirement.asset).toBe(USDC);
	});

	it('reads the asset off the signed transaction when the payload echoes no accept', async () => {
		const transaction = txPaying({ mint: THREE, amount: 10_000_000, program: 'token2022' });
		const result = await spec.verifyPayment({
			paymentHeader: header({ transaction }),
			requirements,
			builderCode: null,
		});
		expect(sentRequirement.asset).toBe(THREE);
		expect(result.requirement.asset).toBe(THREE);
	});

	it('refuses an asset the resource never offered, by name, before the facilitator is called', async () => {
		const transaction = txPaying({ mint: USDC, amount: 10_000, program: 'classic' });
		const stranger = { ...usdcAccept, asset: 'THREEsynthetic1111111111111111111111111111' };
		await expect(
			spec.verifyPayment({
				paymentHeader: header({ transaction, accepted: stranger }),
				requirements,
				builderCode: null,
			}),
		).rejects.toMatchObject({ code: 'unsupported_asset', status: 402 });
		expect(global.fetch).not.toHaveBeenCalled();
	});

	it('rejects a $THREE underpayment through the static Token-2022 decode', async () => {
		const transaction = txPaying({ mint: THREE, amount: 10_000, program: 'token2022' });
		await expect(
			spec.verifyPayment({
				paymentHeader: header({ transaction, accepted: threeAccept }),
				requirements,
				builderCode: null,
			}),
		).rejects.toMatchObject({ code: 'invalid_payment', status: 402 });
	});
});
