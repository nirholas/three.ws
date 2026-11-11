// SCIM 2.0 service provider for team provisioning (RFC 7643 / RFC 7644).
//
//   https://three.ws/scim/v2/ServiceProviderConfig
//   https://three.ws/scim/v2/ResourceTypes[/User|/Group]
//   https://three.ws/scim/v2/Schemas[/<urn>]
//   https://three.ws/scim/v2/Users           GET (filter, paging) | POST
//   https://three.ws/scim/v2/Users/:id       GET | PUT | PATCH | DELETE
//   https://three.ws/scim/v2/Groups          GET (filter, paging) | POST
//   https://three.ws/scim/v2/Groups/:id      GET | PUT | PATCH | DELETE
//
// Routed by the /scim/v2 row in vercel.json; the server keeps the original
// pathname on req.url, so the resource path is read from it.
//
// Authorization: `Bearer tws_scim_...`, the per-team token the owner generates
// in the team settings. The token IS the tenant boundary: every query below is
// scoped to the team it names, and the team must still hold its Microsoft
// tenant claim. The discovery documents are public (RFC 7644 4 allows it, and
// Entra reads them before it has a token configured).
//
// Every write is recorded in team_enterprise_events (actor 'scim'), and the
// whole surface is rate limited per team, with a strict per-IP bucket for
// failed bearer checks.

import { wrap, readBody, json, rateLimited } from '../_lib/http.js';
import { limits, clientIp } from '../_lib/rate-limit.js';
import { env } from '../_lib/env.js';
import {
	ScimError, CONTENT_TYPE, errorBody, parseFilter, parsePaging, listResponse, excludes,
	userStateFromResource, renderUser, readPatchOps, renderGroup, groupStateFromResource,
	serviceProviderConfig, resourceTypes, schemas,
} from '../_lib/scim.js';
import {
	authenticateScimToken, scimCreateUser, scimGetUser, scimListUsers, scimReplaceUser, scimPatchUser,
	scimDeleteUser, scimCreateGroup, scimGetGroup, scimListGroups, scimReplaceGroup, scimPatchGroup,
	scimDeleteGroup, scimGroupMembers,
} from '../_lib/team-enterprise.js';

const BODY_LIMIT = 1_000_000;

function baseUrl() {
	return `${env.APP_ORIGIN}/scim/v2`;
}

function docsUrl() {
	return `${env.APP_ORIGIN}/docs/enterprise-sso`;
}

function send(res, status, body, extra = {}) {
	return json(res, status, body, { 'content-type': `${CONTENT_TYPE}; charset=utf-8`, 'cache-control': 'no-store', ...extra });
}

function fail(res, status, detail, scimType = null, extra = {}) {
	return send(res, status, errorBody(status, detail, scimType), extra);
}

/** The resource path after /scim/v2, as segments. */
export function scimSegments(pathname) {
	const m = pathname.match(/^\/(?:api\/)?scim\/v2(?:\/(.*))?$/i);
	if (!m || !m[1]) return [];
	return m[1].split('/').filter(Boolean).map((s) => decodeURIComponent(s));
}

async function readScimJson(req) {
	const ct = String(req.headers['content-type'] || '').toLowerCase();
	if (ct && !ct.includes('application/scim+json') && !ct.includes('application/json')) {
		throw new ScimError(415, 'send application/scim+json', 'invalidSyntax');
	}
	// express.json parsed an application/json body already; scim+json is left
	// on the stream (server/index.mjs) and readBody drains it.
	if (req.body && typeof req.body === 'object' && !Buffer.isBuffer(req.body)) return req.body;
	const buf = await readBody(req, BODY_LIMIT);
	if (!buf.length) throw new ScimError(400, 'the request body is empty', 'invalidSyntax');
	try {
		return JSON.parse(buf.toString('utf8'));
	} catch {
		throw new ScimError(400, 'the request body is not valid JSON', 'invalidSyntax');
	}
}

function discovery(res, segments) {
	const base = baseUrl();
	const [kind, id] = segments;
	if (kind === 'ServiceProviderConfig') return send(res, 200, serviceProviderConfig({ baseUrl: base, docsUrl: docsUrl() }));
	if (kind === 'ResourceTypes') {
		const all = resourceTypes({ baseUrl: base });
		if (!id) return send(res, 200, listResponse(all, { totalResults: all.length, startIndex: 1 }));
		const one = all.find((r) => r.id === id);
		return one ? send(res, 200, one) : fail(res, 404, `ResourceType ${id} not found`);
	}
	const all = schemas({ baseUrl: base });
	if (!id) return send(res, 200, listResponse(all, { totalResults: all.length, startIndex: 1 }));
	const one = all.find((s) => s.id === id);
	return one ? send(res, 200, one) : fail(res, 404, `Schema ${id} not found`);
}

