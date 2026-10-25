// Intent Mandate — AP2-style budgeted authorization for autonomous agent spend.
//
// Modeled on Google's Agent Payments Protocol (AP2) "Intent Mandate": a
// cryptographically signed, verifiable credential that a user issues up-front
// to authorize an agent to spend on their behalf, later and autonomously,
// within hard constraints (total budget, per-call cap, currency, networks, and
// optionally a resource allowlist). The agent carries the mandate through each
// transaction; the server verifies it before releasing any payment.
//
// We sign mandates as compact JWS (JWT) with a dedicated symmetric secret
// (env.A2A_MANDATE_SECRET) using `jose` — the same library this codebase
// already uses for session auth and offer/receipt signing. The platform is the
// mandate authority: a user authenticates to the issuance endpoint, the server
// binds their userId into the `owner` claim and signs. Verification is fully
// offline (no DB/chain round-trip), so it stays on the hot path of every
// autonomous payment without adding latency.
//
// Budget ENFORCEMENT across multiple calls lives in spend-ledger.js — the
// mandate states the cap; the ledger tracks cumulative spend against it. This
// module owns issuance, signature verification, and per-call policy checks.

import * as jose from 'jose';

import { env } from '../env.js';
import { platformLimits } from './platform-ceiling.js';

export const MANDATE_TYPE = 'a2a-intent-mandate';
export const MANDATE_VERSION = 1;

// Networks an agent may be authorized to pay over, in preference order. Solana
// is the primary A2A settlement rail — USDC SPL TransferChecked, sub-cent fees,
// sub-second finality — and is what the client picks first (see
// api/_lib/x402/a2a-client.js). The EVM `exact` schemes remain authorizable for
// peers that only accept Base/Ethereum.
export const SUPPORTED_NETWORKS = [
	'solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp', // Solana mainnet (CAIP-2)
	'solana:EtWTRABZaYq6iMfeYKouRu166VU2xqa1', // Solana devnet (CAIP-2)
	'eip155:8453', // Base mainnet
	'eip155:84532', // Base Sepolia
	'eip155:1', // Ethereum mainnet
	'eip155:137', // Polygon
	'eip155:42161', // Arbitrum One
];

// Default rail when a mandate is issued without an explicit network list:
// Solana mainnet.
export const DEFAULT_NETWORK = 'solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp';

// Upper bound on mandate lifetime — a budgeted authorization should be
// short-lived; 90 days is the ceiling, callers pick shorter.
export const MAX_TTL_SECONDS = 90 * 24 * 60 * 60;

export class MandateError extends Error {
	constructor(code, message, status = 400) {
		super(message);
		this.name = 'MandateError';
		this.code = code;
		this.status = status;
	}
}

function secretKey() {
	const secret = env.A2A_MANDATE_SECRET;
	if (!secret) {
		throw new MandateError(
			'mandate_signing_unconfigured',
			'A2A_MANDATE_SECRET (or JWT_SECRET) must be set to issue or verify mandates',
			500,
		);
	}
	return new TextEncoder().encode(secret);
}

// Atomic-units are integers (e.g. USDC has 6 decimals → 1 USDC = 1_000_000).
// Accept string or number/bigint; normalize to a positive BigInt. Rejects
// anything non-integer, negative, or zero.
function toPositiveAtomics(value, field) {
	let bi;
	try {
		bi = typeof value === 'bigint' ? value : BigInt(String(value).trim());
	} catch {
		throw new MandateError('invalid_amount', `${field} must be an integer atomic amount`);
	}
	if (bi <= 0n) throw new MandateError('invalid_amount', `${field} must be greater than zero`);
	return bi;
}

/**
 * Issue (sign) an Intent Mandate. Returns the compact JWS plus the decoded
 * mandate for the caller to echo back to the user.
 *
 * @param {object} opts
 * @param {string} opts.ownerUserId        Authenticated user authorizing the spend.
 * @param {string} opts.subjectAgentId     Agent permitted to spend under this mandate.
 * @param {string|number|bigint} opts.maxAtomics      Total budget across all calls.
 * @param {string|number|bigint} opts.perCallAtomics  Per-call ceiling.
 * @param {string} [opts.currency='USDC']  Currency symbol the mandate covers.
 * @param {string[]} [opts.networks]       Allowed networks (subset of SUPPORTED_NETWORKS).
 * @param {string[]} [opts.resources=[]]   Allowed peer endpoint prefixes; [] = any.
 * @param {string} [opts.purpose='']       Human-readable scope note.
 * @param {number} opts.ttlSec             Lifetime in seconds (1..MAX_TTL_SECONDS).
 * @returns {Promise<{ jws: string, mandate: object }>}
 */
