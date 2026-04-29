// Shared adapter for the four official @pump-fun/* SDKs.
// Lazy-loaded — Vercel cold starts pay only for what an endpoint touches.
//
// Public surface:
//   getConnection({ network })            → @solana/web3.js Connection
//   getPumpSdk({ network })                → { sdk: PumpSdk|OnlinePumpSdk, BN, web3 }
//   getPumpSwapSdk({ network })            → { sdk: PumpAmmSdk, BN, web3 }
//   getPumpAgent({ network, mint })        → { agent: PumpAgent, BN, web3, agentPda }
//   getPumpAgentOffline({ network, mint }) → instruction-only PumpAgentOffline
//   verifySignature(network, sig)          → confirmed parsed tx, throws on missing/failed
//   solanaPubkey(s)                        → PublicKey or null
//
// Network selection: 'mainnet' | 'devnet'. Endpoint URLs come from env so
// production can pin Helius / Triton / etc. RPC providers.

import { Connection, PublicKey } from '@solana/web3.js';

const RPC_MAINNET = () =>
	process.env.SOLANA_RPC_URL || 'https://api.mainnet-beta.solana.com';
const RPC_DEVNET = () =>
	process.env.SOLANA_RPC_URL_DEVNET || 'https://api.devnet.solana.com';

export function getConnection({ network = 'mainnet', commitment = 'confirmed' } = {}) {
	const url = network === 'devnet' ? RPC_DEVNET() : RPC_MAINNET();
	return new Connection(url, commitment);
}

export function solanaPubkey(s) {
	if (!s) return null;
	try {
		return new PublicKey(s);
	} catch {
		return null;
	}
}

export async function getPumpSdk({ network = 'mainnet' } = {}) {
	const [{ PumpSdk, OnlinePumpSdk }, web3, BN] = await Promise.all([
		import('@pump-fun/pump-sdk'),
		import('@solana/web3.js'),
		import('bn.js').then((m) => m.default || m),
	]);
	const connection = getConnection({ network });
	const sdk = new OnlinePumpSdk
		? new OnlinePumpSdk(connection)
		: new PumpSdk(connection);
	return { sdk, connection, BN, web3, PumpSdk, OnlinePumpSdk };
}

export async function getPumpSwapSdk({ network = 'mainnet' } = {}) {
	const [{ PumpAmmSdk, PumpAmmInternalSdk }, web3, BN] = await Promise.all([
		import('@pump-fun/pump-swap-sdk'),
		import('@solana/web3.js'),
		import('bn.js').then((m) => m.default || m),
	]);
	const connection = getConnection({ network });
	const sdk = new PumpAmmSdk(connection);
	const internalSdk = new PumpAmmInternalSdk ? new PumpAmmInternalSdk(connection) : null;
	return { sdk, internalSdk, connection, BN, web3 };
}

export async function getPumpAgent({ network = 'mainnet', mint } = {}) {
	if (!mint) throw Object.assign(new Error('mint required'), { status: 400 });
	const [
		{ PumpAgent, getTokenAgentPaymentsPDA },
		web3,
		BN,
	] = await Promise.all([
		import('@pump-fun/agent-payments-sdk'),
		import('@solana/web3.js'),
		import('bn.js').then((m) => m.default || m),
	]);
	const connection = getConnection({ network });
	const mintPk = mint instanceof PublicKey ? mint : new PublicKey(mint);
	// PumpAgent is an Anchor-backed online SDK. Construction signature can
	// shift between 3.x patches; pass connection + mint and let it error if not.
	const agent = new PumpAgent(mintPk, connection);
	const [agentPda] = getTokenAgentPaymentsPDA
		? getTokenAgentPaymentsPDA(mintPk)
		: [null];
	return { agent, connection, BN, web3, agentPda };
}

export async function getPumpAgentOffline({ network = 'mainnet', mint } = {}) {
	if (!mint) throw Object.assign(new Error('mint required'), { status: 400 });
	const [
		{ PumpAgentOffline, getTokenAgentPaymentsPDA, getInvoiceIdPDA },
		web3,
		BN,
	] = await Promise.all([
		import('@pump-fun/agent-payments-sdk'),
		import('@solana/web3.js'),
		import('bn.js').then((m) => m.default || m),
	]);
	const mintPk = mint instanceof PublicKey ? mint : new PublicKey(mint);
	const offline = PumpAgentOffline.load
		? PumpAgentOffline.load(mintPk, getConnection({ network }))
		: new PumpAgentOffline(mintPk);
	const [agentPda] = getTokenAgentPaymentsPDA
		? getTokenAgentPaymentsPDA(mintPk)
		: [null];
	return { offline, getInvoiceIdPDA, BN, web3, agentPda };
}