async function users(req, res, ctx, id, url) {
	const base = baseUrl();
	if (!id) {
		if (req.method === 'GET') {
			const filters = parseFilter(url.searchParams.get('filter'), 'user');
			const paging = parsePaging(url.searchParams);
			const { rows, total } = await scimListUsers(ctx, filters, paging);
			return send(res, 200, listResponse(rows.map((r) => renderUser(r, { baseUrl: base })), { totalResults: total, startIndex: paging.startIndex }));
		}
		if (req.method === 'POST') {
			const row = await scimCreateUser(ctx, userStateFromResource(await readScimJson(req)));
			const out = renderUser(row, { baseUrl: base });
			return send(res, 201, out, { location: out.meta.location });
		}
		return fail(res, 405, 'use GET or POST on /Users', null, { allow: 'GET, POST' });
	}
	if (req.method === 'GET') return send(res, 200, renderUser(await scimGetUser(ctx, id), { baseUrl: base }));
	if (req.method === 'PUT') return send(res, 200, renderUser(await scimReplaceUser(ctx, id, userStateFromResource(await readScimJson(req))), { baseUrl: base }));
	if (req.method === 'PATCH') return send(res, 200, renderUser(await scimPatchUser(ctx, id, readPatchOps(await readScimJson(req))), { baseUrl: base }));
	if (req.method === 'DELETE') {
		await scimDeleteUser(ctx, id);
		res.statusCode = 204;
		return res.end();
	}
	return fail(res, 405, 'use GET, PUT, PATCH or DELETE on /Users/:id', null, { allow: 'GET, PUT, PATCH, DELETE' });
}

async function renderGroups(rows, { withMembers }) {
	const members = withMembers ? await scimGroupMembers(rows.map((r) => r.id)) : new Map();
	return rows.map((r) => renderGroup(r, members.get(r.id) || [], { baseUrl: baseUrl(), withMembers }));
}

async function groups(req, res, ctx, id, url) {
	const withMembers = !excludes(url.searchParams, 'members');
	if (!id) {
		if (req.method === 'GET') {
			const filters = parseFilter(url.searchParams.get('filter'), 'group');
			const paging = parsePaging(url.searchParams);
			const { rows, total } = await scimListGroups(ctx, filters, paging);
			return send(res, 200, listResponse(await renderGroups(rows, { withMembers }), { totalResults: total, startIndex: paging.startIndex }));
		}
		if (req.method === 'POST') {
			const row = await scimCreateGroup(ctx, groupStateFromResource(await readScimJson(req)));
			const [out] = await renderGroups([row], { withMembers: true });
			return send(res, 201, out, { location: out.meta.location });
		}
		return fail(res, 405, 'use GET or POST on /Groups', null, { allow: 'GET, POST' });
	}
	if (req.method === 'GET') {
		const [out] = await renderGroups([await scimGetGroup(ctx, id)], { withMembers });
		return send(res, 200, out);
	}
	if (req.method === 'PUT') {
		const [out] = await renderGroups([await scimReplaceGroup(ctx, id, groupStateFromResource(await readScimJson(req)))], { withMembers: true });
		return send(res, 200, out);
	}
	if (req.method === 'PATCH') {
		const [out] = await renderGroups([await scimPatchGroup(ctx, id, readPatchOps(await readScimJson(req)))], { withMembers });
		return send(res, 200, out);
	}
	if (req.method === 'DELETE') {
		await scimDeleteGroup(ctx, id);
		res.statusCode = 204;
		return res.end();
	}
	return fail(res, 405, 'use GET, PUT, PATCH or DELETE on /Groups/:id', null, { allow: 'GET, PUT, PATCH, DELETE' });
}

export default wrap(async (req, res) => {
	const url = new URL(req.url, 'http://x');
	const segments = scimSegments(url.pathname);
	const [resource, id, extra] = segments;

	try {
		if (extra !== undefined) throw new ScimError(404, 'no such SCIM resource');
		if (['ServiceProviderConfig', 'ResourceTypes', 'Schemas'].includes(resource)) {
			if (req.method !== 'GET') return fail(res, 405, 'discovery endpoints are read-only', null, { allow: 'GET' });
			if (resource === 'ServiceProviderConfig' && id) throw new ScimError(404, 'no such SCIM resource');
			return discovery(res, segments);
		}
		if (resource !== 'Users' && resource !== 'Groups') throw new ScimError(404, 'no such SCIM resource');

		const header = String(req.headers.authorization || '');
		const m = header.match(/^Bearer\s+(\S+)$/i);
		const ctx = m ? await authenticateScimToken(m[1]) : null;
		if (!ctx) {
			const rl = await limits.scimAuthFail(clientIp(req));
			if (!rl.success) return rateLimited(res, rl, 'too many failed SCIM authentications');
			return fail(res, 401, 'a valid team SCIM bearer token is required', null, { 'www-authenticate': 'Bearer realm="three.ws SCIM"' });
		}
		const rl = await limits.scimTeam(ctx.teamId);
		if (!rl.success) {
			res.setHeader('retry-after', String(Math.max(1, Math.ceil(((rl.reset || Date.now() + 60_000) - Date.now()) / 1000))));
			return fail(res, 429, 'too many SCIM requests for this team; retry after the Retry-After interval', 'tooMany');
		}
		if (resource === 'Users') return await users(req, res, ctx, id, url);
		return await groups(req, res, ctx, id, url);
	} catch (err) {
		if (err instanceof ScimError) return fail(res, err.status, err.message, err.scimType);
		if (err?.status === 413) return fail(res, 413, 'the request body is too large', 'tooLarge');
		throw err;
	}
});
