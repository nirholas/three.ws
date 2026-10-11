// Funded launch intents: a quoted pump.fun launch that is paid for, confirmed
// and executed in separate, checkable steps.
//
// The flow, one row in `pump_funded_launch_intents` per launch:
//
//   quote      POST /api/pump/launch-intents. Any credential (session or
//              bearer) may create one. The response carries every fee line,
//              the quote's expiry, the agent wallet that has to be funded and
//              a one-time preflight token.
//   paid       POST /api/pump/launch-intents/:id/pay from a same-site session.
//              The proof is the funding transaction's signature plus the
//              preflight token. It is accepted once; the same signature replays
//              the stored result, a different one is refused.
//   (approval) POST /api/pump/launch-intents/:id/confirm from a same-site
//              session queues the spend from the agent wallet as an approval
//              request (recipient, amount, asset, chain, explicit yes). The
//              approval executor is the only code that signs the launch.
//   submitted  The executor broadcast the create transaction.
//   confirmed  The transaction is confirmed on-chain.
//   indexed    The bonding curve account is readable.
//
// A bearer token can create an intent and poll it. It can never pay, confirm
// or sign: the handler enforces that, and the executor runs only from an
// approved request the owner answered in the browser or a paired chat.
//
// The dry run simulates the exact launch transaction on the intent's network
// with a throwaway mint and never broadcasts, so a devnet intent exercises the
// whole lane without touching mainnet.

import { Keypair, PublicKey, TransactionMessage, VersionedTransaction } from '@solana/web3.js';
import { sql } from './db.js';
import { env } from './env.js';
import { randomToken, sha256, constantTimeEquals } from './crypto.js';
import { encryptSecret, decryptSecret } from './secret-box.js';
import { logAudit } from './audit.js';
import { logger } from './usage.js';
import { findLaunchPair, earningsProjection } from './pump-launch-pairs.js';
import { getPumpSdk, solanaPubkey, verifySignature, getConnection } from './pump.js';
import { WSOL_MINT, walletQuoteDeltaAtomics } from './pump-quote.js';
import { pumpLaunchFeeBps, pumpFeeAtomics, pumpFeeRecipient, buildPlatformFeeInstructions } from './pump-platform-fee.js';
import { FIXED_LAUNCH_COST_SOL } from './agent-token-plan.js';
import { getOrCreateAgentSolanaWallet, getSolanaAddressBalances } from './agent-wallet.js';
import { createApprovalRequest } from './approvals.js';
import { solPriceUsd } from './sol-price.js';
import { THREE_WS_VANITY, hasThreeWsMark } from '../../src/solana/vanity/brand.js';
import { grindVanityNode, GrindExhaustedError } from '../../src/solana/vanity/grinder-node.js';

const log = logger('pump-funded-launch');

export const QUOTE_TTL_MS = 15 * 60 * 1000;
export const STAGES = Object.freeze(['quote', 'paid', 'submitted', 'confirmed', 'indexed']);
export const TERMINAL_STAGES = Object.freeze(['failed', 'expired']);
const LAMPORTS = 1_000_000_000;
const MAX_INITIAL_BUY = Object.freeze({ sol: 100, stable: 250_000, exotic: 1_000_000 });

export class FundedLaunchError extends Error {
	constructor(status, code, message, extra = {}) {
		super(message);
		this.status = status;
		this.code = code;
		this.expose = true;
		this.extra = extra;
	}
}

const explorerTx = (sig, network) => (sig ? `https://solscan.io/tx/${sig}${network === 'devnet' ? '?cluster=devnet' : ''}` : null);
const explorerAccount = (addr, network) => (addr ? `https://solscan.io/account/${addr}${network === 'devnet' ? '?cluster=devnet' : ''}` : null);
const iso = (v) => (v ? new Date(v).toISOString() : null);
const ui = (atomics, decimals) => Number(atomics) / 10 ** decimals;
const atomicsFromUi = (amount, decimals) => BigInt(Math.round(Number(amount) * 10 ** decimals));
const bpsOf = (atomics, bps) => (BigInt(atomics) * BigInt(bps)) / 10_000n;

// ── validation ────────────────────────────────────────────────────────────────

function validateInput(raw = {}) {
	const name = String(raw.name ?? '').trim();
	const symbol = String(raw.symbol ?? '').trim();
	const description = String(raw.description ?? '').trim();
	const imageUrl = String(raw.image_url ?? raw.imageUrl ?? raw.image ?? '').trim();
	const network = String(raw.network ?? 'mainnet').toLowerCase();
	if (!name || name.length > 32) throw new FundedLaunchError(400, 'validation_error', 'name is required and must be at most 32 characters');
	if (!symbol || symbol.length > 10 || !/^[A-Za-z0-9$_.-]+$/.test(symbol)) throw new FundedLaunchError(400, 'validation_error', 'symbol is required, at most 10 characters, letters and digits');
	if (description.length > 1000) throw new FundedLaunchError(400, 'validation_error', 'description must be at most 1000 characters');
	let image;
	try {
		image = new URL(imageUrl);
	} catch {
		throw new FundedLaunchError(400, 'validation_error', 'image_url must be an absolute https URL');
	}
	if (image.protocol !== 'https:') throw new FundedLaunchError(400, 'validation_error', 'image_url must use https');
	if (network !== 'mainnet' && network !== 'devnet') throw new FundedLaunchError(400, 'validation_error', 'network must be mainnet or devnet');
	const initialBuy = raw.initial_buy == null || raw.initial_buy === '' ? 0 : Number(raw.initial_buy);
	if (!Number.isFinite(initialBuy) || initialBuy < 0) throw new FundedLaunchError(400, 'validation_error', 'initial_buy must be a non-negative number in the quote asset');
	let creatorFeeBps = null;
	if (raw.creator_fee_bps != null && raw.creator_fee_bps !== '') {
		creatorFeeBps = Number(raw.creator_fee_bps);
		if (!Number.isInteger(creatorFeeBps) || creatorFeeBps < 0 || creatorFeeBps > 10_000) throw new FundedLaunchError(400, 'validation_error', 'creator_fee_bps must be an integer between 0 and 10000');
	}
	return {
		name,
		symbol: symbol.toUpperCase(),
		description,
		imageUrl: image.toString(),
		network,
		quote: String(raw.quote ?? raw.quote_asset ?? raw.quote_mint ?? 'sol').trim(),
		initialBuy,
		creatorFeeBps,
	};
}

