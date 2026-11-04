// The hire Blink's money and delivery path, shared by the Blink endpoint
// (api/actions/agent-hire.js) and its settlement sweep (api/cron/hire-blink-sweep.js).
//
// A wallet hires an agent's Solana offer in three steps:
//
//   1. buildHireTransaction: an unsigned Solana Pay layout transaction the buyer
//      signs in their own wallet. The buyer is the fee payer and the only signer;
//      the server never signs. Layout: idempotent payout-ATA create, then the
//      `hire:<id>` memo, then the USDC transferChecked to the agent's payout ATA
//      carrying the hire's reference key LAST, which is where findReference and
//      validateTransfer look (api/_lib/solana/solana-pay-verify.js).
//   2. settleBlinkHire: verify the payment on chain against the hire row (payout,
//      exact price, USDC mint for the cluster, reference, memo), claim the row so
//      nothing runs it twice, call the offer's upstream with the buyer's input,
//      and write the result, the payment signature and the fulfillment attestation.
//   3. The sweep settles hires whose wallet never chained the confirm callback
//      (located by reference) and expires the ones nobody paid.
//
// The cluster comes from SOLANA_CLUSTER: `devnet` prices the whole flow in devnet
// USDC on devnet; anything else is mainnet. Each hire records the cluster it was
// priced on, so a later flip of the variable never verifies an old hire against
// the wrong chain.

import { createHash, randomBytes } from 'node:crypto';
import { Keypair, PublicKey, Transaction, TransactionInstruction } from '@solana/web3.js';
import { createAssociatedTokenAccountIdempotentInstruction } from '@solana/spl-token';
import { USDC_MINT_BY_NETWORK } from './custody/builders.js';
import { ataFor, tokenBalanceAtomics, tokenProgramForMint, tokenTransfer } from './solana-token-program.js';
import { blockhashKey, getRecentBlockhashInfo } from './solana/read-guards.js';
import { FindReferenceError, ValidateTransferError, findReference, validateTransfer } from './solana/solana-pay-verify.js';
import { safeFetchJson, SsrfError } from './ssrf.js';
import { claimBlinkHire, getHireById, updateHire } from './agent-economy.js';
import { getServiceById } from './agent-paid-services.js';
import { recordHireAttestation } from './trust/hire-attestations.js';

export const BLOCKCHAIN_IDS = Object.freeze({
	mainnet: 'solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp',
	devnet: 'solana:EtWTRABZaYq6iMfeYKouRu166VU2xqa1',
});

export const MEMO_PROGRAM_ID = new PublicKey('MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr');
export const USDC_DECIMALS = 6;
export const MAX_INPUT_BYTES = 4_000;
// An unpaid Blink hire is expired after this long. The transaction it was
// built with carries a blockhash that stops being valid after about 90 seconds,
// so nothing built for the row can still land by then.
export const BLINK_HIRE_TTL_MS = 20 * 60 * 1000;

const MAX_PARAMETERS = 8;
const MAX_STRING_LENGTH = 2_000;
const MAX_RESULT_BYTES = 16_000;
const KEY_RE = /^[A-Za-z0-9_]{1,40}$/;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** 'devnet' when SOLANA_CLUSTER says so, otherwise 'mainnet'. Read per call. */
export function hireBlinkNetwork() {
	return String(process.env.SOLANA_CLUSTER || '').trim().toLowerCase() === 'devnet' ? 'devnet' : 'mainnet';
}

export function hireNetworkOf(hire) {
	return hire?.meta?.cluster === 'devnet' ? 'devnet' : 'mainnet';
}

export function formatUsdc(atomics) {
	const n = Number(BigInt(atomics)) / 10 ** USDC_DECIMALS;
	return n.toLocaleString('en-US', { maximumFractionDigits: USDC_DECIMALS });
}

// ── Offer input: JSON Schema to Action parameters and back ───────────────────

