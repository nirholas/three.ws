// Real-funds agreement: server-side record and enforcement.
//
// Before any real-funds action, a person signs three documents together: the
// Terms of Service, the Risk Disclosure, and the Agent Wallet Agreement. The
// signing dialog lives in public/risk-ack.js and posts to /api/legal/risk-ack;
// this module validates that signature, writes the durable record into
// legal_signatures (migration 20260917180000_legal_signatures.sql), and gives
// every money-moving endpoint one call, requireRealFundsAgreement(), that
// refuses an account without a current signature. Usage is in
// docs/risk-acknowledgment.md.
//
// The client gate is a convenience; this is the enforcement. It covers session
// and API-key callers alike, so a script cannot skip the agreement the UI shows.
//
// Versions come from AGREEMENT_DOCUMENTS / RISK_ACK_VERSION in the client
// module, so the documents a signature records are always the ones the dialog
// showed. Each signature also stores the sha256 of every document's <main>
// text as this server serves it, which pins exactly what was signed even if
// the page is later edited without a version bump.

import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { sql } from './db.js';
import { withDbRetry } from './db-retry.js';
import { logAuditNow } from './audit.js';
import { clientIp } from './rate-limit.js';
import { error } from './http.js';
import { env } from './env.js';
import { clientCountry } from './client-geo.js';
import {
	AGREEMENT_ATTESTATIONS,
	AGREEMENT_DOCUMENTS,
	RISK_ACK_REQUIRED_ERROR,
	RISK_ACK_VERSION,
	normalizeSignatureName,
} from '../../public/risk-ack.js';

/**
 * Comprehensively sanctioned jurisdictions, refused with HTTP 451 before any
 * real-funds action. Override with REAL_FUNDS_BLOCKED_COUNTRIES (comma-separated
 * ISO 3166-1 alpha-2 codes). Unknown country never blocks.
 */
export const SANCTIONED_COUNTRIES = Object.freeze(new Set(['CU', 'IR', 'KP', 'SY', 'RU', 'BY']));

// Sanctioned regions of Ukraine (Crimea incl. Sevastopol, Donetsk, Luhansk). The
// edge geo header carries "UA,<region>,<city>", so these match on the region name.
const SANCTIONED_UA_REGIONS = /\b(crimea|sevastopol|donetsk|luhansk|lugansk)\b/i;

function blockedCountries() {
	const raw = process.env.REAL_FUNDS_BLOCKED_COUNTRIES;
	if (raw === undefined || raw === '') return SANCTIONED_COUNTRIES;
	return new Set(raw.split(',').map((c) => c.trim().toUpperCase()).filter(Boolean));
}

/** True when the edge geo header places the request in a sanctioned jurisdiction. Pure. */
export function isSanctionedRequest(req) {
	const country = clientCountry(req);
	if (!country) return false;
	if (blockedCountries().has(country)) return true;
	if (country === 'UA') {
		const raw = req?.headers?.['x-client-geo-location'];
		return typeof raw === 'string' && SANCTIONED_UA_REGIONS.test(raw.split(',').slice(1).join(','));
	}
	return false;
}

const SLUG = /^[a-z0-9][a-z0-9-]{0,39}$/;
const PATH = /^\/[\x20-\x7e]{0,199}$/;
const UA_MAX = 512;
const SIGN_PATH = '/legal/agreements';

const DOCUMENT_FILES = {
	tos: new URL('../../public/legal/tos.html', import.meta.url),
	risk: new URL('../../public/legal/risk.html', import.meta.url),
	agentWallet: new URL('../../public/legal/agent-wallet.html', import.meta.url),
};

/**
 * sha256 of a legal page's <main> element, whitespace-collapsed so a
 * re-indent does not change the fingerprint but any wording change does. Pure.
 * @param {string} html
 */
export function fingerprintDocumentHtml(html) {
	const match = /<main\b[^>]*>([\s\S]*?)<\/main>/i.exec(html);
	const text = (match ? match[1] : html).replace(/\s+/g, ' ').trim();
	return createHash('sha256').update(text).digest('hex');
}

let _fingerprints = null;

/** Fingerprints of the served documents, computed once per process. Never rejects. */
export function documentFingerprints() {
	if (_fingerprints) return _fingerprints;
	_fingerprints = Promise.all(
		AGREEMENT_DOCUMENTS.map(async (d) => {
			try {
				return [d.key, fingerprintDocumentHtml(await readFile(DOCUMENT_FILES[d.key], 'utf8'))];
			} catch (err) {
				console.error('[real-funds-agreement] could not fingerprint', d.key, err?.message || err);
				return [d.key, null];
			}
		}),
	).then((pairs) => Object.fromEntries(pairs));
	return _fingerprints;
}

