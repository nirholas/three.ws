// Fixed-supply launches: the second Solana launch venue.
//
// The bonding-curve lane (api/pump/[action].js) prices every trade on a curve
// from the first buy. This lane does the opposite: the supply is fixed at 1B,
// a set allocation (5% to 50%) is sold in one 48-hour deposit window, and every
// depositor gets the same clearing price. If deposits reach the raise goal the
// launch graduates: a share of the raise seeds an AMM pool (liquidity_bps), the
// rest goes to the creator's funds wallet, and depositors claim their tokens.
// If the goal is missed, depositors withdraw. No curve, no sniping the first
// block, no dev buy.
//
// Venue choice (recorded per the build brief): the program is Metaplex Genesis,
// picked because it is maintained (SDK 0.43.0 published 2026-09-19), audited,
// Apache-2.0, and ships a public SDK plus a hosted transaction builder. The
// builder returns unsigned transactions with the mint already co-signed; the
// creator's wallet signs every one, and they must land in order. Nothing in
// this module holds a key: callers pass signed bytes, or a keypair for the
// custodial agent path.
//
// Measured shape (2026-09-22): five transactions, 415 to 1,091 bytes, the first
// co-signed by the mint. The venue rejects a raise goal under 250 SOL.

import { VersionedTransaction } from '@solana/web3.js';

import { getConnection } from './pump.js';
import { confirmOrThrow } from './solana/confirm.js';

export const FIXED_TOTAL_SUPPLY = 1_000_000_000;
export const FIXED_LIMITS = Object.freeze({
	allocation_min: 50_000_000,
	allocation_max: 500_000_000,
	allocation_default: 500_000_000,
	raise_goal_min_sol: 250,
	liquidity_bps_min: 2000,
	liquidity_bps_max: 10_000,
	liquidity_bps_default: 5000,
	deposit_window_hours: 48,
	// The deposit window may open at most this far ahead.
	max_start_delay_days: 30,
});

// Eligibility floor for the creator wallet. The first transaction (mint,
// metadata and launch account) simulated on mainnet at 19,348,601 lamports on
// 2026-09-22; the other four add the sale buckets and cannot be simulated in
// advance because they read accounts the first one creates. The floor is about
// three times the first transaction so a launch never stalls halfway for rent.
// Override with FIXED_LAUNCH_COST_LAMPORTS if the venue's account sizes change.
export const FIXED_LAUNCH_COST_LAMPORTS = Number(process.env.FIXED_LAUNCH_COST_LAMPORTS) || 60_000_000;

export class FixedLaunchError extends Error {
	constructor(status, code, message) {
		super(message);
		this.status = status;
		this.code = code;
	}
}

const venueNetwork = (network) => (network === 'devnet' ? 'solana-devnet' : 'solana-mainnet');

function apiConfig() {
	const baseUrl = String(process.env.FIXED_LAUNCH_API_URL || '').trim();
	return baseUrl ? { baseUrl } : {};
}

async function loadSdk() {
	const [{ createUmi }, umiCore, gen] = await Promise.all([
		import('@metaplex-foundation/umi-bundle-defaults'),
		import('@metaplex-foundation/umi'),
		import('@metaplex-foundation/genesis'),
	]);
	return { createUmi, umiCore, gen };
}

/** A umi instance whose identity is the given wallet, with no signing ability. */
async function umiFor(network, wallet) {
	const { createUmi, umiCore, gen } = await loadSdk();
	const rpc = getConnection({ network }).rpcEndpoint;
	const umi = createUmi(rpc).use(gen.genesis());
	const signer = umiCore.createNoopSigner(umiCore.publicKey(wallet));
	umi.use(umiCore.signerIdentity(signer));
	return { umi, gen, umiCore };
}

/**
 * Validate and normalize a fixed-supply launch request. Pure: tests pin every
 * bound without the network.
 */
