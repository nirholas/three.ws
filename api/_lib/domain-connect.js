// Connect a purchased domain to an agent's public page.
//
// Production is Cloud Run behind one global external load balancer
// (docs/ops/gcp-production.md, "DNS and TLS"). A domain reaches an agent's page
// in four steps, each a real API call run as the domains service account:
//
//   1. a public Cloud DNS managed zone for the domain, with A records for the
//      apex and www pointing at the load balancer's address;
//   2. the registration's nameservers switched to that zone (Cloud Domains
//      configureDnsSettings);
//   3. a Google-managed SSL certificate for the apex and www, attached to the
//      HTTPS proxy (the proxy holds at most 15 certificates);
//   4. rows in web_domain_hosts. Once the certificate turns ACTIVE the rows go
//      `live` and the host router in server/index.mjs serves the agent page on
//      that host.
//
// A domain connects only if the caller owns an active registration for it.

import { createHash } from 'node:crypto';

import { sql } from './db.js';
import { acquireLock, releaseLock } from './cache.js';
import { fetchUpstream } from './upstream-fetch.js';
import { logger } from './usage.js';
import { GCP_PROJECT, configureCustomDns, getDomainsAccessToken } from './cloud-domains.js';
import { DomainsError, normalizeDomain } from './domains-service.js';

const log = logger('domain-connect');

export const LB_ADDRESS_NAME = process.env.DOMAINS_LB_ADDRESS_NAME || 'three-ws-ip';
export const HTTPS_PROXY = process.env.DOMAINS_HTTPS_PROXY || 'three-ws-https-proxy';

/** Google caps one target HTTPS proxy at 15 SSL certificates; one is the platform's own. */
export const PROXY_CERT_LIMIT = 15;

async function gcp(url, { method = 'GET', body } = {}) {
	const token = await getDomainsAccessToken();
	const res = await fetchUpstream(
		url,
		{
			method,
			headers: { Authorization: `Bearer ${token}`, 'x-goog-user-project': GCP_PROJECT, ...(body ? { 'content-type': 'application/json' } : {}) },
			...(body ? { body: JSON.stringify(body) } : {}),
		},
		{ name: 'gcp-domain-connect', timeoutMs: 30_000, attempts: method === 'GET' ? 3 : 1, okWhen: (r) => r.status < 500 },
	).catch((err) => {
		throw new DomainsError(`Google Cloud is unavailable: ${err?.message || 'network error'}`, { status: 502, code: 'domains_upstream_error' });
	});
	const text = await res.text();
	let json = null;
	try {
		json = text ? JSON.parse(text) : null;
	} catch {
		json = null;
	}
	if (!res.ok) {
		const message = json?.error?.message || `Google Cloud answered ${res.status}`;
		const e = new DomainsError(message, { status: res.status === 404 ? 404 : res.status === 409 ? 409 : res.status === 403 ? 503 : 502, code: res.status === 409 ? 'already_exists' : res.status === 404 ? 'not_found' : res.status === 403 ? 'domains_permission_denied' : 'domains_upstream_error' });
		e.upstreamStatus = res.status;
		throw e;
	}
	return json;
}

const COMPUTE = `https://compute.googleapis.com/compute/v1/projects/${GCP_PROJECT}/global`;
const DNS = `https://dns.googleapis.com/dns/v1/projects/${GCP_PROJECT}`;

async function waitGlobalOperation(op) {
	if (!op?.name || op.status === 'DONE') return op;
	const done = await gcp(`${COMPUTE}/operations/${op.name}/wait`, { method: 'POST' });
	if (done?.error?.errors?.length) {
		throw new DomainsError(done.error.errors.map((e) => e.message).join('; '), { status: 502, code: 'domains_upstream_error' });
	}
	return done;
}

const slug = (domain) => createHash('sha256').update(domain).digest('hex').slice(0, 12);
const zoneName = (domain) => `tw-${slug(domain)}`;
const certName = (domain) => `tw-${slug(domain)}`;

async function loadBalancerIp() {
	const a = await gcp(`${COMPUTE}/addresses/${LB_ADDRESS_NAME}`);
	if (!a?.address) throw new DomainsError('The load balancer address could not be read.', { status: 502, code: 'domains_upstream_error' });
	return a.address;
}

export async function ensureZone(domain) {
	const name = zoneName(domain);
	try {
		return await gcp(`${DNS}/managedZones`, {
			method: 'POST',
			body: { name, dnsName: `${domain}.`, description: `three.ws agent domain ${domain}`, visibility: 'public' },
		});
	} catch (err) {
		if (err.code !== 'already_exists') throw err;
		return gcp(`${DNS}/managedZones/${name}`);
	}
}

