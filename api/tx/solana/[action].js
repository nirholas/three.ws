import { z } from 'zod';
import {
	Connection, PublicKey, Transaction, SystemProgram, LAMPORTS_PER_SOL,
	TransactionInstruction,
} from '@solana/web3.js';
import {
	createTransferInstruction, getMint, getAssociatedTokenAddress,
	createAssociatedTokenAccountInstruction,
} from '@solana/spl-token';
import { cors, json, method, readJson, wrap, error } from '../../_lib/http.js';
import { getSessionUser } from '../../_lib/auth.js';
import { limits, clientIp } from '../../_lib/rate-limit.js';
import { parse } from '../../_lib/validate.js';

const SOLANA_RPC_MAINNET = process.env.SOLANA_RPC_URL        || 'https://api.mainnet-beta.solana.com';
const SOLANA_RPC_DEVNET  = process.env.SOLANA_RPC_URL_DEVNET || 'https://api.devnet.solana.com';
const MEMO_PROGRAM_ID    = new PublicKey('MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr');

// ── build-transfer ────────────────────────────────────────────────────────────

const transferSchema = z.object({
	sender:    z.string(),
	recipient: z.string(),
	amount:    z.number().positive(),
	token:     z.string().default('SOL'),
	memo:      z.string().optional(),
	network:   z.enum(['mainnet', 'devnet']).default('mainnet'),
});

async function handleBuildTransfer(req, res) {
	if (cors(req, res, { methods: 'POST,OPTIONS', credentials: true })) return;
	if (!method(req, res, ['POST'])) return;
	const user = await getSessionUser(req);
	if (!user) return error(res, 401, 'unauthorized', 'sign in required');
	const rl = await limits.authIp(clientIp(req));
	if (!rl.success) return error(res, 429, 'rate_limited', 'too many requests');

	const { sender, recipient, amount, token, memo, network } = parse(transferSchema, await readJson(req));

	const rpcUrl = network === 'devnet' ? SOLANA_RPC_DEVNET : SOLANA_RPC_MAINNET;
	const connection = new Connection(rpcUrl, 'confirmed');
	const senderPubkey    = new PublicKey(sender);
	const recipientPubkey = new PublicKey(recipient);

	const tx = new Transaction();

	if (token === 'SOL') {
		tx.add(SystemProgram.transfer({
			fromPubkey: senderPubkey,
			toPubkey:   recipientPubkey,
			lamports:   Math.round(amount * LAMPORTS_PER_SOL),
		}));
	} else {
		const mint        = new PublicKey(token);
		const mintInfo    = await getMint(connection, mint);
		const senderATA   = await getAssociatedTokenAddress(mint, senderPubkey);
		const recipientATA = await getAssociatedTokenAddress(mint, recipientPubkey);

		const recipientAccount = await connection.getAccountInfo(recipientATA);
		if (!recipientAccount) {
			tx.add(createAssociatedTokenAccountInstruction(senderPubkey, recipientATA, recipientPubkey, mint));
		}

		const amountInSmallestUnit = BigInt(Math.round(amount * 10 ** mintInfo.decimals));
		tx.add(createTransferInstruction(senderATA, recipientATA, senderPubkey, amountInSmallestUnit));
	}

	if (memo) {
		tx.add(new TransactionInstruction({
			keys:      [],
			programId: MEMO_PROGRAM_ID,
			data:      Buffer.from(memo, 'utf-8'),
		}));
	}

	const latestBlockhash = await connection.getLatestBlockhash();
	tx.feePayer      = senderPubkey;
	tx.recentBlockhash = latestBlockhash.blockhash;

	const serialized = tx.serialize({ requireAllSignatures: false });
	return json(res, 200, {
		transaction:          serialized.toString('base64'),
		network,
		blockhash:            latestBlockhash.blockhash,
		lastValidBlockHeight: latestBlockhash.lastValidBlockHeight,
	});
}

// ── build-swap ────────────────────────────────────────────────────────────────

const swapSchema = z.object({
	sender:      z.string(),
	inputMint:   z.string(),
	outputMint:  z.string(),
	amount:      z.number().positive(),
	slippageBps: z.number().int().min(1).max(5000).default(50),
	network:     z.enum(['mainnet']).default('mainnet'),
});

async function handleBuildSwap(req, res) {
	if (cors(req, res, { methods: 'POST,OPTIONS', credentials: true })) return;
	if (!method(req, res, ['POST'])) return;
	const user = await getSessionUser(req);
	if (!user) return error(res, 401, 'unauthorized', 'sign in required');
	const rl = await limits.authIp(clientIp(req));
	if (!rl.success) return error(res, 429, 'rate_limited', 'too many requests');

	const { sender, inputMint, outputMint, amount, slippageBps } = parse(swapSchema, await readJson(req));

	const connection  = new Connection(SOLANA_RPC_MAINNET, 'confirmed');
	const inputMintPk = new PublicKey(inputMint);
	const mintInfo    = await getMint(connection, inputMintPk);
	const amountInSmallestUnit = Math.round(amount * 10 ** mintInfo.decimals);

	const quoteUrl = `https://quote-api.jup.ag/v6/quote?inputMint=${inputMint}&outputMint=${outputMint}&amount=${amountInSmallestUnit}&slippageBps=${slippageBps}`;
	const quoteRes = await fetch(quoteUrl);
	if (!quoteRes.ok) return error(res, 422, 'no_route', 'No swap route found');
	const quoteResponse = await quoteRes.json();
	if (!quoteResponse || quoteResponse.error) return error(res, 422, 'no_route', 'No swap route found');

	const swapRes = await fetch('https://quote-api.jup.ag/v6/swap', {
		method:  'POST',
		headers: { 'Content-Type': 'application/json' },
		body:    JSON.stringify({ quoteResponse, userPublicKey: sender, wrapAndUnwrapSol: true }),
	});
	if (!swapRes.ok) return error(res, 422, 'swap_failed', 'Jupiter swap transaction fetch failed');
	const swapResponse = await swapRes.json();

	const outputMintInfo    = await getMint(connection, new PublicKey(outputMint));
	const outputDecimals    = outputMintInfo.decimals;

	return json(res, 200, {
		transaction:    swapResponse.swapTransaction,
		network:        'mainnet',
		inputAmount:    amount,
		outputAmount:   Number(quoteResponse.outAmount) / 10 ** outputDecimals,
		outputMint,
		priceImpactPct: quoteResponse.priceImpactPct,
	});
}

// ── router ────────────────────────────────────────────────────────────────────

const DISPATCH = { 'build-transfer': handleBuildTransfer, 'build-swap': handleBuildSwap };

export default wrap(async (req, res) => {
	const action = req.query?.action ?? new URL(req.url, 'http://x').pathname.split('/').pop();
	const fn = DISPATCH[action];
	if (!fn) return error(res, 404, 'not_found', `unknown action: ${action}`);
	return fn(req, res);
});
