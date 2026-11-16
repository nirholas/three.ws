// The usage feed: read-only OData v4 access to a person's or a team's usage for
// Power BI, Excel and any OData client. This module owns the feed keys (create,
// list, revoke, authenticate) and runs an OData query against an entity set.
//
// Feed keys live in usage_feed_keys (migration 20261116150000), not api_keys:
// a key pasted into a Power BI dataset authenticates this feed and nothing
// else. Clients send it as the password of HTTP Basic auth, the auth kind
// Power BI Service refreshes on a schedule without a gateway.
//
// Scope: a key with no team reads its creator's own rows. A team key reads the
// team owner's rows plus every active person of the team (team_people), and
// only while its creator still owns the team; that binding is re-checked on
// every request, so handing a team over or archiving it ends the key at once.

import { sql } from './db.js';
import { randomToken, sha256 } from './crypto.js';
import { logAudit } from './audit.js';
import { Params, compileFilter, col, pageWindow } from './odata/query.js';

export const FEED_KEY_PREFIX = 'tws_feed_';
export const MAX_ACTIVE_KEYS = 10;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export class FeedKeyError extends Error {
	constructor(status, code, message) {
		super(message);
		this.status = status;
		this.code = code;
	}
}

// ── keys ─────────────────────────────────────────────────────────────────────

/** Teams the user owns and may bind a feed key to. */
export async function listOwnedTeams(userId) {
	return sql`
		select id, name from teams
		where owner_user_id = ${userId} and archived_at is null
		order by created_at desc
	`;
}

/** The user's active feed keys, newest first. */
export async function listFeedKeys(userId) {
	return sql`
		select k.id, k.name, k.prefix, k.team_id, t.name as team_name, k.created_at, k.last_used_at
		from usage_feed_keys k left join teams t on t.id = k.team_id
		where k.user_id = ${userId} and k.revoked_at is null
		order by k.created_at desc
	`;
}

/**
 * Create a feed key. Returns the stored row plus the plaintext token, which is
 * shown once and never stored.
 */
export async function createFeedKey({ userId, name, teamId = null, req = null }) {
	const label = typeof name === 'string' ? name.trim() : '';
	if (!label) throw new FeedKeyError(400, 'validation_error', 'give the key a name, for example "Finance Power BI"');
	if (label.length > 80) throw new FeedKeyError(400, 'validation_error', 'the key name is longer than 80 characters');
	let team = null;
	if (teamId != null && teamId !== '') {
		if (!UUID.test(String(teamId))) throw new FeedKeyError(400, 'validation_error', 'team_id is not a valid id');
		[team] = await sql`select id, name, owner_user_id, archived_at from teams where id = ${teamId} limit 1`;
		if (!team || team.archived_at) throw new FeedKeyError(404, 'not_found', 'team not found');
		if (team.owner_user_id !== userId) throw new FeedKeyError(403, 'forbidden', 'only the team owner can create a team usage feed key');
	}
	const [{ n }] = await sql`select count(*)::int as n from usage_feed_keys where user_id = ${userId} and revoked_at is null`;
	if (n >= MAX_ACTIVE_KEYS) {
		throw new FeedKeyError(409, 'limit_reached', `you already have ${MAX_ACTIVE_KEYS} active feed keys; revoke one you no longer use first`);
	}
	const token = `${FEED_KEY_PREFIX}${randomToken(32)}`;
	const tokenHash = await sha256(token);
	const prefix = token.slice(0, FEED_KEY_PREFIX.length + 6);
	const [row] = await sql`
		insert into usage_feed_keys (user_id, team_id, name, prefix, token_hash)
		values (${userId}, ${team ? team.id : null}, ${label}, ${prefix}, ${tokenHash})
		returning id, name, prefix, team_id, created_at, last_used_at
	`;
	logAudit({ userId, action: 'usage_feed.key_created', resourceId: row.id, meta: { team_id: row.team_id, name: label }, req });
	return { key: { ...row, team_name: team ? team.name : null }, token };
}

/** Revoke one of the user's feed keys. */
export async function revokeFeedKey({ userId, id, req = null }) {
	if (!UUID.test(String(id || ''))) throw new FeedKeyError(400, 'validation_error', 'id is not a valid key id');
	const [row] = await sql`
		update usage_feed_keys set revoked_at = now()
		where id = ${id} and user_id = ${userId} and revoked_at is null
		returning id, team_id
	`;
	if (!row) throw new FeedKeyError(404, 'not_found', 'feed key not found or already revoked');
	logAudit({ userId, action: 'usage_feed.key_revoked', resourceId: row.id, meta: { team_id: row.team_id }, req });
	return row;
}

/**
 * Resolve a presented token to its scope, or null. A team key resolves only
 * while its creator still owns the (unarchived) team.
 * @returns {Promise<{ keyId: string, userId: string, teamId: string|null, teamName: string|null }|null>}
 */
