// Card gacha on /play: the server-side guards and normalizers behind
// /api/gacha/* (api/_lib/collectorcrypt-gacha.js) and the machine's reach in
// multiplayer/src/world-features.js.
//
// The transaction guards are the safety-critical part: a player is only asked
// to sign a pack payment after the server proves it is exactly one USDC
// transfer of the machine price to Collector Crypt's treasury, and a buyback
// only after it proves nothing but the card leaves the wallet. Every fixture
// here is a synthetic transaction built from freshly generated keys.

import { describe, it, expect } from 'vitest';
import {
	Keypair, PublicKey, SystemProgram, Transaction, TransactionInstruction,
	TransactionMessage, VersionedTransaction,
} from '@solana/web3.js';
import {
	GACHA_NETWORKS, GachaTxRejected, normalizeNetwork, isSolanaAddress, isPackCode, isMemo, isBase64Tx,
	formatUsdc, usdToAtomic, describePackError, normalizeMachines, normalizeCard, normalizeWinner,
	normalizeOpenResult, normalizePackStatus, decodeTransaction, inspectPackTransaction,
	inspectBuybackTransaction, transactionId,
} from '../api/_lib/collectorcrypt-gacha.js';
import { GACHA, GACHA_REACH, gachaInRange, nearestGacha } from '../multiplayer/src/world-features.js';

const TOKEN = new PublicKey('TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA');
const MEMO_PROGRAM = new PublicKey('MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr');
const COMPUTE = new PublicKey('ComputeBudget111111111111111111111111111111');
const BLOCKHASH = '11111111111111111111111111111111';
const NET = GACHA_NETWORKS.devnet;

const fakeSig = () => Buffer.alloc(64, 7);

function transferChecked({ source, mint, destination, authority, amount, decimals = 6 }) {
	const data = Buffer.alloc(10);
	data[0] = 12;
	data.writeBigUInt64LE(BigInt(amount), 1);
	data[9] = decimals;
	return new TransactionInstruction({
		programId: TOKEN,
		keys: [
			{ pubkey: source, isSigner: false, isWritable: true },
			{ pubkey: mint, isSigner: false, isWritable: false },
			{ pubkey: destination, isSigner: false, isWritable: true },
			{ pubkey: authority, isSigner: true, isWritable: false },
		],
		data,
	});
}

function tokenIx(op, keys, amount) {
	const data = Buffer.alloc(amount == null ? 1 : 9);
	data[0] = op;
	if (amount != null) data.writeBigUInt64LE(BigInt(amount), 1);
	return new TransactionInstruction({ programId: TOKEN, keys, data });
}

/** A pack transaction shaped like Collector Crypt's generatePack output. */
function packTx({ player, amount = 25_000_000, overrides = {}, extra = [], presign = true }) {
	const feePayer = new PublicKey(overrides.feePayer || NET.gachaWallet);
	const tx = new Transaction({ feePayer, recentBlockhash: BLOCKHASH });
	tx.add(new TransactionInstruction({ programId: COMPUTE, keys: [], data: Buffer.from([2, 0x40, 0x0d, 0x03, 0x00]) }));
	tx.add(new TransactionInstruction({ programId: MEMO_PROGRAM, keys: [], data: Buffer.from('cc-pokemon_25-test') }));
	tx.add(transferChecked({
		source: Keypair.generate().publicKey,
		mint: new PublicKey(overrides.mint || NET.usdcMint),
		destination: new PublicKey(overrides.destination || NET.laneTreasury),
		authority: overrides.authority || player,
		amount,
		decimals: overrides.decimals ?? 6,
	}));
	for (const ix of extra) tx.add(ix);
	tx.compileMessage();
	if (presign) tx.addSignature(feePayer, fakeSig());
	return tx.serialize({ requireAllSignatures: false, verifySignatures: false }).toString('base64');
}

function inspectPack(b64, player, expectedAtomic = 25_000_000n) {
	return inspectPackTransaction(decodeTransaction(b64), { player: player.toBase58(), net: 'devnet', expectedAtomic });
}