async function ensureRecords(zone, domain, ip) {
	const additions = [`${domain}.`, `www.${domain}.`].map((name) => ({ name, type: 'A', ttl: 300, rrdatas: [ip] }));
	const existing = await gcp(`${DNS}/managedZones/${zone}/rrsets?type=A`);
	const have = new Map((existing?.rrsets || []).map((r) => [r.name, r]));
	const todo = additions.filter((r) => have.get(r.name)?.rrdatas?.[0] !== ip);
	if (!todo.length) return;
	const deletions = todo.filter((r) => have.has(r.name)).map((r) => have.get(r.name));
	await gcp(`${DNS}/managedZones/${zone}/changes`, { method: 'POST', body: { additions: todo, ...(deletions.length ? { deletions } : {}) } });
}

async function proxyCertificates() {
	const proxy = await gcp(`${COMPUTE}/targetHttpsProxies/${HTTPS_PROXY}`);
	return { proxy, urls: proxy?.sslCertificates || [] };
}

async function ensureCertificate(domain) {
	const name = certName(domain);
	try {
		await waitGlobalOperation(
			await gcp(`${COMPUTE}/sslCertificates`, {
				method: 'POST',
				body: { name, type: 'MANAGED', managed: { domains: [domain, `www.${domain}`] }, description: `three.ws agent domain ${domain}` },
			}),
		);
	} catch (err) {
		if (err.code !== 'already_exists') throw err;
	}
	const lockKey = `domains:proxy-certs`;
	if (!(await acquireLock(lockKey, 60))) {
		throw new DomainsError('Another domain is being attached right now. Retry in a few seconds.', { status: 409, code: 'connect_busy' });
	}
	try {
		const { urls } = await proxyCertificates();
		const url = `https://www.googleapis.com/compute/v1/projects/${GCP_PROJECT}/global/sslCertificates/${name}`;
		if (urls.includes(url)) return name;
		if (urls.length >= PROXY_CERT_LIMIT) {
			throw new DomainsError(
				`The load balancer already holds ${urls.length} of its ${PROXY_CERT_LIMIT} certificates. Free one or move to a certificate map before connecting another domain.`,
				{ status: 503, code: 'cert_capacity' },
			);
		}
		await waitGlobalOperation(
			await gcp(`${COMPUTE}/targetHttpsProxies/${HTTPS_PROXY}/setSslCertificates`, { method: 'POST', body: { sslCertificates: [...urls, url] } }),
		);
		return name;
	} finally {
		await releaseLock(lockKey);
	}
}

async function ownedRegistration(userId, domain) {
	const [row] = await sql`
		select id, domain_name from web_domain_registrations
		where user_id = ${userId} and lower(domain_name) = ${domain} and status = 'active'
	`;
	if (!row) {
		throw new DomainsError(`You have no active registration for ${domain}. Register it first (domain_register), then connect it once its status is active.`, {
			status: 403,
			code: 'domain_not_owned',
		});
	}
	return row;
}

async function ownedAgent(userId, agentId) {
	const [agent] = await sql`select id, name from agent_identities where id = ${agentId} and user_id = ${userId} and deleted_at is null`;
	if (!agent) throw new DomainsError('That agent was not found on your account.', { status: 404, code: 'agent_not_found' });
	return agent;
}

function publicHost(h) {
	return { host: h.host, agentId: h.agent_id, status: h.status, certName: h.cert_name, nameServers: h.name_servers, error: h.error, liveAt: h.live_at };
}

/**
 * Connect an owned domain to an agent's public page. Idempotent: running it
 * again for the same domain re-checks each step and returns the current state.
 */
