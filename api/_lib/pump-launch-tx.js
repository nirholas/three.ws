// Transaction assembly for pump.fun coin launches.
//
// A launch is the biggest transaction three.ws asks a wallet to sign: the
// createV2 + dev-buy instructions alone measured 1,229 bytes against Solana's
// 1,232-byte legacy limit with a 32-char name (mainnet, 2026-09-16), so anything
// appended (the three.ws launch fee, a USDC-quote transfer) overflowed. Two
// tools keep every launch inside a packet:
//
//   1. pump.fun's published address lookup table. Compiling the v0 message
//      against it replaces the repeated program/global/fee accounts with 1-byte
//      indexes: the same SOL launch drops to 984 bytes, leaving room for the fee.
//   2. Solana transaction v1 (feature txv1aq4…, active on mainnet since slot
//      447,120,000). A 4,096-byte envelope with explicit resource limits. It has
//      no lookup tables, but at 4 KB it fits every launch shape we build,
//      including the USDC-quoted ones that overflow v0 even with the table.
//
// `buildLaunchTransaction` picks between them: v0 + lookup table when it fits
// (widest wallet support), v1 when the caller asked for it or when v0 overflows
// and the wallet advertised v1 signing. Mint co-signatures are applied here, so
// the browser only has to add the wallet's own signature.

import {
	AddressLookupTableAccount,
	PublicKey,
	TransactionMessage,
	VersionedTransaction,
} from '@solana/web3.js';
import { ed25519 } from '@noble/curves/ed25519.js';
import { getConnection } from './pump.js';
import { isRpcOutageError, rpcUnavailableError } from './rpc-degrade.js';
import {
	buildPartiallySignedV1Transaction,
	decodeFeatureActivationSlot,
	LEGACY_TRANSACTION_LIMIT,
	TX_V1_FEATURE_ADDRESS,
	V1_TRANSACTION_LIMIT,
} from './solana/transaction-v1.js';

// Published by pump.fun for its own create/trade transactions.
export const PUMP_LOOKUP_TABLES = Object.freeze({
	mainnet: '7mFD2mUtRS65XstiSAvCJuYmdesZoQwCwRJhq1p3eRMe',
	devnet: '7y3623xaVQzsLxHRyp1wQD4Pmer5JjgbaagGFAEqCjua',
});

// A simulated createV2 + dev buy + fee transfer consumed ~205k CU and loaded
// 14.4 MB of account data on mainnet. v1 carries these as hard caps (an unset
// cap is zero, not a default), so leave real headroom on both.
export const LAUNCH_V1_CONFIG = Object.freeze({
	computeUnitLimit: 400_000,
	loadedAccountsDataSizeLimit: 32 * 1024 * 1024,
	priorityFeeLamports: 10_000n,
});

const ALT_TTL_MS = 10 * 60_000;
const altCache = new Map(); // network -> { at, tables }

/**
 * The pump.fun lookup table(s) for a network. An RPC miss returns [] so a
 * launch degrades to an un-tabled v0 message instead of failing outright.
 * @returns {Promise<AddressLookupTableAccount[]>}
 */
export async function getPumpLookupTables({ network = 'mainnet' } = {}) {
	const hit = altCache.get(network);
	if (hit && Date.now() - hit.at < ALT_TTL_MS) return hit.tables;
	const key = PUMP_LOOKUP_TABLES[network];
	let tables = [];
	if (key) {
		try {
			const { value } = await getConnection({ network }).getAddressLookupTable(new PublicKey(key));
			if (value) tables = [new AddressLookupTableAccount({ key: value.key, state: value.state })];
		} catch (err) {
			console.warn('[pump-launch-tx] lookup table fetch failed', network, err?.message);
		}
	}
	altCache.set(network, { at: Date.now(), tables });
	return tables;
}

/**
 * The PumpAgent program rejects new agents: `create` fails with custom error
 * 6015 AgentInitializationNotSupported (simulated on mainnet 2026-09-16). Every
 * launch that appended it reverted, so the buyback binding is off unless an
 * operator confirms the program accepts it again and sets
 * PUMP_AGENT_INIT_ENABLED=1.
 */
export function pumpAgentBuybackAvailable() {
	const v = String(process.env.PUMP_AGENT_INIT_ENABLED || '').trim().toLowerCase();
	return v === '1' || v === 'true';
}

const v1StatusCache = new Map(); // network -> { at, status }
const V1_STATUS_TTL_MS = 5 * 60_000;

/**
 * Whether the transaction-v1 feature is active on a cluster, read from the
 * feature account itself rather than assumed.
 * @returns {Promise<{ active: boolean, activation_slot: number|null }>}
 */