function schemaProps(schema) {
	const props = schema && typeof schema === 'object' && schema.properties && typeof schema.properties === 'object'
		? schema.properties
		: {};
	const required = new Set(Array.isArray(schema?.required) ? schema.required.map(String) : []);
	return { props, required };
}

function propLabel(key, prop) {
	const text = typeof prop?.description === 'string' && prop.description.trim()
		? prop.description.trim()
		: typeof prop?.title === 'string' && prop.title.trim()
			? prop.title.trim()
			: key;
	return text.slice(0, 60);
}

function propType(prop) {
	const t = Array.isArray(prop?.type) ? prop.type.find((x) => x !== 'null') : prop?.type;
	if (Array.isArray(prop?.enum) && prop.enum.length) return 'enum';
	return typeof t === 'string' ? t : 'string';
}

function enterable(prop) {
	return ['string', 'number', 'integer', 'boolean', 'enum'].includes(propType(prop));
}

/**
 * The offer's top-level input properties as Action `parameters`, each named
 * `in_<property>`. Returns null when the offer needs input a Blink form cannot
 * collect (a required object or array, or a property name that is not a plain
 * identifier), so the card leaves that offer out rather than selling a call that
 * could never succeed.
 */
export function offerParameters(schema) {
	const { props, required } = schemaProps(schema);
	const params = [];
	for (const [key, prop] of Object.entries(props)) {
		const isRequired = required.has(key);
		if (!KEY_RE.test(key) || !enterable(prop)) {
			if (isRequired) return null;
			continue;
		}
		if (params.length >= MAX_PARAMETERS) {
			if (isRequired) return null;
			continue;
		}
		const p = { name: `in_${key}`, label: propLabel(key, prop) };
		if (isRequired) p.required = true;
		const kind = propType(prop);
		if (kind === 'enum') {
			p.type = 'select';
			p.options = prop.enum.slice(0, 20).map((v) => ({ label: String(v), value: String(v) }));
		} else if (kind === 'boolean') {
			p.type = 'select';
			p.options = [{ label: 'Yes', value: 'true' }, { label: 'No', value: 'false' }];
		} else if (kind === 'number' || kind === 'integer') {
			p.type = 'number';
			if (Number.isFinite(prop.minimum)) p.min = prop.minimum;
			if (Number.isFinite(prop.maximum)) p.max = prop.maximum;
		} else if (prop.format === 'uri' || prop.format === 'url') {
			p.type = 'url';
		} else if (prop.format === 'email') {
			p.type = 'email';
		} else if (prop.format === 'date') {
			p.type = 'date';
		} else if (prop.format === 'date-time') {
			p.type = 'datetime-local';
		} else {
			p.type = Number(prop.maxLength) > 200 || !prop.maxLength ? 'textarea' : 'text';
			if (typeof prop.pattern === 'string' && prop.pattern.length <= 200) {
				p.pattern = prop.pattern;
				p.patternDescription = `${p.label} must match ${prop.pattern}`;
			}
		}
		params.push(p);
	}
	return params;
}

function inputError(message) {
	return { ok: false, message };
}

/**
 * Validate and coerce the buyer's `in_*` values against the offer schema.
 * `raw` maps parameter name (with the `in_` prefix) to the submitted string.
 * @returns {{ ok: true, input: object } | { ok: false, message: string }}
 */