// Confirm a signature on-chain. Returns the parsed tx (versioned-aware).
// Throws { status: 422, code } on failure so handlers can `try/catch`.
export async function verifySignature({ network, signature }) {
	const connection = getConnection({ network });
	let tx;
	try {
		tx = await connection.getParsedTransaction(signature, {
			maxSupportedTransactionVersion: 0,
			commitment: 'confirmed',
		});
	} catch {
		const e = new Error('transaction not found');
		e.status = 422;
		e.code = 'tx_not_found';
		throw e;
	}
	if (!tx) {
		const e = new Error('transaction not found');
		e.status = 422;
		e.code = 'tx_not_found';
		throw e;
	}
	if (tx.meta?.err) {
		const e = new Error('transaction failed on-chain');
		e.status = 422;
		e.code = 'tx_failed';
		throw e;
	}
	return tx;
}

// Resolve the canonical pump.fun AMM pool for `mint` (post-graduation) and
// return everything `buyQuoteInput` / `sellBaseInput` need to price a swap.
// Quote currency is WSOL on the canonical pool.
//
// Throws { status: 404, code: 'pool_not_found' } if no pool exists yet.
export async function getAmmPoolState({ network = 'mainnet', mint } = {}) {
	if (!mint) throw Object.assign(new Error('mint required'), { status: 400 });
	const [
		{
			canonicalPumpPoolPda,
			OnlinePumpAmmSdk,
			PumpAmmSdk,
		},
		web3,
		BN,
		spl,
	] = await Promise.all([
		import('@pump-fun/pump-swap-sdk'),
		import('@solana/web3.js'),
		import('bn.js').then((m) => m.default || m),
		import('@solana/spl-token'),
	]);
	const connection = getConnection({ network });
	const mintPk = mint instanceof PublicKey ? mint : new PublicKey(mint);
	const poolKey = canonicalPumpPoolPda(mintPk);

	const online = new OnlinePumpAmmSdk(connection);
	let pool;
	try {
		pool = await online.fetchPool(poolKey);
	} catch {
		const e = new Error('pump.fun AMM pool not found for mint');
		e.status = 404;
		e.code = 'pool_not_found';
		throw e;
	}

	const [baseAccInfo, quoteAccInfo, baseMintInfo] = await Promise.all([
		connection.getAccountInfo(pool.poolBaseTokenAccount),
		connection.getAccountInfo(pool.poolQuoteTokenAccount),
		connection.getAccountInfo(pool.baseMint),
	]);
	if (!baseAccInfo || !quoteAccInfo || !baseMintInfo) {
		const e = new Error('pool token accounts unavailable');
		e.status = 502;
		e.code = 'pool_accounts_missing';
		throw e;
	}
	const baseAcc = spl.AccountLayout.decode(baseAccInfo.data);
	const quoteAcc = spl.AccountLayout.decode(quoteAccInfo.data);
	const baseMintAccount = spl.MintLayout.decode(baseMintInfo.data);
	const baseReserve = new BN(baseAcc.amount.toString());
	const quoteReserve = new BN(quoteAcc.amount.toString());

	const offline = new PumpAmmSdk();
	const [globalConfigInfo, feeConfigInfo] = await Promise.all([
		connection.getAccountInfo(
			(await import('@pump-fun/pump-swap-sdk')).GLOBAL_CONFIG_PDA,
		),
		connection.getAccountInfo(
			(await import('@pump-fun/pump-swap-sdk')).PUMP_AMM_FEE_CONFIG_PDA,
		),
	]);
	const globalConfig = globalConfigInfo
		? offline.decodeGlobalConfig(globalConfigInfo)
		: null;
	const feeConfig = feeConfigInfo ? offline.decodeFeeConfig(feeConfigInfo) : null;

	return {
		connection,
		poolKey,
		pool,
		baseReserve,
		quoteReserve,
		baseMintAccount,
		globalConfig,
		feeConfig,
		BN,
		web3,
	};
}

// Build a versioned tx from a list of instructions, return base64 (unsigned).
// Mirrors the pattern used in api/agents/solana-register-prep.js so frontends
// can decode via VersionedTransaction.deserialize and submit via injected wallet.
export async function buildUnsignedTxBase64({ network, payer, instructions }) {
	const [{ TransactionMessage, VersionedTransaction, PublicKey: PK }] = await Promise.all([
		import('@solana/web3.js'),
	]);
	const connection = getConnection({ network });
	const { blockhash } = await connection.getLatestBlockhash('confirmed');
	const payerPk = payer instanceof PK ? payer : new PK(payer);
	const msg = new TransactionMessage({
		payerKey: payerPk,
		recentBlockhash: blockhash,
		instructions,
	}).compileToV0Message();
	const vtx = new VersionedTransaction(msg);
	return Buffer.from(vtx.serialize()).toString('base64');
}
