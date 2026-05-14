// x402-checkout — buyer-side helper for the drop-in modal.
//
// The buyer's wallet (Phantom for Solana, MetaMask for EVM) needs to sign the
// payment payload that goes into the `X-PAYMENT` header. For EVM that's an
// EIP-712 typed-data signature the wallet builds locally. For Solana the
// wallet only signs serialized transactions — it does NOT build instructions.
// So we expose this endpoint: client posts { accept, buyer }, server returns
// a partially-signed v0 transaction ready for Phantom to add the payer's sig.
//
// Endpoints:
//   POST /api/x402-checkout?action=prepare   { accept, buyer }
//      → { network, tx_base64 }              v0 SPL transferChecked, fee payer
//                                            is accept.extra.feePayer (the
//                                            facilitator's sponsor account)
//   POST /api/x402-checkout?action=encode    { signed_tx_base64, accept, resource_url }
//      → { x_payment }                       base64 paymentPayload ready for
//                                            X-PAYMENT header
//
// We split prepare + encode so the modal can show "Sign in your wallet…" while
// Phantom is open, then "Sending…" while we wrap the signed tx into the
// x402 envelope. Keeps each step short and visible.

import { z } from 'zod';
import {
	Connection,
	PublicKey,
	TransactionMessage,
	VersionedTransaction,
	ComputeBudgetProgram,
} from '@solana/web3.js';
import {
	TOKEN_PROGRAM_ID,
	ASSOCIATED_TOKEN_PROGRAM_ID,
	getAssociatedTokenAddressSync,
	createAssociatedTokenAccountIdempotentInstruction,
	createTransferCheckedInstruction,
	getMint,
} from '@solana/spl-token';
import { cors, json, method, readJson, wrap, error } from './_lib/http.js';
import { parse } from './_lib/validate.js';
import {
	NETWORK_SOLANA_MAINNET,
	NETWORK_SOLANA_DEVNET,
} from './_lib/x402-spec.js';

const SOLANA_RPC = process.env.SOLANA_RPC_URL || 'https://api.mainnet-beta.solana.com';
const SOLANA_DEVNET_RPC = process.env.SOLANA_RPC_URL_DEVNET || 'https://api.devnet.solana.com';

const acceptSchema = z.object({
	scheme: z.literal('exact'),
	network: z.string().min(1).max(80),
	amount: z.string().regex(/^\d+$/),
	asset: z.string().min(32).max(44),
	payTo: z.string().min(32).max(44),
	maxTimeoutSeconds: z.number().int().positive().optional(),
	extra: z
		.object({
			name: z.string().optional(),
			decimals: z.number().int().nonnegative().optional(),
			feePayer: z.string().min(32).max(44),
		})
		.passthrough(),
});

const prepareSchema = z.object({
	accept: acceptSchema,
	buyer: z.string().min(32).max(44),
});

const encodeSchema = z.object({
	accept: acceptSchema,
	signed_tx_base64: z.string().min(40).max(20_000),
	resource_url: z.string().url(),
});

export default wrap(async (req, res) => {
	// Public, cross-origin endpoint — the drop-in script runs on any merchant
	// site and POSTs here. No credentials, allow any origin.
	if (cors(req, res, { origins: '*', methods: 'POST,OPTIONS' })) return;
	if (!method(req, res, ['POST'])) return;

	const action = req.query?.action;
	if (action === 'prepare') return handlePrepare(req, res);
	if (action === 'encode') return handleEncode(req, res);
	return error(res, 404, 'not_found', `unknown action: ${action ?? '(none)'}`);
});

function isSolanaNetwork(network) {
	return (
		network === NETWORK_SOLANA_MAINNET ||
		network === NETWORK_SOLANA_DEVNET ||
		network === 'solana'
	);
}

function rpcFor(network) {
	if (network === NETWORK_SOLANA_DEVNET) return SOLANA_DEVNET_RPC;
	return SOLANA_RPC;
}

async function handlePrepare(req, res) {
	const body = parse(prepareSchema, await readJson(req));
	const { accept, buyer } = body;
	if (!isSolanaNetwork(accept.network)) {
		return error(
			res,
			400,
			'unsupported_network',
			`prepare only builds Solana transactions; got network=${accept.network}. EVM clients sign EIP-712 typed data locally and don't need this endpoint.`,
		);
	}

	const conn = new Connection(rpcFor(accept.network), 'confirmed');
	const mint = new PublicKey(accept.asset);
	const payTo = new PublicKey(accept.payTo);
	const feePayer = new PublicKey(accept.extra.feePayer);
	const buyerPubkey = new PublicKey(buyer);
	const amount = BigInt(accept.amount);

	const senderAta = getAssociatedTokenAddressSync(
		mint,
		buyerPubkey,
		false,
		TOKEN_PROGRAM_ID,
		ASSOCIATED_TOKEN_PROGRAM_ID,
	);
	const receiverAta = getAssociatedTokenAddressSync(
		mint,
		payTo,
		false,
		TOKEN_PROGRAM_ID,
		ASSOCIATED_TOKEN_PROGRAM_ID,
	);
	const mintInfo = await getMint(conn, mint);

	const ixs = [
		ComputeBudgetProgram.setComputeUnitLimit({ units: 60_000 }),
		ComputeBudgetProgram.setComputeUnitPrice({ microLamports: 1 }),
	];
	const receiverInfo = await conn.getAccountInfo(receiverAta);
	if (!receiverInfo) {
		ixs.push(
			createAssociatedTokenAccountIdempotentInstruction(
				feePayer,
				receiverAta,
				payTo,
				mint,
				TOKEN_PROGRAM_ID,
				ASSOCIATED_TOKEN_PROGRAM_ID,
			),
		);
	}
	ixs.push(
		createTransferCheckedInstruction(
			senderAta,
			mint,
			receiverAta,
			buyerPubkey,
			amount,
			mintInfo.decimals,
			[],
			TOKEN_PROGRAM_ID,
		),
	);

	const { blockhash } = await conn.getLatestBlockhash('confirmed');
	const message = new TransactionMessage({
		payerKey: feePayer,
		recentBlockhash: blockhash,
		instructions: ixs,
	}).compileToV0Message();
	const vtx = new VersionedTransaction(message);

	const txBase64 = Buffer.from(vtx.serialize()).toString('base64');
	return json(res, 200, {
		network: accept.network,
		tx_base64: txBase64,
		recent_blockhash: blockhash,
	});
}

async function handleEncode(req, res) {
	const body = parse(encodeSchema, await readJson(req));
	const { accept, signed_tx_base64, resource_url } = body;
	const payload = {
		x402Version: 2,
		scheme: 'exact',
		network: accept.network,
		resource: { url: resource_url, mimeType: 'application/json' },
		accepted: accept,
		payload: { transaction: signed_tx_base64 },
	};
	const xPayment = Buffer.from(JSON.stringify(payload), 'utf8').toString('base64');
	return json(res, 200, { x_payment: xPayment });
}
