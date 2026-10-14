// Synthetic recorded-transaction log fixtures for pump.fun / PumpFees event
// decoding tests. Hand-encodes Borsh bytes for DistributeCreatorFeesEvent
// (Pump program) and SocialFeePdaClaimed (PumpFees program) using the exact
// field order read from the installed @nirholas/pump-sdk's IDL
// (PumpIdl.types / PumpFeesIdl.types), then wraps them as "Program data:"
// log lines inside the invoke/success frame parsePumpEventsFromLogs expects.
// Every account below is a synthetic placeholder, never a real mainnet key.

import bs58 from 'bs58';
import { PUMP_PROGRAM_ID, PUMP_FEE_PROGRAM_ID } from '../../api/_lib/solana/programs.js';

class BorshWriter {
	constructor() {
		this.chunks = [];
	}
	u8(v) {
		this.chunks.push(Buffer.from([v]));
		return this;
	}
	bool(v) {
		this.chunks.push(Buffer.from([v ? 1 : 0]));
		return this;
	}
	u16(v) {
		const b = Buffer.alloc(2);
		b.writeUInt16LE(v);
		this.chunks.push(b);
		return this;
	}
	u64(v) {
		const b = Buffer.alloc(8);
		b.writeBigUInt64LE(BigInt(v));
		this.chunks.push(b);
		return this;
	}
	i64(v) {
		const b = Buffer.alloc(8);
		b.writeBigInt64LE(BigInt(v));
		this.chunks.push(b);
		return this;
	}
	pubkey(base58) {
		const bytes = bs58.decode(base58);
		if (bytes.length !== 32) throw new Error(`fixture pubkey must decode to 32 bytes: ${base58}`);
		this.chunks.push(Buffer.from(bytes));
		return this;
	}
	string(s) {
		const utf8 = Buffer.from(s, 'utf8');
		const len = Buffer.alloc(4);
		len.writeUInt32LE(utf8.length);
		this.chunks.push(len, utf8);
		return this;
	}
	vec(items, writeItem) {
		const len = Buffer.alloc(4);
		len.writeUInt32LE(items.length);
		this.chunks.push(len);
		for (const item of items) writeItem(this, item);
		return this;
	}
	bytes() {
		return Buffer.concat(this.chunks);
	}
}

function discriminatorBuffer(disc) {
	return Buffer.from(disc, 'hex');
}

const DISTRIBUTE_CREATOR_FEES_DISC = 'a537817004b3ca28';
const SOCIAL_FEE_PDA_CLAIMED_DISC = '3212c141edd2eaec';
// Discriminators below read straight off the installed @nirholas/pump-sdk's
// PumpIdl.events (Buffer.from(event.discriminator).toString('hex')), same as
// the two above.
const CREATE_EVENT_DISC = '1b72a94ddeeb6376';
const TRADE_EVENT_DISC = 'bddb7fd34ee661ee';
const COMPLETE_EVENT_DISC = '5f72619cd42e9808';
const COLLECT_CREATOR_FEE_EVENT_DISC = '7a027f010ebf0caf';

/**
 * @param {{mint:string, bondingCurve:string, sharingConfig:string, admin:string,
 *   shareholders:Array<{address:string, shareBps:number}>, distributed:bigint|number, timestamp?:number}} fields
 */
export function encodeDistributeCreatorFeesEvent(fields) {
	const w = new BorshWriter();
	w.i64(fields.timestamp ?? 1_760_000_000)
		.pubkey(fields.mint)
		.pubkey(fields.bondingCurve)
		.pubkey(fields.sharingConfig)
		.pubkey(fields.admin)
		.vec(fields.shareholders, (writer, sh) => writer.pubkey(sh.address).u16(sh.shareBps))
		.u64(fields.distributed);
	return Buffer.concat([discriminatorBuffer(DISTRIBUTE_CREATOR_FEES_DISC), w.bytes()]);
}

/**
 * @param {{userId:string, platform:number, socialFeePda:string, recipient:string,
 *   socialClaimAuthority:string, amountClaimed:bigint|number, claimableBefore?:bigint|number,
 *   lifetimeClaimed:bigint|number, recipientBalanceBefore?:bigint|number,
 *   recipientBalanceAfter?:bigint|number, timestamp?:number}} fields
 */
export function encodeSocialFeePdaClaimed(fields) {
	const w = new BorshWriter();
	w.i64(fields.timestamp ?? 1_760_000_100)
		.string(fields.userId)
		.u8(fields.platform)
		.pubkey(fields.socialFeePda)
		.pubkey(fields.recipient)
		.pubkey(fields.socialClaimAuthority)
		.u64(fields.amountClaimed)
		.u64(fields.claimableBefore ?? 0)
		.u64(fields.lifetimeClaimed)
		.u64(fields.recipientBalanceBefore ?? 0)
		.u64(fields.recipientBalanceAfter ?? 0);
	return Buffer.concat([discriminatorBuffer(SOCIAL_FEE_PDA_CLAIMED_DISC), w.bytes()]);
}