/**
 * The creator fee a launch on `pair` will carry: the creator's pick when the
 * program lets them choose, else the schedule rate. Throws on a pick outside
 * the allowed range, with the range in the error so a client can correct it.
 */
export function resolveCreatorFee(pair, requestedBps) {
	const rule = pair.creator_fee || {};
	if (rule.configurable) {
		const bps = requestedBps == null ? rule.default_bps : requestedBps;
		if (bps < rule.min_bps || bps > rule.max_bps) {
			throw new FundedLaunchError(400, 'creator_fee_out_of_range', `creator_fee_bps must be between ${rule.min_bps} and ${rule.max_bps} on ${pair.symbol}`, { min_bps: rule.min_bps, max_bps: rule.max_bps, default_bps: rule.default_bps });
		}
		return { bps, configurable: true, min_bps: rule.min_bps, max_bps: rule.max_bps, default_bps: rule.default_bps };
	}
	const fixed = rule.fixed_bps ?? pair.fees?.creator_bps ?? null;
	if (requestedBps != null && fixed != null && requestedBps !== fixed) {
		throw new FundedLaunchError(400, 'creator_fee_fixed', `${rule.reason || 'The creator fee is not configurable on this quote.'} The rate is ${fixed} bps.`, { fixed_bps: fixed });
	}
	return { bps: fixed, configurable: false, fixed_bps: fixed, reason: rule.reason || null };
}

// ── quote ─────────────────────────────────────────────────────────────────────

/**
 * Every fee line of a launch on `pair` with `initialBuy` in the quote asset.
 * Lines marked `included` are part of the initial buy and do not add to the
 * total; the rest are paid on top. Totals are per asset, in atomics and units.
 */
export async function buildLaunchQuote({ pair, network, initialBuy, creatorFee }) {
	const dec = pair.decimals;
	const buy = atomicsFromUi(initialBuy, dec);
	const platformBps = pumpLaunchFeeBps();
	const recipient = await pumpFeeRecipient().catch(() => null);
	const platformFee = recipient ? pumpFeeAtomics(buy, platformBps) : 0n;
	const lines = [];
	const solLine = (id, label, sol, note) => {
		const atomics = BigInt(Math.round(sol * LAMPORTS));
		lines.push({ id, label, asset: 'SOL', amount: ui(atomics, 9), atomics: atomics.toString(), payee: 'pump.fun program (rent)', included: false, note });
	};
	solLine('mint_rent', 'Mint account rent', FIXED_LAUNCH_COST_SOL.mintRent, 'Refundable only if the account closes; it does not.');
	solLine('bonding_curve_rent', 'Bonding curve rent', FIXED_LAUNCH_COST_SOL.bondingCurveRent, 'Held by the curve account for its lifetime.');
	solLine('metadata_rent', 'Metadata account rent', FIXED_LAUNCH_COST_SOL.metadataRent, 'Stores the coin name, symbol and image link on-chain.');
	lines[lines.length - 1].payee = 'Metaplex token metadata (rent)';
	lines.push({
		id: 'network_fee',
		label: 'Network fee',
		asset: 'SOL',
		amount: FIXED_LAUNCH_COST_SOL.txFee,
		atomics: String(Math.round(FIXED_LAUNCH_COST_SOL.txFee * LAMPORTS)),
		payee: 'Solana validators',
		included: false,
		note: 'Base signature fee. A priority fee is added at send time from live fee markets and is bounded by the compute budget.',
	});
	if (buy > 0n) {
		lines.push({ id: 'initial_buy', label: `Initial buy`, asset: pair.symbol, amount: ui(buy, dec), atomics: buy.toString(), payee: 'Your coin\'s bonding curve', included: false, note: 'Your opening position. The fee lines below come out of this amount.' });
		if (pair.fees) {
			const protocol = bpsOf(buy, pair.fees.protocol_bps);
			lines.push({ id: 'pump_protocol_fee', label: `pump.fun protocol fee (${(pair.fees.protocol_bps / 100).toFixed(2)}%)`, asset: pair.symbol, amount: ui(protocol, dec), atomics: protocol.toString(), payee: 'pump.fun', included: true, note: 'Taken from the initial buy by the program.' });
			if (pair.fees.lp_bps > 0) {
				const lp = bpsOf(buy, pair.fees.lp_bps);
				lines.push({ id: 'pump_lp_fee', label: `pump.fun liquidity fee (${(pair.fees.lp_bps / 100).toFixed(2)}%)`, asset: pair.symbol, amount: ui(lp, dec), atomics: lp.toString(), payee: 'pump.fun liquidity', included: true, note: 'Taken from the initial buy by the program.' });
			}
		}
		if (creatorFee.bps != null) {
			const creator = bpsOf(buy, creatorFee.bps);
			lines.push({ id: 'creator_fee', label: `Creator fee (${(creatorFee.bps / 100).toFixed(2)}%)`, asset: pair.symbol, amount: ui(creator, dec), atomics: creator.toString(), payee: 'You, as the coin\'s creator', included: true, note: 'Paid to the creator on every trade, this one included. Claimable on three.ws.' });
		}
		if (platformFee > 0n) {
			lines.push({ id: 'platform_launch_fee', label: `three.ws launch fee (${(platformBps / 100).toFixed(2)}%)`, asset: pair.symbol, amount: ui(platformFee, dec), atomics: platformFee.toString(), payee: recipient.toBase58(), included: false, note: 'Charged on the opening buy only. A launch with no opening buy pays nothing.' });
		}
	}
	const totals = {};
	for (const line of lines) {
		if (line.included) continue;
		totals[line.asset] = (totals[line.asset] || 0n) + BigInt(line.atomics);
	}
	const shaped = {};
	for (const [asset, atomics] of Object.entries(totals)) {
		const d = asset === 'SOL' ? 9 : dec;
		shaped[asset] = { atomics: atomics.toString(), amount: ui(atomics, d), decimals: d };
	}
	const solUsd = await solPriceUsd().catch(() => null);
	return {
		network,
		pair: { id: pair.id, symbol: pair.symbol, mint: pair.mint, decimals: dec, kind: pair.kind, fees: pair.fees },
		initial_buy: { amount: ui(buy, dec), atomics: buy.toString(), asset: pair.symbol },
		creator_fee: creatorFee,
		platform_fee_bps: platformBps,
		lines,
		totals: shaped,
		sol_usd: Number.isFinite(solUsd) ? solUsd : null,
		fees_known: Boolean(pair.fees),
		quoted_at: new Date().toISOString(),
	};
}

