/**
 * On-chain skill-license verification + minting (the `skill_license` Anchor
 * program — see contracts/skill-license/).
 * ---------------------------------------------------------------------------
 * The program records each purchased skill as a `SkillLicense` PDA backed by a
 * 1-of-1 SPL NFT in the buyer's wallet. The PDA is derived deterministically
 * from `(owner, agent_mint, sha256(skill_name))`, so anyone can re-derive it and
 * read it back — giving the platform an *alternative, trustless* way to verify
 * skill access that does not depend on our database:
 *
 *     a license PDA that exists with `revoked_at == 0` ⇒ the wallet owns the skill.
 *
 * This module is the JS counterpart to the on-chain program: it derives the same
 * PDAs (matching the Rust `seeds`), decodes the account, verifies ownership, and
 * — when a minter key is configured — builds and submits the `mint_skill_license`
 * instruction. PDA derivation is pure and dependency-light so it is unit-tested
 * directly; the RPC calls are only made by `verify*`/`mint*`.
 */

import { createHash } from 'node:crypto';

import {
	Keypair,
	PublicKey,
	SystemProgram,
	SYSVAR_RENT_PUBKEY,
	Transaction,
	TransactionInstruction,
} from '@solana/web3.js';
import { sendAndConfirm } from './solana/confirm.js';
import bs58 from 'bs58';

import { env } from './env.js';
import { solanaConnection } from './solana/connection.js';

/** Program id baked into the on-chain program's `declare_id!`. Override per
 *  deployment with SKILL_LICENSE_PROGRAM_ID. */
export const SKILL_LICENSE_PROGRAM_ID =
	process.env.SKILL_LICENSE_PROGRAM_ID || '9rPHPFHmdek5WMH92HHtMuXsbeFBbvsetfbxuVZGsWoj';

export const TOKEN_PROGRAM_ID = new PublicKey('TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA');
export const ASSOCIATED_TOKEN_PROGRAM_ID = new PublicKey(
	'ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL',
);

// Seed prefixes — must byte-match the constants in contracts/skill-license/src/lib.rs.
const MARKETPLACE_SEED = Buffer.from('marketplace');
const SKILL_LICENSE_SEED = Buffer.from('skill_license');
const SKILL_MINT_SEED = Buffer.from('skill_mint');

// Anchor instruction discriminators (sha256("global:<name>")[..8]).
const INITIALIZE_MARKETPLACE_DISCRIMINATOR = Buffer.from([47, 81, 64, 0, 96, 56, 105, 7]);
const MINT_DISCRIMINATOR = Buffer.from([179, 127, 15, 8, 180, 22, 10, 122]);

// Anchor account discriminator for `SkillLicense` (sha256("account:SkillLicense")[..8]).
const SKILL_LICENSE_DISCRIMINATOR = Buffer.from([212, 242, 220, 5, 112, 253, 200, 97]);

function programPk(programId) {
	return programId instanceof PublicKey ? programId : new PublicKey(programId);
}

/** sha256(skill_name) — the fixed-length third PDA seed. Matches the Rust
 *  `skill_seed()` (Solana `hash::hash` is sha256). */
export function skillSeed(skillName) {
	return createHash('sha256').update(String(skillName), 'utf8').digest();
}

/** The singleton marketplace config PDA. */
export function deriveMarketplacePda(programId = SKILL_LICENSE_PROGRAM_ID) {
	return PublicKey.findProgramAddressSync([MARKETPLACE_SEED], programPk(programId));
}

/** The license PDA for a given owner + agent + skill. */
export function deriveSkillLicensePda(owner, agentMint, skillName, programId = SKILL_LICENSE_PROGRAM_ID) {
	return PublicKey.findProgramAddressSync(
		[
			SKILL_LICENSE_SEED,
			new PublicKey(owner).toBuffer(),
			new PublicKey(agentMint).toBuffer(),
			skillSeed(skillName),
		],
		programPk(programId),
	);
}

/** The 1/1 NFT mint PDA backing a license. */
export function deriveSkillMintPda(owner, agentMint, skillName, programId = SKILL_LICENSE_PROGRAM_ID) {
	return PublicKey.findProgramAddressSync(
		[
			SKILL_MINT_SEED,
			new PublicKey(owner).toBuffer(),
			new PublicKey(agentMint).toBuffer(),
			skillSeed(skillName),
		],
		programPk(programId),
	);
}

/** The owner's associated token account for a mint (standard ATA derivation). */
export function deriveAssociatedTokenAddress(owner, mint) {
	const [ata] = PublicKey.findProgramAddressSync(
		[new PublicKey(owner).toBuffer(), TOKEN_PROGRAM_ID.toBuffer(), new PublicKey(mint).toBuffer()],
		ASSOCIATED_TOKEN_PROGRAM_ID,
	);
	return ata;
}

