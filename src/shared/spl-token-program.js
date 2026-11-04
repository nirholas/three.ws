// Resolve which SPL token program owns a mint, for browser transaction builders.
//
// $THREE (and every pump.fun mint minted after the Token-2022 switch) is a
// Token-2022 mint, not a classic SPL Token mint. @solana/spl-token defaults every
// helper to the legacy TOKEN_PROGRAM_ID, so a builder that omits the program id
// derives the WRONG associated-token address and points the instruction at the
// wrong program. The chain rejects that with "incorrect program id for instruction"
// during simulation, which reads like a malformed transaction rather than what it
// is: the right transfer aimed at the wrong token program.
//
// The mint account's owner is the canonical, on-chain way to tell the two apart,
// and it is fixed for the life of the mint, so the answer is cached per mint.
//
// Node/agent code has the same helper in solana-agent-sdk/src/utils/token-program.ts;
// this is the browser-side counterpart (dynamic spl-token import, no TS types).

const cache = new Map();

/**
 * @param {import('@solana/web3.js').Connection} connection
 * @param {import('@solana/web3.js').PublicKey} mint
 * @param {object} spl                                    the loaded @solana/spl-token module
 * @returns {Promise<import('@solana/web3.js').PublicKey>} TOKEN_PROGRAM_ID or TOKEN_2022_PROGRAM_ID
 * @throws if the mint account is missing or is not owned by either SPL token program
 */
export async function resolveTokenProgramId(connection, mint, spl) {
	const key = mint.toBase58();
	const cached = cache.get(key);
	if (cached) return cached;

	const info = await connection.getAccountInfo(mint);
	if (!info) throw new Error(`Token mint not found on this network: ${key}`);

	let programId;
	if (info.owner.equals(spl.TOKEN_2022_PROGRAM_ID)) programId = spl.TOKEN_2022_PROGRAM_ID;
	else if (info.owner.equals(spl.TOKEN_PROGRAM_ID)) programId = spl.TOKEN_PROGRAM_ID;
	else throw new Error(`Not an SPL token mint (owned by ${info.owner.toBase58()}): ${key}`);

	cache.set(key, programId);
	return programId;
}

const mintCache = new Map();

/**
 * The mint's owning program and its on-chain decimals, read in one account fetch.
 * TransferChecked needs both, and the decimals must come from the mint rather than
 * from a caller's assumption so a mis-labelled price can never move the wrong amount.
 *
 * @param {import('@solana/web3.js').Connection} connection
 * @param {import('@solana/web3.js').PublicKey} mint
 * @param {object} spl the loaded @solana/spl-token module
 * @returns {Promise<{ programId: import('@solana/web3.js').PublicKey, decimals: number }>}
 * @throws if the mint account is missing or is not owned by either SPL token program
 */
export async function resolveMintInfo(connection, mint, spl) {
	const key = mint.toBase58();
	const cached = mintCache.get(key);
	if (cached) return cached;

	const info = await connection.getAccountInfo(mint);
	if (!info) throw new Error(`Token mint not found on this network: ${key}`);

	let programId;
	if (info.owner.equals(spl.TOKEN_2022_PROGRAM_ID)) programId = spl.TOKEN_2022_PROGRAM_ID;
	else if (info.owner.equals(spl.TOKEN_PROGRAM_ID)) programId = spl.TOKEN_PROGRAM_ID;
	else throw new Error(`Not an SPL token mint (owned by ${info.owner.toBase58()}): ${key}`);

	const { decimals } = spl.unpackMint(mint, info, programId);
	const resolved = { programId, decimals };
	mintCache.set(key, resolved);
	cache.set(key, programId);
	return resolved;
}

/**
 * Instructions that pay one or more recipients from the payer's ATA of `mint`.
 * Every leg is a TransferChecked on the mint's own program with the mint's
 * on-chain decimals; each recipient ATA is derived on that program and, unless the
 * leg sets `createAccount: false`, opened idempotently first (payer funds the rent).
 * `references` on a leg ride that leg's transfer as read-only keys (Solana Pay).
 *
 * @param {object} args
 * @param {import('@solana/web3.js').Connection} args.connection
 * @param {object} args.spl the loaded @solana/spl-token module
 * @param {import('@solana/web3.js').PublicKey} args.mint
 * @param {import('@solana/web3.js').PublicKey} args.payer the wallet that signs and owns the source ATA
 * @param {Array<{ owner: import('@solana/web3.js').PublicKey, atomics: bigint|number|string, createAccount?: boolean, references?: import('@solana/web3.js').PublicKey[] }>} args.legs
 */
export async function splPaymentInstructions({ connection, spl, mint, payer, legs }) {
	const { programId, decimals } = await resolveMintInfo(connection, mint, spl);
	const ataProgram = spl.ASSOCIATED_TOKEN_PROGRAM_ID;
	const source = spl.getAssociatedTokenAddressSync(mint, payer, false, programId, ataProgram);
	const instructions = [];
	for (const leg of legs) {
		const dest = spl.getAssociatedTokenAddressSync(mint, leg.owner, true, programId, ataProgram);
		if (leg.createAccount !== false) {
			instructions.push(
				spl.createAssociatedTokenAccountIdempotentInstruction(payer, dest, leg.owner, mint, programId, ataProgram),
			);
		}
		const transfer = spl.createTransferCheckedInstruction(
			source,
			mint,
			dest,
			payer,
			BigInt(leg.atomics),
			decimals,
			[],
			programId,
		);
		for (const ref of leg.references || []) transfer.keys.push({ pubkey: ref, isSigner: false, isWritable: false });
		instructions.push(transfer);
	}
	return { instructions, programId, decimals, source };
}

/**
 * The buyer-signed checkout transaction for an SPL-priced purchase: an optional
 * platform-fee leg first, then the seller leg carrying the Solana Pay reference
 * as the final instruction (the server's reference lookup and the purchase
 * verifiers read it there). Both legs run on the mint's own token program, so a
 * $THREE (Token-2022) price and a USDC (classic) price build the same way.
 *
 * @param {object} args
 * @param {import('@solana/web3.js').Connection} args.connection
 * @param {object} args.web3 the loaded @solana/web3.js module
 * @param {object} args.spl the loaded @solana/spl-token module
 * @param {import('@solana/web3.js').PublicKey} args.payer
 * @param {string} args.recipient seller wallet (base58)
 * @param {string} args.mint
 * @param {bigint} args.amount seller atomics
 * @param {string} args.reference Solana Pay reference (base58)
 * @param {{ recipient: string, amount: bigint }} [args.fee]
 */
export async function buildReferencedSplTransfer({ connection, web3, spl, payer, recipient, mint, amount, reference, fee }) {
	const { PublicKey, Transaction } = web3;
	const legs = [];
	if (fee && BigInt(fee.amount) > 0n) legs.push({ owner: new PublicKey(fee.recipient), atomics: fee.amount });
	legs.push({ owner: new PublicKey(recipient), atomics: amount, references: [new PublicKey(reference)] });
	const { instructions } = await splPaymentInstructions({ connection, spl, mint: new PublicKey(mint), payer, legs });
	const { blockhash } = await connection.getLatestBlockhash('confirmed');
	return new Transaction({ feePayer: payer, recentBlockhash: blockhash }).add(...instructions);
}