async function resolveAgent({ userId, agentId }) {
	if (!agentId) throw new FundedLaunchError(400, 'validation_error', 'agent_id is required: the launch is paid from that agent\'s wallet');
	const [row] = await sql`
		select id, name, user_id from agent_identities
		where id = ${String(agentId)} and deleted_at is null limit 1
	`;
	if (!row) throw new FundedLaunchError(404, 'agent_not_found', 'no such agent');
	if (row.user_id !== userId) throw new FundedLaunchError(403, 'forbidden', 'not your agent');
	return row;
}

/**
 * Create a quoted launch intent. Returns the intent and the raw preflight
 * token, which is shown exactly once: only its hash is stored.
 */
export async function createFundedLaunchIntent({ userId, agentId, input }) {
	const v = validateInput(input);
	const agent = await resolveAgent({ userId, agentId });
	const pair = await findLaunchPair({ network: v.network, idOrMint: v.quote });
	if (!pair) throw new FundedLaunchError(400, 'unknown_quote', `"${v.quote}" is not a quote asset this lane supports; GET /api/pump/pairs lists them`);
	if (pair.status !== 'live') {
		throw new FundedLaunchError(409, 'quote_not_live', `${pair.symbol} is ${pair.status.replace(/_/g, ' ')} on ${v.network} right now`, { pair });
	}
	const cap = MAX_INITIAL_BUY[pair.kind] ?? MAX_INITIAL_BUY.exotic;
	if (v.initialBuy > cap) throw new FundedLaunchError(400, 'validation_error', `initial_buy must be at most ${cap} ${pair.symbol}`);
	const creatorFee = resolveCreatorFee(pair, v.creatorFeeBps);
	const quote = await buildLaunchQuote({ pair, network: v.network, initialBuy: v.initialBuy, creatorFee });
	const { address } = await getOrCreateAgentSolanaWallet(agent.id);
	const token = randomToken(32);
	const tokenHash = await sha256(token);
	const expiresAt = new Date(Date.now() + QUOTE_TTL_MS).toISOString();
	const [row] = await sql`
		insert into pump_funded_launch_intents (
			user_id, agent_id, network, stage, name, symbol, description, image_url,
			quote_asset, quote_mint, quote_symbol, quote_decimals, initial_buy_atomics, creator_fee_bps,
			quote, quote_expires_at, preflight_token_hash, funding_address
		) values (
			${userId}, ${agent.id}, ${v.network}, 'quote', ${v.name}, ${v.symbol}, ${v.description}, ${v.imageUrl},
			${pair.id}, ${pair.mint}, ${pair.symbol}, ${pair.decimals}, ${quote.initial_buy.atomics}::numeric, ${creatorFee.bps},
			${JSON.stringify(quote)}::jsonb, ${expiresAt}, ${tokenHash}, ${address}
		)
		returning *
	`;
	logAudit({ userId, action: 'pump_funded_launch_quoted', resourceId: row.id, meta: { agent_id: agent.id, network: v.network, quote: pair.id, initial_buy: v.initialBuy, creator_fee_bps: creatorFee.bps } });
	return { intent: await shapeIntent({ ...row, agent_name: agent.name }), preflight_token: token };
}

// ── loading ───────────────────────────────────────────────────────────────────

async function loadIntent(userId, id) {
	const [row] = await sql`
		select i.*, a.name as agent_name
		from pump_funded_launch_intents i
		left join agent_identities a on a.id = i.agent_id
		where i.id = ${String(id)} and i.user_id = ${userId}
		limit 1
	`;
	if (!row) throw new FundedLaunchError(404, 'not_found', 'no such launch intent');
	return row;
}

export async function listFundedLaunchIntents(userId, { agentId = null, limit = 30 } = {}) {
	const n = Math.min(100, Math.max(1, Number(limit) || 30));
	const rows = agentId
		? await sql`
			select i.*, a.name as agent_name from pump_funded_launch_intents i
			left join agent_identities a on a.id = i.agent_id
			where i.user_id = ${userId} and i.agent_id = ${String(agentId)}
			order by i.created_at desc limit ${n}`
		: await sql`
			select i.*, a.name as agent_name from pump_funded_launch_intents i
			left join agent_identities a on a.id = i.agent_id
			where i.user_id = ${userId}
			order by i.created_at desc limit ${n}`;
	return Promise.all(rows.map((r) => shapeIntent(r, { withBalance: false })));
}

/** One intent, with its stages advanced from chain state first. */
export async function getFundedLaunchIntent(userId, id, { withBalance = true } = {}) {
	const row = await advanceIntentStages(await loadIntent(userId, id));
	return shapeIntent(row, { withBalance });
}

// ── payment proof ─────────────────────────────────────────────────────────────

function requiredAtomics(row, asset) {
	return BigInt(row.quote?.totals?.[asset]?.atomics || '0');
}

async function fundingBalances(row) {
	const conn = getConnection({ network: row.network });
	const owner = new PublicKey(row.funding_address);
	const out = { SOL: null };
	try {
		out.SOL = BigInt(await conn.getBalance(owner, 'confirmed'));
	} catch (err) {
		log.warn('balance_read_failed', { intent: row.id, asset: 'SOL', err: err?.message });
	}
	if (row.quote_mint && row.quote_symbol !== 'SOL') {
		out[row.quote_symbol] = null;
		try {
			const spl = await import('@solana/spl-token');
			const ata = spl.getAssociatedTokenAddressSync(new PublicKey(row.quote_mint), owner, true);
			const bal = await conn.getTokenAccountBalance(ata, 'confirmed');
			out[row.quote_symbol] = BigInt(bal?.value?.amount ?? '0');
		} catch {
			out[row.quote_symbol] = 0n;
		}
	}
	return out;
}

