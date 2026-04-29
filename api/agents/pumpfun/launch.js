// POST /api/agents/:id/pumpfun/launch
// Create a new pump.fun token whose creator is the agent's Solana wallet.
// Optional `solAmount` immediately buys an initial supply for the agent.
//
// Body: { name, symbol, uri, solAmount?, network? }
//   - uri: already-hosted JSON metadata URL (caller is responsible for upload)
//   - solAmount: optional initial buy in SOL (decimal); creates+buys atomically
//   - network: 'mainnet' | 'devnet' (default mainnet)
//
// The agent signs as creator/user. A fresh mint Keypair is generated and also
// signs the create transaction. We return the new mint, transaction signature,
// and explorer URL.

import { getSessionUser, authenticateBearer, extractBearer } from '../../_lib/auth.js';
import { cors, json, method, readJson, error } from '../../_lib/http.js';
import { limits, clientIp } from '../../_lib/rate-limit.js';
import { loadAgentForSigning, solanaConnection } from '../../_lib/agent-pumpfun.js';
import { grindMintKeypair } from '../../_lib/pump-vanity.js';
import { sql } from '../../_lib/db.js';
import { Keypair, Transaction, SystemProgram } from '@solana/web3.js';
import { z } from 'zod';

const bodySchema = z.object({
	name: z.string().trim().min(1).max(32),
	symbol: z.string().trim().min(1).max(10),
	uri: z.string().url().max(2048),
	solAmount: z.number().nonnegative().max(1000).optional(),
	tokenAmount: z.number().nonnegative().optional(),
	vanityPrefix: z.string().min(1).max(6).optional(),
	network: z.enum(['mainnet', 'devnet']).default('mainnet'),
});

async function resolveAuth(req) {
	const session = await getSessionUser(req);
	if (session) return { userId: session.id };
	const bearer = await authenticateBearer(extractBearer(req));
	if (bearer) return { userId: bearer.userId };
	return null;
}

export default async function handler(req, res, id) {
	if (cors(req, res, { methods: 'POST,OPTIONS', credentials: true })) return;
	if (!method(req, res, ['POST'])) return;

	const auth = await resolveAuth(req);
	if (!auth) return error(res, 401, 'unauthorized', 'sign in required');
	const rl = await limits.authIp(clientIp(req));
	if (!rl.success) return error(res, 429, 'rate_limited', 'too many requests');

	let body;
	try {
		body = bodySchema.parse(await readJson(req));
	} catch (e) {
		return error(res, 400, 'validation_error', e.errors?.[0]?.message || 'invalid body');
	}

	const loaded = await loadAgentForSigning(id, auth.userId);
	if (loaded.error) return error(res, loaded.error.status, loaded.error.code, loaded.error.msg);
	const { keypair } = loaded;

	const { PumpSdk, OnlinePumpSdk } = await import('@pump-fun/pump-sdk');
	const BN = (await import('bn.js')).default;
	const conn = solanaConnection(body.network);
	const online = new OnlinePumpSdk(conn);
	const sdk = new PumpSdk();

	let mint;
	let vanityIterations = 1;
	try {
		const ground = grindMintKeypair({ prefix: body.vanityPrefix });
		mint = ground.keypair;
		vanityIterations = ground.iterations;
	} catch (err) {
		return error(res, err.status || 500, err.code || 'internal', err.message);
	}
	const solLamports = new BN(Math.floor((body.solAmount || 0) * 1e9));
	const tokenAmount = new BN(body.tokenAmount || 0);

	let instructions;
	if (solLamports.gtn(0)) {
		const global = await online.fetchGlobal();
		instructions = await sdk.createV2AndBuyInstructions({
			global,
			mint: mint.publicKey,
			name: body.name,
			symbol: body.symbol,
			uri: body.uri,
			creator: keypair.publicKey,
			user: keypair.publicKey,
			amount: tokenAmount,
			solAmount: solLamports,
			mayhemMode: false,
		});
	} else {
		const ix = await sdk.createV2Instruction({
			mint: mint.publicKey,
			name: body.name,
			symbol: body.symbol,
			uri: body.uri,
			creator: keypair.publicKey,
			user: keypair.publicKey,
			mayhemMode: false,
		});
		instructions = [ix];
	}

	const tx = new Transaction().add(...instructions);
	tx.feePayer = keypair.publicKey;
	const { blockhash } = await conn.getLatestBlockhash();
	tx.recentBlockhash = blockhash;
	tx.sign(keypair, mint);

	let signature;
	try {
		signature = await conn.sendRawTransaction(tx.serialize(), { skipPreflight: false });
		await conn.confirmTransaction(signature, 'confirmed');
	} catch (err) {
		console.error('[pumpfun/launch] send failed', err);
		return error(res, 502, 'rpc_error', err.message || 'transaction failed');
	}

	await sql`
		INSERT INTO agent_actions (agent_id, type, payload, source_skill)
		VALUES (
			${id},
			${'pumpfun.launch'},
			${JSON.stringify({
				mint: mint.publicKey.toBase58(),
				name: body.name,
				symbol: body.symbol,
				uri: body.uri,
				signature,
				network: body.network,
				vanity_prefix: body.vanityPrefix || null,
				vanity_iterations: vanityIterations,
			})}::jsonb,
			${'pumpfun'}
		)
	`.catch((e) => console.error('[pumpfun/launch] log failed', e));

	return json(res, 201, {
		data: {
			mint: mint.publicKey.toBase58(),
			signature,
			explorer: `https://solscan.io/tx/${signature}${body.network === 'devnet' ? '?cluster=devnet' : ''}`,
			pumpfun_url: `https://pump.fun/${mint.publicKey.toBase58()}`,
			vanity_prefix: body.vanityPrefix || null,
			vanity_iterations: vanityIterations,
		},
	});
}