export function normalizeFixedLaunch(input, now = Date.now()) {
	const name = String(input.name || '').trim();
	const symbol = String(input.symbol || '').trim().toUpperCase();
	if (name.length < 1 || name.length > 32) throw new FixedLaunchError(400, 'validation_error', 'name must be 1 to 32 characters');
	if (symbol.length < 1 || symbol.length > 10) throw new FixedLaunchError(400, 'validation_error', 'symbol must be 1 to 10 characters');
	const description = input.description ? String(input.description).trim().slice(0, 250) : undefined;
	let image;
	try {
		image = new URL(String(input.image_url || input.image || ''));
	} catch {
		throw new FixedLaunchError(400, 'validation_error', 'image_url must be an https URL');
	}
	if (image.protocol !== 'https:' || !/^([a-z0-9-]+\.)+[a-z]{2,}$/i.test(image.hostname)) {
		throw new FixedLaunchError(400, 'validation_error', 'image_url must be an https URL on a domain');
	}
	const L = FIXED_LIMITS;
	const allocation = Math.round(Number(input.token_allocation ?? L.allocation_default));
	if (!(allocation >= L.allocation_min && allocation <= L.allocation_max)) {
		throw new FixedLaunchError(400, 'validation_error', `token_allocation must be between ${L.allocation_min} and ${L.allocation_max} (5% to 50% of the 1B supply)`);
	}
	const raiseGoal = Number(input.raise_goal_sol ?? L.raise_goal_min_sol);
	if (!(raiseGoal >= L.raise_goal_min_sol && raiseGoal <= 1_000_000)) {
		throw new FixedLaunchError(400, 'validation_error', `raise_goal_sol must be at least ${L.raise_goal_min_sol} SOL`);
	}
	const liquidityBps = Math.round(Number(input.liquidity_bps ?? L.liquidity_bps_default));
	if (!(liquidityBps >= L.liquidity_bps_min && liquidityBps <= L.liquidity_bps_max)) {
		throw new FixedLaunchError(400, 'validation_error', 'liquidity_bps must be between 2000 and 10000');
	}
	// Default: the window opens 10 minutes out, long enough for the create
	// transactions to land and the launch to be registered before deposits open.
	const start = input.deposit_start_at ? new Date(input.deposit_start_at) : new Date(now + 10 * 60_000);
	if (Number.isNaN(start.getTime())) throw new FixedLaunchError(400, 'validation_error', 'deposit_start_at must be an ISO date');
	if (start.getTime() < now + 2 * 60_000) throw new FixedLaunchError(400, 'validation_error', 'deposit_start_at must be at least 2 minutes from now');
	if (start.getTime() > now + L.max_start_delay_days * 86_400_000) {
		throw new FixedLaunchError(400, 'validation_error', `deposit_start_at must be within ${L.max_start_delay_days} days`);
	}
	const end = new Date(start.getTime() + L.deposit_window_hours * 3_600_000);
	return { name, symbol, description, image_url: image.toString(), token_allocation: allocation, raise_goal_sol: raiseGoal, liquidity_bps: liquidityBps, deposit_start_at: start.toISOString(), deposit_end_at: end.toISOString() };
}

/** The venue's create input, JSON-safe so it can be stored with the prep and replayed at registration. */
export function venueInput({ network, wallet, fundsRecipient, launch }) {
	return {
		wallet,
		network: venueNetwork(network),
		launchType: 'launchpool',
		quoteMint: 'SOL',
		token: {
			name: launch.name,
			symbol: launch.symbol,
			image: launch.image_url,
			...(launch.description ? { description: launch.description } : {}),
		},
		launch: {
			launchpool: {
				tokenAllocation: launch.token_allocation,
				depositStartTime: launch.deposit_start_at,
				raiseGoal: launch.raise_goal_sol,
				raydiumLiquidityBps: launch.liquidity_bps,
				fundsRecipient,
			},
		},
	};
}