function shortfall(row, balances) {
	const missing = {};
	for (const [asset, total] of Object.entries(row.quote?.totals || {})) {
		const have = balances[asset];
		if (have == null) continue;
		const need = BigInt(total.atomics);
		if (have < need) missing[asset] = { atomics: (need - have).toString(), amount: ui(need - have, total.decimals) };
	}
	return missing;
}

/**
 * Record the funding transaction. Accepted exactly once per intent: the same
 * signature replays the stored result, any other is refused once one landed.
 * The proof must credit the funding address and leave it holding the quoted
 * totals; a transfer that falls short is reported and not consumed.
 */
export async function recordFundingProof({ userId, intentId, signature, preflightToken }) {
	const sig = String(signature || '').trim();
	if (!/^[1-9A-HJ-NP-Za-km-z]{64,100}$/.test(sig)) throw new FundedLaunchError(400, 'validation_error', 'signature must be a base58 transaction signature');
	if (!preflightToken) throw new FundedLaunchError(400, 'validation_error', 'preflight_token is required');
	const row = await loadIntent(userId, intentId);

	if (row.payment_signature) {
		if (row.payment_signature === sig) return { intent: await shapeIntent(row), result: { ...(row.payment_result || {}), replayed: true }, replayed: true };
		throw new FundedLaunchError(409, 'already_paid', 'this intent was already funded with a different transaction', { payment_signature: row.payment_signature });
	}
	if (row.stage !== 'quote') throw new FundedLaunchError(409, 'wrong_stage', `the intent is ${row.stage}; payment is accepted at the quote stage only`);
	if (new Date(row.quote_expires_at).getTime() <= Date.now()) {
		await sql`update pump_funded_launch_intents set stage = 'expired', updated_at = now() where id = ${row.id} and stage = 'quote'`;
		throw new FundedLaunchError(410, 'quote_expired', 'the quote expired before it was funded; create a new intent');
	}
	const hash = await sha256(String(preflightToken));
	if (!constantTimeEquals(hash, row.preflight_token_hash)) throw new FundedLaunchError(403, 'preflight_mismatch', 'the preflight token does not belong to this intent');

	const [taken] = await sql`select id from pump_funded_launch_intents where payment_signature = ${sig} limit 1`;
	if (taken) throw new FundedLaunchError(409, 'signature_used', 'that transaction already funded another intent');

	const tx = await verifySignature({ network: row.network, signature: sig });
	const credited = {};
	const solDelta = walletQuoteDeltaAtomics({ tx, wallet: row.funding_address, quoteSymbol: 'SOL' });
	if (solDelta) credited.SOL = solDelta;
	if (row.quote_symbol !== 'SOL' && row.quote_mint) {
		const d = walletQuoteDeltaAtomics({ tx, wallet: row.funding_address, quoteSymbol: row.quote_symbol, quoteMint: row.quote_mint });
		if (d) credited[row.quote_symbol] = d;
	}
	if (!Object.keys(credited).length) {
		throw new FundedLaunchError(422, 'not_a_funding_tx', `the transaction did not move SOL${row.quote_symbol !== 'SOL' ? ` or ${row.quote_symbol}` : ''} to ${row.funding_address}`);
	}
	const balances = await fundingBalances(row);
	const missing = shortfall(row, balances);
	if (Object.keys(missing).length) {
		throw new FundedLaunchError(402, 'funding_insufficient', 'the transaction landed but the agent wallet still holds less than the quote needs', {
			funding_address: row.funding_address,
			shortfall: missing,
			credited,
		});
	}
	const result = {
		signature: sig,
		explorer: explorerTx(sig, row.network),
		credited,
		balance_after: Object.fromEntries(Object.entries(balances).map(([k, v]) => [k, v == null ? null : v.toString()])),
		slot: tx.slot ?? null,
		block_time: tx.blockTime ? new Date(tx.blockTime * 1000).toISOString() : null,
		verified_at: new Date().toISOString(),
	};
	let updated;
	try {
		[updated] = await sql`
			update pump_funded_launch_intents
			set stage = 'paid', payment_signature = ${sig}, payment_result = ${JSON.stringify(result)}::jsonb,
			    paid_at = now(), updated_at = now()
			where id = ${row.id} and stage = 'quote' and payment_signature is null
			returning *
		`;
	} catch (err) {
		if (String(err?.code) === '23505') throw new FundedLaunchError(409, 'signature_used', 'that transaction already funded another intent');
		throw err;
	}
	if (!updated) {
		// Lost a race with a concurrent proof for this intent: answer from what landed.
		const fresh = await loadIntent(userId, intentId);
		if (fresh.payment_signature === sig) return { intent: await shapeIntent(fresh), result: { ...(fresh.payment_result || {}), replayed: true }, replayed: true };
		throw new FundedLaunchError(409, 'already_paid', 'this intent was already funded with a different transaction', { payment_signature: fresh.payment_signature });
	}
	logAudit({ userId, action: 'pump_funded_launch_paid', resourceId: row.id, meta: { signature: sig, network: row.network, credited } });
	return { intent: await shapeIntent({ ...updated, agent_name: row.agent_name }), result, replayed: false };
}

// ── metadata + mint ───────────────────────────────────────────────────────────

async function ensureMetadata(row) {
	if (row.metadata_uri) return row;
	const { uploadPumpMetadata } = await import('./pump-launch.js');
	const up = await uploadPumpMetadata({ imageUrl: row.image_url, name: row.name, symbol: row.symbol, description: row.description || '' });
	const [updated] = await sql`
		update pump_funded_launch_intents set metadata_uri = ${up.metadataUri}, updated_at = now()
		where id = ${row.id} returning *
	`;
	return { ...row, ...updated };
}

function markEnforced() {
	return env.THREE_WS_MARK_ENFORCE !== '0' && env.THREE_WS_MARK_ENFORCE !== 'false';
}

async function freshMintKeypair() {
	if (!markEnforced()) return Keypair.generate();
	try {
		const ground = await grindVanityNode({ ...THREE_WS_VANITY });
		return Keypair.fromSecretKey(ground.secretKey);
	} catch (err) {
		if (err instanceof GrindExhaustedError) throw new FundedLaunchError(503, 'mark_grind_failed', 'could not stamp the three.ws mark on a fresh mint; retry');
		throw err;
	}
}