export function coerceOfferInput(schema, raw) {
	const { props, required } = schemaProps(schema);
	const input = {};
	for (const [key, prop] of Object.entries(props)) {
		if (!KEY_RE.test(key) || !enterable(prop)) continue;
		const label = propLabel(key, prop);
		const value = raw[`in_${key}`];
		const text = value == null ? '' : String(value).trim();
		if (!text) {
			if (required.has(key)) return inputError(`"${label}" is required to hire this offer.`);
			continue;
		}
		const kind = propType(prop);
		if (kind === 'enum') {
			const match = prop.enum.find((v) => String(v) === text);
			if (match === undefined) return inputError(`"${label}" must be one of: ${prop.enum.map(String).join(', ')}.`);
			input[key] = match;
		} else if (kind === 'boolean') {
			if (text !== 'true' && text !== 'false') return inputError(`"${label}" must be yes or no.`);
			input[key] = text === 'true';
		} else if (kind === 'number' || kind === 'integer') {
			const n = Number(text);
			if (!Number.isFinite(n)) return inputError(`"${label}" must be a number.`);
			if (kind === 'integer' && !Number.isInteger(n)) return inputError(`"${label}" must be a whole number.`);
			if (Number.isFinite(prop.minimum) && n < prop.minimum) return inputError(`"${label}" must be at least ${prop.minimum}.`);
			if (Number.isFinite(prop.maximum) && n > prop.maximum) return inputError(`"${label}" must be at most ${prop.maximum}.`);
			input[key] = n;
		} else {
			const max = Math.min(MAX_STRING_LENGTH, Number(prop.maxLength) || MAX_STRING_LENGTH);
			if (text.length > max) return inputError(`"${label}" must be at most ${max} characters.`);
			if (Number.isFinite(prop.minLength) && text.length < prop.minLength) {
				return inputError(`"${label}" must be at least ${prop.minLength} characters.`);
			}
			if (prop.format === 'uri' || prop.format === 'url') {
				let u;
				try {
					u = new URL(text);
				} catch {
					return inputError(`"${label}" must be a full http(s) URL.`);
				}
				if (u.protocol !== 'https:' && u.protocol !== 'http:') return inputError(`"${label}" must be a full http(s) URL.`);
			}
			if (prop.format === 'email' && !EMAIL_RE.test(text)) return inputError(`"${label}" must be an email address.`);
			if (typeof prop.pattern === 'string') {
				let re = null;
				try {
					re = new RegExp(prop.pattern, 'u');
				} catch {
					re = null;
				}
				if (re && !re.test(text)) return inputError(`"${label}" does not match the format this offer expects.`);
			}
			input[key] = text;
		}
	}
	if (Buffer.byteLength(JSON.stringify(input), 'utf8') > MAX_INPUT_BYTES) {
		return inputError('The input for this hire is too large for a Blink. Hire it from three.ws instead.');
	}
	return { ok: true, input };
}

/** Stable hash of a validated input, so one wallet's retry reuses its hire row. */
export function inputHash(input) {
	const sorted = Object.keys(input).sort().reduce((acc, k) => {
		acc[k] = input[k];
		return acc;
	}, {});
	return createHash('sha256').update(JSON.stringify(sorted)).digest('hex').slice(0, 32);
}

/** A fresh Solana Pay reference key (a random public key nobody holds). */
export function newReference() {
	return Keypair.fromSeed(randomBytes(32)).publicKey.toBase58();
}

// ── The payment transaction ──────────────────────────────────────────────────

/**
 * The buyer's USDC balance in atomics, or null when the chain could not be
 * read: an unreachable node must never refuse a hire the chain would accept.
 */
export async function readBuyerUsdc(connection, network, buyer) {
	try {
		return await tokenBalanceAtomics(connection, { mint: USDC_MINT_BY_NETWORK[network], owner: buyer });
	} catch {
		return null;
	}
}

/**
 * Build the unsigned hire payment. The buyer is fee payer and sole signer.
 * @returns {Promise<string>} base64 legacy transaction, signatures empty
 */