export async function issueIntentMandate({
	ownerUserId,
	subjectAgentId,
	maxAtomics,
	perCallAtomics,
	currency = 'USDC',
	networks,
	resources = [],
	purpose = '',
	ttlSec,
}) {
	if (!ownerUserId) throw new MandateError('invalid_owner', 'ownerUserId is required');
	if (!subjectAgentId) throw new MandateError('invalid_subject', 'subjectAgentId is required');

	const max = toPositiveAtomics(maxAtomics, 'maxAtomics');
	const perCall = toPositiveAtomics(perCallAtomics, 'perCallAtomics');
	if (perCall > max) {
		throw new MandateError('invalid_amount', 'perCallAtomics cannot exceed maxAtomics');
	}
	// Mandates are self-issued, so the platform bounds them: a caller cannot mint
	// themselves an arbitrarily large budget or per-call allowance.
	const platform = platformLimits();
	if (max > BigInt(platform.maxMandateAtomics)) {
		throw new MandateError(
			'amount_exceeds_platform_cap',
			`maxAtomics cannot exceed the platform mandate ceiling of ${platform.maxMandateAtomics}`,
		);
	}
	if (perCall > BigInt(platform.perCallAtomics)) {
		throw new MandateError(
			'amount_exceeds_platform_cap',
			`perCallAtomics cannot exceed the platform per-call ceiling of ${platform.perCallAtomics}`,
		);
	}

	const nets = Array.isArray(networks) && networks.length ? networks : [DEFAULT_NETWORK];
	const unsupported = nets.filter((n) => !SUPPORTED_NETWORKS.includes(n));
	if (unsupported.length) {
		throw new MandateError('unsupported_network', `unsupported network(s): ${unsupported.join(', ')}`);
	}

	if (!Array.isArray(resources)) {
		throw new MandateError('invalid_resources', 'resources must be an array of URL prefixes');
	}
	for (const r of resources) {
		if (typeof r !== 'string' || !/^https?:\/\//i.test(r)) {
			throw new MandateError('invalid_resources', `resource "${r}" must be an http(s) URL prefix`);
		}
	}

	const ttl = Number(ttlSec);
	if (!Number.isFinite(ttl) || ttl < 1 || ttl > MAX_TTL_SECONDS) {
		throw new MandateError('invalid_ttl', `ttlSec must be between 1 and ${MAX_TTL_SECONDS}`);
	}

	const nowSec = Math.floor(Date.now() / 1000);
	// Generate the jti up-front so the returned mandate carries the SAME id the
	// signed token (and thus verifyIntentMandate / the spend ledger) will use.
	// setJti() stamps the JWT but does not mutate `claims`, so we must thread the
	// value through explicitly rather than read it back off `claims`.
	const mandateId = jti();
	const claims = {
		typ: MANDATE_TYPE,
		ver: MANDATE_VERSION,
		owner: ownerUserId,
		// Mandate-specific scope lives under `m` to keep registered JWT claims clean.
		m: {
			maxAtomics: max.toString(),
			perCallAtomics: perCall.toString(),
			currency,
			networks: nets,
			resources,
			purpose: String(purpose || ''),
		},
	};

	const jws = await new jose.SignJWT(claims)
		.setProtectedHeader({ alg: 'HS256', typ: 'JWT' })
		.setSubject(subjectAgentId)
		.setIssuer(env.APP_ORIGIN)
		.setIssuedAt(nowSec)
		.setExpirationTime(nowSec + ttl)
		.setJti(mandateId)
		.sign(secretKey());

	return {
		jws,
		mandate: decodeFromClaims(claims, { sub: subjectAgentId, exp: nowSec + ttl, iat: nowSec, jti: mandateId }),
	};
}

function jti() {
	// jose has no built-in jti; use a 128-bit random hex. crypto.randomUUID is
	// available in Node ≥ 16 and the edge runtime.
	return globalThis.crypto.randomUUID();
}

