// Live domain availability and registration intelligence over RDAP
// (Registration Data Access Protocol, RFC 9082/9083), the IANA-standard
// successor to WHOIS. Keyless and live: resolve the authoritative RDAP
// server for a TLD via the IANA bootstrap registry, falling back to the
// rdap.org aggregator when a TLD has no bootstrap entry.

const THREE_WS_UA = 'three.ws/1.0 (+https://three.ws; support@three.ws)';
const IANA_BOOTSTRAP_URL = 'https://data.iana.org/rdap/dns.json';
const RDAP_ORG_BASE = 'https://rdap.org';
const BOOTSTRAP_TTL_MS = 24 * 60 * 60 * 1000;

let bootstrapCache = null;

function domainError(code, message, status = 400) {
	const err = new Error(message);
	err.status = status;
	err.code = code;
	return err;
}

const DOMAIN_RE = /^(?=.{1,253}$)([a-z0-9_](?:[a-z0-9_-]{0,61}[a-z0-9_])?\.)+[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/i;

export function normalizeDomain(raw) {
	const d = String(raw || '').trim().toLowerCase().replace(/\.$/, '');
	if (!DOMAIN_RE.test(d)) throw domainError('invalid_domain', `"${raw}" is not a valid domain name`, 400);
	return d;
}

async function fetchJson(url, timeoutMs = 10_000) {
	const controller = new AbortController();
	const timer = setTimeout(() => controller.abort(), timeoutMs);
	try {
		const res = await fetch(url, {
			headers: { accept: 'application/rdap+json, application/json', 'user-agent': THREE_WS_UA },
			redirect: 'follow',
			signal: controller.signal,
		});
		let body = null;
		try {
			body = await res.json();
		} catch {
			body = null;
		}
		return { status: res.status, body };
	} finally {
		clearTimeout(timer);
	}
}

async function getBootstrapMap() {
	if (bootstrapCache && Date.now() - bootstrapCache.fetchedAt < BOOTSTRAP_TTL_MS) return bootstrapCache.map;
	const { status, body } = await fetchJson(IANA_BOOTSTRAP_URL, 15_000);
	if (status !== 200 || !body || typeof body !== 'object') {
		if (bootstrapCache) return bootstrapCache.map; // serve stale on refresh failure
		return new Map();
	}
	const map = new Map();
	for (const [tlds, urls] of body.services ?? []) {
		const base = urls.find((u) => u.startsWith('https://')) ?? urls[0];
		if (!base) continue;
		for (const tld of tlds) map.set(tld.toLowerCase(), base.replace(/\/$/, ''));
	}
	bootstrapCache = { map, fetchedAt: Date.now() };
	return map;
}

function eventDate(events, action) {
	return events?.find((e) => e.eventAction === action)?.eventDate ?? null;
}

function findRegistrar(entities) {
	for (const e of entities ?? []) {
		if (e.roles?.includes('registrar')) {
			let name = null;
			const vcard = e.vcardArray?.[1];
			if (Array.isArray(vcard)) {
				const fn = vcard.find((entry) => entry[0] === 'fn');
				if (fn && typeof fn[3] === 'string') name = fn[3];
			}
			const ianaId = e.publicIds?.find((p) => String(p.type || '').toLowerCase().includes('iana'))?.identifier ?? null;
			return { name, ianaId };
		}
		const nested = findRegistrar(e.entities);
		if (nested.name || nested.ianaId) return nested;
	}
	return { name: null, ianaId: null };
}

function emptyCheck(domain, status, overrides) {
	return {
		domain,
		status,
		available: null,
		registrar: null,
		registrarIanaId: null,
		createdAt: null,
		updatedAt: null,
		expiresAt: null,
		nameservers: [],
		statusFlags: [],
		dnssecSigned: null,
		rdapServer: null,
		source: 'rdap',
		checkedAt: new Date().toISOString(),
		...overrides,
	};
}

export async function checkDomain(raw) {
	const domain = normalizeDomain(raw);
	const tld = domain.split('.').pop();

	const bootstrap = await getBootstrapMap();
	const base = bootstrap.get(tld) ?? RDAP_ORG_BASE;
	const rdapServer = `${base}/domain/${encodeURIComponent(domain)}`;

	let status;
	let body;
	try {
		({ status, body } = await fetchJson(rdapServer));
	} catch {
		return emptyCheck(domain, 'unknown', { rdapServer, note: 'RDAP server unreachable or timed out' });
	}

	if (status === 404) {
		return emptyCheck(domain, 'available', {
			available: true,
			rdapServer,
			note: 'No registration found in the authoritative RDAP registry, the domain is likely available (registry-level reservations may still apply).',
		});
	}

	if (status !== 200 || !body || typeof body !== 'object') {
		return emptyCheck(domain, 'unknown', {
			rdapServer,
			note: `RDAP query returned HTTP ${status}, this TLD may not support RDAP or rate limits applied`,
		});
	}

	const registrar = findRegistrar(body.entities);
	return {
		domain,
		status: 'registered',
		available: false,
		registrar: registrar.name,
		registrarIanaId: registrar.ianaId,
		createdAt: eventDate(body.events, 'registration'),
		updatedAt: eventDate(body.events, 'last changed') ?? eventDate(body.events, 'last update of RDAP database'),
		expiresAt: eventDate(body.events, 'expiration'),
		nameservers: (body.nameservers ?? []).map((n) => String(n.ldhName || '').toLowerCase()).filter(Boolean),
		statusFlags: body.status ?? [],
		dnssecSigned: body.secureDNS?.delegationSigned ?? null,
		rdapServer,
		source: 'rdap',
		checkedAt: new Date().toISOString(),
	};
}

const BULK_MAX = 50;
const BULK_CONCURRENCY = 8;

export async function checkBulk(domains, max = BULK_MAX) {
	if (!Array.isArray(domains) || domains.length === 0) throw domainError('empty_list', 'Provide a non-empty array of domains', 400);
	if (domains.length > max) throw domainError('too_many_domains', `Maximum ${max} domains per bulk request (got ${domains.length})`, 400);

	const unique = [...new Set(domains.map((d) => String(d)))];
	const results = new Array(unique.length);
	let next = 0;
	async function worker() {
		while (next < unique.length) {
			const i = next++;
			try {
				results[i] = await checkDomain(unique[i]);
			} catch (err) {
				results[i] = emptyCheck(unique[i], 'unknown', { note: err.message || 'lookup failed' });
			}
		}
	}
	await Promise.all(Array.from({ length: Math.min(BULK_CONCURRENCY, unique.length) }, worker));
	return results;
}