export async function transactionV1Status({ network = 'mainnet' } = {}) {
	const hit = v1StatusCache.get(network);
	if (hit && Date.now() - hit.at < V1_STATUS_TTL_MS) return hit.status;
	let status = { active: false, activation_slot: null };
	try {
		const info = await getConnection({ network }).getAccountInfo(new PublicKey(TX_V1_FEATURE_ADDRESS));
		const slot = info ? decodeFeatureActivationSlot(info.data) : null;
		status = { active: slot != null, activation_slot: slot };
	} catch (err) {
		// Unknown is reported as inactive and not cached, so the next read retries.
		console.warn('[pump-launch-tx] v1 feature read failed', network, err?.message);
		return status;
	}
	v1StatusCache.set(network, { at: Date.now(), status });
	return status;
}

function launchTooLarge(message) {
	return Object.assign(new Error(message), { status: 413, code: 'launch_payload_too_large' });
}

function kitSigner(keypair) {
	const seed = keypair.secretKey.slice(0, 32);
	return {
		publicKey: keypair.publicKey.toBase58(),
		signMessage: async (bytes) => ed25519.sign(bytes, seed),
	};
}

async function latestBlockhash(connection) {
	try {
		return await connection.getLatestBlockhash('confirmed');
	} catch (err) {
		if (isRpcOutageError(err)) {
			throw rpcUnavailableError('could not fetch a recent blockhash: Solana RPC is temporarily unavailable', err);
		}
		throw err;
	}
}

/**
 * Compile a launch transaction for a browser wallet to sign.
 *
 * @param {object} o
 * @param {'mainnet'|'devnet'} o.network
 * @param {PublicKey} o.payer                 the wallet that signs and pays
 * @param {import('@solana/web3.js').TransactionInstruction[]} o.instructions
 * @param {'auto'|0|1} [o.transactionVersion] 'auto' = v0 when it fits, else v1
 * @param {boolean} [o.v1Capable]             the wallet advertised v1 signing
 * @param {import('@solana/web3.js').Keypair[]} [o.signers]  co-signers applied here (the mint)
 * @returns {Promise<{ tx_base64: string, transaction_version: 0|1, bytes: number, limit_bytes: number }>}
 */
export async function buildLaunchTransaction({
	network,
	payer,
	instructions,
	transactionVersion = 'auto',
	v1Capable = false,
	signers = [],
}) {
	const connection = getConnection({ network });
	const lifetime = await latestBlockhash(connection);

	if (transactionVersion !== 1) {
		const tables = await getPumpLookupTables({ network });
		try {
			const msg = new TransactionMessage({
				payerKey: payer,
				recentBlockhash: lifetime.blockhash,
				instructions,
			}).compileToV0Message(tables);
			const vtx = new VersionedTransaction(msg);
			if (signers.length) vtx.sign(signers);
			const bytes = vtx.serialize();
			if (bytes.length > LEGACY_TRANSACTION_LIMIT) throw new RangeError('over legacy limit');
			return {
				tx_base64: Buffer.from(bytes).toString('base64'),
				transaction_version: 0,
				bytes: bytes.length,
				limit_bytes: LEGACY_TRANSACTION_LIMIT,
			};
		} catch (err) {
			// web3.js reports an oversized message as a RangeError/"encoding
			// overruns" from its fixed 1,232-byte buffer. Anything else is real.
			const overflow = err instanceof RangeError || /overruns|too large|over legacy limit/i.test(err?.message || '');
			if (!overflow) throw err;
			if (transactionVersion === 0 || !v1Capable) {
				throw launchTooLarge(
					transactionVersion === 0
						? 'this launch does not fit in a legacy transaction: switch the transaction format to v1, or drop the dev buy'
						: 'this launch needs a Solana transaction v1, which your wallet does not advertise: update the wallet, or launch SOL-paired',
				);
			}
		}
	}

	const { active } = await transactionV1Status({ network });
	if (!active) {
		throw Object.assign(new Error(`Solana transaction v1 is not active on ${network} yet`), {
			status: 409,
			code: 'tx_v1_inactive',
		});
	}
	let bytes;
	try {
		bytes = await buildPartiallySignedV1Transaction({
			instructions,
			signers: signers.map(kitSigner),
			feePayer: payer.toBase58(),
			lifetime,
			config: LAUNCH_V1_CONFIG,
		});
	} catch (err) {
		if (/size|limit|too large/i.test(err?.message || '')) {
			throw launchTooLarge('this launch exceeds even the 4,096-byte v1 envelope: shorten the name or metadata');
		}
		throw err;
	}
	return {
		tx_base64: Buffer.from(bytes).toString('base64'),
		transaction_version: 1,
		bytes: bytes.length,
		limit_bytes: V1_TRANSACTION_LIMIT,
	};
}
