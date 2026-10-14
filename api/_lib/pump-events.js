// pump-events.js
// --------------
// Shared Pump / PumpSwap / PumpFees log decoder.
//
// Wraps the installed @nirholas/pump-sdk's Anchor-IDL-driven decoder
// (parsePumpEventsFromLogs) so every caller that needs typed on-chain events
// -- creates, trades, completions, fee collections, fee distributions, and
// GitHub social-fee claims -- reads them the same way instead of hand-rolling
// Borsh offsets per caller. The SDK keys off the invoking program in the log
// stack (Pump, PumpSwap, or PumpFees) and returns each event as
// `{ type, data }`, with the Anchor event name camel-cased and its trailing
// "Event" stripped (e.g. "DistributeCreatorFeesEvent" decodes as
// `type: "distributeCreatorFees"`). Numeric fields decode as BN; the
// normalising helpers below convert the ones this codebase consumes to plain
// strings so attribution math can use BigInt directly.

import { parsePumpEventsFromLogs } from '@nirholas/pump-sdk';

/** Every decodable event in a transaction's logs, oldest first. Never throws. */
export function parseEventsFromLogs(logs) {
	if (!Array.isArray(logs) || logs.length === 0) return [];
	try {
		return parsePumpEventsFromLogs(logs) || [];
	} catch {
		return [];
	}
}

function eventsOfType(logs, type) {
	return parseEventsFromLogs(logs).filter((e) => e?.type === type);
}

export const getCreateEvents = (logs) => eventsOfType(logs, 'create');
export const getTradeEvents = (logs) => eventsOfType(logs, 'trade');
export const getCompleteEvents = (logs) => eventsOfType(logs, 'complete');
export const getCollectCreatorFeeEvents = (logs) => eventsOfType(logs, 'collectCreatorFee');
export const getDistributeCreatorFeesEvents = (logs) => eventsOfType(logs, 'distributeCreatorFees');
export const getSocialFeePdaClaimedEvents = (logs) => eventsOfType(logs, 'socialFeePdaClaimed');

/**
 * Every DistributeCreatorFeesEvent in a transaction's logs, normalised to
 * plain values. This is the event the fee-sharing program emits whenever a
 * coin's creator fees are split between its shareholders (which includes a
 * GitHub social-fee PDA, when the coin delegates fees to one) -- the event
 * both attribution rules below are built on.
 * @param {string[]} logs
 * @returns {Array<{mint:string, sharingConfig:string, shareholders:Array<{address:string,shareBps:number}>, distributedRaw:string, quoteMint?:string}>}
 */
/** The SDK decodes Anchor `pubkey` fields as PublicKey instances; base58-stringify, or pass through nullish. */
function pubkeyString(v) {
	return v == null ? v : v.toString();
}

export function parseTransactionDistributions(logs) {
	return getDistributeCreatorFeesEvents(logs).map((e) => ({
		mint: pubkeyString(e.data.mint),
		sharingConfig: pubkeyString(e.data.sharingConfig),
		shareholders: (e.data.shareholders || []).map((s) => ({
			address: pubkeyString(s.address),
			shareBps: Number(s.shareBps),
		})),
		distributedRaw: e.data.distributed.toString(),
		quoteMint: pubkeyString(e.data.quoteMint),
	}));
}

/**
 * The SocialFeePdaClaimed event from a claim_social_fee_pda transaction's
 * logs, or null when the instruction emitted no event (a claim that reverted
 * or paid out nothing).
 * @param {string[]} logs
 */
export function parseSocialFeeClaim(logs) {
	const [event] = getSocialFeePdaClaimedEvents(logs);
	if (!event) return null;
	const d = event.data;
	return {
		githubUserId: d.userId,
		socialPlatform: Number(d.platform),
		socialFeePda: pubkeyString(d.socialFeePda),
		recipient: pubkeyString(d.recipient),
		amountClaimedRaw: d.amountClaimed.toString(),
		lifetimeClaimedRaw: d.lifetimeClaimed.toString(),
		quoteMint: pubkeyString(d.quoteMint),
	};
}

/** True when a transaction's logs show a claim_social_fee_pda instruction (V1 or V2). */
export function isSocialClaimLog(logs) {
	return (logs || []).some((line) => line.includes('Program log: Instruction: ClaimSocialFeePda'));
}
