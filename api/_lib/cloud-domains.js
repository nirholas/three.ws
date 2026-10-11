// Google Cloud Domains (domains.googleapis.com) client: the registrar behind the
// domain_* MCP tools and /api/domains.
//
// Authenticated as the Cloud Run runtime service account through
// getGcpAccessToken (gcp-auth.js). Every call is a real request to the API, and
// nothing here is cached or faked. Callers that want caching wrap these (see
// domains-service.js).
//
// What the API can and cannot do, measured against the live service 2026-10-10:
//   - searchDomains?query=<name>  suggests names across TLDs, availability is
//     approximate and the price is the yearly price.
//   - retrieveRegisterParameters?domainName=<fqdn>  exact availability, yearly
//     price, supported privacy modes and the notices a registration must
//     acknowledge. An unsupported TLD answers UNSUPPORTED.
//   - register  creates the registration (a long-running operation). With
//     validateOnly:true it validates price, availability and contacts and
//     registers nothing. Registration is for ONE year; the same yearly price is
//     the renewal price.
//   - There is no endpoint that lists supported TLDs. data/domain-tlds.json is
//     probed against retrieveRegisterParameters by scripts/refresh-domain-tlds.mjs.

import { getGcpAccessToken } from './gcp-auth.js';
import { fetchUpstream } from './upstream-fetch.js';

const API = 'https://domains.googleapis.com/v1';

export const GCP_PROJECT = process.env.GOOGLE_CLOUD_PROJECT || 'aerial-vehicle-466722-p5';

// Domain work runs as its own service account, never as the identity the rest
// of the API uses. That account can register domains (which bills the project)
// and edit DNS and certificates, so it holds nothing else, and no key for it
// exists: the API's own credential impersonates it through IAM Credentials
// (roles/iam.serviceAccountTokenCreator on this account only).
export const DOMAINS_SERVICE_ACCOUNT =
	process.env.DOMAINS_SERVICE_ACCOUNT || `three-ws-domains@${GCP_PROJECT}.iam.gserviceaccount.com`;

const _token = { value: null, expiresAt: 0 };

/**
 * Access token for the domains service account. `DOMAINS_ACCESS_TOKEN` is an
 * operator override for scripts run from a workstation
 * (`DOMAINS_ACCESS_TOKEN=$(gcloud auth print-access-token)`); the server never
 * sets it.
 */
export async function getDomainsAccessToken() {
	if (process.env.DOMAINS_ACCESS_TOKEN) return process.env.DOMAINS_ACCESS_TOKEN;
	if (_token.value && Date.now() < _token.expiresAt) return _token.value;
	const base = await getGcpAccessToken();
	const res = await fetchUpstream(
		`https://iamcredentials.googleapis.com/v1/projects/-/serviceAccounts/${DOMAINS_SERVICE_ACCOUNT}:generateAccessToken`,
		{
			method: 'POST',
			headers: { Authorization: `Bearer ${base}`, 'content-type': 'application/json' },
			body: JSON.stringify({ scope: ['https://www.googleapis.com/auth/cloud-platform'], lifetime: '3600s' }),
		},
		{ name: 'gcp-iam-credentials', timeoutMs: 10_000, attempts: 2, okWhen: (r) => r.ok || r.status === 403 },
	).catch((err) => {
		throw new CloudDomainsError(`Could not reach IAM Credentials: ${err?.message || 'network error'}`, { status: 502, code: 'domains_upstream_error' });
	});
	const body = await res.json().catch(() => ({}));
	if (!res.ok || !body.accessToken) {
		throw new CloudDomainsError(
			`The API credential may not impersonate ${DOMAINS_SERVICE_ACCOUNT}: ${body?.error?.message || res.status}`,
			{ status: 503, code: 'domains_permission_denied' },
		);
	}
	_token.value = body.accessToken;
	_token.expiresAt = new Date(body.expireTime).getTime() - 5 * 60_000;
	return _token.value;
}
const LOCATION = `projects/${GCP_PROJECT}/locations/global`;

export class CloudDomainsError extends Error {
	constructor(message, { status = 502, code = 'domains_upstream_error', detail } = {}) {
		super(message);
		this.name = 'CloudDomainsError';
		this.status = status;
		this.code = code;
		if (detail !== undefined) this.detail = detail;
	}
}

/** Google's Money type ({ units: "12", nanos: 500000000 }) to a number of dollars. */
export function moneyToNumber(money) {
	if (!money) return null;
	return Number(money.units || 0) + Number(money.nanos || 0) / 1e9;
}

