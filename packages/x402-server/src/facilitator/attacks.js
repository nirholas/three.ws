// Adversarial suite for Solana x402 facilitators.
//
// Every case builds a transaction that is correctly SHAPED to look like a payment
// but is hostile in one specific way: it tries to drain the sponsor, redirect the
// money, inflate the fee, or abuse the settle flow. Each case names the refusal
// reason class a hardened facilitator must answer with. The transactions are
// signed by throwaway buyer keys and never funded, so a correct facilitator
// refuses them before anything touches the chain and the run costs nothing.
//
// Point it at a facilitator you operate, on devnet or a local validator. It
// refuses to run against a mainnet network id.

import {
	AddressLookupTableAccount,
	ComputeBudgetProgram,
	Keypair,
	MessageV0,
	PublicKey,
	StakeProgram,
	SystemProgram,
	TransactionInstruction,
	TransactionMessage,
	VersionedTransaction,
} from '@solana/web3.js';
import {
	ASSOCIATED_TOKEN_PROGRAM_ID,
	TOKEN_2022_PROGRAM_ID,
	TOKEN_PROGRAM_ID,
	createAssociatedTokenAccountIdempotentInstruction,
	createTransferCheckedInstruction,
	createTransferInstruction,
	getAssociatedTokenAddressSync,
} from '@solana/spl-token';

export const MAINNET_NETWORK_IDS = ['solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp'];

const MEMO = new PublicKey('MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr');
const LIGHTHOUSE = new PublicKey('L2TExMFKdjpN9kozasaurPirfHy9P8sbXoAN1qA3S95');

const ata = (mint, owner, program = TOKEN_PROGRAM_ID) =>
	getAssociatedTokenAddressSync(mint, owner, false, program, ASSOCIATED_TOKEN_PROGRAM_ID);

/**
 * @param {{
 *   network: string,
 *   feePayer: string,        sponsor address the facilitator advertises
 *   payTo: string,           a recipient the facilitator allowlists
 *   mint: string,            a mint the facilitator settles
 *   amount?: string,         atomic amount the requirement asks for (default 1_000_000)
 *   decimals?: number,       mint decimals (default 6)
 *   tokenProgram?: PublicKey token program that owns `mint` (default classic SPL Token)
 *   blockhash?: string       any 32-byte base58 string; refusals precede the chain
 * }} cfg
 */