describe('gacha input validators', () => {
	it('accepts only real base58 public keys', () => {
		expect(isSolanaAddress(Keypair.generate().publicKey.toBase58())).toBe(true);
		expect(isSolanaAddress('not-an-address')).toBe(false);
		expect(isSolanaAddress('0OIl'.repeat(10))).toBe(false);
		expect(isSolanaAddress(null)).toBe(false);
	});
	it('validates pack codes and memos', () => {
		expect(isPackCode('pokemon_50')).toBe(true);
		expect(isPackCode('Pokemon 50')).toBe(false);
		expect(isPackCode('../etc')).toBe(false);
		expect(isMemo('cc-1f0e2d3c-4b5a-4968-8776-655443322110')).toBe(true);
		expect(isMemo('cc-not-a-uuid')).toBe(false);
	});
	it('validates base64 transactions by shape and size', () => {
		expect(isBase64Tx('A'.repeat(100))).toBe(true);
		expect(isBase64Tx('short')).toBe(false);
		expect(isBase64Tx('A'.repeat(100) + '!')).toBe(false);
		expect(isBase64Tx('A'.repeat(5000))).toBe(false);
	});
	it('normalizes the network to mainnet unless devnet is asked for', () => {
		expect(normalizeNetwork('devnet')).toBe('devnet');
		expect(normalizeNetwork('testnet')).toBe('mainnet');
		expect(normalizeNetwork(undefined)).toBe('mainnet');
	});
});

describe('gacha USDC formatting', () => {
	it('formats base units to a decimal string', () => {
		expect(formatUsdc(46_750_000n)).toBe('46.75');
		expect(formatUsdc('25000000')).toBe('25.00');
		expect(formatUsdc(1_234_567)).toBe('1.234567');
		expect(formatUsdc('garbage')).toBe(null);
		expect(formatUsdc(-1)).toBe(null);
	});
	it('converts a USD price to base units without float drift', () => {
		expect(usdToAtomic(25)).toBe(25_000_000n);
		expect(usdToAtomic(0.1 + 0.2)).toBe(300_000n);
		expect(usdToAtomic(0)).toBe(null);
		expect(usdToAtomic('abc')).toBe(null);
	});
});

describe('describePackError', () => {
	it('maps upstream refusals to actionable codes', () => {
		expect(describePackError(429, { details: 'too many open packs' }).code).toBe('too_many_open');
		expect(describePackError(429, {}).code).toBe('too_many_pending');
		expect(describePackError(503, {}).code).toBe('busy');
		expect(describePackError(400, { details: 'Machine is empty' }).code).toBe('machine_empty');
		expect(describePackError(400, { details: 'Machine is off balance' }).code).toBe('machine_rebalancing');
		expect(describePackError(400, { details: 'Machine is off' }).code).toBe('machine_off');
		expect(describePackError(500, {}).code).toBe('upstream_error');
	});
});

describe('normalizeMachines', () => {
	const machines = {
		machines: [
			{
				code: 'pokemon_50', name: 'Pokemon  50 ', menuCategory: 'Pokemon', public: true, price: 50,
				thumbnailUrl: '/pokemon_50.png', imageNobg: 'https://example.public.blob.vercel-storage.com/p50.png',
				odds: { epic: 0.02, rare: 0.1, uncommon: 0.3, common: 0.58 },
				tierRanges: { epic: { start: 250, end: 2000 } },
				stock: { epic: 3, rare: 10, uncommon: 40, common: 100 }, instantBuyback: 85, turboMode: true, menuOrder: 2,
			},
			{ code: 'pokemon_25', name: 'Pokemon 25', public: true, price: 25, thumbnailUrl: '/pokemon_25.png', stock: {}, odds: {} },
			{ code: 'closed_one', name: 'Closed', public: true, price: 10, stock: { common: 5 }, odds: {} },
			{ code: 'private_one', name: 'Hidden', public: false, price: 10, stock: { common: 5 }, odds: {} },
			{ code: 'Bad Code', name: 'Bad', public: true, price: 10 },
		],
	};
	const status = { machineStatus: 'running', gachas: [
		{ code: 'pokemon_50', isOpen: true }, { code: 'pokemon_25', isOpen: true },
		{ code: 'closed_one', isOpen: false }, { code: 'private_one', isOpen: true },
	] };

	it('keeps public open machines, cheapest first', () => {
		const list = normalizeMachines(machines, status, { base: NET.base });
		expect(list.map((m) => m.code)).toEqual(['pokemon_25', 'pokemon_50']);
	});
	it('resolves relative thumbnails against the upstream base and prefers the cut-out art', () => {
		const [p25, p50] = normalizeMachines(machines, status, { base: NET.base });
		expect(p25.thumbnail).toBe(`${NET.base}/pokemon_25.png`);
		expect(p25.art).toBe(`${NET.base}/pokemon_25.png`);
		expect(p50.art).toBe('https://example.public.blob.vercel-storage.com/p50.png');
		expect(p50.thumbnail).toBe(`${NET.base}/pokemon_50.png`);
	});
	it('collapses whitespace in names and sums stock', () => {
		const p50 = normalizeMachines(machines, status).find((m) => m.code === 'pokemon_50');
		expect(p50.name).toBe('Pokemon 50');
		expect(p50.totalStock).toBe(153);
		expect(p50.available).toBe(true);
		expect(p50.tierRanges.epic).toEqual({ start: 250, end: 2000 });
		expect(p50.tierRanges.rare).toBe(null);
	});
	it('marks a machine with no stock as unavailable', () => {
		const p25 = normalizeMachines(machines, status).find((m) => m.code === 'pokemon_25');
		expect(p25.available).toBe(false);
	});
	it('closes every machine when the fleet is not running', () => {
		expect(normalizeMachines(machines, { ...status, machineStatus: 'maintenance' })).toEqual([]);
	});
});

