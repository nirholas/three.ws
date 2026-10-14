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

import { parsePumpEventsFromLogs, PumpIdl, PumpAmmIdl, PumpFeesIdl } from '@nirholas/pump-sdk';
import { PUMP_PROGRAM_ID, PUMP_AMM_PROGRAM_ID, PUMP_FEE_PROGRAM_ID } from './solana/programs.js';

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

// --- Full-transaction replay (/atomic's "Replay" panel) ---------------------
//
// parsePumpEventsFromLogs only returns events it recognises; a line whose
// discriminator it cannot match is silently skipped. A replay that walks a
// transaction step by step must never drop a frame just because a program
// upgrade added an event this install's @nirholas/pump-sdk predates, so
// decodeTransactionEvents re-walks the same invoke-stack shape the SDK reads
// and, for every "Program data:" line under a known Pump/PumpSwap/PumpFees
// program invocation whose 8-byte discriminator the SDK's own IDLs don't
// list, emits it as `{ type: 'unrecognized' }` carrying the raw bytes instead
// of disappearing.

function discriminatorHex(bytes) {
	return Buffer.from(bytes).toString('hex');
}

const KNOWN_EVENT_DISCRIMINATORS = new Set(
	[PumpIdl, PumpAmmIdl, PumpFeesIdl].flatMap((idl) => (idl.events || []).map((e) => discriminatorHex(e.discriminator))),
);

const EVENT_PROGRAM_IDS = new Set([PUMP_PROGRAM_ID, PUMP_AMM_PROGRAM_ID, PUMP_FEE_PROGRAM_ID]);

const INVOKE_RE = /^Program ([1-9A-HJ-NP-Za-km-z]{32,44}) invoke \[\d+\]$/;
const RETURN_RE = /^Program [1-9A-HJ-NP-Za-km-z]{32,44} (success|failed)/;

/** Anchor decodes pubkeys as PublicKey and numerics as BN; flatten both to JSON-safe values. */
function normalizeEventValue(value) {
	if (value == null) return value;
	if (typeof value === 'boolean' || typeof value === 'number' || typeof value === 'string') return value;
	if (typeof value.toBase58 === 'function') return value.toBase58();
	if (typeof value.toNumber === 'function' && typeof value.toString === 'function') return value.toString();
	if (Array.isArray(value)) return value.map(normalizeEventValue);
	if (typeof value === 'object') {
		const out = {};
		for (const [key, v] of Object.entries(value)) out[key] = normalizeEventValue(v);
		return out;
	}
	return value;
}

/**
 * Every decodable Pump/PumpSwap/PumpFees event in a transaction's logs, oldest
 * first, normalised to JSON-safe values. An event whose discriminator is not
 * in the installed SDK's IDLs (a program upgrade this install predates)
 * renders as `{ type: 'unrecognized', programId, discriminator, dataBase64 }`
 * rather than being dropped. Never throws.
 * @param {string[]} logs
 * @returns {Array<{type:string, programId:string, data?:object, discriminator?:string, dataBase64?:string}>}
 */
export function decodeTransactionEvents(logs) {
	if (!Array.isArray(logs) || logs.length === 0) return [];
	const out = [];
	const stack = [];
	for (const line of logs) {
		const invoke = line.match(INVOKE_RE);
		if (invoke) {
			stack.push(invoke[1]);
			continue;
		}
		if (RETURN_RE.test(line)) {
			stack.pop();
			continue;
		}
		if (!line.startsWith('Program data: ')) continue;
		const programId = stack[stack.length - 1];
		if (!EVENT_PROGRAM_IDS.has(programId)) continue;

		let data;
		try {
			data = Buffer.from(line.slice('Program data: '.length), 'base64');
		} catch {
			continue;
		}
		if (data.length < 8) continue;
		const discriminator = discriminatorHex(data.subarray(0, 8));

		if (!KNOWN_EVENT_DISCRIMINATORS.has(discriminator)) {
			out.push({ type: 'unrecognized', programId, discriminator, dataBase64: data.toString('base64') });
			continue;
		}
		const [decoded] = parsePumpEventsFromLogs([
			`Program ${programId} invoke [1]`,
			line,
			`Program ${programId} success`,
		]);
		out.push(
			decoded
				? { type: decoded.type, programId, data: normalizeEventValue(decoded.data) }
				: { type: 'unrecognized', programId, discriminator, dataBase64: data.toString('base64') },
		);
	}
	return out;
}