export function buildAttackCases(cfg) {
	const sponsor = new PublicKey(cfg.feePayer);
	const payTo = new PublicKey(cfg.payTo);
	const mint = new PublicKey(cfg.mint);
	const amount = BigInt(cfg.amount || 1_000_000);
	const decimals = cfg.decimals ?? 6;
	const program = cfg.tokenProgram || TOKEN_PROGRAM_ID;
	const blockhash = cfg.blockhash || Keypair.generate().publicKey.toBase58();
	const attacker = Keypair.generate();
	const buyer = Keypair.generate();

	const requirement = (over = {}) => ({
		scheme: 'exact',
		network: cfg.network,
		asset: cfg.mint,
		amount: amount.toString(),
		payTo: cfg.payTo,
		maxTimeoutSeconds: 60,
		extra: { feePayer: cfg.feePayer },
		...over,
	});

	const honestTransfer = (over = {}) =>
		createTransferCheckedInstruction(
			over.source || ata(mint, over.authority || buyer.publicKey, program),
			over.mint || mint,
			over.dest || ata(mint, payTo, program),
			over.authority || buyer.publicKey,
			over.amount ?? amount,
			decimals,
			[],
			over.program || program,
		);
	const cuLimit = (units) => ComputeBudgetProgram.setComputeUnitLimit({ units });
	const cuPrice = (microLamports) => ComputeBudgetProgram.setComputeUnitPrice({ microLamports });

	// Compile + sign. Sponsor-fee-payer transactions leave the sponsor slot empty,
	// exactly as a real buyer's wallet would hand them to a facilitator.
	function tx({ payer = sponsor, ixs, signers = [buyer], lookups = null, forgeSignature = false }) {
		const msg = new TransactionMessage({ payerKey: payer, recentBlockhash: blockhash, instructions: ixs });
		let compiled = lookups
			? msg.compileToV0Message(lookups)
			: msg.compileToV0Message();
		const t = new VersionedTransaction(compiled);
		const real = signers.filter((s) => s.publicKey);
		t.sign(real);
		if (forgeSignature) {
			const idx = compiled.staticAccountKeys.findIndex((k) => k.equals(buyer.publicKey));
			t.signatures[idx] = Uint8Array.from({ length: 64 }, (_, i) => (i * 7 + 3) % 256);
		}
		return Buffer.from(t.serialize()).toString('base64');
	}

	const payload = (b64) => ({
		x402Version: 2,
		scheme: 'exact',
		network: cfg.network,
		payload: { transaction: b64 },
	});

	const honest = () => [cuLimit(60_000), cuPrice(1000), honestTransfer()];
	const c = (name, endpoint, expect, build, req = requirement()) => ({
		name,
		endpoint,
		expect,
		build: () => ({ paymentPayload: payload(build()), paymentRequirements: req }),
	});

	const otherMint = Keypair.generate().publicKey;
	const junkAta = ata(mint, attacker.publicKey, program);

	return [
		c('fee-payer lamport drain via System transfer', 'verify', 'system_instruction_forbidden', () =>
			tx({ ixs: [...honest(), SystemProgram.transfer({ fromPubkey: sponsor, toPubkey: attacker.publicKey, lamports: 5_000_000 })] })),
		c('sponsor-funded System createAccount', 'verify', 'system_instruction_forbidden', () =>
			tx({ ixs: [...honest(), SystemProgram.createAccount({ fromPubkey: sponsor, newAccountPubkey: attacker.publicKey, lamports: 2_000_000, space: 165, programId: TOKEN_PROGRAM_ID })], signers: [buyer, attacker] })),
		c('priority-fee inflation: unit price far above ceiling', 'verify', 'cu_price_too_high', () =>
			tx({ ixs: [cuLimit(60_000), cuPrice(50_000_000), honestTransfer()] })),
		c('priority-fee inflation: limit times price over the lamport ceiling', 'verify', 'priority_fee_too_high', () =>
			tx({ ixs: [cuLimit(300_000), cuPrice(99_000), honestTransfer()] })),
		c('compute-unit abuse: limit above ceiling', 'verify', 'cu_limit_too_high', () =>
			tx({ ixs: [cuLimit(1_400_000), cuPrice(1), honestTransfer()] })),
		c('dust griefing: a sponsored settle that cannot cover its own fee', 'settle', 'amount_below_min_settle', () =>
			tx({ ixs: [cuLimit(60_000), cuPrice(1000), honestTransfer({ amount: 1n })] }),
			requirement({ amount: '1' })),
		c('recipient substitution: payTo is not allowlisted', 'verify', 'pay_to_not_allowlisted', () =>
			tx({ ixs: [cuLimit(60_000), cuPrice(1000), honestTransfer({ dest: junkAta })] }),
			requirement({ payTo: attacker.publicKey.toBase58() })),
		c('recipient substitution: transfer destination is the attacker ATA', 'verify', 'transfer_wrong_destination', () =>
			tx({ ixs: [cuLimit(60_000), cuPrice(1000), honestTransfer({ dest: junkAta })] })),
		c('mint substitution: requirement names a mint the facilitator does not settle', 'verify', 'mint_not_settleable', () =>
			tx({ ixs: honest() }),
			requirement({ asset: otherMint.toBase58() })),
		c('mint substitution: instruction mint differs from the requirement', 'verify', 'transfer_wrong_mint', () =>
			tx({ ixs: [cuLimit(60_000), cuPrice(1000), honestTransfer({ mint: otherMint })] })),
		c('extra instruction from an unlisted program', 'verify', 'program_not_allowed', () =>
			tx({ ixs: [...honest(), StakeProgram.initialize({ stakePubkey: attacker.publicKey, authorized: { staker: attacker.publicKey, withdrawer: attacker.publicKey } })] })),
		c('two transfers in one transaction', 'verify', 'multiple_transfers', () =>
			tx({ ixs: [...honest(), honestTransfer()] })),
		c('plain Transfer instead of TransferChecked', 'verify', 'token_ix_not_transfer_checked', () =>
			tx({ ixs: [cuLimit(60_000), cuPrice(1000), createTransferInstruction(ata(mint, buyer.publicKey, program), ata(mint, payTo, program), buyer.publicKey, amount, [], program)] })),
		c('underpayment: transfers less than the requirement', 'verify', 'amount_below_required', () =>
			tx({ ixs: [cuLimit(60_000), cuPrice(1000), honestTransfer({ amount: amount - 1n })] })),
		c('fee payer is neither the sponsor nor the buyer', 'verify', 'fee_payer_not_sponsor', () =>
			tx({ payer: attacker.publicKey, ixs: honest(), signers: [attacker, buyer] })),
		c('ATA create for an attacker-owned account', 'verify', 'ata_create_wrong_account', () =>
			tx({ ixs: [cuLimit(60_000), cuPrice(1000), createAssociatedTokenAccountIdempotentInstruction(sponsor, junkAta, attacker.publicKey, mint, program), honestTransfer()] })),
		c('ATA create funded by someone other than the fee payer', 'verify', 'ata_create_wrong_funder', () =>
			tx({ ixs: [cuLimit(60_000), cuPrice(1000), createAssociatedTokenAccountIdempotentInstruction(buyer.publicKey, ata(mint, payTo, program), payTo, mint, program), honestTransfer()] })),
		c('address lookup table hides accounts', 'verify', 'address_table_lookups_forbidden', () => {
			const t = new VersionedTransaction(new TransactionMessage({ payerKey: sponsor, recentBlockhash: blockhash, instructions: honest() }).compileToV0Message());
			const m = t.message;
			const withLookup = new MessageV0({
				header: m.header,
				staticAccountKeys: m.staticAccountKeys,
				recentBlockhash: m.recentBlockhash,
				compiledInstructions: m.compiledInstructions,
				addressTableLookups: [{ accountKey: Keypair.generate().publicKey, writableIndexes: [0], readonlyIndexes: [] }],
			});
			const forged = new VersionedTransaction(withLookup);
			forged.sign([buyer]);
			return Buffer.from(forged.serialize()).toString('base64');
		}),
		c('forged buyer signature', 'verify', 'invalid_signature', () =>
			tx({ ixs: honest(), forgeSignature: true })),
		c('missing buyer signature', 'verify', 'missing_signature', () =>
			tx({ ixs: honest(), signers: [] })),
		c('token transfer through the wrong token program', 'verify', 'wrong_token_program', () =>
			tx({ ixs: [cuLimit(60_000), cuPrice(1000), createTransferCheckedInstruction(ata(mint, buyer.publicKey, program), mint, ata(mint, payTo, program), buyer.publicKey, amount, decimals, [], program.equals(TOKEN_PROGRAM_ID) ? TOKEN_2022_PROGRAM_ID : TOKEN_PROGRAM_ID)] })),
		c('wallet-guard instruction that names the sponsor', 'verify', 'guard_instruction_references_sponsor', () =>
			tx({ ixs: [...honest(), new TransactionInstruction({ programId: LIGHTHOUSE, keys: [{ pubkey: sponsor, isSigner: false, isWritable: true }], data: Buffer.from([1]) })] })),
		c('padding with guard instructions beyond the ceiling', 'verify', 'too_many_guard_instructions', () =>
			tx({ ixs: [...honest(), ...Array.from({ length: 4 }, () => new TransactionInstruction({ programId: LIGHTHOUSE, keys: [{ pubkey: buyer.publicKey, isSigner: false, isWritable: false }], data: Buffer.from([2]) }))] })),
		c('transfer drawn from an account the authority does not own', 'verify', 'transfer_source_not_authority_ata', () =>
			tx({ ixs: [cuLimit(60_000), cuPrice(1000), honestTransfer({ source: ata(mint, attacker.publicKey, program) })] })),
		c('transfer authority is not a signer', 'verify', 'authority_not_signer', () => {
			const ixn = honestTransfer();
			const keys = ixn.keys.map((k) => (k.pubkey.equals(buyer.publicKey) ? { ...k, isSigner: false } : k));
			return tx({ ixs: [cuLimit(60_000), cuPrice(1000), new TransactionInstruction({ programId: ixn.programId, keys, data: ixn.data })], signers: [] });
		}),
		c('no transfer at all', 'verify', 'no_usdc_transfer', () =>
			tx({ ixs: [cuLimit(60_000), cuPrice(1000), new TransactionInstruction({ programId: MEMO, keys: [], data: Buffer.from('hi') })], signers: [] })),
		c('bytes that are not a transaction', 'verify', 'deserialize_failed', () => 'AAAA'),
	];
}