async function ensureMint(row) {
	if (row.mint && row.mint_secret) return row;
	const kp = await freshMintKeypair();
	const secret = await encryptSecret(Buffer.from(kp.secretKey).toString('base64'));
	const [updated] = await sql`
		update pump_funded_launch_intents set mint = ${kp.publicKey.toBase58()}, mint_secret = ${secret}, updated_at = now()
		where id = ${row.id} and mint is null returning *
	`;
	if (!updated) return loadIntent(row.user_id, row.id);
	return { ...row, ...updated };
}

async function mintKeypairFor(row) {
	const b64 = await decryptSecret(row.mint_secret);
	const kp = Keypair.fromSecretKey(Uint8Array.from(Buffer.from(b64, 'base64')));
	if (kp.publicKey.toBase58() !== row.mint) throw new FundedLaunchError(500, 'mint_mismatch', 'the stored mint secret does not match the stored mint');
	return kp;
}

// ── instruction building ──────────────────────────────────────────────────────

/**
 * The create (and buy) instructions for an intent, exactly as the executor
 * sends them. `payer` is the agent wallet; `mint` the coin's keypair public key.
 */
export async function buildIntentInstructions({ row, mint, payer }) {
	const pumpSdk = await import('@pump-fun/pump-sdk');
	const { sdk, BN } = await getPumpSdk({ network: row.network });
	const global = await sdk.fetchGlobal();
	const buy = new BN(String(row.initial_buy_atomics || '0'));
	const hasBuy = !buy.isZero();
	const configurable = Boolean(row.quote?.creator_fee?.configurable) && Boolean(global.creatorFeeConfigurable);
	const creatorFeeBps = configurable && row.creator_fee_bps > 0 ? new BN(row.creator_fee_bps) : undefined;
	const common = { mint, name: row.name, symbol: row.symbol, uri: row.metadata_uri, creator: payer, user: payer, mayhemMode: false, creatorFeeBps };
	const quoteMint = row.quote_mint && row.quote_mint !== WSOL_MINT ? solanaPubkey(row.quote_mint) : null;

	if (quoteMint) {
		if (hasBuy) {
			const amount = pumpSdk.getBuyTokenAmountFromSolAmount({ global, feeConfig: null, mintSupply: null, bondingCurve: null, amount: buy, quoteMint });
			const ixs = await sdk.createV2AndBuyV2Instructions({ global, ...common, quoteAmount: buy, amount, quoteMint });
			return Array.isArray(ixs) ? [...ixs] : [ixs];
		}
		return [await sdk.createV2Instruction({ ...common, quoteMint })];
	}
	if (hasBuy) {
		const amount = pumpSdk.getBuyTokenAmountFromSolAmount({ global, feeConfig: null, mintSupply: null, bondingCurve: null, amount: buy });
		const ixs = await sdk.createV2AndBuyInstructions({ global, ...common, solAmount: buy, amount });
		return Array.isArray(ixs) ? [...ixs] : [ixs];
	}
	return [await sdk.createV2Instruction(common)];
}

async function platformFeeFor(row, payer) {
	const isUsdc = Boolean(row.quote_mint) && row.quote_symbol !== 'SOL';
	return buildPlatformFeeInstructions({
		network: row.network,
		payer,
		isUsdc,
		quoteMintPk: isUsdc ? solanaPubkey(row.quote_mint) : undefined,
		grossAtomics: BigInt(String(row.initial_buy_atomics || '0')),
		basis: 'launch_dev_buy',
		bps: pumpLaunchFeeBps(),
	});
}

// ── confirmation (approval request) ───────────────────────────────────────────

/**
 * Queue the launch spend for the owner's explicit yes. Only a same-site session
 * reaches this (the handler enforces it). Idempotent while a request is open.
 */
export async function requestLaunchConfirmation({ userId, intentId }) {
	let row = await loadIntent(userId, intentId);
	if (row.stage !== 'paid' && row.stage !== 'failed') {
		throw new FundedLaunchError(409, 'wrong_stage', row.stage === 'quote' ? 'fund the intent before confirming it' : `the intent is already ${row.stage}`);
	}
	const pair = await findLaunchPair({ network: row.network, idOrMint: row.quote_asset });
	if (!pair || pair.status !== 'live') throw new FundedLaunchError(409, 'quote_not_live', `${row.quote_symbol} launches are not accepting creates on ${row.network} right now`);
	const balances = await fundingBalances(row);
	const missing = shortfall(row, balances);
	if (Object.keys(missing).length) throw new FundedLaunchError(402, 'funding_insufficient', 'the agent wallet no longer holds what the quote needs', { funding_address: row.funding_address, shortfall: missing });

	row = await ensureMetadata(row);
	row = await ensureMint(row);

	const [{ n }] = await sql`select count(*)::int as n from approval_requests where source = 'pump_funded_launch' and source_ref = ${row.id}`;
	const totals = row.quote.totals;
	const primaryAsset = row.quote_symbol === 'SOL' ? 'SOL' : row.quote_symbol;
	const primary = totals[primaryAsset] || totals.SOL;
	const solUsd = row.quote.sol_usd;
	const amountUsd = primaryAsset === 'SOL' ? (solUsd ? primary.amount * solUsd : null) : primary.amount;
	const riskNotes = [
		...row.quote.lines.filter((l) => !l.included).map((l) => `${l.label}: ${l.amount} ${l.asset}`),
		...(totals.SOL && primaryAsset !== 'SOL' ? [`Plus ${totals.SOL.amount} SOL of rent and network fees`] : []),
		`Creator fee ${(row.creator_fee_bps / 100).toFixed(2)}% on every trade, paid to the agent wallet`,
		'The new coin trades publicly as soon as this lands. Launches cannot be undone.',
	];
	const { request, created } = await createApprovalRequest({
		userId,
		agentId: row.agent_id,
		requesterRole: 'owner',
		source: 'pump_funded_launch',
		sourceRef: row.id,
		actionType: 'pump_funded_launch',
		venue: 'pump_launch',
		payload: {
			v: 1,
			intent_id: row.id,
			mint: row.mint,
			name: row.name,
			symbol: row.symbol,
			network: row.network,
			quote_mint: row.quote_mint,
			quote_symbol: row.quote_symbol,
			initial_buy_atomics: String(row.initial_buy_atomics),
			creator_fee_bps: row.creator_fee_bps,
			totals,
			funding_address: row.funding_address,
		},
		summary: `Launch ${row.name} (${row.symbol}) on pump.fun from ${row.agent_name || 'the agent'}'s wallet, paying ${primary.amount} ${primaryAsset}`,
		amount: primary.amount,
		amountUsd: Number.isFinite(amountUsd) ? Number(amountUsd.toFixed(2)) : null,
		asset: primaryAsset,
		chain: 'solana',
		network: row.network,
		recipient: row.mint,
		recipientLabel: `${row.symbol} bonding curve (new coin)`,
		riskNotes,
		gateReason: 'A coin launch signs from the agent wallet and cannot be undone.',
		idempotencyKey: `pump_funded_launch:${row.id}:${n}`,
		autoApprovable: false,
	});
	const [updated] = await sql`
		update pump_funded_launch_intents set approval_id = ${request.id}, stage = 'paid', error = null, updated_at = now()
		where id = ${row.id} returning *
	`;
	if (created) logAudit({ userId, action: 'pump_funded_launch_confirmation_requested', resourceId: row.id, meta: { approval_id: request.id, mint: row.mint } });
	return { intent: await shapeIntent({ ...updated, agent_name: row.agent_name }), approval: { id: request.id, status: request.status, link: `/approvals/${request.id}`, expires_at: iso(request.expires_at) }, created };
}

