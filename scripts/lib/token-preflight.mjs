// Pure helpers for scripts/preflight-three-token-rail.mjs. No network, no env,
// no signing: everything here is a deterministic function of its arguments so it
// can be unit tested (tests/token-preflight.test.js).

import { PublicKey, SystemProgram } from '@solana/web3.js';

export const SERVICE = 'three-ws-api';
export const REGION = 'us-central1';
export const PROJECT = 'aerial-vehicle-466722-p5';

// Addresses that can never be a receiver: programs, sysvars and burn sinks.
export const RESERVED_ADDRESSES = new Map([
	[SystemProgram.programId.toBase58(), 'the System Program'],
	['TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA', 'the SPL Token program'],
	['TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb', 'the Token-2022 program'],
	['ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL', 'the Associated Token program'],
	['11111111111111111111111111111111', 'the System Program'],
	['1nc1nerator11111111111111111111111111111111', 'the Solana incinerator (burn sink)'],
	['SysvarRent111111111111111111111111111111111', 'a sysvar account'],
	['SysvarC1ock11111111111111111111111111111111', 'a sysvar account'],
]);

/**
 * Validate one receiver address string.
 * @param {string} address
 * @returns {{ ok: boolean, pubkey: string|null, onCurve: boolean, errors: string[] }}
 */
export function validateAddress(address) {
	const errors = [];
	const raw = typeof address === 'string' ? address.trim() : '';
	if (!raw) return { ok: false, pubkey: null, onCurve: false, errors: ['address is empty'] };
	let pk;
	try {
		pk = new PublicKey(raw);
	} catch {
		return { ok: false, pubkey: null, onCurve: false, errors: ['not a valid base58 32-byte Solana address'] };
	}
	const b58 = pk.toBase58();
	if (b58 !== raw) errors.push('address does not round-trip through base58 (typo or padding)');
	const reserved = RESERVED_ADDRESSES.get(b58);
	if (reserved) errors.push(`address is ${reserved}, which can never be a receiver`);
	const onCurve = PublicKey.isOnCurve(pk.toBytes());
	if (!onCurve) {
		errors.push('address is off the ed25519 curve (a PDA): nothing can sign for it, so funds sent here are stranded');
	}
	return { ok: errors.length === 0, pubkey: b58, onCurve, errors };
}

/**
 * Validate the treasury / rewards pair together.
 * @returns {{ ok: boolean, treasury: object, rewards: object, errors: string[] }}
 */
export function validateReceivers({ treasury, rewards }) {
	const t = validateAddress(treasury);
	const r = validateAddress(rewards);
	const errors = [];
	if (!t.ok) errors.push(...t.errors.map((e) => `treasury: ${e}`));
	if (!r.ok) errors.push(...r.errors.map((e) => `rewards: ${e}`));
	if (t.pubkey && r.pubkey && t.pubkey === r.pubkey) {
		errors.push(
			'treasury and rewards are the same wallet: rewards-distribute reads the rewards wallet balance as the distributable pool, so it would plan to hand out the treasury',
		);
	}
	return { ok: errors.length === 0, treasury: t, rewards: r, errors };
}

/**
 * Classify an account fetched with getAccountInfo.
 * @param {{ owner: string, executable: boolean, lamports: number }|null} info
 * @returns {{ kind: 'unfunded'|'system'|'other', ok: boolean, note: string }}
 */
export function classifyAccount(info) {
	if (!info) {
		return {
			kind: 'unfunded',
			ok: true,
			note: 'account does not exist on mainnet yet (0 SOL); the first transfer creates it, and the buyer transaction creates its $THREE token account',
		};
	}
	if (info.executable) return { kind: 'other', ok: false, note: 'account is an executable program, not a wallet' };
	if (info.owner !== SystemProgram.programId.toBase58()) {
		return { kind: 'other', ok: false, note: `account is owned by ${info.owner}, not the System Program: it is not an ordinary wallet` };
	}
	return { kind: 'system', ok: true, note: `ordinary system-owned wallet (${info.lamports} lamports)` };
}

/**
 * Compare each configured-lane signer against the candidate rewards wallet.
 * @param {string} rewards candidate rewards pubkey
 * @param {Array<{ lane: string, signer: string, armed: boolean }>} conflicts
 */
export function describeConflicts(rewards, conflicts) {
	return conflicts.map((c) => ({
		lane: c.lane,
		armed: c.armed,
		severity: c.armed ? 'blocking' : 'warning',
		message: `${rewards} is the ${c.lane} signer${c.armed ? ' and the lane is ARMED: it would sweep the whole rewards pool into the treasury' : ' (lane not armed yet): arming it would sweep the whole rewards pool into the treasury; give the lane its own wallet first'}`,
	}));
}

/** The one reviewed config-only command. Always --update-env-vars, never --set-env-vars. */
export function buildApplyCommand({ treasury, rewards }) {
	return (
		`gcloud run services update ${SERVICE} --region ${REGION} --project ${PROJECT} ` +
		`--update-env-vars THREE_TREASURY_WALLET=${treasury},THREE_REWARDS_WALLET=${rewards}`
	);
}

/** Parse `--treasury X --rewards Y` (also `--treasury=X`). */
export function parseArgs(argv) {
	const out = { treasury: '', rewards: '', help: false };
	for (let i = 0; i < argv.length; i++) {
		const a = argv[i];
		if (a === '--help' || a === '-h') out.help = true;
		else if (a.startsWith('--treasury=')) out.treasury = a.slice(11);
		else if (a.startsWith('--rewards=')) out.rewards = a.slice(10);
		else if (a === '--treasury') out.treasury = argv[++i] || '';
		else if (a === '--rewards') out.rewards = argv[++i] || '';
	}
	return out;
}
