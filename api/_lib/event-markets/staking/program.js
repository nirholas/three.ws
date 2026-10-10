// Client for the event_markets_stake Anchor program: PDA derivation, instruction
// builders and account decoders. No Anchor runtime, just the wire format, so the
// API bundle stays small and the tests exercise exactly what the server sends.
// Program: contracts/event-markets-stake. Guide: docs/event-markets-staking.md.

import { createHash } from 'node:crypto';
import { PublicKey, SystemProgram, TransactionInstruction } from '@solana/web3.js';
import {
	ASSOCIATED_TOKEN_PROGRAM_ID,
	TOKEN_PROGRAM_ID,
	getAssociatedTokenAddressSync,
} from '@solana/spl-token';

export const MAX_OUTCOMES = 16;
export const STATUS = { open: 0, resolved: 1, void: 2 };
export const STATUS_NAME = ['open', 'resolved', 'void'];

const disc = (kind, name) => createHash('sha256').update(`${kind}:${name}`).digest().subarray(0, 8);

const u16 = (n) => { const b = Buffer.alloc(2); b.writeUInt16LE(n); return b; };
const u64 = (n) => { const b = Buffer.alloc(8); b.writeBigUInt64LE(BigInt(n)); return b; };
const i64 = (n) => { const b = Buffer.alloc(8); b.writeBigInt64LE(BigInt(n)); return b; };
const opt = (v, enc) => (v == null ? Buffer.from([0]) : Buffer.concat([Buffer.from([1]), enc(v)]));
const pk = (v) => new PublicKey(v);

export function programId() {
	const id = process.env.EVENT_MARKETS_STAKE_PROGRAM_ID;
	if (!id) throw new Error('EVENT_MARKETS_STAKE_PROGRAM_ID is not set');
	return pk(id);
}

/** 32-byte pool id for a market: sha256 of its uuid, so the pool is derivable from the market alone. */
export function poolIdFor(marketId) {
	return createHash('sha256').update(`event-market:${marketId}`).digest();
}

export function configPda(program) {
	return PublicKey.findProgramAddressSync([Buffer.from('config')], program)[0];
}
export function poolPda(program, poolId) {
	return PublicKey.findProgramAddressSync([Buffer.from('pool'), Buffer.from(poolId)], program)[0];
}
export function positionPda(program, pool, owner) {
	return PublicKey.findProgramAddressSync([Buffer.from('position'), pk(pool).toBuffer(), pk(owner).toBuffer()], program)[0];
}
export const vaultFor = (pool, mint, tokenProgram = TOKEN_PROGRAM_ID) =>
	getAssociatedTokenAddressSync(pk(mint), pk(pool), true, tokenProgram);

const meta = (pubkey, isSigner, isWritable) => ({ pubkey: pk(pubkey), isSigner, isWritable });
const ix = (program, name, args, keys) =>
	new TransactionInstruction({ programId: program, keys, data: Buffer.concat([disc('global', name), ...args]) });

export const build = {
	initialize(program, { authority, resolver, treasury, buyback, feeBps, buybackShareBps }) {
		return ix(program, 'initialize',
			[pk(resolver).toBuffer(), pk(treasury).toBuffer(), pk(buyback).toBuffer(), u16(feeBps), u16(buybackShareBps)],
			[meta(configPda(program), false, true), meta(authority, true, true), meta(SystemProgram.programId, false, false)]);
	},

	setConfig(program, { authority, resolver, treasury, buyback, feeBps, buybackShareBps, paused, newAuthority }) {
		const key = (v) => pk(v).toBuffer();
		return ix(program, 'set_config',
			[opt(resolver, key), opt(treasury, key), opt(buyback, key), opt(feeBps, u16), opt(buybackShareBps, u16),
				opt(paused, (v) => Buffer.from([v ? 1 : 0])), opt(newAuthority, key)],
			[meta(configPda(program), false, true), meta(authority, true, false)]);
	},

	createPool(program, { resolver, poolId, mint, outcomeCount, minStake, maxStake, maxPool, lockTs, voidAfterTs, tokenProgram = TOKEN_PROGRAM_ID }) {
		const pool = poolPda(program, poolId);
		return ix(program, 'create_pool',
			[Buffer.from(poolId), Buffer.from([outcomeCount]), u64(minStake), u64(maxStake), u64(maxPool), i64(lockTs), i64(voidAfterTs)],
			[meta(configPda(program), false, false), meta(pool, false, true), meta(mint, false, false),
				meta(vaultFor(pool, mint, tokenProgram), false, true), meta(resolver, true, true),
				meta(tokenProgram, false, false), meta(ASSOCIATED_TOKEN_PROGRAM_ID, false, false),
				meta(SystemProgram.programId, false, false)]);
	},

	stake(program, { staker, poolId, mint, outcome, amount, tokenProgram = TOKEN_PROGRAM_ID }) {
		const pool = poolPda(program, poolId);
		return ix(program, 'stake', [Buffer.from([outcome]), u64(amount)],
			[meta(configPda(program), false, false), meta(pool, false, true), meta(mint, false, false),
				meta(vaultFor(pool, mint, tokenProgram), false, true), meta(positionPda(program, pool, staker), false, true),
				meta(getAssociatedTokenAddressSync(pk(mint), pk(staker), false, tokenProgram), false, true),
				meta(staker, true, true), meta(tokenProgram, false, false), meta(SystemProgram.programId, false, false)]);
	},

	lock(program, { resolver, poolId }) { return resolverIx(program, 'lock', resolver, poolId); },
	voidPool(program, { resolver, poolId }) { return resolverIx(program, 'void_pool', resolver, poolId); },

	resolve(program, { resolver, poolId, mint, winningOutcome, treasuryOwner, buybackOwner, tokenProgram = TOKEN_PROGRAM_ID }) {
		const pool = poolPda(program, poolId);
		return ix(program, 'resolve', [Buffer.from([winningOutcome])],
			[meta(configPda(program), false, false), meta(pool, false, true), meta(mint, false, false),
				meta(vaultFor(pool, mint, tokenProgram), false, true),
				meta(getAssociatedTokenAddressSync(pk(mint), pk(treasuryOwner), true, tokenProgram), false, true),
				meta(getAssociatedTokenAddressSync(pk(mint), pk(buybackOwner), true, tokenProgram), false, true),
				meta(resolver, true, false), meta(tokenProgram, false, false)]);
	},

	voidExpired(program, { poolId }) {
		return ix(program, 'void_expired', [], [meta(poolPda(program, poolId), false, true)]);
	},

	claim(program, args) { return payoutIx(program, 'claim', args); },
	refund(program, args) { return payoutIx(program, 'refund', args); },
};