/**
 * Validate a signature POST body. Pure: every rule the record must satisfy
 * lives here, so the endpoint cannot store a signature the dialog could not
 * have produced.
 *
 * @param {unknown} body
 * @returns {{ ok: true, value: { version: number, documents: Record<string, number>, attestations: Record<string, true>, signatureName: string, context: string|null, path: string|null } }
 *   | { ok: false, code: string, message: string }}
 */
export function validateSignatureBody(body) {
	if (!body || typeof body !== 'object' || Array.isArray(body)) {
		return { ok: false, code: 'invalid_body', message: 'body must be a JSON object' };
	}
	const version = Number(body.version);
	if (!Number.isInteger(version) || version !== RISK_ACK_VERSION) {
		return {
			ok: false,
			code: 'invalid_version',
			message: `version must be ${RISK_ACK_VERSION}, the current agreement version. Reload the page and sign again.`,
		};
	}
	const docs = body.documents && typeof body.documents === 'object' ? body.documents : {};
	for (const d of AGREEMENT_DOCUMENTS) {
		if (Number(docs[d.key]) !== d.version) {
			return {
				ok: false,
				code: 'document_not_accepted',
				message: `${d.title} version ${d.version} must be accepted`,
			};
		}
	}
	const attest = body.attestations && typeof body.attestations === 'object' ? body.attestations : {};
	for (const a of AGREEMENT_ATTESTATIONS) {
		if (attest[a.key] !== true) {
			return { ok: false, code: 'attestation_missing', message: `the "${a.key}" confirmation must be checked` };
		}
	}
	const signatureName = normalizeSignatureName(body.signatureName);
	if (!signatureName) {
		return { ok: false, code: 'invalid_signature', message: 'type your full name to sign' };
	}
	return {
		ok: true,
		value: {
			version,
			documents: Object.fromEntries(AGREEMENT_DOCUMENTS.map((d) => [d.key, d.version])),
			attestations: Object.fromEntries(AGREEMENT_ATTESTATIONS.map((a) => [a.key, true])),
			signatureName,
			context: typeof body.context === 'string' && SLUG.test(body.context) ? body.context : null,
			path: typeof body.path === 'string' && PATH.test(body.path) ? body.path : null,
		},
	};
}

/**
 * Write a validated signature. The legal_signatures row is the deliverable;
 * the audit_log row is the secondary trail. Never throws.
 *
 * @param {{ userId: string|null, value: ReturnType<typeof validateSignatureBody>['value'], req?: import('http').IncomingMessage }} args
 * @returns {Promise<boolean>} true when the legal_signatures row landed
 */
export async function recordRealFundsSignature({ userId, value, req = null }) {
	const fingerprints = await documentFingerprints();
	const documents = Object.fromEntries(
		AGREEMENT_DOCUMENTS.map((d) => [d.key, { version: d.version, sha256: fingerprints[d.key] }]),
	);
	const ip = req ? clientIp(req) : null;
	const ua = req?.headers?.['user-agent'] ? String(req.headers['user-agent']).slice(0, UA_MAX) : null;
	let recorded = false;
	try {
		await withDbRetry(
			() => sql`
				insert into legal_signatures
					(user_id, bundle_version, documents, signature_name, attestations, context, path, ip, user_agent)
				values
					(${userId}, ${value.version}, ${JSON.stringify(documents)}::jsonb, ${value.signatureName},
					 ${JSON.stringify(value.attestations)}::jsonb, ${value.context}, ${value.path}, ${ip}, ${ua})
			`,
			{ timeoutMs: 8_000 },
		);
		recorded = true;
	} catch (err) {
		console.error('[real-funds-agreement] signature insert failed', err?.message || err);
	}
	if (recorded) {
		if (userId) _rememberSigned(userId);
		await logAuditNow({
			userId,
			action: 'risk-ack-accept',
			resourceId: null,
			meta: { version: value.version, documents: value.documents, context: value.context, path: value.path },
			req,
		});
	}
	return recorded;
}

// Positive results only: signatures are append-only and the required version
// is a deploy-time constant, so "signed" can never become false inside one
// process. Negative results are never cached, so a fresh signature takes
// effect on the very next request.
const SIGNED_CACHE_TTL_MS = 10 * 60_000;
const SIGNED_CACHE_MAX = 5_000;
const _signedCache = new Map();

function _cachedSigned(userId) {
	const at = _signedCache.get(userId);
	if (at === undefined) return false;
	if (Date.now() - at > SIGNED_CACHE_TTL_MS) {
		_signedCache.delete(userId);
		return false;
	}
	return true;
}

