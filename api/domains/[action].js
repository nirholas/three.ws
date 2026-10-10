/**
 * Web domains API: search, check, price, register and connect.
 * Backed by Google Cloud Domains (api/_lib/cloud-domains.js). Doc: docs/domains.md.
 *
 * Public reads (rate limited per caller, because each uncached call is a
 * metered registrar request):
 *   GET  /api/domains/search?q=orbit&tlds=com,xyz   suggestions with prices
 *   GET  /api/domains/check?domain=orbit.app        one answer + reason
 *   GET  /api/domains/pricing?tld=app               TLD price list (snapshot)
 *   GET  /api/domains/suggest?name=Orbit            cheapest available names for a project
 *   GET  /api/domains/quota                         registrar quota status
 *
 * Signed in:
 *   POST /api/domains/quote            validate-only quote for a registration
 *   POST /api/domains/register         spend credits, register (confirm + idempotency_key)
 *   GET  /api/domains/status?id=|domain=   settle and read a registration
 *   GET  /api/domains/list             your registrations and connected hosts
 *   POST /api/domains/connect          serve an agent page on a registered domain
 *   GET  /api/domains/connect-status?domain=
 */

import { authenticateBearer, extractBearer, getSessionUser, assertBearerMaySpend } from '../_lib/auth.js';
import { sql } from '../_lib/db.js';
import { connectDomain, connectStatus, listHosts } from '../_lib/domain-connect.js';
import {
	DomainsError,
	domainCheck,
	domainPricing,
	domainSearch,
	listRegistrations,
	quoteRegistration,
	quotaStatus,
	registerWithCredits,
	registrationStatus,
	suggestForProject,
} from '../_lib/domains-service.js';
import { cors, error, json, method, rateLimited, readJson, respondError, wrap } from '../_lib/http.js';
import { clientIp, limits } from '../_lib/rate-limit.js';

async function resolveUser(req, res) {
	const session = await getSessionUser(req, res);
	if (session) return { user: session, bearer: null };
	const bearer = await authenticateBearer(extractBearer(req));
	if (bearer) {
		const [u] = await sql`select id, wallet_address from users where id = ${bearer.userId} and deleted_at is null limit 1`;
		return { user: u || null, bearer };
	}
	return { user: null, bearer: null };
}

function fail(res, err) {
	if (err instanceof DomainsError || (err?.status && err?.code)) {
		return respondError(res, err.status || 500, err.code || 'domains_error', err, err.detail ? { detail: err.detail } : {});
	}
	throw err;
}

export default wrap(async (req, res) => {
	if (cors(req, res, { methods: 'GET,POST,OPTIONS', credentials: true })) return;
	if (!method(req, res, ['GET', 'POST'])) return;

	const url = new URL(req.url, 'http://x');
	const action = url.searchParams.get('action') || url.pathname.split('/').filter(Boolean)[2];
	const q = url.searchParams;

	const publicReads = new Set(['search', 'check', 'pricing', 'suggest', 'quota']);
	try {
		if (publicReads.has(action)) {
			if (req.method !== 'GET') return error(res, 405, 'method_not_allowed', 'use GET');
			if (action === 'pricing') {
				return json(res, 200, domainPricing({ tld: q.get('tld') || undefined, maxPriceUsd: q.get('max_price_usd') ?? undefined, limit: Number(q.get('limit')) || 200 }), { 'cache-control': 'public, max-age=300' });
			}
			if (action === 'quota') return json(res, 200, await quotaStatus());
			const rl = await limits.domainsLookup(clientIp(req));
			if (!rl.success) return rateLimited(res, rl, 'Domain lookups are limited per hour.');
			if (action === 'check') return json(res, 200, await domainCheck(q.get('domain')));
			if (action === 'suggest') return json(res, 200, await suggestForProject(q.get('name')));
			const tlds = (q.get('tlds') || '').split(',').map((s) => s.trim()).filter(Boolean);
			return json(res, 200, await domainSearch(q.get('q'), { tlds, limit: Number(q.get('limit')) || 20 }));
		}

		const { user, bearer } = await resolveUser(req, res);
		if (!user) return error(res, 401, 'unauthorized', 'Sign in to register or connect a domain.');

		if (action === 'status') return json(res, 200, await registrationStatus({ userId: user.id, id: q.get('id') || undefined, domain: q.get('domain') || undefined }));
		if (action === 'list') {
			const [registrations, hosts] = await Promise.all([listRegistrations(user.id), listHosts(user.id)]);
			return json(res, 200, { registrations, hosts });
		}
		if (action === 'connect-status') return json(res, 200, await connectStatus({ userId: user.id, domain: q.get('domain') }));

		if (req.method !== 'POST') return error(res, 405, 'method_not_allowed', 'use POST');
		const body = (await readJson(req).catch(() => null)) || {};

		if (action === 'quote') {
			const rl = await limits.domainsLookup(String(user.id));
			if (!rl.success) return rateLimited(res, rl, 'Domain lookups are limited per hour.');
			return json(res, 200, await quoteRegistration({ userId: user.id, domain: body.domain, contact: body.contact, autoRenew: body.auto_renew, privacy: body.privacy }));
		}
		if (action === 'register') {
			assertBearerMaySpend(bearer, req);
			const rl = await limits.domainsRegister(String(user.id));
			if (!rl.success) return rateLimited(res, rl, 'Too many registration attempts this hour.');
			const out = await registerWithCredits({
				userId: user.id,
				domain: body.domain,
				contact: body.contact,
				autoRenew: body.auto_renew,
				privacy: body.privacy,
				expectedPriceUsd: body.expected_price_usd,
				confirm: body.confirm,
				idempotencyKey: body.idempotency_key,
				agentId: body.agent_id || null,
				source: body.source === 'coin' ? 'coin' : 'api',
			});
			return json(res, out.replayed ? 200 : 202, out);
		}
		if (action === 'connect') {
			return json(res, 200, await connectDomain({ userId: user.id, agentId: body.agent_id, domain: body.domain }));
		}
		return error(res, 404, 'not_found', `Unknown domains action "${action}".`);
	} catch (err) {
		return fail(res, err);
	}
});
