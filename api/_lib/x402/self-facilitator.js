// api/_lib/x402/self-facilitator.js
//
// three.ws SELF-HOSTED x402 facilitator (Solana verify + settle), platform adapter.
//
// The verification, anti-drain gate, sponsor guards and settle logic live in the
// published package `@three-ws/x402-server/facilitator`
// (packages/x402-server/src/facilitator). This file only injects what is specific
// to the three.ws deployment: environment configuration, the platform RPC helper,
// the fee-payer secret, and the database-backed settlement store (passed per call
// by api/x402-facilitator/[action].js). It re-exports the names the rest of the
// API imports, so production runs the same code a self-hoster installs.
//
// Why it exists: the closed-loop agent economy settles against OUR endpoints, so
// no third party touches settlement or holds the sponsor key. Point
// X402_FACILITATOR_URL_SOLANA at /api/x402-facilitator.

import bs58 from 'bs58';
import { Keypair } from '@solana/web3.js';

import { env } from '../env.js';
import { solanaConnection } from '../solana/connection.js';
import {
	isSupportedTokenProgram,
	knownTokenProgramForMint,
	tokenProgramForMint,
} from '../solana-token-program.js';
import {
	createFacilitator,
	blockhashIsLive,
	isFeePayerRentFailure,
	txBase64FromPayload,
	verifyBuyerSignatures,
	SETTLEMENT_PENDING_REASON,
} from '../../../packages/x402-server/src/facilitator/index.js';

export {
	SETTLEMENT_PENDING_REASON,
	blockhashIsLive,
	isFeePayerRentFailure,
	txBase64FromPayload,
	verifyBuyerSignatures,
};

export const SELF_FACILITATOR_ENABLED =
	String(process.env.X402_SELF_FACILITATOR_ENABLED || '').toLowerCase() === 'true';

// Sponsor SOL floor: below this the facilitator refuses to settle, which pauses the
// paying loop until the sponsor is topped up. Default 0.02 SOL.
export const SPONSOR_SOL_FLOOR_LAMPORTS = Number(
	process.env.X402_SPONSOR_SOL_FLOOR_LAMPORTS || 20_000_000,
);

// Minimum atomic amount a SPONSOR-mode settle must move. Each co-sign burns about
// 5000 lamports, so settling a dust transfer is a pure fee-burn grief. Default
// 1000 atomic = $0.001. Self-pay settles pay their own fee and are exempt.
export const MIN_SPONSOR_SETTLE_ATOMIC = Math.max(
	0,
	Number(process.env.X402_SELF_FAC_MIN_SETTLE_ATOMIC || 1000),
);

export const SETTLEMENT_DROP_HORIZON_MS = 180_000;

let _feePayerCache = null;
// Load the sponsor (fee-payer) keypair the facilitator co-signs with. Its public
// key MUST equal env.X402_FEE_PAYER_SOLANA (the address the 402 challenge
// advertises) or endpoints would advertise a fee payer we cannot actually sign.
export function loadFeePayerKeypair() {
	if (_feePayerCache) return _feePayerCache;
	const b58 = process.env.X402_FEE_PAYER_SECRET_BASE58;
	if (!b58) {
		throw new Error(
			'self-facilitator: X402_FEE_PAYER_SECRET_BASE58 not set (the sponsor key that co-signs + pays SOL)',
		);
	}
	const raw = bs58.decode(b58);
	if (raw.length !== 64) {
		throw new Error(`self-facilitator: fee-payer key expected 64 bytes, got ${raw.length}`);
	}
	const kp = Keypair.fromSecretKey(raw);
	const advertised = env.X402_FEE_PAYER_SOLANA;
	if (advertised && kp.publicKey.toBase58() !== advertised) {
		throw new Error(
			`self-facilitator: fee-payer secret pubkey ${kp.publicKey.toBase58()} != advertised X402_FEE_PAYER_SOLANA ${advertised}`,
		);
	}
	_feePayerCache = kp;
	return kp;
}

// Recipients this facilitator will settle to. ONLY platform-controlled wallets
// belong here: that is what keeps every settled dollar inside three.ws. Defaults to
// X402_PAY_TO_SOLANA; add ring treasuries via X402_SELF_FACILITATOR_PAYTO_ALLOWLIST.
export function payToAllowlist() {
	const out = new Set();
	if (env.X402_PAY_TO_SOLANA) out.add(env.X402_PAY_TO_SOLANA);
	const extra = String(process.env.X402_SELF_FACILITATOR_PAYTO_ALLOWLIST || '')
		.split(',')
		.map((s) => s.trim())
		.filter(Boolean);
	for (const a of extra) out.add(a);
	return out;
}

const settleableMints = () => [env.X402_ASSET_MINT_SOLANA, env.THREE_TOKEN_MINT].filter(Boolean);

const facilitator = createFacilitator({
	// Re-read per call: tests and operators rotate these without a restart.
	connection: () => solanaConnection({ url: env.SOLANA_RPC_URL, commitment: 'confirmed', fresh: true }),
	// Throws the operator-facing 'secret not set' error when unconfigured.
	feePayer: loadFeePayerKeypair,
	sponsorAddress: () => env.X402_FEE_PAYER_SOLANA || null,
	payToAllowlist,
	settleableMints,
	guards: {
		sponsorSolFloorLamports: SPONSOR_SOL_FLOOR_LAMPORTS,
		minSponsoredSettleAtomic: MIN_SPONSOR_SETTLE_ATOMIC,
		maxCuLimit: Number(process.env.X402_SELF_FAC_MAX_CU_LIMIT || 300_000),
		maxCuPriceMicroLamports: Number(process.env.X402_SELF_FAC_MAX_CU_PRICE || 100_000),
		maxPriorityLamports: Number(process.env.X402_SELF_FAC_MAX_PRIORITY_LAMPORTS || 20_000),
		// Read per call: the confirmation window is the one tunable an operator
		// reaches for DURING an incident, and must not need a redeploy to move.
		confirmTimeoutMs: () => Number(process.env.X402_SETTLE_CONFIRM_TIMEOUT_MS),
	},
	// The platform passes its Postgres settlement store and fee meter per call, so
	// there is no default store and no in-process decision log: the handler writes
	// the durable log itself.
	store: null,
	decisionLog: null,
	tokenPrograms: {
		known: knownTokenProgramForMint,
		resolve: tokenProgramForMint,
	},
});

export const validateRingTransaction = (args) => facilitator.validateRingTransaction(args);
export const sponsorKnownBelowFloor = (now) => facilitator.sponsorKnownBelowFloor(now);
export const noteSponsorRentFailure = (simErr, feePayer, now) =>
	facilitator.noteSponsorRentFailure(simErr, feePayer, now);
export const refreshSponsorFloorState = (now) => facilitator.refreshSponsorFloorState(now);
export const sponsorSolLamports = (conn, feePayerPubkey, now) =>
	facilitator.sponsorSolLamports(conn, feePayerPubkey, now);
export const settleRingPayment = (args) => facilitator.settleRingPayment(args);
export const verifyRingPayment = (args) => facilitator.verifyRingPayment(args);
export const probeSettlementSignature = (args) => facilitator.probeSettlementSignature(args);

export { isSupportedTokenProgram };