function _rememberSigned(userId) {
	if (_signedCache.size >= SIGNED_CACHE_MAX) _signedCache.delete(_signedCache.keys().next().value);
	_signedCache.set(userId, Date.now());
}

/** Test hook: forget cached signature lookups. */
export function resetRealFundsAgreementCache() {
	_signedCache.clear();
}

/**
 * The account's latest signature at or above the current version.
 * Throws on a database failure; callers decide how to fail.
 * @param {string} userId
 * @returns {Promise<{ signedAt: string, signatureName: string, context: string|null } | null>}
 */
export async function currentSignatureFor(userId) {
	const rows = await withDbRetry(
		() => sql`
			select created_at, signature_name, context
			from legal_signatures
			where user_id = ${userId} and bundle_version >= ${RISK_ACK_VERSION}
			order by created_at desc
			limit 1
		`,
		{ timeoutMs: 5_000 },
	);
	const row = rows?.[0];
	if (!row) return null;
	_rememberSigned(userId);
	return {
		signedAt: new Date(row.created_at).toISOString(),
		signatureName: row.signature_name,
		context: row.context ?? null,
	};
}

/**
 * True when the account holds a current signature. Cached like the HTTP gate.
 * Throws on a database failure so the caller can fail closed.
 * @param {string} userId
 */
export async function hasCurrentAgreement(userId) {
	if (_cachedSigned(userId)) return true;
	return Boolean(await currentSignatureFor(userId));
}

/**
 * Every signature this account has made, newest first, for the review page.
 * @param {string} userId
 * @param {{ limit?: number }} [opts]
 */
export async function signatureHistoryFor(userId, { limit = 20 } = {}) {
	const rows = await withDbRetry(
		() => sql`
			select id, bundle_version, documents, signature_name, context, path, created_at
			from legal_signatures
			where user_id = ${userId}
			order by created_at desc
			limit ${Math.min(Math.max(1, limit), 100)}
		`,
		{ timeoutMs: 5_000 },
	);
	return (rows || []).map((r) => ({
		id: r.id,
		version: r.bundle_version,
		current: r.bundle_version >= RISK_ACK_VERSION,
		documents: r.documents,
		signatureName: r.signature_name,
		context: r.context ?? null,
		path: r.path ?? null,
		signedAt: new Date(r.created_at).toISOString(),
	}));
}

/** The machine-readable part of a refusal, so any client can route the user to sign. */
export function agreementRequirement() {
	const origin = env.APP_ORIGIN;
	return {
		version: RISK_ACK_VERSION,
		sign_url: `${origin}${SIGN_PATH}`,
		documents: AGREEMENT_DOCUMENTS.map((d) => ({
			key: d.key,
			title: d.title,
			version: d.version,
			url: `${origin}${d.path}`,
		})),
	};
}

/**
 * Refuse a real-funds request from an account that has not signed the current
 * agreements. Sends the response and resolves false when refused; resolves
 * true when the caller may proceed.
 *
 * Devnet is exempt: it moves no real value, and the client gate exempts it
 * too. A database failure fails CLOSED with 503: real funds never move on an
 * unverified agreement.
 *
 * @param {import('http').IncomingMessage} req
 * @param {import('http').ServerResponse} res
 * @param {{ userId: string|null|undefined, network?: string|null, context?: string }} opts
 * @returns {Promise<boolean>}
 */
export async function requireRealFundsAgreement(req, res, { userId, network = null, context = 'real-funds' } = {}) {
	if (String(network || '').toLowerCase() === 'devnet') return true;
	if (isSanctionedRequest(req)) {
		error(
			res,
			451,
			'region_not_supported',
			'Real-funds features are not available in your region because of sanctions law. Nothing was sent.',
			{ context },
		);
		return false;
	}
	if (!userId) {
		error(res, 401, 'unauthorized', 'sign in to use real-funds features');
		return false;
	}
	if (_cachedSigned(userId)) return true;
	let signature;
	try {
		signature = await currentSignatureFor(userId);
	} catch (err) {
		console.error('[real-funds-agreement] signature lookup failed', context, err?.message || err);
		error(
			res,
			503,
			'agreement_check_unavailable',
			'We could not verify your signed real-funds agreements, so nothing was sent. Try again in a moment.',
		);
		return false;
	}
	if (signature) return true;
	error(
		res,
		403,
		RISK_ACK_REQUIRED_ERROR,
		'Sign the real-funds agreements (Terms of Service, Risk Disclosure, and Agent Wallet Agreement) before using ' +
			`real funds. Nothing was sent. Sign at ${env.APP_ORIGIN}${SIGN_PATH}`,
		{ context, ...agreementRequirement() },
	);
	return false;
}
