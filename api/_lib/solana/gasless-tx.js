// Gasless purchase transactions: the platform sponsors Solana network fees.
//
// Users hold USDC but rarely hold SOL. Forcing them to acquire SOL just to pay
// the ~0.000005 SOL signature fee is real friction at checkout. Here the
// platform's marketplace payer becomes the transaction fee-payer and co-signs
// the transaction on the backend; the buyer still authorizes the SPL token
// transfer with their own signature, but pays no network fee.
//
// The buyer receives a partially-signed `VersionedTransaction` (the payer's
// signature is already attached) and adds only their authority signature in the
// wallet. The reference key rides the seller leg so @solana/pay's findReference
// / validateTransfer can locate and verify the payment; see
// api/_lib/purchase-confirm.js, which validates the exact split this builds.
//
// The payer keypair is one of the monitored signers (`marketplace-payer` in
// api/_lib/solana-signers.js). If it runs dry every gasless purchase silently
// breaks, so the balance-check cron watches it. When no payer is configured the
// builder returns null and callers fall back to a buyer-pays transaction.
//
// Every account and instruction follows the mint's own token program, so a
// Token-2022 mint ($THREE) pays between Token-2022 ATAs exactly like USDC pays
// between classic ones. A seller or treasury that has never held the mint gets
// its ATA opened in the same transaction, rent paid by the platform payer.

import {
	PublicKey,
	TransactionMessage,
	VersionedTransaction,
} from '@solana/web3.js';
import { getMint } from '@solana/spl-token';

import { decodeSecretKey } from '../solana-signers.js';
import { ataFor, createMissingAtas, tokenProgramForMint, tokenTransfer } from '../solana-token-program.js';

// Resolve the marketplace fee-payer keypair from the environment once per
// lambda instance. `undefined` = not yet resolved, `null` = not configured /
// undecodable (callers fall back to buyer-pays).
let _payer = undefined;

/**
 * Load the platform's gasless fee-payer keypair, preferring the dedicated
 * MARKETPLACE_PAYER_KEYPAIR and falling back to the shared platform treasury.
 * @returns {Promise<import('@solana/web3.js').Keypair | null>}
 */
export async function resolveMarketplacePayer() {
	if (_payer !== undefined) return _payer;
	const secret =
		process.env.MARKETPLACE_PAYER_KEYPAIR ||
		process.env.PLATFORM_TREASURY_KEYPAIR ||
		process.env.TREASURY_KEYPAIR ||
		'';
	if (!secret) {
		_payer = null;
		return null;
	}
	const bytes = await decodeSecretKey(secret);
	if (!bytes) {
		_payer = null;
		return null;
	}
	try {
		const { Keypair } = await import('@solana/web3.js');
		_payer = Keypair.fromSecretKey(bytes);
	} catch {
		_payer = null;
	}
	return _payer;
}

/** Reset the cached payer, a test-only seam so env changes take effect. */
export function _resetMarketplacePayerCache() {
	_payer = undefined;
}

/**
 * The instructions of a gasless purchase, in the order they must execute:
 * idempotent creates for any missing seller/treasury ATA (paid by `payer`), the
 * treasury fee leg, then the seller leg carrying the Solana Pay reference LAST,
 * because @solana/pay's validateTransfer only ever inspects the last instruction.
 * With the fee leg last, confirm would decode the treasury transfer, find no
 * reference key on it, and reject a good payment as "invalid references"
 * (api/_lib/purchase-confirm.js validates exactly this shape).
 *
 * Pure apart from the mint and ATA reads, so scripts/verify-token2022-purchase.mjs
 * can simulate the exact instruction list production builds.
 *
 * @returns {Promise<{ instructions: import('@solana/web3.js').TransactionInstruction[],
 *                     tokenProgram: PublicKey, decimals: number }>}
 */