/**
 * Decode a raw `SkillLicense` account buffer (Anchor layout). Throws if the
 * discriminator does not match, so a wrong account can never be read as a valid
 * license.
 *
 * @param {Buffer|Uint8Array} data
 */
export function decodeSkillLicense(data) {
	const buf = Buffer.from(data);
	if (buf.length < 8 || !buf.subarray(0, 8).equals(SKILL_LICENSE_DISCRIMINATOR)) {
		throw new Error('not a SkillLicense account (discriminator mismatch)');
	}
	let o = 8;
	const pk = () => {
		const p = new PublicKey(buf.subarray(o, o + 32));
		o += 32;
		return p;
	};
	const authority = pk();
	const agentMint = pk();
	const nftMint = pk();
	const skillHash = Buffer.from(buf.subarray(o, o + 32));
	o += 32;
	const purchaseDate = Number(buf.readBigInt64LE(o));
	o += 8;
	const revokedAt = Number(buf.readBigInt64LE(o));
	o += 8;
	const bump = buf.readUInt8(o);
	o += 1;
	const nameLen = buf.readUInt32LE(o);
	o += 4;
	const skillName = buf.subarray(o, o + nameLen).toString('utf8');

	return {
		authority: authority.toBase58(),
		agentMint: agentMint.toBase58(),
		nftMint: nftMint.toBase58(),
		skillHash: skillHash.toString('hex'),
		purchaseDate,
		revokedAt,
		bump,
		skillName,
		revoked: revokedAt !== 0,
	};
}

function rpcForNetwork(network) {
	return network === 'devnet' ? env.SOLANA_RPC_URL_DEVNET : env.SOLANA_RPC_URL;
}

/** Is the program deployed + executable on this connection? */
export async function isProgramDeployed(connection, programId = SKILL_LICENSE_PROGRAM_ID) {
	const info = await connection.getAccountInfo(programPk(programId));
	return Boolean(info && info.executable);
}

/**
 * Verify whether `ownerWallet` holds an active on-chain license for `skill` on
 * `agentMint`. Reads the license PDA directly — no database involved.
 *
 * @param {object} p
 * @param {string} p.ownerWallet  buyer's base58 Solana pubkey
 * @param {string} p.agentMint    the agent's on-chain grouping mint (base58)
 * @param {string} p.skill        skill name/slug
 * @param {'mainnet'|'devnet'} [p.network]
 * @param {Connection} [p.connection]  reuse an existing connection
 * @param {string} [p.programId]
 * @returns {Promise<{deployed:boolean, exists:boolean, owned:boolean, revoked:boolean,
 *                    license:string, nftMint:string, ownerTokenAccount:string,
 *                    record:ReturnType<typeof decodeSkillLicense>|null}>}
 */
export async function verifyOnchainSkillLicense({
	ownerWallet,
	agentMint,
	skill,
	network = 'mainnet',
	connection,
	programId = SKILL_LICENSE_PROGRAM_ID,
}) {
	const conn = connection || solanaConnection({ url: rpcForNetwork(network), commitment: 'confirmed', network });
	const [license] = deriveSkillLicensePda(ownerWallet, agentMint, skill, programId);
	const [nftMint] = deriveSkillMintPda(ownerWallet, agentMint, skill, programId);
	const ownerTokenAccount = deriveAssociatedTokenAddress(ownerWallet, nftMint);

	const base = {
		license: license.toBase58(),
		nftMint: nftMint.toBase58(),
		ownerTokenAccount: ownerTokenAccount.toBase58(),
	};

	const deployed = await isProgramDeployed(conn, programId);
	if (!deployed) {
		return { deployed: false, exists: false, owned: false, revoked: false, record: null, ...base };
	}

	const info = await conn.getAccountInfo(license);
	if (!info) {
		return { deployed: true, exists: false, owned: false, revoked: false, record: null, ...base };
	}

	let record;
	try {
		record = decodeSkillLicense(info.data);
	} catch {
		return { deployed: true, exists: false, owned: false, revoked: false, record: null, ...base };
	}

	const owned = record.revokedAt === 0 && record.authority === new PublicKey(ownerWallet).toBase58();
	return {
		deployed: true,
		exists: true,
		owned,
		revoked: record.revoked,
		record,
		...base,
	};
}

/** Load the minter keypair from the environment (base58 secret), or null. */
export function minterKeypair() {
	const secret = process.env.SKILL_LICENSE_MINTER_KEY;
	if (!secret) return null;
	return Keypair.fromSecretKey(bs58.decode(secret.trim()));
}