/**
 * Ask the venue for the unsigned create transactions.
 * @returns {Promise<{ transactions_base64: string[], mint: string, genesis_account: string, blockhash: object, input: object }>}
 */
export async function prepareFixedLaunch({ network = 'mainnet', wallet, fundsRecipient, launch }) {
	const { umi, gen } = await umiFor(network, wallet);
	const input = venueInput({ network, wallet, fundsRecipient: fundsRecipient || wallet, launch });
	let created;
	try {
		created = await gen.createLaunch(umi, apiConfig(), input);
	} catch (err) {
		const detail = err?.responseBody?.details?.map?.((d) => d.message).join('; ');
		const status = err?.statusCode >= 400 && err?.statusCode < 500 ? 422 : 502;
		throw new FixedLaunchError(status, 'venue_rejected', `The fixed-supply venue refused the launch: ${detail || err?.message || 'unknown error'}`);
	}
	return {
		transactions_base64: created.transactions.map((tx) => Buffer.from(umi.transactions.serialize(tx)).toString('base64')),
		mint: created.mintAddress,
		genesis_account: created.genesisAccount,
		blockhash: created.blockhash,
		input,
	};
}

/** Every prepared transaction must be signable by the creator and create the prepared mint. */
export function inspectPreparedTransactions(transactionsBase64, { wallet, mint }) {
	const txs = transactionsBase64.map((b64) => VersionedTransaction.deserialize(Buffer.from(b64, 'base64')));
	txs.forEach((tx, i) => {
		const n = tx.message.header.numRequiredSignatures;
		const signers = tx.message.staticAccountKeys.slice(0, n).map((k) => k.toBase58());
		if (signers[0] !== wallet) throw new FixedLaunchError(422, 'unexpected_fee_payer', `transaction ${i + 1} is not fee-paid by the creator wallet`);
	});
	const allKeys = new Set(txs.flatMap((tx) => tx.message.staticAccountKeys.map((k) => k.toBase58())));
	if (!allKeys.has(mint)) throw new FixedLaunchError(422, 'mint_not_in_tx', 'the prepared transactions do not create the prepared mint');
	return txs;
}

/** Sign every prepared transaction with a server-held keypair (the custodial agent path). */
export function signPreparedTransactions(transactionsBase64, keypair) {
	return transactionsBase64.map((b64) => {
		const tx = VersionedTransaction.deserialize(Buffer.from(b64, 'base64'));
		tx.sign([keypair]);
		return Buffer.from(tx.serialize()).toString('base64');
	});
}

/**
 * Land signed transactions strictly in order, each confirmed before the next.
 * A later transaction depends on accounts an earlier one creates.
 * @returns {Promise<string[]>} signatures
 */
export async function submitInOrder({ network, signedBase64, connection = null }) {
	const conn = connection || getConnection({ network });
	const signatures = [];
	for (const [i, b64] of signedBase64.entries()) {
		const tx = VersionedTransaction.deserialize(Buffer.from(b64, 'base64'));
		const n = tx.message.header.numRequiredSignatures;
		if (tx.signatures.slice(0, n).some((sig) => sig.every((b) => b === 0))) {
			throw new FixedLaunchError(400, 'missing_signature', `transaction ${i + 1} is missing a required signature`);
		}
		let signature;
		try {
			signature = await conn.sendRawTransaction(tx.serialize(), { skipPreflight: false, preflightCommitment: 'confirmed', maxRetries: 3 });
			await confirmOrThrow(conn, signature, 'confirmed');
		} catch (err) {
			throw Object.assign(new FixedLaunchError(502, 'submit_failed', `transaction ${i + 1} of ${signedBase64.length} did not land: ${err?.message || err}`), { landed: signatures });
		}
		signatures.push(signature);
	}
	return signatures;
}