// ── executor (the only code path that signs) ──────────────────────────────────

/**
 * Approval executor. Signs the launch from the agent wallet for an intent that
 * is paid and matches the approved payload byte for byte. Contract:
 * `(row) -> { status, signature?, note?, usd? }`.
 */
export async function executeApprovedFundedLaunch(approval) {
	const p = approval?.payload || {};
	const [row] = await sql`select * from pump_funded_launch_intents where id = ${String(p.intent_id || '')} and user_id = ${approval.user_id} limit 1`;
	if (!row) return { status: 'error', note: 'The launch intent no longer exists.' };
	if (row.stage !== 'paid') return { status: 'skipped', note: `The intent is ${row.stage}; nothing was signed.` };
	if (row.mint !== p.mint || String(row.initial_buy_atomics) !== String(p.initial_buy_atomics) || row.creator_fee_bps !== p.creator_fee_bps || (row.quote_mint || null) !== (p.quote_mint || null) || row.network !== p.network) {
		return { status: 'error', note: 'The intent changed after it was approved. Nothing was signed.' };
	}
	if (row.approval_id && row.approval_id !== approval.id) return { status: 'skipped', note: 'A different approval owns this intent.' };

	const { loadAgentForSigning } = await import('./agent-pumpfun.js');
	const { reserveSpend, finalizeSpend, releaseSpend } = await import('./agent-spend-policy.js');
	const { submitProtected } = await import('./execution-engine.js');
	const { getPumpLookupTables } = await import('./pump-launch-tx.js');
	const { markPlanLaunched } = await import('./agent-token-plan.js');
	const { publishFeedEvent } = await import('./feed.js');

	const loaded = await loadAgentForSigning(row.agent_id, row.user_id, { reason: 'pump_funded_launch', meta: { intent_id: row.id, approval_id: approval.id } });
	if (loaded.error) return { status: 'error', note: loaded.error.msg };
	const payer = loaded.keypair;
	if (payer.publicKey.toBase58() !== row.funding_address) return { status: 'error', note: 'The agent wallet is not the funded address. Nothing was signed.' };

	let mintKeypair;
	try {
		mintKeypair = await mintKeypairFor(row);
	} catch (err) {
		return { status: 'error', note: err?.message || 'The mint secret could not be read.' };
	}

	const [existing] = await sql`select id from pump_agent_mints where mint = ${row.mint} and network = ${row.network} limit 1`;
	if (existing) return { status: 'skipped', note: 'This mint is already registered as launched.' };

	let instructions;
	let launchFee;
	try {
		instructions = await buildIntentInstructions({ row, mint: mintKeypair.publicKey, payer: payer.publicKey });
		launchFee = await platformFeeFor(row, payer.publicKey);
	} catch (err) {
		await failIntent(row.id, `build: ${err?.message || err}`);
		return { status: 'error', note: `Could not build the launch transaction: ${String(err?.message || err).slice(0, 160)}` };
	}

	const isSolPair = row.quote_symbol === 'SOL';
	const solOutflow = Number(row.quote?.totals?.SOL?.atomics || '0') / LAMPORTS;
	const reservation = await reserveSpend({
		agentId: row.agent_id,
		meta: loaded.meta,
		mint: row.mint,
		solAmount: isSolPair ? solOutflow : Number(row.quote?.totals?.SOL?.atomics || '0') / LAMPORTS,
		type: 'pumpfun.launch',
		payload: { name: row.name, symbol: row.symbol, network: row.network, source: 'funded_launch_intent', intent_id: row.id, approval_id: approval.id },
	});
	if (!reservation.ok) {
		await failIntent(row.id, reservation.msg);
		return { status: 'error', note: reservation.msg };
	}

	const connection = getConnection({ network: row.network });
	const lookupTables = await getPumpLookupTables({ network: row.network });
	const send = (ixs) => submitProtected({ network: row.network, connection, payer, instructions: ixs, opts: { extraSigners: [mintKeypair], addressLookupTables: lookupTables } });
	let signature;
	let feeSettlement = launchFee ? 'bundled' : null;
	try {
		try {
			({ signature } = await send(launchFee ? [...instructions, ...launchFee.instructions] : instructions));
		} catch (err) {
			if (!launchFee || !/too large|overruns|RangeError/i.test(`${err?.name} ${err?.message}`)) throw err;
			({ signature } = await send(instructions));
			feeSettlement = 'separate';
			try {
				await submitProtected({ network: row.network, connection, payer, instructions: launchFee.instructions });
			} catch (feeErr) {
				feeSettlement = 'failed';
				log.error('separate_fee_failed', { intent: row.id, err: feeErr?.message });
			}
		}
	} catch (err) {
		await releaseSpend(reservation.reservationId);
		await failIntent(row.id, `send: ${err?.message || err}`);
		return { status: 'error', note: `The launch transaction did not land: ${String(err?.message || err).slice(0, 160)}` };
	}

	const result = {
		signature,
		explorer: explorerTx(signature, row.network),
		pumpfun_url: `https://pump.fun/coin/${row.mint}`,
		launch_url: `${env.APP_ORIGIN}/launch/${row.mint}`,
		platform_fee: launchFee ? { ...launchFee.disclosure, settlement: feeSettlement } : null,
		approval_id: approval.id,
	};
	await sql`
		update pump_funded_launch_intents
		set stage = 'submitted', launch_signature = ${signature}, submitted_at = now(), result = ${JSON.stringify(result)}::jsonb,
		    mint_secret = null, error = null, updated_at = now()
		where id = ${row.id}
	`;
	await sql`
		insert into pump_agent_mints (agent_id, user_id, network, mint, name, symbol, metadata_uri, agent_authority, buyback_bps, quote_mint)
		values (${row.agent_id}, ${row.user_id}, ${row.network}, ${row.mint}, ${row.name}, ${row.symbol}, ${row.metadata_uri}, ${row.funding_address}, 0, ${row.quote_mint})
		on conflict (mint, network) do nothing
	`.catch((err) => log.error('mint_record_failed', { intent: row.id, err: err?.message }));
	await markPlanLaunched({ agentId: row.agent_id, network: row.network, mint: row.mint }).catch(() => {});
	await finalizeSpend(reservation.reservationId, { mint: row.mint, name: row.name, symbol: row.symbol, uri: row.metadata_uri, signature, network: row.network, quote_mint: row.quote_mint, intent_id: row.id });
	publishFeedEvent({ type: 'coin-buy', ts: Date.now(), actor: `${row.funding_address.slice(0, 4)}…${row.funding_address.slice(-4)}`, mint: row.mint, sol: isSolPair ? Number(row.initial_buy_atomics) / LAMPORTS : 0, network: row.network, branded: hasThreeWsMark(row.mint) }).catch(() => {});
	logAudit({ userId: row.user_id, action: 'pump_funded_launch_submitted', resourceId: row.id, meta: { signature, mint: row.mint, network: row.network, approval_id: approval.id } });

	const usd = row.quote_symbol === 'SOL' && row.quote.sol_usd ? Number((solOutflow * row.quote.sol_usd).toFixed(2)) : row.quote_symbol !== 'SOL' ? Number(row.quote.totals[row.quote_symbol]?.amount || 0) : null;
	return { status: 'ok', signature, note: `Launched ${row.symbol}. Mint ${row.mint}.`, usd };
}