export async function buildHireTransaction({ connection, network, buyer, payout, atomics, reference, hireId }) {
	const mint = new PublicKey(USDC_MINT_BY_NETWORK[network]);
	const buyerKey = new PublicKey(buyer);
	const payoutKey = new PublicKey(payout);
	const tokenProgram = await tokenProgramForMint(connection, mint);
	const buyerAta = ataFor(mint, buyerKey, tokenProgram);
	const payoutAta = ataFor(mint, payoutKey, tokenProgram, { allowOwnerOffCurve: true });

	const instructions = [
		// An agent that has never held USDC has no token account yet. The
		// idempotent create is a no-op when it exists and rescues the payment
		// when it does not; the buyer funds the rent as fee payer.
		createAssociatedTokenAccountIdempotentInstruction(buyerKey, payoutAta, payoutKey, mint, tokenProgram),
		new TransactionInstruction({ programId: MEMO_PROGRAM_ID, keys: [], data: Buffer.from(`hire:${hireId}`, 'utf8') }),
		tokenTransfer({
			source: buyerAta,
			mint,
			destination: payoutAta,
			authority: buyerKey,
			atomics: BigInt(atomics),
			decimals: USDC_DECIMALS,
			tokenProgram,
			references: [new PublicKey(reference)],
		}),
	];

	const { blockhash } = await getRecentBlockhashInfo(connection, blockhashKey({ network }));
	const tx = new Transaction({ feePayer: buyerKey, recentBlockhash: blockhash }).add(...instructions);
	return tx.serialize({ requireAllSignatures: false, verifySignatures: false }).toString('base64');
}

// ── Settlement ───────────────────────────────────────────────────────────────

// The confirm callback often arrives a moment before the payment is visible at
// `confirmed`, so it looks again on this schedule before handing the hire to
// the sweep. Each wait is a real chain read, not a timer standing in for one.
const CONFIRM_POLL_DELAYS_MS = [0, 1_500, 3_000, 5_000];

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function notVisibleYet(err) {
	if (err instanceof ValidateTransferError) return err.message === 'not found';
	return true;
}

/**
 * Verify one signature against the hire. Returns 'verified', 'mismatch' (with
 * the reason), or 'confirming' when the transaction is not visible yet or the
 * RPC did not answer.
 */
async function verifyPayment(hire, signature, { wait }) {
	const network = hireNetworkOf(hire);
	const delays = wait ? CONFIRM_POLL_DELAYS_MS : [0];
	let lastError = null;
	for (const delay of delays) {
		if (delay) await sleep(delay);
		try {
			await validateTransfer(
				signature,
				{
					recipient: hire.payout_address,
					amount: Number(BigInt(hire.amount_atomics)) / 10 ** USDC_DECIMALS,
					splToken: USDC_MINT_BY_NETWORK[network],
					reference: hire.meta.reference,
					memo: `hire:${hire.id}`,
				},
				{ network, commitment: 'confirmed' },
			);
			return { state: 'verified' };
		} catch (err) {
			if (!notVisibleYet(err)) return { state: 'mismatch', reason: err.message };
			lastError = err;
		}
	}
	return { state: 'confirming', reason: lastError?.message || 'not found' };
}

export function summarizeResult(result) {
	if (result == null) return null;
	try {
		if (typeof result === 'string') return result.slice(0, 280);
		const inner = result.summary ?? result.result ?? result.text ?? result;
		const s = typeof inner === 'string' ? inner : JSON.stringify(inner);
		return s.slice(0, 280);
	} catch {
		return null;
	}
}

function capResult(data) {
	try {
		const s = JSON.stringify(data ?? null);
		if (Buffer.byteLength(s, 'utf8') <= MAX_RESULT_BYTES) return data ?? null;
		return { truncated: true, preview: s.slice(0, MAX_RESULT_BYTES - 200) };
	} catch {
		return null;
	}
}

function isRetryable(err) {
	return !(err instanceof SsrfError) && !(err?.status >= 400 && err?.status < 500);
}