/**
 * Run the suite against a facilitator URL. `fetchImpl` defaults to global fetch.
 * @returns {Promise<Array<{name:string, endpoint:string, expect:string, got:string|null, pass:boolean}>>}
 */
export async function runAttacks({ url, cases, fetchImpl = fetch }) {
	const base = String(url).replace(/\/+$/, '');
	const results = [];
	for (const attack of cases) {
		let got = null;
		let pass = false;
		try {
			const res = await fetchImpl(`${base}/${attack.endpoint}`, {
				method: 'POST',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify(attack.build()),
			});
			const body = await res.json().catch(() => ({}));
			const refused = attack.endpoint === 'verify' ? body.isValid === false : body.success === false;
			got = attack.endpoint === 'verify' ? body.invalidReason ?? null : body.errorReason ?? null;
			pass = refused && typeof got === 'string' && got.startsWith(attack.expect);
		} catch (err) {
			got = `request_failed:${String(err?.message || err).slice(0, 80)}`;
		}
		results.push({ name: attack.name, endpoint: attack.endpoint, expect: attack.expect, got, pass });
	}
	return results;
}

/**
 * Build one HONEST sponsor-mode payment: a TransferChecked of `amount` from a
 * fresh buyer to `payTo`, signed by the buyer, fee payer slot left for the
 * facilitator. Used by the end-to-end settle check and the guard tests.
 * @returns {{ paymentPayload: object, paymentRequirements: object, buyer: Keypair }}
 */