async function failIntent(id, message) {
	await sql`
		update pump_funded_launch_intents set stage = 'failed', error = ${String(message).slice(0, 400)}, updated_at = now()
		where id = ${id} and stage in ('paid', 'submitted')
	`.catch((err) => log.error('fail_mark_failed', { intent: id, err: err?.message }));
}

// ── stage advancement ─────────────────────────────────────────────────────────

/**
 * Move an intent forward from chain state: expire a stale quote, confirm a
 * submitted launch, mark it indexed once the curve account reads. Never
 * throws; a read failure leaves the stage where it was.
 */
export async function advanceIntentStages(row) {
	try {
		if (row.stage === 'quote' && new Date(row.quote_expires_at).getTime() <= Date.now()) {
			const [u] = await sql`update pump_funded_launch_intents set stage = 'expired', updated_at = now() where id = ${row.id} and stage = 'quote' returning *`;
			return u ? { ...row, ...u } : row;
		}
		if (row.stage === 'submitted' && row.launch_signature) {
			try {
				await verifySignature({ network: row.network, signature: row.launch_signature });
			} catch (err) {
				if (err?.code === 'tx_failed') {
					const [u] = await sql`update pump_funded_launch_intents set stage = 'failed', error = 'the launch transaction failed on-chain', updated_at = now() where id = ${row.id} and stage = 'submitted' returning *`;
					return u ? { ...row, ...u } : row;
				}
				return row;
			}
			const [u] = await sql`update pump_funded_launch_intents set stage = 'confirmed', confirmed_at = now(), updated_at = now() where id = ${row.id} and stage = 'submitted' returning *`;
			row = u ? { ...row, ...u } : row;
		}
		if (row.stage === 'confirmed' && row.mint) {
			const { online } = await getPumpSdk({ network: row.network });
			const curve = await online.fetchBondingCurve(row.mint).catch(() => null);
			if (curve) {
				const [u] = await sql`update pump_funded_launch_intents set stage = 'indexed', indexed_at = now(), indexed_by = 'bonding_curve', updated_at = now() where id = ${row.id} and stage = 'confirmed' returning *`;
				row = u ? { ...row, ...u } : row;
			}
		}
	} catch (err) {
		log.warn('advance_failed', { intent: row.id, stage: row.stage, err: err?.message });
	}
	return row;
}

// ── dry run ───────────────────────────────────────────────────────────────────

/**
 * Simulate the exact launch transaction with a throwaway mint and the agent
 * wallet as payer. Nothing is signed or broadcast. On a devnet intent this is
 * the whole lane end to end without mainnet involvement.
 */