export async function buildGaslessPurchaseInstructions({
	connection,
	payer,
	buyerPublicKey,
	recipient,
	mint,
	creatorAtomics,
	reference,
	decimals,
	platformFeeAtomics = 0n,
	platformFeeWallet = null,
}) {
	const mintKey = new PublicKey(mint);
	const buyer = new PublicKey(buyerPublicKey);
	const seller = new PublicKey(recipient);
	const feeWallet = platformFeeAtomics > 0n && platformFeeWallet ? new PublicKey(platformFeeWallet) : null;

	const tokenProgram = await tokenProgramForMint(connection, mintKey);
	const mintDecimals =
		decimals == null
			? (await getMint(connection, mintKey, 'confirmed', tokenProgram)).decimals
			: Number(decimals);

	const source = ataFor(mintKey, buyer, tokenProgram);
	const instructions = await createMissingAtas(connection, {
		payer: new PublicKey(payer),
		mint: mintKey,
		tokenProgram,
		owners: [seller, feeWallet],
	});

	if (feeWallet) {
		instructions.push(
			tokenTransfer({
				source,
				mint: mintKey,
				destination: ataFor(mintKey, feeWallet, tokenProgram, { allowOwnerOffCurve: true }),
				authority: buyer,
				atomics: platformFeeAtomics,
				decimals: mintDecimals,
				tokenProgram,
			}),
		);
	}
	instructions.push(
		tokenTransfer({
			source,
			mint: mintKey,
			destination: ataFor(mintKey, seller, tokenProgram, { allowOwnerOffCurve: true }),
			authority: buyer,
			atomics: creatorAtomics,
			decimals: mintDecimals,
			tokenProgram,
			references: [new PublicKey(reference)],
		}),
	);
	return { instructions, tokenProgram, decimals: mintDecimals };
}

/**
 * Build a partially-signed (gasless) SPL-token purchase transaction.
 *
 * The platform payer is the fee-payer and co-signs; the buyer authorizes the
 * transfer leg(s) with their wallet. Pass a non-zero `platformFeeAtomics` +
 * `platformFeeWallet` to add the treasury fee leg atomically (skill purchases);
 * omit them for a single full-amount transfer (whole-asset purchases).
 *
 * @param {object}  args
 * @param {import('@solana/web3.js').Connection} args.connection
 * @param {string}  args.buyerPublicKey      base58: token-transfer authority
 * @param {string}  args.recipient           base58: seller / creator payout wallet
 * @param {string}  args.mint                base58: SPL or Token-2022 mint (USDC, $THREE)
 * @param {bigint}  args.creatorAtomics      seller leg amount, atomic units
 * @param {string}  args.reference           base58: Solana Pay reference key
 * @param {number} [args.decimals]           mint decimals; fetched on-chain if omitted
 * @param {bigint} [args.platformFeeAtomics] treasury leg amount, atomic units
 * @param {string} [args.platformFeeWallet]  base58: treasury wallet for the fee leg
 * @returns {Promise<{ transaction: string, feePayer: string, gasless: true } | null>}
 *          base64 VersionedTransaction, or null when no payer is configured.
 */
export async function buildGaslessPurchaseTx(args) {
	const payer = await resolveMarketplacePayer();
	if (!payer) return null;
	const { connection } = args;

	const { instructions } = await buildGaslessPurchaseInstructions({ ...args, payer: payer.publicKey });

	const { blockhash } = await connection.getLatestBlockhash('confirmed');
	const messageV0 = new TransactionMessage({
		payerKey: payer.publicKey, // platform pays the network fee
		recentBlockhash: blockhash,
		instructions,
	}).compileToV0Message();

	const tx = new VersionedTransaction(messageV0);
	tx.sign([payer]); // partial: buyer adds the authority signature in their wallet

	return {
		transaction: Buffer.from(tx.serialize()).toString('base64'),
		feePayer: payer.publicKey.toBase58(),
		gasless: true,
	};
}
