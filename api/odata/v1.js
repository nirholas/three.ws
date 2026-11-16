// OData v4 usage feed for Power BI, Excel and any OData client.
//
//   GET /api/odata/v1/                         service document
//   GET /api/odata/v1/$metadata                CSDL XML
//   GET /api/odata/v1/<EntitySet>              rows: $select $filter $orderby $top $skip $count
//   GET /api/odata/v1/<EntitySet>/$count       plain-text row count (honours $filter)
//   GET /api/odata/v1/<EntitySet>('<Id>')      one row by key
//
// Routed by the /api/odata/v1 row in vercel.json; the server keeps the original
// pathname on req.url, so the resource path is read from it.
//
// Authorization: HTTP Basic with a usage feed key (tws_feed_...) as the
// password; the username is ignored. Basic is an auth kind Power BI Service
// refreshes on a schedule without a gateway. Bearer with the same key works for
// scripts. Keys are minted in Dashboard, Settings, "Connect to Power BI or
// Excel" (api/usage/feed-keys.js) and are read-only by construction.
//
// Paging is server-driven: at most 1000 rows per response (lower with
// Prefer: odata.maxpagesize=N) and an @odata.nextLink while more remain.

import { wrap, setRateLimitHeaders } from '../_lib/http.js';
import { limits, clientIp } from '../_lib/rate-limit.js';
import { env } from '../_lib/env.js';
import { ODataError, parseQueryOptions, preferredPageSize, MAX_PAGE_SIZE } from '../_lib/odata/query.js';
import { metadataXml, serviceDocument } from '../_lib/odata/csdl.js';
import { entitySet } from '../_lib/odata/usage-model.js';
import {
	authenticateFeedKey, feedKeyFromAuthorization, recordFeedKeyUse, queryEntitySet, countEntitySet,
} from '../_lib/usage-feed.js';

const JSON_TYPE = 'application/json;odata.metadata=minimal;odata.streaming=true;IEEE754Compatible=false;charset=utf-8';
const CHALLENGE = 'Basic realm="three.ws usage feed", charset="UTF-8"';

export function feedBase() {
	return `${env.APP_ORIGIN}/api/odata/v1/`;
}

const KEY_SEGMENT = /^([A-Za-z_][A-Za-z0-9_]*)\('((?:[^']|'')*)'\)$/;

function decode(s) {
	try {
		return decodeURIComponent(s);
	} catch {
		return s;
	}
}

/**
 * The resource path after /api/odata/v1, as decoded segments. A key predicate
 * stays one segment even when its key holds a slash: Ids carry model names
 * such as @cf/meta/llama-3.3-70b, and OData clients (Power Query included)
 * send that slash unencoded.
 */
export function odataSegments(pathname) {
	const m = String(pathname || '').match(/^\/api\/odata\/v1(?:\/(.*))?$/i);
	if (!m || !m[1]) return [];
	const whole = decode(m[1]).replace(/\/$/, '');
	if (KEY_SEGMENT.test(whole)) return [whole];
	return m[1].split('/').filter(Boolean).map(decode);
}