/** Both the mint and the launch account must exist on-chain before a launch is recorded. */
export async function verifyFixedLaunchOnChain({ network, mint, genesisAccount, connection = null }) {
	const conn = connection || getConnection({ network });
	const { PublicKey } = await import('@solana/web3.js');
	const [mintInfo, genesisInfo] = await conn.getMultipleAccountsInfo([new PublicKey(mint), new PublicKey(genesisAccount)], 'confirmed');
	if (!mintInfo) throw new FixedLaunchError(422, 'mint_missing', 'the mint account does not exist on-chain');
	if (!genesisInfo) throw new FixedLaunchError(422, 'launch_account_missing', 'the launch account does not exist on-chain');
	return true;
}

/**
 * Register the landed launch with the venue so it appears on the venue's own
 * sale page. A registration failure never undoes a landed launch: the caller
 * records the launch and reports venue_url as null.
 */
export async function registerFixedLaunch({ network, wallet, genesisAccount, input }) {
	try {
		const { umi, gen } = await umiFor(network, wallet);
		const result = await gen.registerLaunch(umi, apiConfig(), { genesisAccount, createLaunchInput: input, creatorWallet: wallet });
		return { venue_url: result?.launch?.link || null, error: null };
	} catch (err) {
		return { venue_url: null, error: err?.message || 'registration failed' };
	}
}

/** Eligibility for the fixed venue: balance for rent + fees on the creator wallet. */
export async function fixedEligibility({ network, wallet, connection = null }) {
	const reasons = [];
	let lamports = null;
	if (wallet) {
		try {
			lamports = await (connection || getConnection({ network })).getBalance(new (await import('@solana/web3.js')).PublicKey(wallet));
		} catch (err) {
			reasons.push({ code: 'rpc_unavailable', message: `Could not read the wallet balance: ${err?.message || 'RPC error'}.` });
		}
		if (lamports != null && lamports < FIXED_LAUNCH_COST_LAMPORTS) {
			reasons.push({
				code: 'insufficient_sol',
				message: `The creator wallet holds ${(lamports / 1e9).toFixed(4)} SOL; a fixed-supply launch needs about ${(FIXED_LAUNCH_COST_LAMPORTS / 1e9).toFixed(3)} SOL for rent and fees. Fixed-supply launches are not sponsored.`,
			});
		}
	}
	return { eligible: reasons.length === 0, reasons, wallet_lamports: lamports, required_lamports: FIXED_LAUNCH_COST_LAMPORTS };
}

// ── Launch flows ───────────────────────────────────────────────────────────
//
// Everything that names the venue's own identifiers stays in this module; the
// launch service (api/_lib/launch-service.js) and the routes speak only of a
// "launch account", which is what the venue calls its per-launch state account.

/**
 * The venue builder's transactions for a creator wallet, inspected: every one
 * is fee-paid by the creator and together they create the prepared mint.
 * @returns {Promise<{ transactions_base64: string[], mint: string, launch_account: string, input: object }>}
 */
export async function prepareFixedForWallet({ network = 'mainnet', wallet, fundsRecipient = null, launch }) {
	const prepared = await prepareFixedLaunch({ network, wallet, fundsRecipient, launch });
	inspectPreparedTransactions(prepared.transactions_base64, { wallet, mint: prepared.mint });
	return {
		transactions_base64: prepared.transactions_base64,
		mint: prepared.mint,
		launch_account: prepared.genesis_account,
		input: prepared.input,
	};
}

/**
 * A wallet-signed set must be exactly the prepared set: same count, and each
 * message byte-identical to what the venue built. A wallet can only add its
 * signature; any other change is refused before anything is broadcast.
 */