export function buildPayment({
	network,
	feePayer,
	payTo,
	mint,
	amount = 1_000_000n,
	decimals = 6,
	tokenProgram = TOKEN_PROGRAM_ID,
	blockhash,
	buyer = Keypair.generate(),
	createRecipientAta = false,
	priceMicroLamports = 1000,
}) {
	const sponsor = new PublicKey(feePayer);
	const mintKey = new PublicKey(mint);
	const owner = new PublicKey(payTo);
	const dest = ata(mintKey, owner, tokenProgram);
	const ixs = [
		ComputeBudgetProgram.setComputeUnitLimit({ units: 60_000 }),
		ComputeBudgetProgram.setComputeUnitPrice({ microLamports: priceMicroLamports }),
	];
	if (createRecipientAta) {
		ixs.push(createAssociatedTokenAccountIdempotentInstruction(sponsor, dest, owner, mintKey, tokenProgram));
	}
	ixs.push(
		createTransferCheckedInstruction(
			ata(mintKey, buyer.publicKey, tokenProgram),
			mintKey,
			dest,
			buyer.publicKey,
			BigInt(amount),
			decimals,
			[],
			tokenProgram,
		),
	);
	const message = new TransactionMessage({
		payerKey: sponsor,
		recentBlockhash: blockhash || Keypair.generate().publicKey.toBase58(),
		instructions: ixs,
	}).compileToV0Message();
	const t = new VersionedTransaction(message);
	t.sign([buyer]);
	return {
		buyer,
		paymentPayload: {
			x402Version: 2,
			scheme: 'exact',
			network,
			payload: { transaction: Buffer.from(t.serialize()).toString('base64') },
		},
		paymentRequirements: {
			scheme: 'exact',
			network,
			asset: mint,
			amount: BigInt(amount).toString(),
			payTo,
			maxTimeoutSeconds: 60,
			extra: { feePayer },
		},
	};
}