/** Call the offer's upstream exactly as the paid x402 route does. */
export async function runOffer(service, input) {
	const method = service.target_method === 'GET' ? 'GET' : 'POST';
	let url = service.target_url;
	if (method === 'GET') {
		const u = new URL(service.target_url);
		for (const [k, v] of Object.entries(input || {})) u.searchParams.set(k, String(v));
		url = u.href;
	}
	let lastErr = null;
	for (let attempt = 0; attempt < 2; attempt++) {
		try {
			const upstream = await safeFetchJson(url, { method, body: method === 'POST' ? input || {} : undefined });
			if (upstream.ok) return upstream.data;
			lastErr = Object.assign(new Error(`the agent's service answered ${upstream.status}`), { status: upstream.status });
		} catch (err) {
			lastErr = err instanceof SsrfError
				? Object.assign(new Error(`the agent's service address is not allowed: ${err.message}`), { cause: err })
				: Object.assign(new Error(`the agent's service did not answer: ${err?.message || err}`), { cause: err });
			if (err instanceof SsrfError) throw lastErr;
		}
		if (!isRetryable(lastErr)) break;
	}
	throw lastErr;
}

/**
 * Settle one pending Blink hire against a payment signature.
 *
 * @param {object} hire        the agent_hires row
 * @param {{ signature: string, wait?: boolean }} opts
 * @returns {Promise<{ state: 'completed'|'failed'|'mismatch'|'confirming'|'busy', hire: object, reason?: string }>}
 */
export async function settleBlinkHire(hire, { signature, wait = false }) {
	if (hire.status !== 'pending') return { state: hire.status === 'completed' ? 'completed' : 'failed', hire };

	const verified = await verifyPayment(hire, signature, { wait });
	if (verified.state !== 'verified') return { ...verified, hire };

	const claimed = await claimBlinkHire(hire.id, { signature });
	if (!claimed) {
		const current = (await getHireById(hire.id)) || hire;
		if (current.status === 'completed') return { state: 'completed', hire: current };
		if (current.status !== 'pending') return { state: 'failed', hire: current };
		return { state: 'busy', hire: current };
	}

	const service = await getServiceById(claimed.service_id);
	try {
		if (!service) throw new Error('the offer this hire paid for no longer exists');
		const data = await runOffer(service, claimed.meta?.input || {});
		const resultSummary = summarizeResult(data);
		const done = await updateHire(claimed.id, {
			status: 'completed',
			paymentSignature: signature,
			payerAddress: claimed.payer_address,
			resultSummary,
			meta: { result: capResult(data), settled_at: new Date().toISOString() },
		});
		await recordHireAttestation(done || claimed, { phase: 'recorded', paymentSignature: signature, resultSummary });
		return { state: 'completed', hire: done || { ...claimed, status: 'completed', result_summary: resultSummary } };
	} catch (err) {
		const message = `paid, but ${err?.message || 'the offer failed'}`.slice(0, 500);
		const failed = await updateHire(claimed.id, {
			status: 'failed',
			paymentSignature: signature,
			payerAddress: claimed.payer_address,
			error: message,
			meta: { settled_at: new Date().toISOString() },
		});
		await recordHireAttestation(failed || claimed, { phase: 'failed', paymentSignature: signature, err });
		return { state: 'failed', hire: failed || { ...claimed, status: 'failed', error: message } };
	}
}

/**
 * Find the payment for a hire by its reference key. Returns the signature, or
 * null when no transaction carries the reference yet.
 */
export async function locateHirePayment(hire) {
	try {
		const found = await findReference(hire.meta.reference, { network: hireNetworkOf(hire), commitment: 'confirmed' });
		if (found?.err) return null;
		return found?.signature ? String(found.signature) : null;
	} catch (err) {
		if (err instanceof FindReferenceError) return null;
		throw err;
	}
}

/** Close an unpaid Blink hire whose payment window has passed. */
export async function expireBlinkHire(hire) {
	return updateHire(hire.id, {
		status: 'expired',
		error: 'no payment arrived for this hire',
		meta: { expired_at: new Date().toISOString() },
	});
}