// Shape the verified/issued claims into a flat, ergonomic mandate object.
function decodeFromClaims(claims, registered) {
	const m = claims.m || {};
	return {
		mandateId: registered.jti,
		ownerUserId: claims.owner,
		subjectAgentId: registered.sub,
		maxAtomics: m.maxAtomics,
		perCallAtomics: m.perCallAtomics,
		currency: m.currency,
		networks: Array.isArray(m.networks) ? m.networks : [],
		resources: Array.isArray(m.resources) ? m.resources : [],
		purpose: m.purpose || '',
		issuedAt: registered.iat,
		expiresAt: registered.exp,
	};
}

/**
 * Verify a mandate's signature and expiry, returning the decoded mandate.
 * Throws MandateError('invalid_mandate', …, 401) on any signature/expiry
 * failure — callers map that to a 401/403 as appropriate.
 *
 * @param {string} jws
 * @returns {Promise<object>} decoded mandate
 */
export async function verifyIntentMandate(jws) {
	if (!jws || typeof jws !== 'string') {
		throw new MandateError('invalid_mandate', 'mandate (compact JWS) is required', 400);
	}
	let payload;
	try {
		({ payload } = await jose.jwtVerify(jws, secretKey(), {
			issuer: env.APP_ORIGIN,
			algorithms: ['HS256'],
		}));
	} catch (err) {
		const expired = err?.code === 'ERR_JWT_EXPIRED';
		throw new MandateError(
			expired ? 'mandate_expired' : 'invalid_mandate',
			expired ? 'mandate has expired' : `mandate verification failed: ${err.message}`,
			401,
		);
	}
	if (payload.typ !== MANDATE_TYPE) {
		throw new MandateError('invalid_mandate', 'not an intent mandate', 401);
	}
	const mandate = decodeFromClaims(payload, {
		jti: payload.jti,
		sub: payload.sub,
		iat: payload.iat,
		exp: payload.exp,
	});
	if (!mandate.maxAtomics || !mandate.perCallAtomics) {
		throw new MandateError('invalid_mandate', 'mandate is missing budget claims', 401);
	}
	return mandate;
}

/**
 * Assert a single proposed payment is within the mandate's policy. Does NOT
 * check cumulative budget — that's spend-ledger.js. Throws MandateError with a
 * specific code on the first violation.
 *
 * @param {object} opts
 * @param {object} opts.mandate                  Decoded mandate from verifyIntentMandate.
 * @param {string|number|bigint} opts.amountAtomics  Proposed payment amount.
 * @param {string} opts.network                  Network the payment will settle on (CAIP-2).
 * @param {string} [opts.resource]               Peer endpoint URL being paid.
 * @param {string} [opts.currency]               Currency of the proposed payment.
 * @param {number} [opts.nowSec]                 Override for testing.
 */
export function assertMandateAllows({ mandate, amountAtomics, network, resource, currency, nowSec }) {
	if (!mandate || typeof mandate !== 'object') {
		throw new MandateError('invalid_mandate', 'mandate is required', 400);
	}
	const now = Number.isFinite(nowSec) ? nowSec : Math.floor(Date.now() / 1000);
	if (mandate.expiresAt && now >= mandate.expiresAt) {
		throw new MandateError('mandate_expired', 'mandate has expired', 401);
	}

	const amount = toPositiveAtomics(amountAtomics, 'amount');
	const perCall = BigInt(mandate.perCallAtomics);
	if (amount > perCall) {
		throw new MandateError(
			'amount_over_per_call',
			`payment ${amount} exceeds per-call cap ${perCall}`,
			402,
		);
	}

	if (currency && mandate.currency && currency !== mandate.currency) {
		throw new MandateError(
			'currency_mismatch',
			`mandate authorizes ${mandate.currency}, payment is ${currency}`,
			402,
		);
	}

	if (network && mandate.networks.length && !mandate.networks.includes(network)) {
		throw new MandateError(
			'network_not_allowed',
			`mandate does not authorize network ${network}`,
			402,
		);
	}

	if (resource && mandate.resources.length) {
		const allowed = mandate.resources.some((prefix) => resource.startsWith(prefix));
		if (!allowed) {
			throw new MandateError(
				'resource_not_allowed',
				`mandate does not authorize paying ${resource}`,
				402,
			);
		}
	}
}