function baseHeaders(extra = {}) {
	return { 'OData-Version': '4.0', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', ...extra };
}

function send(res, status, body, contentType = JSON_TYPE, extra = {}) {
	const payload = typeof body === 'string' ? body : JSON.stringify(body);
	res.statusCode = status;
	for (const [k, v] of Object.entries(baseHeaders({ 'Content-Type': contentType, ...extra }))) res.setHeader(k, v);
	res.end(payload);
}

function fail(res, status, code, message, extra = {}) {
	return send(res, status, { error: { code, message } }, JSON_TYPE, extra);
}

function nextLink(url, skipToken) {
	const next = new URL(feedBase() + url.pathname.replace(/^\/api\/odata\/v1\/?/i, ''));
	for (const [k, v] of url.searchParams) if (k.toLowerCase() !== '$skiptoken') next.searchParams.append(k, v);
	next.searchParams.set('$skiptoken', String(skipToken));
	// URLSearchParams encodes '$' as %24; OData clients accept both, but the
	// literal form keeps links readable in Power Query diagnostics.
	return next.toString().replace(/%24/g, '$');
}

async function authenticate(req, res) {
	const token = feedKeyFromAuthorization(req.headers.authorization);
	if (!token) {
		fail(res, 401, 'Unauthorized', 'sign in with Basic authentication: any username, and a usage feed key from three.ws Dashboard, Settings, "Connect to Power BI or Excel" as the password', { 'WWW-Authenticate': CHALLENGE });
		return null;
	}
	const key = await authenticateFeedKey(token);
	if (!key) {
		const rl = await limits.usageFeedAuthFail(clientIp(req));
		if (!rl.success) {
			setRateLimitHeaders(res, rl);
			fail(res, 429, 'TooManyRequests', 'too many failed sign-ins from this address; wait a few minutes');
			return null;
		}
		fail(res, 401, 'Unauthorized', 'this usage feed key is not valid: it may be revoked, mistyped, or its team changed owner. Create a new key in three.ws Settings.', { 'WWW-Authenticate': CHALLENGE });
		return null;
	}
	const rl = await limits.usageFeedKey(key.keyId);
	if (!rl.success) {
		setRateLimitHeaders(res, rl);
		fail(res, 429, 'TooManyRequests', 'this feed key is over its request budget (600 per minute); wait and refresh again');
		return null;
	}
	await recordFeedKeyUse(key, req);
	return key;
}

async function readCollection(req, res, url, set, scope, keyFilter) {
	const options = parseQueryOptions(url.searchParams, set.props);
	if (keyFilter) options.filter = options.filter ? { type: 'and', left: keyFilter, right: options.filter, edm: 'Edm.Boolean' } : keyFilter;
	const requested = preferredPageSize(req.headers.prefer);
	const pageSize = requested || MAX_PAGE_SIZE;
	const { rows, nextSkipToken, count } = await queryEntitySet(set, scope, options, pageSize);
	const selectSuffix = options.select ? `(${options.select.join(',')})` : '';
	if (keyFilter) {
		if (!rows.length) return fail(res, 404, 'NotFound', `no ${set.name} row with that key`);
		return send(res, 200, { '@odata.context': `${feedBase()}$metadata#${set.name}${selectSuffix}/$entity`, ...rows[0] });
	}
	const body = { '@odata.context': `${feedBase()}$metadata#${set.name}${selectSuffix}` };
	if (count != null) body['@odata.count'] = count;
	body.value = rows;
	if (nextSkipToken != null) body['@odata.nextLink'] = nextLink(url, nextSkipToken);
	return send(res, 200, body, JSON_TYPE, requested ? { 'Preference-Applied': `odata.maxpagesize=${requested}` } : {});
}

export default wrap(async (req, res) => {
	if (req.method !== 'GET' && req.method !== 'HEAD') {
		return fail(res, 405, 'MethodNotAllowed', 'the usage feed is read-only: use GET', { Allow: 'GET, HEAD' });
	}
	const url = new URL(req.url, 'http://feed.local');
	const segments = odataSegments(url.pathname);

	const key = await authenticate(req, res);
	if (!key) return;
	const scope = { userId: key.userId, teamId: key.teamId, teamName: key.teamName };

	try {
		if (segments.length === 0) return send(res, 200, serviceDocument(feedBase()));
		if (segments.length === 1 && segments[0] === '$metadata') {
			return send(res, 200, metadataXml(), 'application/xml;charset=utf-8');
		}
		const keyMatch = segments.length === 1 ? segments[0].match(KEY_SEGMENT) : null;
		const set = entitySet(keyMatch ? keyMatch[1] : segments[0]);
		if (!set) {
			return fail(res, 404, 'NotFound', `no resource '${segments.join('/')}'. Entity sets: UsageDaily, McpToolCalls, LlmUsage, Generations, Billing`);
		}
		if (keyMatch) {
			const keyFilter = { type: 'cmp', op: 'eq', left: { type: 'prop', name: 'Id', edm: 'Edm.String' }, right: { type: 'lit', edm: 'Edm.String', value: keyMatch[2].replace(/''/g, "'") }, edm: 'Edm.Boolean' };
			return await readCollection(req, res, url, set, scope, keyFilter);
		}
		if (segments.length === 2 && segments[1] === '$count') {
			const options = parseQueryOptions(url.searchParams, set.props);
			const n = await countEntitySet(set, scope, options.filter);
			return send(res, 200, String(n), 'text/plain;charset=utf-8');
		}
		if (segments.length === 1) return await readCollection(req, res, url, set, scope, null);
		return fail(res, 404, 'NotFound', `no resource '${segments.join('/')}'`);
	} catch (err) {
		if (err instanceof ODataError) return fail(res, err.status, err.code, err.message);
		throw err;
	}
});