/** Dollars to Google's Money type. Two-decimal precision is all the registrar accepts. */
export function numberToMoney(amount, currencyCode = 'USD') {
	const cents = Math.round(Number(amount) * 100);
	const units = Math.trunc(cents / 100);
	const nanos = (cents - units * 100) * 10_000_000;
	return { currencyCode, units: String(units), ...(nanos ? { nanos } : {}) };
}

function mapUpstreamError(status, body) {
	const message = body?.error?.message || `Cloud Domains answered ${status}`;
	if (status === 400) return new CloudDomainsError(message, { status: 400, code: 'domains_invalid_request', detail: body?.error?.details });
	if (status === 403) {
		return new CloudDomainsError(
			`The platform service account lacks Cloud Domains permission: ${message}`,
			{ status: 503, code: 'domains_permission_denied' },
		);
	}
	if (status === 404) return new CloudDomainsError(message, { status: 404, code: 'domains_not_found' });
	if (status === 409) return new CloudDomainsError(message, { status: 409, code: 'domains_conflict' });
	if (status === 429) return new CloudDomainsError('Cloud Domains is rate limiting requests. Retry shortly.', { status: 429, code: 'domains_rate_limited' });
	return new CloudDomainsError(message, { status: 502, code: 'domains_upstream_error' });
}

async function call(path, { method = 'GET', body, query } = {}) {
	const token = await getDomainsAccessToken();
	const url = new URL(`${API}/${path}`);
	for (const [k, v] of Object.entries(query || {})) if (v != null) url.searchParams.set(k, String(v));
	const init = {
		method,
		headers: {
			Authorization: `Bearer ${token}`,
			'x-goog-user-project': GCP_PROJECT,
			...(body ? { 'content-type': 'application/json' } : {}),
		},
		...(body ? { body: JSON.stringify(body) } : {}),
	};
	// A write is never retried: a register that timed out may still have
	// succeeded, and the caller resolves that through the idempotency key.
	// Every 4xx, 429 included, is the API's answer about this request, so it
	// comes back as a response to map (a quota 429 is not worth retrying inside
	// the call and must not trip the breaker); only 5xx is transient.
	const res = await fetchUpstream(url, init, {
		name: 'cloud-domains',
		timeoutMs: 20_000,
		attempts: method === 'GET' ? 3 : 1,
		okWhen: (r) => r.status < 500,
	}).catch((err) => {
		throw new CloudDomainsError(`Cloud Domains is unavailable: ${err?.message || 'network error'}`, { status: 502, code: 'domains_upstream_error' });
	});
	const text = await res.text();
	let parsed = null;
	try {
		parsed = text ? JSON.parse(text) : null;
	} catch {
		parsed = null;
	}
	if (!res.ok) throw mapUpstreamError(res.status, parsed);
	return parsed;
}

/** Suggested names across TLDs for a query string. */
export async function searchDomains(query) {
	const out = await call(`${LOCATION}/registrations:searchDomains`, { query: { query } });
	return out?.registerParameters || [];
}

/** Exact availability + price + privacy + notices for one fully-qualified name. */
export async function retrieveRegisterParameters(domainName) {
	const out = await call(`${LOCATION}/registrations:retrieveRegisterParameters`, { query: { domainName } });
	return out?.registerParameters || null;
}

/**
 * Register a domain. `validateOnly: true` runs every server-side check and
 * registers nothing; the real call returns a long-running operation to poll.
 */
export async function registerDomain({ registration, yearlyPrice, domainNotices = [], contactNotices = [], validateOnly = false }) {
	return call(`${LOCATION}/registrations:register`, {
		method: 'POST',
		body: { registration, yearlyPrice, domainNotices, contactNotices, validateOnly },
	});
}

/** A long-running operation by full name (projects/.../operations/...). */
export async function getOperation(name) {
	return call(name);
}

/** The registration resource for a domain, or null when it does not exist. */
export async function getRegistration(domainName) {
	try {
		return await call(`${LOCATION}/registrations/${domainName}`);
	} catch (err) {
		if (err.code === 'domains_not_found') return null;
		throw err;
	}
}

/** Point a registration at custom nameservers (the Cloud DNS zone's). */
export async function configureCustomDns(domainName, nameServers, { validateOnly = false } = {}) {
	return call(`${LOCATION}/registrations/${domainName}:configureDnsSettings`, {
		method: 'POST',
		body: {
			dnsSettings: { customDns: { nameServers } },
			updateMask: 'customDns',
			validateOnly,
		},
	});
}

/** Switch a registration between AUTOMATIC_RENEWAL and MANUAL_RENEWAL at the registrar. */
export async function setRenewalMethod(domainName, method) {
	return call(`${LOCATION}/registrations/${domainName}:configureManagementSettings`, {
		method: 'POST',
		body: { managementSettings: { preferredRenewalMethod: method }, updateMask: 'preferredRenewalMethod' },
	});
}