describe('card normalizers', () => {
	const mint = Keypair.generate().publicKey.toBase58();
	const nft = {
		id: mint,
		content: {
			metadata: {
				name: 'Charizard  PSA 10 ',
				attributes: [
					{ trait_type: 'Card Name', value: 'Charizard' },
					{ trait_type: 'Set', value: 'Base Set' },
					{ trait_type: 'Year', value: 1999 },
					{ trait_type: 'Grading Company', value: 'PSA' },
					{ trait_type: 'The Grade', value: '10' },
					{ trait_type: 'Insured Value', value: '420' },
				],
			},
			files: [{ cc_cdn: 'https://cdn.example.net/front/charizard.jpg' }],
		},
	};

	it('flattens a DAS asset into the card shape the UI renders', () => {
		const c = normalizeCard(nft, { tier: 'epic' });
		expect(c).toMatchObject({ address: mint, name: 'Charizard', title: 'Charizard PSA 10', set: 'Base Set', year: '1999', grader: 'PSA', grade: '10', tier: 'epic' });
		expect(c.image).toBe('https://cdn.example.net/front/charizard.jpg');
		expect(normalizeCard(null)).toBe(null);
	});
	it('adds the timestamp to a winner row', () => {
		const w = normalizeWinner({ nft, rarity: 1, timestamp: '2026-10-31T12:00:00Z', wallet: Keypair.generate().publicKey.toBase58() });
		expect(w.at).toBe('2026-10-31T12:00:00Z');
	});
	it('reads an openPack result: waiting, won, turbo-sold', () => {
		expect(normalizeOpenResult({ code: 'WAITING_FOR_WEBHOOK' })).toEqual({ state: 'waiting' });
		expect(normalizeOpenResult(null)).toEqual({ state: 'error' });
		const won = normalizeOpenResult({ nft_address: mint, nftWon: nft, rarity: 'Rare', points: 12, roll: 3456 });
		expect(won).toMatchObject({ state: 'won', nftAddress: mint, points: 12, roll: 3456, turboSold: false, turboPayout: null });
		expect(won.card.tier).toBe('rare');
		const turbo = normalizeOpenResult({ code: 'TURBO_MODE_BUYBACK', nft_address: mint, nftWon: nft, rarity: 'common', buybackAmount: 21_250_000 });
		expect(turbo).toMatchObject({ turboSold: true, turboPayout: '21.25' });
	});
	it('reads pack status', () => {
		expect(normalizePackStatus({})).toMatchObject({ found: false, paid: false, delivered: false });
		expect(normalizePackStatus({ pack: { status: 'pending' } })).toMatchObject({ found: true, paid: false });
		expect(normalizePackStatus({ pack: { webhook_received: true }, send: { transaction_signature: 'turbomode' } })).toMatchObject({ paid: true, delivered: true });
		const st = normalizePackStatus({ pack: { pack_type: 'pokemon_50', status: 'confirmed', refunded: false, turbo_mode: true }, send: { nft_address: mint, status: 'confirmed' } });
		expect(st).toMatchObject({ found: true, paid: true, delivered: true, turbo: true, packType: 'pokemon_50', nftAddress: mint });
	});
});