export function assertSignedMatchesPrepared(preparedBase64, signedBase64) {
	if (!Array.isArray(signedBase64) || signedBase64.length !== preparedBase64.length) {
		throw new FixedLaunchError(400, 'transaction_count_mismatch', `expected ${preparedBase64.length} signed transactions, got ${Array.isArray(signedBase64) ? signedBase64.length : 0}`);
	}
	preparedBase64.forEach((b64, i) => {
		let signed;
		try {
			signed = VersionedTransaction.deserialize(Buffer.from(signedBase64[i], 'base64'));
		} catch {
			throw new FixedLaunchError(400, 'validation_error', `signed transaction ${i + 1} is not a serialized versioned transaction`);
		}
		const prepared = VersionedTransaction.deserialize(Buffer.from(b64, 'base64'));
		const a = Buffer.from(prepared.message.serialize());
		const b = Buffer.from(signed.message.serialize());
		if (!a.equals(b)) throw new FixedLaunchError(422, 'transaction_modified', `signed transaction ${i + 1} differs from the prepared one`);
	});
}

/**
 * Land a signed launch, prove it on-chain, and register it with the venue.
 * @returns {Promise<{ signatures: string[], venue_url: string|null, registration_error: string|null }>}
 */
export async function landFixedLaunch({ network = 'mainnet', signedBase64, mint, launchAccount, wallet, input }) {
	const signatures = await submitInOrder({ network, signedBase64 });
	await verifyFixedLaunchOnChain({ network, mint, genesisAccount: launchAccount });
	const reg = await registerFixedLaunch({ network, wallet, genesisAccount: launchAccount, input });
	return { signatures, venue_url: reg.venue_url, registration_error: reg.error };
}

/**
 * The custodial path: build, sign with a server-held keypair, land, register.
 * @returns {Promise<{ mint: string, launch_account: string, signatures: string[], venue_url: string|null, registration_error: string|null }>}
 */
export async function launchFixedWithKeypair({ network = 'mainnet', keypair, fundsRecipient = null, launch }) {
	const wallet = keypair.publicKey.toBase58();
	const prepared = await prepareFixedForWallet({ network, wallet, fundsRecipient, launch });
	const signed = signPreparedTransactions(prepared.transactions_base64, keypair);
	const landed = await landFixedLaunch({
		network,
		signedBase64: signed,
		mint: prepared.mint,
		launchAccount: prepared.launch_account,
		wallet,
		input: prepared.input,
	});
	return { mint: prepared.mint, launch_account: prepared.launch_account, ...landed };
}

/** Record a landed fixed-supply launch; the directory and agent profiles read this table. */
export async function recordFixedLaunch({ userId, agentId = null, network = 'mainnet', mint, launchAccount, launch, creator, signatures, venueUrl = null }) {
	const [row] = await sql`
		INSERT INTO fixed_supply_launches
			(agent_id, user_id, network, mint, genesis_account, name, symbol, image_url, description, creator_address,
			 token_allocation, raise_goal_sol, liquidity_bps, deposit_start_at, deposit_end_at, signatures, venue_url)
		VALUES
			(${agentId}, ${userId}, ${network}, ${mint}, ${launchAccount}, ${launch.name}, ${launch.symbol}, ${launch.image_url},
			 ${launch.description || null}, ${creator}, ${launch.token_allocation}, ${launch.raise_goal_sol}, ${launch.liquidity_bps},
			 ${launch.deposit_start_at}, ${launch.deposit_end_at}, ${JSON.stringify(signatures)}::jsonb, ${venueUrl})
		ON CONFLICT (mint, network) DO NOTHING
		RETURNING id, mint, network, created_at
	`;
	return row || null;
}

/** One fixed-supply launch by mint, with the launch account under its neutral name. */
export async function getFixedLaunch({ mint, network = 'mainnet' }) {
	const [row] = await sql`
		SELECT f.id, f.agent_id, f.user_id, f.network, f.mint, f.genesis_account AS launch_account, f.name, f.symbol,
		       f.image_url, f.description, f.creator_address, f.token_allocation, f.raise_goal_sol, f.liquidity_bps,
		       f.deposit_start_at, f.deposit_end_at, f.signatures, f.venue_url, f.created_at
		FROM fixed_supply_launches f
		WHERE f.mint = ${mint} AND f.network = ${network}
		LIMIT 1
	`;
	return row || null;
}