/**
 * Build the one-time `initialize_marketplace` instruction. `authority` becomes
 * the admin (can rotate the minter); `minter` is the wallet allowed to mint
 * licenses. Account order matches the IDL / `InitializeMarketplace` struct.
 */
export function buildInitializeMarketplaceIx({
	authority,
	minter,
	programId = SKILL_LICENSE_PROGRAM_ID,
}) {
	const pid = programPk(programId);
	const [marketplace] = deriveMarketplacePda(pid);
	const data = Buffer.concat([
		INITIALIZE_MARKETPLACE_DISCRIMINATOR,
		new PublicKey(minter).toBuffer(),
	]);
	const keys = [
		{ pubkey: marketplace, isSigner: false, isWritable: true },
		{ pubkey: new PublicKey(authority), isSigner: true, isWritable: true },
		{ pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
	];
	return {
		instruction: new TransactionInstruction({ programId: pid, keys, data }),
		accounts: { marketplace: marketplace.toBase58() },
	};
}

/** Borsh-encode a string (u32 LE length + utf8 bytes). */
function encodeString(value) {
	const bytes = Buffer.from(value, 'utf8');
	const len = Buffer.alloc(4);
	len.writeUInt32LE(bytes.length);
	return Buffer.concat([len, bytes]);
}

/**
 * Build the `mint_skill_license` instruction. Account order must match the IDL /
 * `MintSkillLicense` accounts struct exactly.
 */
export function buildMintSkillLicenseIx({
	minter,
	owner,
	agentMint,
	skillName,
	programId = SKILL_LICENSE_PROGRAM_ID,
}) {
	const pid = programPk(programId);
	const ownerPk = new PublicKey(owner);
	const agentPk = new PublicKey(agentMint);
	const [marketplace] = deriveMarketplacePda(pid);
	const [skillLicense] = deriveSkillLicensePda(ownerPk, agentPk, skillName, pid);
	const [nftMint] = deriveSkillMintPda(ownerPk, agentPk, skillName, pid);
	const ownerTokenAccount = deriveAssociatedTokenAddress(ownerPk, nftMint);

	const data = Buffer.concat([MINT_DISCRIMINATOR, encodeString(skillName)]);

	const keys = [
		{ pubkey: marketplace, isSigner: false, isWritable: true },
		{ pubkey: new PublicKey(minter), isSigner: true, isWritable: true },
		{ pubkey: ownerPk, isSigner: false, isWritable: false },
		{ pubkey: agentPk, isSigner: false, isWritable: false },
		{ pubkey: skillLicense, isSigner: false, isWritable: true },
		{ pubkey: nftMint, isSigner: false, isWritable: true },
		{ pubkey: ownerTokenAccount, isSigner: false, isWritable: true },
		{ pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
		{ pubkey: ASSOCIATED_TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
		{ pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
		{ pubkey: SYSVAR_RENT_PUBKEY, isSigner: false, isWritable: false },
	];

	return {
		instruction: new TransactionInstruction({ programId: pid, keys, data }),
		accounts: {
			marketplace: marketplace.toBase58(),
			skillLicense: skillLicense.toBase58(),
			nftMint: nftMint.toBase58(),
			ownerTokenAccount: ownerTokenAccount.toBase58(),
		},
	};
}

/**
 * Mint an on-chain skill license to `ownerWallet`. Server-signed by the
 * configured minter keypair. Idempotent at the program level: a second mint for
 * the same (owner, agent, skill) fails because the license/mint PDAs already
 * exist — callers should treat an "already in use" error as success.
 *
 * @returns {Promise<{signature:string, license:string, nftMint:string, ownerTokenAccount:string, alreadyMinted:boolean}>}
 */
export async function mintSkillLicenseOnchain({
	ownerWallet,
	agentMint,
	skill,
	network = 'mainnet',
	connection,
	programId = SKILL_LICENSE_PROGRAM_ID,
}) {
	const minter = minterKeypair();
	if (!minter) {
		throw Object.assign(new Error('SKILL_LICENSE_MINTER_KEY not configured'), {
			code: 'minter_unconfigured',
		});
	}
	const conn = connection || solanaConnection({ url: rpcForNetwork(network), commitment: 'confirmed', network });

	const { instruction, accounts } = buildMintSkillLicenseIx({
		minter: minter.publicKey,
		owner: ownerWallet,
		agentMint,
		skillName: skill,
		programId,
	});

	// If the license PDA already exists this mint is a no-op success.
	const existing = await conn.getAccountInfo(new PublicKey(accounts.skillLicense));
	if (existing) {
		return { signature: null, ...accounts, alreadyMinted: true };
	}

	const tx = new Transaction().add(instruction);
	const signature = await sendAndConfirm(conn, tx, [minter], {
		commitment: 'confirmed',
	});
	return { signature, ...accounts, alreadyMinted: false };
}