/**
 * @param {{name:string, symbol:string, uri:string, mint:string, bondingCurve:string,
 *   user:string, creator:string, timestamp?:number, virtualTokenReserves:bigint|number,
 *   virtualSolReserves:bigint|number, realTokenReserves:bigint|number,
 *   tokenTotalSupply:bigint|number, tokenProgram:string, isMayhemMode?:boolean,
 *   isCashbackEnabled?:boolean}} fields
 */
export function encodeCreateEvent(fields) {
	const w = new BorshWriter();
	w.string(fields.name)
		.string(fields.symbol)
		.string(fields.uri)
		.pubkey(fields.mint)
		.pubkey(fields.bondingCurve)
		.pubkey(fields.user)
		.pubkey(fields.creator)
		.i64(fields.timestamp ?? 1_760_000_000)
		.u64(fields.virtualTokenReserves)
		.u64(fields.virtualSolReserves)
		.u64(fields.realTokenReserves)
		.u64(fields.tokenTotalSupply)
		.pubkey(fields.tokenProgram)
		.bool(fields.isMayhemMode ?? false)
		.bool(fields.isCashbackEnabled ?? false);
	return Buffer.concat([discriminatorBuffer(CREATE_EVENT_DISC), w.bytes()]);
}

/**
 * @param {{mint:string, solAmount:bigint|number, tokenAmount:bigint|number, isBuy:boolean,
 *   user:string, timestamp?:number, virtualSolReserves:bigint|number,
 *   virtualTokenReserves:bigint|number, realSolReserves:bigint|number,
 *   realTokenReserves:bigint|number, feeRecipient:string, feeBasisPoints?:bigint|number,
 *   fee?:bigint|number, creator:string, creatorFeeBasisPoints?:bigint|number,
 *   creatorFee?:bigint|number, ixName?:string}} fields
 */
export function encodeTradeEvent(fields) {
	const w = new BorshWriter();
	w.pubkey(fields.mint)
		.u64(fields.solAmount)
		.u64(fields.tokenAmount)
		.bool(fields.isBuy)
		.pubkey(fields.user)
		.i64(fields.timestamp ?? 1_760_000_050)
		.u64(fields.virtualSolReserves)
		.u64(fields.virtualTokenReserves)
		.u64(fields.realSolReserves)
		.u64(fields.realTokenReserves)
		.pubkey(fields.feeRecipient)
		.u64(fields.feeBasisPoints ?? 100)
		.u64(fields.fee ?? 0)
		.pubkey(fields.creator)
		.u64(fields.creatorFeeBasisPoints ?? 50)
		.u64(fields.creatorFee ?? 0)
		.bool(fields.trackVolume ?? false)
		.u64(fields.totalUnclaimedTokens ?? 0)
		.u64(fields.totalClaimedTokens ?? 0)
		.u64(fields.currentSolVolume ?? 0)
		.i64(fields.lastUpdateTimestamp ?? 0)
		.string(fields.ixName ?? (fields.isBuy ? 'buy' : 'sell'))
		.bool(fields.mayhemMode ?? false)
		.u64(fields.cashbackFeeBasisPoints ?? 0)
		.u64(fields.cashback ?? 0);
	return Buffer.concat([discriminatorBuffer(TRADE_EVENT_DISC), w.bytes()]);
}

/** @param {{user:string, mint:string, bondingCurve:string, timestamp?:number}} fields */
export function encodeCompleteEvent(fields) {
	const w = new BorshWriter();
	w.pubkey(fields.user).pubkey(fields.mint).pubkey(fields.bondingCurve).i64(fields.timestamp ?? 1_760_000_200);
	return Buffer.concat([discriminatorBuffer(COMPLETE_EVENT_DISC), w.bytes()]);
}

/** @param {{creator:string, creatorFee:bigint|number, timestamp?:number}} fields */
export function encodeCollectCreatorFeeEvent(fields) {
	const w = new BorshWriter();
	w.i64(fields.timestamp ?? 1_760_000_300).pubkey(fields.creator).u64(fields.creatorFee);
	return Buffer.concat([discriminatorBuffer(COLLECT_CREATOR_FEE_EVENT_DISC), w.bytes()]);
}

function programDataLogLine(bytes) {
	return `Program data: ${bytes.toString('base64')}`;
}

/**
 * Wraps one or more already-encoded event payloads as a recorded
 * transaction's log lines: one invoke/success frame per program, each
 * carrying its "Program data:" lines in order. Matches the shape
 * `parsePumpEventsFromLogs` (and this codebase's pump-events.js wrapper)
 * reads from `tx.meta.logMessages`.
 * @param {Array<{programId:string, instruction:string, dataPayloads:Buffer[]}>} frames
 */