export async function connectDomain({ userId, agentId, domain: input }) {
	const domain = normalizeDomain(input);
	const reg = await ownedRegistration(userId, domain);
	await ownedAgent(userId, agentId);

	const [taken] = await sql`select user_id from web_domain_hosts where lower(host) = ${domain} and user_id <> ${userId}`;
	if (taken) throw new DomainsError('That host is connected to another account.', { status: 409, code: 'host_taken' });

	const ip = await loadBalancerIp();
	const zone = await ensureZone(domain);
	await ensureRecords(zone.name, domain, ip);
	const nameServers = zone.nameServers || [];
	if (nameServers.length) {
		try {
			await configureCustomDns(domain, nameServers);
		} catch (err) {
			// The registrar rejects a no-op change; the zone is already the delegation.
			if (err.code !== 'domains_invalid_request' && err.code !== 'domains_conflict') throw new DomainsError(err.message, { status: err.status, code: err.code });
		}
	}
	const cert = await ensureCertificate(domain);

	const rows = [];
	for (const host of [domain, `www.${domain}`]) {
		const [row] = await sql`
			insert into web_domain_hosts (user_id, agent_id, host, registration_id, status, dns_zone, name_servers, cert_name)
			values (${userId}, ${agentId}, ${host}, ${reg.id}, 'pending_cert', ${zone.name}, ${nameServers}, ${cert})
			on conflict (lower(host)) do update
				set agent_id = excluded.agent_id, dns_zone = excluded.dns_zone, name_servers = excluded.name_servers,
				    cert_name = excluded.cert_name, error = null, updated_at = now(),
				    status = case when web_domain_hosts.status = 'live' then 'live' else 'pending_cert' end
			returning *
		`;
		rows.push(row);
	}
	log.info('connected', { domain, agentId, cert });
	return {
		domain,
		agentId,
		status: rows[0].status,
		nameServers,
		dns: { zone: zone.name, records: [`${domain} A ${ip}`, `www.${domain} A ${ip}`] },
		certificate: cert,
		hosts: rows.map(publicHost),
		note: 'DNS and the certificate propagate on their own. The certificate usually turns active within 15 to 60 minutes; poll domain_connect_status until the host is live.',
	};
}

/** Poll the certificate and promote hosts to live when it is ACTIVE. */
export async function connectStatus({ userId, domain: input }) {
	const domain = normalizeDomain(input);
	const rows = await sql`select * from web_domain_hosts where user_id = ${userId} and (lower(host) = ${domain} or lower(host) = ${`www.${domain}`}) order by host`;
	if (!rows.length) throw new DomainsError(`${domain} is not connected to an agent. Run domain_connect first.`, { status: 404, code: 'not_connected' });
	const cert = rows[0].cert_name;
	let certState = null;
	if (cert) {
		const c = await gcp(`${COMPUTE}/sslCertificates/${cert}`).catch(() => null);
		certState = { status: c?.managed?.status || 'UNKNOWN', domainStatus: c?.managed?.domainStatus || {} };
		if (certState.status === 'ACTIVE') {
			await sql`update web_domain_hosts set status = 'live', live_at = coalesce(live_at, now()), error = null, updated_at = now() where user_id = ${userId} and cert_name = ${cert}`;
		} else if (certState.status === 'PROVISIONING_FAILED' || certState.status === 'PROVISIONING_FAILED_PERMANENTLY') {
			await sql`update web_domain_hosts set status = 'failed', error = ${`Certificate provisioning failed: ${JSON.stringify(certState.domainStatus)}`}, updated_at = now() where user_id = ${userId} and cert_name = ${cert} and status <> 'live'`;
		}
	}
	const fresh = await sql`select * from web_domain_hosts where user_id = ${userId} and cert_name = ${cert} order by host`;
	return {
		domain,
		status: fresh.every((h) => h.status === 'live') ? 'live' : fresh[0].status,
		certificate: certState,
		hosts: fresh.map(publicHost),
		url: fresh.every((h) => h.status === 'live') ? `https://${domain}` : null,
	};
}

/** The caller's connected hosts. */
export async function listHosts(userId) {
	const rows = await sql`select * from web_domain_hosts where user_id = ${userId} order by created_at desc limit 100`;
	return rows.map(publicHost);
}

// ── Host routing ────────────────────────────────────────────────────────────

const HOST_TTL_MS = 30_000;
let hostMemo = { at: 0, map: new Map() };

/**
 * The agent id a live custom host serves, or null. Held in memory for 30
 * seconds so the router costs one query per instance per half minute.
 */
export async function agentForHost(host) {
	const h = String(host || '').toLowerCase().split(':')[0];
	if (!h) return null;
	if (Date.now() - hostMemo.at > HOST_TTL_MS) {
		try {
			const rows = await sql`select lower(host) as host, agent_id from web_domain_hosts where status = 'live'`;
			hostMemo = { at: Date.now(), map: new Map(rows.map((r) => [r.host, r.agent_id])) };
		} catch (err) {
			log.warn('host_table_unavailable', { message: err?.message });
			hostMemo = { at: Date.now() - HOST_TTL_MS + 5_000, map: hostMemo.map };
		}
	}
	return hostMemo.map.get(h) || null;
}