describe('inspectPackTransaction', () => {
	const player = Keypair.generate().publicKey;

	it('accepts the exact payment and reports what the player will pay', () => {
		const out = inspectPack(packTx({ player }), player);
		expect(out).toMatchObject({ amountAtomic: '25000000', amountUsdc: '25.00', mint: NET.usdcMint, destination: NET.laneTreasury, feePayer: NET.gachaWallet });
	});
	it('rejects a price that differs from the machine', () => {
		expect(() => inspectPack(packTx({ player, amount: 26_000_000 }), player)).toThrow(/does not match the machine price/);
	});
	it('rejects a payment to any other wallet', () => {
		const destination = Keypair.generate().publicKey.toBase58();
		expect(() => inspectPack(packTx({ player, overrides: { destination } }), player)).toThrow(/treasury/);
	});
	it('rejects a token other than USDC', () => {
		const mint = Keypair.generate().publicKey.toBase58();
		expect(() => inspectPack(packTx({ player, overrides: { mint } }), player)).toThrow(/not in USDC/);
	});
	it('rejects when the player would pay the network fee', () => {
		expect(() => inspectPack(packTx({ player, overrides: { feePayer: player.toBase58() } }), player)).toThrow(/fee payer/);
	});
	it('rejects a transaction the gacha wallet did not pre-sign', () => {
		expect(() => inspectPack(packTx({ player, presign: false }), player)).toThrow(/pre-signed/);
	});
	it('rejects a second payment hidden behind the first', () => {
		const extra = transferChecked({ source: Keypair.generate().publicKey, mint: new PublicKey(NET.usdcMint), destination: new PublicKey(NET.laneTreasury), authority: player, amount: 25_000_000 });
		expect(() => inspectPack(packTx({ player, extra: [extra] }), player)).toThrow(/more than one payment/);
	});
	it('rejects a SOL transfer riding along', () => {
		const extra = SystemProgram.transfer({ fromPubkey: player, toPubkey: Keypair.generate().publicKey, lamports: 1_000_000 });
		expect(() => inspectPack(packTx({ player, extra: [extra] }), player)).toThrow(GachaTxRejected);
	});
	it('rejects a transaction addressed to a different player', () => {
		const other = Keypair.generate().publicKey;
		expect(() => inspectPack(packTx({ player }), other)).toThrow(/player/);
	});
});