export function buildTransactionLogs(frames) {
	const logs = [];
	for (const frame of frames) {
		logs.push(`Program ${frame.programId} invoke [1]`);
		if (frame.instruction) logs.push(`Program log: Instruction: ${frame.instruction}`);
		for (const payload of frame.dataPayloads) logs.push(programDataLogLine(payload));
		logs.push(`Program ${frame.programId} success`);
	}
	return logs;
}

/** Logs for a claim_social_fee_pda transaction alone (no same-tx distribution). */
export function socialClaimLogs(claimFields) {
	return buildTransactionLogs([
		{
			programId: PUMP_FEE_PROGRAM_ID,
			instruction: 'ClaimSocialFeePda',
			dataPayloads: [encodeSocialFeePdaClaimed(claimFields)],
		},
	]);
}

/** Logs for a claim_social_fee_pda transaction that also carries same-tx distributions. */
export function socialClaimWithDistributionsLogs(claimFields, distributions) {
	return buildTransactionLogs([
		{ programId: PUMP_PROGRAM_ID, instruction: null, dataPayloads: distributions.map(encodeDistributeCreatorFeesEvent) },
		{
			programId: PUMP_FEE_PROGRAM_ID,
			instruction: 'ClaimSocialFeePda',
			dataPayloads: [encodeSocialFeePdaClaimed(claimFields)],
		},
	]);
}

/** Logs for a plain distribution transaction (e.g. a history entry between two claims). */
export function distributionLogs(distribution) {
	return buildTransactionLogs([
		{ programId: PUMP_PROGRAM_ID, instruction: null, dataPayloads: [encodeDistributeCreatorFeesEvent(distribution)] },
	]);
}

/** Logs for a create transaction (a coin launch) alone. */
export function createEventLogs(createFields) {
	return buildTransactionLogs([
		{ programId: PUMP_PROGRAM_ID, instruction: 'Create', dataPayloads: [encodeCreateEvent(createFields)] },
	]);
}

/** Logs for a buy/sell transaction on an existing bonding curve. */
export function tradeEventLogs(tradeFields) {
	return buildTransactionLogs([
		{
			programId: PUMP_PROGRAM_ID,
			instruction: tradeFields.isBuy ? 'Buy' : 'Sell',
			dataPayloads: [encodeTradeEvent(tradeFields)],
		},
	]);
}

/** Logs for the trade transaction that graduates a bonding curve, trade event then complete event. */
export function completeEventLogs(tradeFields, completeFields) {
	return buildTransactionLogs([
		{
			programId: PUMP_PROGRAM_ID,
			instruction: tradeFields.isBuy ? 'Buy' : 'Sell',
			dataPayloads: [encodeTradeEvent(tradeFields), encodeCompleteEvent(completeFields)],
		},
	]);
}

/** Logs for a creator collecting their accrued fee off a bonding curve. */
export function collectCreatorFeeEventLogs(collectFields) {
	return buildTransactionLogs([
		{ programId: PUMP_PROGRAM_ID, instruction: 'CollectCreatorFee', dataPayloads: [encodeCollectCreatorFeeEvent(collectFields)] },
	]);
}

/** A deterministic, valid 32-byte base58 pubkey from a short ASCII tag. Never a real key. */
function synthPubkey(tag) {
	const buf = Buffer.alloc(32);
	Buffer.from(tag, 'utf8').copy(buf);
	return bs58.encode(buf);
}

// Synthetic, non-mainnet accounts. Base58, 32 bytes, never a real third-party key.
// MINT_A is the $THREE mint, the only coin this platform promotes; the rest are
// tagged placeholders encoded fresh above rather than real addresses.
export const SYNTH = {
	PDA_A: synthPubkey('synth-social-fee-pda-a'),
	PDA_B: synthPubkey('synth-social-fee-pda-b'),
	MINT_A: 'FeMbDoX7R1Psc4GEcvJdsbNbZA3bfztcyDCatJVJpump',
	MINT_B: synthPubkey('synth-mint-b'),
	BONDING_CURVE_A: synthPubkey('synth-bonding-curve-a'),
	BONDING_CURVE_B: synthPubkey('synth-bonding-curve-b'),
	SHARING_CONFIG_A: synthPubkey('synth-sharing-config-a'),
	SHARING_CONFIG_B: synthPubkey('synth-sharing-config-b'),
	ADMIN: synthPubkey('synth-admin'),
	RECIPIENT: synthPubkey('synth-recipient'),
	CLAIM_AUTHORITY: synthPubkey('synth-claim-authority'),
	USER_A: synthPubkey('synth-user-a'),
	USER_B: synthPubkey('synth-user-b'),
	CREATOR_A: synthPubkey('synth-creator-a'),
	FEE_RECIPIENT: synthPubkey('synth-fee-recipient'),
	// SPL Token program, the real mainnet id: every pump.fun mint is a real SPL
	// token, so this is a known-constant account, not a third-party key.
	TOKEN_PROGRAM: 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA',
};