function resolverIx(program, name, resolver, poolId) {
	return ix(program, name, [],
		[meta(configPda(program), false, false), meta(poolPda(program, poolId), false, true), meta(resolver, true, false)]);
}

function payoutIx(program, name, { owner, poolId, mint, tokenProgram = TOKEN_PROGRAM_ID }) {
	const pool = poolPda(program, poolId);
	return ix(program, name, [],
		[meta(pool, false, true), meta(mint, false, false), meta(vaultFor(pool, mint, tokenProgram), false, true),
			meta(positionPda(program, pool, owner), false, true),
			meta(getAssociatedTokenAddressSync(pk(mint), pk(owner), false, tokenProgram), false, true),
			meta(owner, true, true), meta(tokenProgram, false, false)]);
}

// ── account decoders (Borsh, field order of the Rust structs) ────────────────

function reader(buf) {
	let o = 8; // Anchor account discriminator
	return {
		pk() { const v = new PublicKey(buf.subarray(o, o + 32)); o += 32; return v; },
		bytes32() { const v = Buffer.from(buf.subarray(o, o + 32)); o += 32; return v; },
		u64() { const v = buf.readBigUInt64LE(o); o += 8; return v; },
		i64() { const v = buf.readBigInt64LE(o); o += 8; return v; },
		u16() { const v = buf.readUInt16LE(o); o += 2; return v; },
		u8() { return buf[o++]; },
	};
}

function check(buf, name) {
	if (!buf || buf.length < 8 || !disc('account', name).equals(buf.subarray(0, 8))) {
		throw new Error(`not a ${name} account`);
	}
}

export function decodeConfig(buf) {
	check(buf, 'Config');
	const r = reader(buf);
	return { authority: r.pk(), resolver: r.pk(), treasury: r.pk(), buyback: r.pk(), feeBps: r.u16(), buybackShareBps: r.u16(), paused: r.u8() === 1, bump: r.u8() };
}

export function decodePool(buf) {
	check(buf, 'Pool');
	const r = reader(buf);
	const p = {
		poolId: r.bytes32(), mint: r.pk(), treasury: r.pk(), buyback: r.pk(),
		minStake: r.u64(), maxStake: r.u64(), maxPool: r.u64(), lockTs: r.i64(), voidAfterTs: r.i64(),
		totalStaked: r.u64(), feePaid: r.u64(), paidOut: r.u64(),
	};
	const totals = [];
	for (let i = 0; i < MAX_OUTCOMES; i++) totals.push(r.u64());
	Object.assign(p, { feeBps: r.u16(), buybackShareBps: r.u16(), outcomeCount: r.u8(), status: r.u8(), winningOutcome: r.u8(), bump: r.u8() });
	p.totals = totals.slice(0, p.outcomeCount);
	p.statusName = STATUS_NAME[p.status];
	return p;
}

export function decodePosition(buf) {
	check(buf, 'Position');
	const r = reader(buf);
	return { pool: r.pk(), owner: r.pk(), amount: r.u64(), outcome: r.u8(), bump: r.u8() };
}

export const PROGRAM_ERRORS = [
	'FeeTooHigh', 'BadSplit', 'Paused', 'BadOutcomeCount', 'BadLimits', 'BadTimes', 'NotOpen', 'Locked', 'NotLocked',
	'Expired', 'NotExpired', 'BadOutcome', 'BelowMinimum', 'OutcomeMismatch', 'OverStakeCap', 'OverPoolCap',
	'NotResolved', 'NotVoid', 'NotWinner', 'Unauthorized', 'Overflow',
];

/** Map a failed-transaction error (`Custom: 6013` or a logged name) to the program error name. */
export function programErrorName(err) {
	const text = typeof err === 'string' ? err : JSON.stringify(err, (_, v) => (typeof v === 'bigint' ? v.toString() : v)) + String(err?.message ?? '') + String((err?.logs ?? []).join(' '));
	for (const n of PROGRAM_ERRORS) if (new RegExp(`Error Code: ${n}\\b`).test(text)) return n;
	const m = text.match(/"Custom":(\d+)|custom program error: 0x([0-9a-f]+)/i);
	if (m) {
		const code = m[1] ? Number(m[1]) : parseInt(m[2], 16);
		return PROGRAM_ERRORS[code - 6000] ?? null;
	}
	return null;
}