describe('inspectBuybackTransaction', () => {
	const player = Keypair.generate().publicKey;
	const nft = Keypair.generate().publicKey;
	const acct = () => Keypair.generate().publicKey;
	const signerKey = (pubkey) => ({ pubkey, isSigner: true, isWritable: false });
	const key = (pubkey) => ({ pubkey, isSigner: false, isWritable: true });

	function buybackV0(instructions) {
		const msg = new TransactionMessage({ payerKey: new PublicKey(NET.gachaWallet), recentBlockhash: BLOCKHASH, instructions }).compileToV0Message();
		return Buffer.from(new VersionedTransaction(msg).serialize()).toString('base64');
	}
	const inspect = (b64) => inspectBuybackTransaction(decodeTransaction(b64), { player: player.toBase58(), net: 'devnet', nftAddress: nft.toBase58() });

	it('accepts moving the one card and closing its account back to the player', () => {
		const card = acct();
		const b64 = buybackV0([
			transferChecked({ source: card, mint: nft, destination: acct(), authority: player, amount: 1, decimals: 0 }),
			tokenIx(9, [key(card), key(player), signerKey(player)]),
		]);
		expect(inspect(b64)).toMatchObject({ version: 0, feePayer: NET.gachaWallet });
	});
	it('rejects moving a token that is not the card', () => {
		const b64 = buybackV0([transferChecked({ source: acct(), mint: acct(), destination: acct(), authority: player, amount: 1, decimals: 0 })]);
		expect(() => inspect(b64)).toThrow(/not the card/);
	});
	it('rejects moving more than one token', () => {
		const b64 = buybackV0([tokenIx(3, [key(acct()), key(acct()), signerKey(player)], 500_000_000)]);
		expect(() => inspect(b64)).toThrow(/more than the card/);
	});
	it('rejects a delegate approval signed by the player', () => {
		const b64 = buybackV0([tokenIx(4, [key(acct()), key(acct()), signerKey(player)], 1)]);
		expect(() => inspect(b64)).toThrow(/token change/);
	});
	it('rejects SOL leaving the player beyond rent', () => {
		const b64 = buybackV0([SystemProgram.transfer({ fromPubkey: player, toPubkey: new PublicKey(NET.rentDestination), lamports: 50_000_000 })]);
		expect(() => inspect(b64)).toThrow(/SOL out/);
	});
	it('allows returning one account of rent to the documented destination', () => {
		const b64 = buybackV0([SystemProgram.transfer({ fromPubkey: player, toPubkey: new PublicKey(NET.rentDestination), lamports: 1_488_440 })]);
		expect(() => inspect(b64)).not.toThrow();
	});
	it('rejects closed-account rent sent to a stranger', () => {
		const b64 = buybackV0([tokenIx(9, [key(acct()), key(acct()), signerKey(player)])]);
		expect(() => inspect(b64)).toThrow(/rent elsewhere/);
	});
	it('rejects a transaction the player does not sign', () => {
		const b64 = buybackV0([tokenIx(9, [key(acct()), key(new PublicKey(NET.rentDestination)), signerKey(acct())])]);
		expect(() => inspect(b64)).toThrow(/player to sign/);
	});

	// Collector Crypt cards are Metaplex Core assets; the documented buyback is
	// an mpl-core TransferV1 of the card followed by cc_buyback::authorize_and_pay.
	const CORE = new PublicKey('CoREENxT6tW1HoK8ypY1SxRMZTcVPm7R94rH4PZNhX7d');
	const CC_BUYBACK = new PublicKey('CcBuyM7sDhedBGLZxivBvgZVdqzrQAG66KYHgnTTEpLF');
	const TOKEN_METADATA = new PublicKey('metaqbxxUerdq28cj1RbAWkYQm3ybzjb6a8bt518x1s');
	const ATA_PROGRAM = new PublicKey('ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL');
	const coreTransfer = (asset, authority = player) => new TransactionInstruction({
		programId: CORE,
		keys: [key(asset), key(new PublicKey('CCryptUfeFSZ3Fgc9FLeKrhLVAP67FSqi1GuVoj9CRac')), signerKey(authority), signerKey(authority), key(acct())],
		data: Buffer.from([14, 0]),
	});
	const authorizeAndPay = () => new TransactionInstruction({
		programId: CC_BUYBACK,
		keys: [signerKey(player), key(nft), key(acct()), key(acct())],
		data: Buffer.alloc(16, 3),
	});
	const ata = (owner, mint) => PublicKey.findProgramAddressSync([owner.toBuffer(), TOKEN.toBuffer(), mint.toBuffer()], ATA_PROGRAM)[0];
	const playerPaysV0 = (instructions) => {
		const msg = new TransactionMessage({ payerKey: player, recentBlockhash: BLOCKHASH, instructions }).compileToV0Message();
		return Buffer.from(new VersionedTransaction(msg).serialize()).toString('base64');
	};
	const computePrice = (microLamports) => {
		const data = Buffer.alloc(9);
		data[0] = 3;
		data.writeBigUInt64LE(BigInt(microLamports), 1);
		return new TransactionInstruction({ programId: COMPUTE, keys: [], data });
	};
	const computeLimit = (units) => {
		const data = Buffer.alloc(5);
		data[0] = 2;
		data.writeUInt32LE(units, 1);
		return new TransactionInstruction({ programId: COMPUTE, keys: [], data });
	};

	it('accepts the documented Core buyback: transfer the card, then authorize_and_pay', () => {
		const b64 = playerPaysV0([computeLimit(300_000), computePrice(50_000), coreTransfer(nft), authorizeAndPay()]);
		expect(() => inspect(b64)).not.toThrow();
	});
	it('rejects a Core transfer of a different asset the player owns', () => {
		const b64 = buybackV0([coreTransfer(acct()), authorizeAndPay()]);
		expect(() => inspect(b64)).toThrow(/not the card/);
	});
	it('rejects any other Core instruction the player signs (burn, plugin approval)', () => {
		const burn = new TransactionInstruction({ programId: CORE, keys: [key(nft), key(acct()), signerKey(player), signerKey(player)], data: Buffer.from([12, 0]) });
		expect(() => inspect(buybackV0([burn]))).toThrow(/Core change/);
	});
	it('rejects an unchecked token transfer of one unit from an account that is not the card', () => {
		// A second NFT the player holds also has amount 1; an unchecked Transfer
		// names no mint, so only the source account can tell it apart.
		const b64 = buybackV0([tokenIx(3, [key(acct()), key(acct()), signerKey(player)], 1)]);
		expect(() => inspect(b64)).toThrow(/not the card/);
	});
	it('accepts an unchecked transfer of one unit out of the card account', () => {
		const b64 = buybackV0([tokenIx(3, [key(ata(player, nft)), key(acct()), signerKey(player)], 1)]);
		expect(() => inspect(b64)).not.toThrow();
	});
	it('rejects a checked transfer whose mint is hidden behind a lookup table', () => {
		const decoded = {
			version: 0, feePayer: NET.gachaWallet, signers: [NET.gachaWallet, player.toBase58()], signatures: [], usesLookupTables: true,
			instructions: [{
				programId: TOKEN.toBase58(),
				keys: [{ pubkey: acct().toBase58(), isSigner: false }, { pubkey: null, isSigner: false }, { pubkey: acct().toBase58(), isSigner: false }, { pubkey: player.toBase58(), isSigner: true }],
				data: Buffer.from([12, 1, 0, 0, 0, 0, 0, 0, 0, 0]),
			}],
		};
		expect(() => inspectBuybackTransaction(decoded, { player: player.toBase58(), net: 'devnet', nftAddress: nft.toBase58() })).toThrow(/not the card/);
	});
	it('rejects a program that is not part of a Collector Crypt sale, even one the player signs for', () => {
		// Any program the player signs for can spend the player's authority by CPI.
		const rogue = new TransactionInstruction({ programId: acct(), keys: [signerKey(player), key(acct())], data: Buffer.from([1]) });
		expect(() => inspect(buybackV0([coreTransfer(nft), rogue]))).toThrow(/unexpected program/);
	});
	it('rejects a Token Metadata transfer of a different mint', () => {
		const keys = Array.from({ length: 13 }, () => key(acct()));
		keys[9] = signerKey(player);
		const ix = new TransactionInstruction({ programId: TOKEN_METADATA, keys, data: Buffer.from([49, 0, 1, 0, 0, 0, 0, 0, 0, 0, 0]) });
		expect(() => inspect(buybackV0([ix]))).toThrow(/not the card/);
	});
	it('rejects several rent-sized SOL transfers that add up to a drain', () => {
		const rent = () => SystemProgram.transfer({ fromPubkey: player, toPubkey: new PublicKey(NET.rentDestination), lamports: 2_000_000 });
		expect(() => inspect(buybackV0([rent(), rent(), rent()]))).toThrow(/SOL out/);
	});
	it('rejects a priority fee that would drain a player who pays the network fee', () => {
		const b64 = playerPaysV0([computeLimit(1_400_000), computePrice(500_000_000), coreTransfer(nft), authorizeAndPay()]);
		expect(() => inspect(b64)).toThrow(/priority fee/);
	});
});

describe('transactionId', () => {
	it('returns the first signature in base58 or null when unsigned', () => {
		const player = Keypair.generate().publicKey;
		const signed = packTx({ player });
		expect(transactionId(signed)).toMatch(/^[1-9A-HJ-NP-Za-km-z]{64,90}$/);
		const unsigned = packTx({ player, presign: false });
		expect(transactionId(unsigned)).toBe(null);
	});
});

describe('gacha machine placement', () => {
	const [spot] = GACHA;
	it('is reachable within its reach radius and not beyond', () => {
		expect(gachaInRange(spot.x, spot.z + spot.r + GACHA_REACH * 0.9)?.id).toBe('gacha-plaza');
		expect(gachaInRange(spot.x, spot.z + spot.r + GACHA_REACH + 0.5)).toBe(null);
		expect(nearestGacha(spot.x + 0.5, spot.z)?.node.id).toBe('gacha-plaza');
	});
	it('faces the plaza centre', () => {
		const toCentre = Math.atan2(-spot.x, -spot.z);
		expect(Math.abs(spot.yaw - toCentre)).toBeLessThan(1e-9);
	});
});