export async function authenticateFeedKey(token) {
	if (typeof token !== 'string' || !token.startsWith(FEED_KEY_PREFIX) || token.length > 200) return null;
	const hash = await sha256(token);
	const [row] = await sql`
		select k.id, k.user_id, k.team_id, t.name as team_name
		from usage_feed_keys k
		join users u on u.id = k.user_id and u.deleted_at is null
		left join teams t on t.id = k.team_id
		where k.token_hash = ${hash} and k.revoked_at is null
		  and (k.team_id is null or (t.owner_user_id = k.user_id and t.archived_at is null))
		limit 1
	`;
	if (!row) return null;
	return { keyId: row.id, userId: row.user_id, teamId: row.team_id || null, teamName: row.team_name || null };
}

/**
 * Record key use: last_used_at plus one audit row per key per hour. A Power BI
 * refresh pages through hundreds of requests; one audit line per request would
 * bury the trail, one per hour still shows every refresh window.
 */
export async function recordFeedKeyUse(key, req = null) {
	const rows = await sql`
		update usage_feed_keys set last_used_at = now()
		where id = ${key.keyId} and (last_used_at is null or last_used_at < now() - interval '1 hour')
		returning id
	`;
	if (rows.length) {
		logAudit({ userId: key.userId, action: 'usage_feed.key_used', resourceId: key.keyId, meta: { team_id: key.teamId }, req });
	}
	return rows.length > 0;
}

/**
 * Pull the feed key out of an Authorization header. Basic auth carries it as
 * the password (any username); a key pasted into the username field is
 * accepted too. Bearer works for scripts.
 * @returns {string|null}
 */
export function feedKeyFromAuthorization(header) {
	const h = String(header || '');
	const basic = h.match(/^Basic\s+([A-Za-z0-9+/=_-]+)\s*$/i);
	if (basic) {
		let decoded;
		try {
			decoded = Buffer.from(basic[1], 'base64').toString('utf8');
		} catch {
			return null;
		}
		const i = decoded.indexOf(':');
		const user = i === -1 ? decoded : decoded.slice(0, i);
		const pass = i === -1 ? '' : decoded.slice(i + 1);
		if (pass.startsWith(FEED_KEY_PREFIX)) return pass.trim();
		if (user.startsWith(FEED_KEY_PREFIX)) return user.trim();
		return pass || null;
	}
	const bearer = h.match(/^Bearer\s+(\S+)\s*$/i);
	return bearer ? bearer[1] : null;
}

// ── queries ──────────────────────────────────────────────────────────────────

function outputColumn(name, type) {
	switch (type) {
		case 'Edm.Date': return `to_char(${col(name)}, 'YYYY-MM-DD') as "${name}"`;
		case 'Edm.DateTimeOffset': return `to_char(${col(name)} at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') as "${name}"`;
		case 'Edm.Int64': case 'Edm.Decimal': return `${col(name)}::text as "${name}"`;
		default: return `${col(name)} as "${name}"`;
	}
}

function toJsonValue(v, type) {
	if (v == null) return null;
	switch (type) {
		case 'Edm.Int64': case 'Edm.Int32': case 'Edm.Decimal': case 'Edm.Double': return Number(v);
		default: return v;
	}
}

function whereAndBase(set, scope, filter) {
	const p = new Params();
	const base = set.base(scope, p);
	const where = filter ? compileFilter(filter, p) : 'true';
	return { p, base, where };
}

/**
 * Count the rows of an entity set matching a filter (ignores paging).
 * @returns {Promise<number>}
 */
export async function countEntitySet(set, scope, filter) {
	const { p, base, where } = whereAndBase(set, scope, filter);
	const [row] = await sql(`select count(*)::bigint as n from (${base}) e where ${where}`, p.values);
	return Number(row?.n || 0);
}

/**
 * Read one page of an entity set.
 * @param {object} set entity set from usage-model.js
 * @param {object} scope { userId, teamId?, teamName? }
 * @param {object} options parsed query options (query.js parseQueryOptions)
 * @param {number} pageSize server page size
 * @returns {Promise<{ rows: object[], nextSkipToken: number|null, count: number|null }>}
 */
export async function queryEntitySet(set, scope, options, pageSize) {
	const names = options.select || Object.keys(set.props);
	const { offset, limit } = pageWindow(options, pageSize);
	const countPromise = options.count ? countEntitySet(set, scope, options.filter) : Promise.resolve(null);
	let rows = [];
	let more = false;
	if (limit > 0) {
		const { p, base, where } = whereAndBase(set, scope, options.filter);
		const order = options.orderBy.map((o) => `${col(o.name)} ${o.dir} nulls ${o.dir === 'asc' ? 'first' : 'last'}`);
		if (!options.orderBy.some((o) => o.name === 'Id')) order.push(`${col('Id')} asc`);
		const select = names.map((n) => outputColumn(n, set.props[n].type)).join(', ');
		const lim = p.add(limit + 1, 'int');
		const off = p.add(offset, 'int');
		const raw = await sql(`select ${select} from (${base}) e where ${where} order by ${order.join(', ')} limit ${lim} offset ${off}`, p.values);
		// Stop at $top: a page that reaches it carries no nextLink, even when
		// more rows exist beyond it.
		more = raw.length > limit && (options.top == null || options.skipToken + limit < options.top);
		rows = raw.slice(0, limit).map((r) => {
			const out = {};
			for (const n of names) out[n] = toJsonValue(r[n], set.props[n].type);
			return out;
		});
	}
	const count = await countPromise;
	return { rows, nextSkipToken: more ? options.skipToken + limit : null, count };
}