export async function dryRunFundedLaunch({ userId, intentId }) {
	let row = await loadIntent(userId, intentId);
	if (['submitted', 'confirmed', 'indexed'].includes(row.stage)) throw new FundedLaunchError(409, 'wrong_stage', `the intent is already ${row.stage}`);
	const started = Date.now();
	const report = { at: new Date().toISOString(), network: row.network, verdict: null, mint_used: null, units_consumed: null, logs: [], error: null, instructions: 0, duration_ms: 0 };
	try {
		row = await ensureMetadata(row);
	} catch (err) {
		report.verdict = 'metadata_failed';
		report.error = String(err?.message || err).slice(0, 240);
		return storeDryRun(row, report);
	}
	const throwaway = Keypair.generate();
	report.mint_used = throwaway.publicKey.toBase58();
	const payer = new PublicKey(row.funding_address);
	let message;
	try {
		const ixs = await buildIntentInstructions({ row, mint: throwaway.publicKey, payer });
		const fee = await platformFeeFor(row, payer);
		const all = fee ? [...ixs, ...fee.instructions] : ixs;
		report.instructions = all.length;
		const { getPumpLookupTables } = await import('./pump-launch-tx.js');
		const tables = await getPumpLookupTables({ network: row.network });
		const connection = getConnection({ network: row.network });
		const { blockhash } = await connection.getLatestBlockhash('confirmed');
		message = new TransactionMessage({ payerKey: payer, recentBlockhash: blockhash, instructions: all }).compileToV0Message(tables);
		const sim = await connection.simulateTransaction(new VersionedTransaction(message), { sigVerify: false, replaceRecentBlockhash: true, commitment: 'confirmed' });
		report.logs = (sim.value?.logs || []).slice(-14);
		report.units_consumed = sim.value?.unitsConsumed ?? null;
		if (sim.value?.err) {
			const errText = JSON.stringify(sim.value.err);
			const logsText = report.logs.join('\n');
			const insufficient = /insufficient (lamports|funds)/i.test(logsText) || /"Custom":1\b/.test(errText) || /AccountNotFound/.test(errText);
			report.verdict = insufficient ? 'funding_required' : 'would_fail';
			report.error = errText.slice(0, 240);
		} else {
			report.verdict = 'would_succeed';
		}
	} catch (err) {
		const msg = String(err?.message || err);
		report.error = msg.slice(0, 240);
		report.verdict = message ? 'rpc_unavailable' : /too large|overruns|RangeError|encode/i.test(`${err?.name} ${msg}`) ? 'compile_failed' : /fetch|ECONN|timeout|429|503/i.test(msg) ? 'rpc_unavailable' : 'compile_failed';
	}
	report.duration_ms = Date.now() - started;
	return storeDryRun(row, report);
}

async function storeDryRun(row, report) {
	const [u] = await sql`update pump_funded_launch_intents set dry_run = ${JSON.stringify(report)}::jsonb, updated_at = now() where id = ${row.id} returning *`;
	logAudit({ userId: row.user_id, action: 'pump_funded_launch_dry_run', resourceId: row.id, meta: { verdict: report.verdict, network: report.network } });
	return { intent: await shapeIntent({ ...row, ...u, agent_name: row.agent_name }), dry_run: report };
}

// ── public shape ──────────────────────────────────────────────────────────────

function stageList(row) {
	const at = { quote: row.created_at, paid: row.paid_at, submitted: row.submitted_at, confirmed: row.confirmed_at, indexed: row.indexed_at };
	const reached = STAGES.indexOf(row.stage);
	return STAGES.map((id, i) => ({
		id,
		label: { quote: 'Quoted', paid: 'Funded', submitted: 'Submitted', confirmed: 'Confirmed', indexed: 'Indexed' }[id],
		done: reached >= i && !(TERMINAL_STAGES.includes(row.stage) && i > 0 && !at[id]),
		current: row.stage === id,
		at: iso(at[id]),
	}));
}

/**
 * The public intent. `withBalance` reads the funding wallet live, which the
 * focus view wants and a list does not.
 */
export async function shapeIntent(row, { withBalance = true } = {}) {
	const quote = row.quote || {};
	const totals = quote.totals || {};
	let balance = null;
	if (withBalance && row.funding_address && ['quote', 'paid', 'failed'].includes(row.stage)) {
		const b = await getSolanaAddressBalances(row.funding_address, row.network);
		balance = { SOL: b.sol, ...(row.quote_symbol === 'USDC' ? { USDC: b.usdc } : {}) };
	}
	const required = Object.fromEntries(Object.entries(totals).map(([asset, t]) => [asset, t.amount]));
	const expiresMs = new Date(row.quote_expires_at).getTime();
	const pairKind = quote.pair?.kind || (row.quote_symbol === 'SOL' ? 'sol' : 'stable');
	return {
		id: row.id,
		agent: { id: row.agent_id, name: row.agent_name || null },
		network: row.network,
		stage: row.stage,
		stages: stageList(row),
		name: row.name,
		symbol: row.symbol,
		description: row.description || '',
		image_url: row.image_url,
		metadata_uri: row.metadata_uri || null,
		quote_asset: { id: row.quote_asset, symbol: row.quote_symbol, mint: row.quote_mint, decimals: row.quote_decimals, kind: pairKind },
		initial_buy: quote.initial_buy || { amount: ui(row.initial_buy_atomics || 0, row.quote_decimals), atomics: String(row.initial_buy_atomics || 0), asset: row.quote_symbol },
		creator_fee: {
			bps: row.creator_fee_bps,
			percent: row.creator_fee_bps != null ? Number((row.creator_fee_bps / 100).toFixed(2)) : null,
			...(quote.creator_fee || {}),
			earnings: row.creator_fee_bps != null ? earningsProjection({ bps: row.creator_fee_bps, quoteSymbol: row.quote_symbol, kind: pairKind }) : null,
		},
		quote: {
			lines: quote.lines || [],
			totals,
			sol_usd: quote.sol_usd ?? null,
			fees_known: quote.fees_known ?? null,
			quoted_at: quote.quoted_at || iso(row.created_at),
			expires_at: iso(row.quote_expires_at),
			expires_in_ms: Math.max(0, expiresMs - Date.now()),
			expired: row.stage === 'expired' || (row.stage === 'quote' && expiresMs <= Date.now()),
		},
		funding: {
			address: row.funding_address,
			explorer: explorerAccount(row.funding_address, row.network),
			required,
			balance,
			paid: Boolean(row.payment_signature),
		},
		payment: row.payment_signature
			? { signature: row.payment_signature, explorer: explorerTx(row.payment_signature, row.network), paid_at: iso(row.paid_at), result: row.payment_result || null }
			: null,
		approval: row.approval_id ? { id: row.approval_id, link: `/approvals/${row.approval_id}` } : null,
		mint: row.mint || null,
		launch: row.launch_signature
			? {
					signature: row.launch_signature,
					explorer: explorerTx(row.launch_signature, row.network),
					pumpfun_url: `https://pump.fun/coin/${row.mint}`,
					launch_url: `/launch/${row.mint}`,
					submitted_at: iso(row.submitted_at),
					confirmed_at: iso(row.confirmed_at),
					indexed_at: iso(row.indexed_at),
					platform_fee: row.result?.platform_fee || null,
				}
			: null,
		dry_run: row.dry_run || null,
		error: row.error || null,
		created_at: iso(row.created_at),
		updated_at: iso(row.updated_at),
		links: { page: `/launch/intents/${row.id}`, api: `/api/pump/launch-intents/${row.id}` },
	};
}
