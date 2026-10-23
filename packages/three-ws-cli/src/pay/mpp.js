// Settles one MPP Solana charge (pull mode) from the published
// draft-solana-charge spec: build an SPL transferChecked transaction, sign it as
// the transfer authority (the server's fee payer slot stays empty when the
// challenge sponsors fees), and wrap it in an `Authorization: Payment` credential.

import {
	address,
	appendTransactionMessageInstructions,
	createNoopSigner,
	createSolanaRpc,
	createTransactionMessage,
	getBase64EncodedWireTransaction,
	partiallySignTransactionMessageWithSigners,
	pipe,
	setTransactionMessageFeePayerSigner,
	setTransactionMessageLifetimeUsingBlockhash,
} from '@solana/kit';
import { getSetComputeUnitLimitInstruction, getSetComputeUnitPriceInstruction } from '@solana-program/compute-budget';
import { findAssociatedTokenPda, getTransferCheckedInstruction, TOKEN_PROGRAM_ADDRESS } from '@solana-program/token';
import { b64urlDecodeJson, b64urlEncode, canonicalJson } from './encoding.js';
import { EXIT, PayError } from './errors.js';

const TOKEN_2022_PROGRAM = 'TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb';
const MEMO_PROGRAM = 'MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr';

async function resolveTokenProgram(rpc, mint, hinted) {
	if (hinted) {
		if (hinted !== TOKEN_PROGRAM_ADDRESS && hinted !== TOKEN_2022_PROGRAM) {
			throw new PayError(EXIT.NO_PAYABLE_OPTION, 'unsupported_token_program', `tokenProgram ${hinted} is neither the Token nor the Token-2022 program.`);
		}
		return address(hinted);
	}
	const { value } = await rpc.getAccountInfo(mint, { encoding: 'base64' }).send();
	const owner = value?.owner;
	if (owner !== TOKEN_PROGRAM_ADDRESS && owner !== TOKEN_2022_PROGRAM) {
		throw new PayError(EXIT.NO_PAYABLE_OPTION, 'unsupported_token_program', `Mint ${mint} is not owned by the Token or Token-2022 program, so the challenge is refused.`);
	}
	return address(owner);
}

/**
 * @returns {Promise<{ authorization: string, source: string }>} the header value for `Authorization`
 */
export async function signMpp({ offer, signer, rpcUrl }) {
	const rpc = createSolanaRpc(rpcUrl);
	const details = offer.request.methodDetails ?? {};
	const mint = address(offer.asset);
	const tokenProgram = await resolveTokenProgram(rpc, mint, details.tokenProgram);
	const [source] = await findAssociatedTokenPda({ owner: signer.address, mint, tokenProgram });
	const [destination] = await findAssociatedTokenPda({ owner: address(offer.payTo), mint, tokenProgram });

	const instructions = [
		getSetComputeUnitLimitInstruction({ units: 40_000 }),
		getSetComputeUnitPriceInstruction({ microLamports: 1n }),
		getTransferCheckedInstruction(
			{ source, mint, destination, authority: signer, amount: offer.amountAtomic, decimals: details.decimals },
			{ programAddress: tokenProgram },
		),
	];
	if (offer.request.externalId) {
		instructions.push({ programAddress: address(MEMO_PROGRAM), accounts: [], data: new TextEncoder().encode(offer.request.externalId) });
	}

	const lifetime = details.recentBlockhash
		? { blockhash: details.recentBlockhash, lastValidBlockHeight: 0n }
		: (await rpc.getLatestBlockhash().send()).value;
	const feePayer = details.feePayer ? createNoopSigner(address(details.feePayerKey)) : signer;

	const message = pipe(
		createTransactionMessage({ version: 0 }),
		(m) => setTransactionMessageFeePayerSigner(feePayer, m),
		(m) => setTransactionMessageLifetimeUsingBlockhash(lifetime, m),
		(m) => appendTransactionMessageInstructions(instructions, m),
	);
	const signed = await partiallySignTransactionMessageWithSigners(message);
	const credential = {
		challenge: offer.challenge,
		source: signer.address,
		payload: { type: 'transaction', transaction: getBase64EncodedWireTransaction(signed) },
	};
	return { authorization: `Payment ${b64urlEncode(canonicalJson(credential))}`, source: signer.address };
}

/** Decoded Payment-Receipt header, when the server sent one. */
export function readMppReceipt(response) {
	const header = response.headers.get('payment-receipt');
	if (!header) return undefined;
	try {
		return b64urlDecodeJson(header);
	} catch {
		return undefined;
	}
}
