// Microsoft 365 Copilot connector: index an account's three.ws agents, Forge
// models and avatars into the account's Microsoft 365 tenant through the
// Microsoft Graph connectors API, so Microsoft Search and Microsoft 365 Copilot
// answer with three.ws results under the tenant's own permissions.
//
// One account maps to one Graph externalConnection in one tenant. A tenant
// admin grants admin consent to the multitenant three.ws Entra app (the same
// app the Marketplace landing page signs buyers in with), three.ws stores the
// tenant id, creates the connection, registers the schema, and a cron keeps the
// items in step. Docs: docs/microsoft-365-copilot-connector.md.
//
// The module splits into a pure half (schema, ACL, item payloads, sync
// planning, throttling arithmetic: all unit-tested in
// tests/m365-connector.test.js) and an IO half (Entra token, Graph calls, the
// database). Graph calls take an injectable fetch and sleep so the backoff is
// tested against real response shapes without a network.
//
// Env (shared with api/_lib/microsoft-marketplace.js):
//   MS_ENTRA_SSO_CLIENT_ID      multitenant app id; needs the application
//                               permissions ExternalConnection.ReadWrite.OwnedBy
//                               and ExternalItem.ReadWrite.OwnedBy
//   MS_ENTRA_SSO_CLIENT_SECRET  that app's client secret

import { createHash } from 'node:crypto';
import { sql } from './db.js';
import { env } from './env.js';
import { thumbnailUrl } from './r2.js';

export const GRAPH_BASE = 'https://graph.microsoft.com/v1.0';
export const LOGIN_BASE = 'https://login.microsoftonline.com';
export const GRAPH_SCOPE = 'https://graph.microsoft.com/.default';
export const REQUIRED_PERMISSIONS = Object.freeze(['ExternalConnection.ReadWrite.OwnedBy', 'ExternalItem.ReadWrite.OwnedBy']);
export const SCHEMA_VERSION = 1;
export const AUDIENCES = Object.freeze(['organization', 'group', 'owner']);
export const ITEM_KINDS = Object.freeze(['agent', 'model', 'avatar']);

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const GUID_RE = UUID_RE;

export class ConnectorError extends Error {
	constructor(code, message, status = 400, extra = {}) {
		super(message);
		this.code = code;
		this.status = status;
		Object.assign(this, extra);
	}
}

/** A non-2xx Graph or Entra answer, with Microsoft's own error code kept. */
export class GraphError extends Error {
	constructor(status, code, message, { retryAfterMs = null } = {}) {
		super(message);
		this.status = status;
		this.code = code;
		this.retryAfterMs = retryAfterMs;
	}
}

// ── Configuration ───────────────────────────────────────────────────────────

function envValue(name) {
	const v = process.env[name];
	return typeof v === 'string' && v.trim() ? v.trim() : null;
}

/** The multitenant app credentials, or null when this deployment has none. */
export function connectorAppConfig() {
	const clientId = envValue('MS_ENTRA_SSO_CLIENT_ID');
	const clientSecret = envValue('MS_ENTRA_SSO_CLIENT_SECRET');
	if (!clientId || !clientSecret) return null;
	return { clientId, clientSecret };
}

export function missingConnectorConfig() {
	return ['MS_ENTRA_SSO_CLIENT_ID', 'MS_ENTRA_SSO_CLIENT_SECRET'].filter((n) => !envValue(n));
}

export function consentRedirectUri(origin = env.APP_ORIGIN) {
	return `${origin}/api/microsoft-365/connect/callback`;
}

/** The admin consent URL a tenant admin is sent to. */
export function adminConsentUrl({ clientId, state, origin = env.APP_ORIGIN }) {
	const u = new URL(`${LOGIN_BASE}/organizations/v2.0/adminconsent`);
	u.searchParams.set('client_id', clientId);
	u.searchParams.set('scope', GRAPH_SCOPE);
	u.searchParams.set('redirect_uri', consentRedirectUri(origin));
	u.searchParams.set('state', state);
	return u.toString();
}

/**
 * Read the admin consent redirect. Microsoft answers with `tenant`,
 * `admin_consent=True` and the `state` on success, or `error` and
 * `error_description` (plus `state`) on failure.
 */
export function parseConsentCallback(params) {
	const get = (k) => (typeof params.get === 'function' ? params.get(k) : params[k]) ?? null;
	const state = get('state');
	const err = get('error');
	if (err) {
		const desc = String(get('error_description') || '');
		const code = err === 'access_denied' ? 'consent_declined' : /AADSTS65004|AADSTS90094|admin/i.test(desc) ? 'admin_required' : 'consent_failed';
		return { ok: false, state, code, detail: desc.split(/\r?\n/)[0].slice(0, 300) };
	}
	const tenant = get('tenant');
	if (String(get('admin_consent')).toLowerCase() !== 'true' || !tenant || !GUID_RE.test(tenant)) {
		return { ok: false, state, code: 'consent_failed', detail: 'Microsoft did not confirm admin consent for a tenant' };
	}
	return { ok: true, state, tenantId: tenant.toLowerCase() };
}

// ── Connection id and schema (pure) ─────────────────────────────────────────

const RESERVED_CONNECTION_IDS = new Set(['none', 'directory', 'exchange', 'exchangearchive', 'linkedin', 'mailbox', 'onedrivebusiness', 'sharepoint', 'teams', 'yammer', 'connectors', 'taskfabric', 'powerbi', 'assistant', 'topicengine', 'msft_all_connectors']);

/** Graph's documented rule for an externalConnection id. */
export function isValidConnectionId(id) {
	if (typeof id !== 'string' || id.length < 3 || id.length > 32) return false;
	if (!/^[A-Za-z0-9]+$/.test(id)) return false;
	if (/^microsoft/i.test(id)) return false;
	return !RESERVED_CONNECTION_IDS.has(id.toLowerCase());
}

/**
 * Stable per-account connection id: `threews` plus the first 24 hex digits of
 * the account id. Two three.ws accounts connecting the same tenant get two
 * distinct connections; reconnecting the same account reuses its id.
 */
export function connectionIdFor(userId) {
	if (typeof userId !== 'string' || !UUID_RE.test(userId)) throw new ConnectorError('invalid_user', 'a connection needs an account id');
	const id = `threews${userId.replace(/-/g, '').slice(0, 24).toLowerCase()}`;
	if (!isValidConnectionId(id)) throw new ConnectorError('invalid_connection_id', `derived connection id ${id} breaks Graph's id rule`);
	return id;
}

const PROPERTY_TYPES = new Set(['string', 'int64', 'double', 'dateTime', 'boolean', 'stringCollection', 'int64Collection', 'doubleCollection', 'dateTimeCollection', 'principal', 'principalCollection']);
const LABELS = new Set(['title', 'url', 'createdBy', 'lastModifiedBy', 'authors', 'createdDateTime', 'lastModifiedDateTime', 'fileName', 'fileExtension', 'containerName', 'containerUrl', 'iconUrl', 'assignedTo', 'dueDate', 'closedDate', 'closedBy', 'reportedBy', 'sprintName', 'severity', 'state', 'priority', 'secondaryId', 'itemParentId', 'parentUrl', 'tags', 'itemType', 'itemPath', 'numReactions']);
const FORBIDDEN_NAME_CHARS = /[\s:;,()[\]{}%$+!*=&?@#\\~'"<>`^\p{Cc}]/u;

/** The schema three.ws registers on every connection. Item kinds share it and differ by `itemType`. */
export function buildSchema() {
	return {
		baseType: 'microsoft.graph.externalItem',
		properties: [
			{ name: 'title', type: 'string', isSearchable: true, isRetrievable: true, isQueryable: true, labels: ['title'], description: 'Name of the three.ws agent, 3D model or avatar' },
			{ name: 'description', type: 'string', isSearchable: true, isRetrievable: true, description: 'Short description of the item written by its creator' },
			{ name: 'itemType', type: 'string', isQueryable: true, isRetrievable: true, isRefinable: true, labels: ['itemType'], description: 'agent for an AI agent, model for a generated 3D model, avatar for a 3D avatar' },
			{ name: 'tags', type: 'stringCollection', isSearchable: true, isQueryable: true, isRetrievable: true, labels: ['tags'], description: 'Tags, skills and categories attached to the item' },
			{ name: 'url', type: 'string', isRetrievable: true, labels: ['url'] },
			{ name: 'iconUrl', type: 'string', isRetrievable: true, labels: ['iconUrl'] },
			{ name: 'createdBy', type: 'string', isSearchable: true, isQueryable: true, isRetrievable: true, labels: ['createdBy'], description: 'Display name of the three.ws account that made the item' },
			{ name: 'createdDateTime', type: 'dateTime', isQueryable: true, isRetrievable: true, isRefinable: true, labels: ['createdDateTime'] },
			{ name: 'lastModifiedDateTime', type: 'dateTime', isQueryable: true, isRetrievable: true, isRefinable: true, labels: ['lastModifiedDateTime'] },
			{ name: 'visibility', type: 'string', isQueryable: true, isRetrievable: true, isRefinable: true, description: 'public, unlisted or private on three.ws' },
		],
	};
}

/**
 * Check a schema against Microsoft's documented constraints. Returns a list of
 * problems (empty when valid), so a bad edit fails a unit test and never a
 * 5 to 15 minute schema operation in a customer tenant.
 */
export function validateSchema(schema) {
	const problems = [];
	if (schema?.baseType !== 'microsoft.graph.externalItem') problems.push('baseType must be microsoft.graph.externalItem');
	const props = Array.isArray(schema?.properties) ? schema.properties : [];
	if (props.length < 1 || props.length > 128) problems.push(`schema needs 1 to 128 properties, has ${props.length}`);
	const seen = new Set();
	const labelOwners = new Map();
	for (const p of props) {
		const name = p?.name;
		if (typeof name !== 'string' || !name || name.length > 32 || FORBIDDEN_NAME_CHARS.test(name)) problems.push(`property name ${JSON.stringify(name)} is not 1 to 32 alphanumeric characters`);
		const key = String(name).toLowerCase();
		if (seen.has(key)) problems.push(`property ${name} is declared twice`);
		seen.add(key);
		if (!PROPERTY_TYPES.has(p?.type)) problems.push(`property ${name} has unknown type ${p?.type}`);
		if (p?.isSearchable && !['string', 'stringCollection'].includes(p.type)) problems.push(`property ${name}: only string and stringCollection can be searchable`);
		if (p?.isSearchable && p?.isRefinable) problems.push(`property ${name}: a property cannot be both searchable and refinable`);
		if (p?.isRefinable && !p?.isQueryable) problems.push(`property ${name}: a refinable property must also be queryable`);
		if (p?.description != null && String(p.description).length > 200) problems.push(`property ${name}: description over 200 characters`);
		for (const a of p?.aliases || []) {
			if (typeof a !== 'string' || !a || a.length > 32 || FORBIDDEN_NAME_CHARS.test(a)) problems.push(`property ${name}: alias ${JSON.stringify(a)} is invalid`);
		}
		for (const l of p?.labels || []) {
			if (!LABELS.has(l)) problems.push(`property ${name}: unknown label ${l}`);
			if (labelOwners.has(l)) problems.push(`label ${l} is on both ${labelOwners.get(l)} and ${name}`);
			labelOwners.set(l, name);
		}
	}
	return problems;
}

/** The URL-to-item resolvers, so a pasted three.ws link resolves to its indexed item. */
export function activitySettings(origin = env.APP_ORIGIN) {
	const uuid = '[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}';
	const resolver = (path, kind, priority) => ({
		'@odata.type': '#microsoft.graph.externalConnectors.itemIdResolver',
		itemId: `${kind}-{id}`,
		priority,
		urlMatchInfo: { baseUrls: [origin], urlPattern: `/${path}/(?<id>${uuid})(?:[/?#].*)?$` },
	});
	return { urlToItemResolvers: [resolver('agent', 'agent', 1), resolver('m', 'model', 2), resolver('avatars', 'avatar', 3)] };
}

export function connectionPayload(userId, origin = env.APP_ORIGIN) {
	return {
		id: connectionIdFor(userId),
		name: 'three.ws agents and 3D models',
		description: 'AI agents, 3D models and avatars from a three.ws account, indexed for Microsoft Search and Microsoft 365 Copilot.',
		activitySettings: activitySettings(origin),
	};
}

// ── ACL (pure) ──────────────────────────────────────────────────────────────

/** The Entra object id of the account owner in this tenant, from a linked `<tid>:<oid>` identity subject. */
export function ownerObjectIdInTenant(subjects, tenantId) {
	for (const s of subjects || []) {
		const [tid, oid] = String(s).split(':');
		if (tid && oid && tid.toLowerCase() === String(tenantId).toLowerCase() && GUID_RE.test(oid)) return oid.toLowerCase();
	}
	return null;
}

/**
 * Who in the tenant may see the account's items.
 *
 *   organization  every member of the tenant except guests
 *   group         the Entra group the admin chose (members without a
 *                 Microsoft identity on three.ws are reached this way)
 *   owner         only the account owner, which needs their three.ws account
 *                 linked to a Microsoft identity in this same tenant
 *
 * The owner's own object id is always granted when it is known, so the person
 * who connected the account finds their content whatever the audience.
 */
export function buildAcl({ tenantId, audience, groupId = null, ownerObjectId = null }) {
	if (!GUID_RE.test(String(tenantId || ''))) throw new ConnectorError('invalid_tenant', 'the connection has no valid tenant id');
	const acl = [];
	if (audience === 'organization') acl.push({ type: 'everyoneExceptGuests', value: tenantId.toLowerCase(), accessType: 'grant' });
	else if (audience === 'group') {
		if (!GUID_RE.test(String(groupId || ''))) throw new ConnectorError('group_required', 'choose the Entra group (its object id) that may see these items');
		acl.push({ type: 'group', value: groupId.toLowerCase(), accessType: 'grant' });
	} else if (audience === 'owner') {
		if (!ownerObjectId) throw new ConnectorError('owner_identity_required', 'owner-only access needs this three.ws account linked to a Microsoft identity in the connected tenant');
	} else {
		throw new ConnectorError('invalid_audience', `audience must be one of ${AUDIENCES.join(', ')}`);
	}
	if (ownerObjectId && GUID_RE.test(ownerObjectId)) acl.push({ type: 'user', value: ownerObjectId.toLowerCase(), accessType: 'grant' });
	return acl;
}

// ── Items (pure) ────────────────────────────────────────────────────────────

const clip = (s, n) => {
	const t = String(s ?? '').replace(/\s+/g, ' ').trim();
	return t.length > n ? `${t.slice(0, n - 1).trimEnd()}…` : t;
};
const iso = (d) => (d ? new Date(d).toISOString() : null);
const isAscii = (s) => /^[\x00-\x7F]*$/.test(s);
const absolute = (u, origin) => (!u ? null : /^https?:\/\//i.test(u) ? u : u.startsWith('/') ? `${origin}${u}` : null);
const uniq = (arr) => [...new Set(arr.map((t) => String(t).trim()).filter(Boolean))].slice(0, 40);

export function itemIdFor(kind, id) {
	if (!ITEM_KINDS.includes(kind) || !UUID_RE.test(String(id))) throw new ConnectorError('invalid_item', `cannot index ${kind} ${id}`);
	return `${kind}-${String(id).toLowerCase()}`;
}

/**
 * Normalize one source row (from loadSourceItems) into the fields every kind
 * shares, plus the text body that makes Copilot answers useful.
 */
export function normalizeSource(row, { origin = env.APP_ORIGIN, ownerName = 'three.ws creator' } = {}) {
	const kind = row.kind;
	if (kind === 'agent') {
		const skills = Array.isArray(row.skills) ? row.skills : [];
		const tags = uniq([...(row.tags || []), ...skills, row.category].filter(Boolean));
		const body = [
			`three.ws AI agent: ${row.name}`,
			row.description && `About: ${row.description}`,
			row.greeting && `Greeting: ${clip(row.greeting, 400)}`,
			row.persona_prompt && `Persona: ${clip(row.persona_prompt, 2400)}`,
			skills.length && `Skills: ${skills.join(', ')}`,
			row.category && `Category: ${row.category}`,
			`Talk to it or embed it: ${origin}/agent/${row.id}`,
		];
		return {
			kind, id: row.id, title: clip(row.name || 'Untitled agent', 200), description: clip(row.description || '', 1000), tags,
			url: `${origin}/agent/${row.id}`, iconUrl: absolute(row.profile_image_url || row.avatar_url, origin),
			visibility: row.is_public === false ? 'private' : 'public', createdBy: ownerName,
			createdDateTime: iso(row.created_at), lastModifiedDateTime: iso(row.updated_at || row.created_at),
			body: body.filter(Boolean).join('\n'),
		};
	}
	if (kind === 'model') {
		const tags = uniq([row.model_category, row.tier, row.multiview ? 'multiview' : null, '3D model', 'GLB'].filter(Boolean));
		const body = [
			`three.ws 3D model generated in Forge from the prompt: ${clip(row.prompt, 1500)}`,
			row.model_category && `Category: ${row.model_category}`,
			row.refine_instruction && `Refined with: ${clip(row.refine_instruction, 400)}`,
			`Format: GLB (glTF binary)${row.size_bytes ? `, ${Math.round(row.size_bytes / 1024)} KB` : ''}`,
			`View, download or remix: ${origin}/m/${row.id}`,
		];
		return {
			kind, id: row.id, title: clip(row.prompt || '3D model', 120), description: clip(row.prompt || '', 1000), tags,
			url: `${origin}/m/${row.id}`, iconUrl: absolute(row.preview_image_url, origin),
			visibility: row.visibility || 'public', createdBy: ownerName,
			createdDateTime: iso(row.created_at), lastModifiedDateTime: iso(row.updated_at || row.created_at),
			body: body.filter(Boolean).join('\n'),
		};
	}
	if (kind === 'avatar') {
		const tags = uniq([...(row.tags || []), row.model_category, 'avatar', '3D'].filter(Boolean));
		const body = [
			`three.ws 3D avatar: ${row.name}`,
			row.description && `About: ${row.description}`,
			row.alt_text && `Looks like: ${clip(row.alt_text, 600)}`,
			row.tags?.length && `Tags: ${row.tags.join(', ')}`,
			`View in 3D or AR: ${origin}/avatars/${row.id}`,
		];
		return {
			kind, id: row.id, title: clip(row.name || 'Untitled avatar', 200), description: clip(row.description || '', 1000), tags,
			url: `${origin}/avatars/${row.id}`, iconUrl: absolute(row.thumbnail_url, origin),
			visibility: row.visibility || 'public', createdBy: ownerName,
			createdDateTime: iso(row.created_at), lastModifiedDateTime: iso(row.updated_at || row.created_at),
			body: body.filter(Boolean).join('\n'),
		};
	}
	throw new ConnectorError('invalid_item', `unknown item kind ${kind}`);
}

/** The Graph externalItem body for a normalized item, with type specifiers where Graph requires them. */
export function toExternalItem(item, acl) {
	const properties = {};
	const put = (name, value) => {
		if (value == null || value === '') return;
		if (Array.isArray(value)) {
			properties[`${name}@odata.type`] = 'Collection(String)';
			properties[name] = value;
			return;
		}
		if (typeof value === 'string' && !isAscii(value)) properties[`${name}@odata.type`] = 'String';
		properties[name] = value;
	};
	put('title', item.title);
	put('description', item.description);
	put('itemType', item.kind);
	put('tags', item.tags);
	put('url', item.url);
	put('iconUrl', item.iconUrl);
	put('createdBy', item.createdBy);
	put('createdDateTime', item.createdDateTime);
	put('lastModifiedDateTime', item.lastModifiedDateTime);
	put('visibility', item.visibility);
	return {
		id: itemIdFor(item.kind, item.id),
		acl,
		properties,
		content: { value: item.body, type: 'text' },
	};
}

/** Hash of exactly what would be sent, so an unchanged item is never re-pushed. */
export function contentHash(externalItem) {
	return createHash('sha256').update(JSON.stringify(externalItem)).digest('hex').slice(0, 32);
}

// ── Sync planning (pure) ────────────────────────────────────────────────────

const cursorKey = (t, id) => `${new Date(t).toISOString()}|${id}`;

/** Whether a source row sorts after the stored cursor (updated_at, item id). */
export function isAfterCursor(row, cursor) {
	if (!cursor?.updatedAt) return true;
	return cursorKey(row.updatedAt, row.itemId) > cursorKey(cursor.updatedAt, cursor.itemId || '');
}

/**
 * Decide what one sync run does.
 *
 *   current  [{ itemId, updatedAt }] every item the account should have indexed now
 *   indexed  Map itemId -> { hash } what three.ws last pushed to Graph
 *   cursor   { updatedAt, itemId } | null, the last row pushed in order
 *
 * Upserts are rows changed since the cursor plus rows never indexed (an item
 * that became public, or one a throttled run skipped), ordered by the cursor
 * key so the cursor can advance row by row. Deletes are indexed ids that are
 * no longer in the source, which covers hard deletes, soft deletes and items
 * that went private.
 */
export function planSync({ current, indexed, cursor }) {
	const currentIds = new Set();
	const upserts = [];
	for (const row of current) {
		currentIds.add(row.itemId);
		if (!indexed.has(row.itemId) || isAfterCursor(row, cursor)) upserts.push(row);
	}
	upserts.sort((a, b) => (cursorKey(a.updatedAt, a.itemId) < cursorKey(b.updatedAt, b.itemId) ? -1 : 1));
	const deletes = [...indexed.keys()].filter((id) => !currentIds.has(id)).sort();
	return { upserts, deletes };
}

/** The cursor after pushing `row`; never moves backwards. */
export function advanceCursor(cursor, row) {
	if (!isAfterCursor(row, cursor)) return cursor;
	return { updatedAt: new Date(row.updatedAt).toISOString(), itemId: row.itemId };
}

// ── Throttling (pure) ───────────────────────────────────────────────────────

export const RETRYABLE_STATUS = new Set([429, 502, 503, 504]);
export const MAX_RETRY_WAIT_MS = 60_000;

/** Milliseconds a Retry-After header asks for (delta seconds or an HTTP date), or null. */
export function parseRetryAfter(header, now = Date.now()) {
	if (header == null || header === '') return null;
	const s = String(header).trim();
	if (/^\d+(\.\d+)?$/.test(s)) return Math.round(Number(s) * 1000);
	const t = Date.parse(s);
	return Number.isFinite(t) ? Math.max(0, t - now) : null;
}

/** Wait before retry `attempt` (1-based): Retry-After when Graph sent one, else exponential from 1 s, both capped. */
export function backoffDelay(attempt, retryAfterMs) {
	if (retryAfterMs != null) return Math.min(retryAfterMs, MAX_RETRY_WAIT_MS);
	return Math.min(1000 * 2 ** (attempt - 1), MAX_RETRY_WAIT_MS);
}

// ── Graph client (IO, injectable) ───────────────────────────────────────────

const realSleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function readGraphError(res) {
	const text = await res.text().catch(() => '');
	try {
		const body = JSON.parse(text);
		if (body?.error && typeof body.error === 'object') return { code: body.error.code || `http_${res.status}`, message: body.error.message || text };
		if (body?.error) return { code: body.error, message: body.error_description || String(body.error) };
	} catch { /* not JSON */ }
	return { code: `http_${res.status}`, message: text.slice(0, 300) || `Graph answered ${res.status}` };
}

/**
 * One Graph request with throttling handled: 429 and 502/503/504 are retried
 * after Retry-After (or exponential backoff), up to `maxAttempts`. When the
 * budget runs out the GraphError carries the last Retry-After so the caller
 * can schedule the next run instead of hammering the tenant.
 */
export async function graphRequest({ token, method = 'GET', url, body, fetchImpl = fetch, sleep = realSleep, maxAttempts = 4, timeoutMs = 20_000 }) {
	const target = url.startsWith('http') ? url : `${GRAPH_BASE}${url}`;
	for (let attempt = 1; ; attempt++) {
		const res = await fetchImpl(target, {
			method,
			headers: { authorization: `Bearer ${token}`, ...(body !== undefined ? { 'content-type': 'application/json' } : {}) },
			body: body !== undefined ? JSON.stringify(body) : undefined,
			signal: AbortSignal.timeout(timeoutMs),
		});
		if (res.ok) return res;
		const retryAfterMs = parseRetryAfter(res.headers?.get?.('retry-after'));
		if (RETRYABLE_STATUS.has(res.status) && attempt < maxAttempts) {
			await res.text().catch(() => '');
			await sleep(backoffDelay(attempt, retryAfterMs));
			continue;
		}
		const { code, message } = await readGraphError(res);
		throw new GraphError(res.status, code, message, { retryAfterMs: RETRYABLE_STATUS.has(res.status) ? backoffDelay(attempt, retryAfterMs) : null });
	}
}

/** App-only Graph token in the customer tenant (client credentials). */
export async function tenantToken(tenantId, { fetchImpl = fetch, config = connectorAppConfig() } = {}) {
	if (!config) throw new ConnectorError('not_configured', 'the three.ws Microsoft Entra app is not configured on this deployment', 501);
	const res = await fetchImpl(`${LOGIN_BASE}/${encodeURIComponent(tenantId)}/oauth2/v2.0/token`, {
		method: 'POST',
		headers: { 'content-type': 'application/x-www-form-urlencoded' },
		body: new URLSearchParams({ client_id: config.clientId, client_secret: config.clientSecret, scope: GRAPH_SCOPE, grant_type: 'client_credentials' }).toString(),
		signal: AbortSignal.timeout(15_000),
	});
	const body = await res.json().catch(() => ({}));
	if (!res.ok || !body.access_token) {
		const desc = String(body.error_description || body.error || `Entra answered ${res.status}`).split(/\r?\n/)[0];
		throw new GraphError(res.status, body.error || 'token_failed', desc);
	}
	return body.access_token;
}

/** Create the connection; an existing one with this id (a reconnect) is reused. */
export async function ensureConnection(token, payload, opts = {}) {
	try {
		const res = await graphRequest({ token, method: 'POST', url: '/external/connections', body: payload, ...opts });
		return await res.json();
	} catch (err) {
		if (!(err instanceof GraphError) || err.status !== 409) throw err;
		const res = await graphRequest({ token, method: 'PATCH', url: `/external/connections/${payload.id}`, body: { name: payload.name, description: payload.description, activitySettings: payload.activitySettings }, ...opts });
		await res.text().catch(() => '');
		return { id: payload.id, reused: true };
	}
}

/** Register the schema; returns the operation URL Graph puts in Location. */
export async function registerSchema(token, connectionId, schema = buildSchema(), opts = {}) {
	const problems = validateSchema(schema);
	if (problems.length) throw new ConnectorError('invalid_schema', problems.join('; '), 500);
	const res = await graphRequest({ token, method: 'PATCH', url: `/external/connections/${connectionId}/schema`, body: schema, ...opts });
	return res.headers?.get?.('location') || null;
}

/** One poll of the schema operation: 'inprogress' | 'completed' | 'failed' with Microsoft's error. */
export async function readOperation(token, operationUrl, opts = {}) {
	if (!operationUrl || !operationUrl.startsWith(`${GRAPH_BASE}/external/connections/`)) throw new ConnectorError('invalid_operation', 'no schema operation to poll', 500);
	const res = await graphRequest({ token, url: operationUrl, ...opts });
	const body = await res.json();
	return { status: String(body.status || '').toLowerCase(), error: body.error?.message || null };
}

export async function deleteConnection(token, connectionId, opts = {}) {
	try {
		const res = await graphRequest({ token, method: 'DELETE', url: `/external/connections/${connectionId}`, ...opts });
		await res.text().catch(() => '');
		return true;
	} catch (err) {
		if (err instanceof GraphError && err.status === 404) return false;
		throw err;
	}
}

export async function putItem(token, connectionId, externalItem, opts = {}) {
	const res = await graphRequest({ token, method: 'PUT', url: `/external/connections/${connectionId}/items/${encodeURIComponent(externalItem.id)}`, body: externalItem, ...opts });
	await res.text().catch(() => '');
}

export async function deleteItem(token, connectionId, itemId, opts = {}) {
	try {
		const res = await graphRequest({ token, method: 'DELETE', url: `/external/connections/${connectionId}/items/${encodeURIComponent(itemId)}`, ...opts });
		await res.text().catch(() => '');
	} catch (err) {
		if (err instanceof GraphError && err.status === 404) return;
		throw err;
	}
}

/** What a Graph or Entra failure means for the admin, in words they can act on. */
export function explainFailure(err) {
	if (err instanceof ConnectorError) return { code: err.code, message: err.message };
	if (err instanceof GraphError) {
		if (/AADSTS700016|AADSTS7000229|AADSTS65001|unauthorized_client|invalid_client/i.test(`${err.code} ${err.message}`)) {
			return { code: 'consent_missing', message: 'The three.ws app has no admin consent in this tenant any more. Reconnect to grant it again.' };
		}
		if (err.status === 401) return { code: 'unauthorized', message: 'Microsoft rejected the three.ws app token. Reconnect so a tenant admin can grant consent again.' };
		if (err.status === 403) return { code: 'forbidden', message: `Microsoft refused the request (${err.code}). Check that admin consent includes ${REQUIRED_PERMISSIONS.join(' and ')}, then reconnect.` };
		if (err.status === 429 || RETRYABLE_STATUS.has(err.status)) return { code: 'throttled', message: 'Microsoft Graph asked three.ws to slow down. Sync resumes automatically where it stopped.' };
		if (/limit/i.test(err.code)) return { code: 'limit_exceeded', message: `Microsoft reported a connector limit: ${err.message}` };
		return { code: err.code || 'graph_error', message: `Microsoft Graph answered ${err.status}: ${err.message}` };
	}
	return { code: 'internal_error', message: 'Sync failed inside three.ws. It retries on the next run.' };
}

// ── Database ────────────────────────────────────────────────────────────────

export async function getConnection(userId) {
	const [row] = await sql`select * from m365_connections where user_id = ${userId}`;
	return row || null;
}

export async function ownerIdentity(userId) {
	const [u] = await sql`select coalesce(nullif(display_name, ''), nullif(username, ''), 'three.ws creator') as name from users where id = ${userId}`;
	const ids = await sql`select subject from user_identities where user_id = ${userId} and provider = 'microsoft'`;
	return { name: u?.name || 'three.ws creator', subjects: ids.map((r) => r.subject) };
}

/**
 * Every item the account should have indexed right now. Private items are
 * included only when the connection opted in. Forge models that a newer
 * refinement superseded are left out (the newest version stands for them).
 */
export async function loadSourceItems(userId, { includePrivate = false } = {}) {
	const [agents, models, avatars] = await Promise.all([
		sql`
			select 'agent' as kind, id, name, description, skills, tags, category, greeting, persona_prompt,
			       profile_image_url, avatar_url, is_public, created_at, updated_at
			from agent_identities
			where user_id = ${userId} and deleted_at is null and (${includePrivate} or coalesce(is_public, true))
		`,
		sql`
			select 'model' as kind, id, prompt, model_category, tier, multiview, refine_instruction, size_bytes,
			       preview_image_url, visibility, created_at, updated_at
			from forge_creations
			where user_id = ${userId} and status = 'done' and glb_url is not null and superseded_by is null
			  and coalesce(internal, false) = false
			  and (${includePrivate} or coalesce(visibility, 'public') <> 'private')
		`,
		sql`
			select 'avatar' as kind, id, name, description, tags, model_category, alt_text, thumbnail_key,
			       visibility, created_at, updated_at
			from avatars
			where owner_id = ${userId} and deleted_at is null and (${includePrivate} or visibility <> 'private')
		`,
	]);
	for (const a of avatars) a.thumbnail_url = thumbnailUrl(a.thumbnail_key);
	return [...agents, ...models, ...avatars];
}

export async function loadIndexed(userId) {
	const rows = await sql`select item_id, content_hash from m365_connector_items where user_id = ${userId}`;
	return new Map(rows.map((r) => [r.item_id, { hash: r.content_hash }]));
}

export async function countIndexed(userId) {
	const [r] = await sql`select count(*)::int as n from m365_connector_items where user_id = ${userId}`;
	return r?.n || 0;
}

// ── Connection lifecycle ────────────────────────────────────────────────────

/** Store the tenant an admin consented in. A different tenant than before starts from an empty ledger. */
export async function saveConsent(userId, tenantId) {
	const connectionId = connectionIdFor(userId);
	const prev = await getConnection(userId);
	if (prev && prev.tenant_id !== tenantId) await sql`delete from m365_connector_items where user_id = ${userId}`;
	await sql`
		insert into m365_connections (user_id, tenant_id, connection_id, status)
		values (${userId}, ${tenantId}, ${connectionId}, 'consented')
		on conflict (user_id) do update set
			tenant_id = excluded.tenant_id, connection_id = excluded.connection_id, status = 'consented',
			schema_operation_url = null, cursor_updated_at = null, cursor_item_id = null,
			last_error = null, last_error_code = null, last_error_at = null, next_attempt_at = null,
			connected_at = now(), updated_at = now()
	`;
	return getConnection(userId);
}

/** Save a failure on the connection. Throttling keeps the connection ready and schedules the retry. */
export async function recordFailure(userId, err) {
	const { code, message } = explainFailure(err);
	const retryMs = err instanceof GraphError && err.retryAfterMs != null ? err.retryAfterMs : null;
	const nextAt = retryMs != null ? new Date(Date.now() + retryMs).toISOString() : null;
	const keepStatus = code === 'throttled' || code === 'internal_error';
	await sql`
		update m365_connections set
			status = case when ${keepStatus} then status else 'error' end,
			last_error = ${message}, last_error_code = ${code}, last_error_at = now(),
			next_attempt_at = ${nextAt}, updated_at = now()
		where user_id = ${userId}
	`;
	return { code, message };
}

/**
 * Create the connection in the tenant and start the schema operation. Graph
 * takes 5 to 15 minutes to apply a schema; the cron polls it and flips the
 * connection to ready, after which the first sync runs.
 */
export async function provisionConnection(userId, { fetchImpl = fetch, sleep = realSleep, origin = env.APP_ORIGIN } = {}) {
	const conn = await getConnection(userId);
	if (!conn) throw new ConnectorError('not_connected', 'connect a Microsoft 365 tenant first', 409);
	await sql`update m365_connections set status = 'provisioning', updated_at = now() where user_id = ${userId}`;
	try {
		const token = await tenantToken(conn.tenant_id, { fetchImpl });
		const opts = { fetchImpl, sleep };
		await ensureConnection(token, connectionPayload(userId, origin), opts);
		const operationUrl = await registerSchema(token, conn.connection_id, buildSchema(), opts);
		await sql`
			update m365_connections set status = 'schema_pending', schema_operation_url = ${operationUrl},
				last_error = null, last_error_code = null, last_error_at = null, next_attempt_at = null, updated_at = now()
			where user_id = ${userId}
		`;
		return { status: 'schema_pending', operationUrl };
	} catch (err) {
		const failure = await recordFailure(userId, err);
		return { status: 'error', ...failure };
	}
}

/** Poll the pending schema operation once. Returns the connection status after the poll. */
export async function pollSchema(userId, { fetchImpl = fetch, sleep = realSleep } = {}) {
	const conn = await getConnection(userId);
	if (!conn || conn.status !== 'schema_pending') return conn?.status || null;
	try {
		const token = await tenantToken(conn.tenant_id, { fetchImpl });
		let status = 'completed';
		let error = null;
		if (conn.schema_operation_url) ({ status, error } = await readOperation(token, conn.schema_operation_url, { fetchImpl, sleep }));
		if (status === 'completed') {
			await sql`update m365_connections set status = 'ready', schema_version = ${SCHEMA_VERSION}, schema_operation_url = null, updated_at = now() where user_id = ${userId}`;
			return 'ready';
		}
		if (status === 'failed') {
			await recordFailure(userId, new ConnectorError('schema_failed', `Microsoft could not apply the three.ws schema${error ? `: ${error}` : ''}. Run a full re-sync to register it again.`));
			return 'error';
		}
		return 'schema_pending';
	} catch (err) {
		await recordFailure(userId, err);
		return 'error';
	}
}

/** Who sees the items, and whether private items are indexed. Any change re-pushes everything with the new ACL. */
export async function updateSettings(userId, { audience, groupId = null, includePrivate = false }) {
	const conn = await getConnection(userId);
	if (!conn) throw new ConnectorError('not_connected', 'connect a Microsoft 365 tenant first', 409);
	if (!AUDIENCES.includes(audience)) throw new ConnectorError('invalid_audience', `audience must be one of ${AUDIENCES.join(', ')}`);
	const group = audience === 'group' ? String(groupId || '').trim().toLowerCase() : null;
	const owner = await ownerIdentity(userId);
	buildAcl({ tenantId: conn.tenant_id, audience, groupId: group, ownerObjectId: ownerObjectIdInTenant(owner.subjects, conn.tenant_id) });
	await sql`
		update m365_connections set audience = ${audience}, group_id = ${group}, include_private = ${Boolean(includePrivate)},
			cursor_updated_at = null, cursor_item_id = null, updated_at = now()
		where user_id = ${userId}
	`;
	await sql`update m365_connector_items set content_hash = '' where user_id = ${userId}`;
	return getConnection(userId);
}

/** Full re-sync: forget the cursor and every hash so the next run re-pushes every item. A failed schema is registered again. */
export async function resetForFullSync(userId) {
	await sql`
		update m365_connections set cursor_updated_at = null, cursor_item_id = null, next_attempt_at = null,
			status = case when status = 'error' and schema_version is null then 'consented' else status end,
			updated_at = now()
		where user_id = ${userId}
	`;
	await sql`update m365_connector_items set content_hash = '' where user_id = ${userId}`;
}

/**
 * Disconnect: delete the connection (and with it every indexed item) in the
 * tenant, then the stored link. If Microsoft refuses (consent already revoked)
 * the local link is still removed and the caller tells the admin to delete the
 * connection from the Microsoft 365 admin center.
 */
export async function disconnect(userId, { fetchImpl = fetch, sleep = realSleep } = {}) {
	const conn = await getConnection(userId);
	if (!conn) return { removed: false, remoteDeleted: false };
	let remoteDeleted = false;
	let remoteError = null;
	try {
		const token = await tenantToken(conn.tenant_id, { fetchImpl });
		await deleteConnection(token, conn.connection_id, { fetchImpl, sleep });
		remoteDeleted = true;
	} catch (err) {
		remoteError = explainFailure(err);
	}
	await sql`delete from m365_connector_items where user_id = ${userId}`;
	await sql`delete from m365_connections where user_id = ${userId}`;
	return { removed: true, remoteDeleted, remoteError, connectionId: conn.connection_id, tenantId: conn.tenant_id };
}

// ── Sync ────────────────────────────────────────────────────────────────────

/** Build the external item, its hash and cursor key for every source row. */
export function prepareItems(rows, { acl, origin, ownerName }) {
	return rows.map((row) => {
		const item = normalizeSource(row, { origin, ownerName });
		const ext = toExternalItem(item, acl);
		return { itemId: ext.id, kind: item.kind, updatedAt: item.lastModifiedDateTime || item.createdDateTime, ext, hash: contentHash(ext) };
	});
}

/**
 * One incremental sync for one account: delete what left, push what changed,
 * advance the cursor after every successful push, and stop cleanly at the
 * deadline or on throttling so the next run resumes exactly where this one
 * stopped.
 */
export async function runSync(userId, { fetchImpl = fetch, sleep = realSleep, origin = env.APP_ORIGIN, deadline = Date.now() + 50_000, force = false } = {}) {
	const conn = await getConnection(userId);
	if (!conn) return { skipped: 'not_connected' };
	if (conn.status !== 'ready') return { skipped: `status_${conn.status}` };
	if (!force && conn.next_attempt_at && new Date(conn.next_attempt_at).getTime() > Date.now()) return { skipped: 'backing_off' };

	await sql`update m365_connections set last_sync_started_at = now() where user_id = ${userId}`;
	const fullRun = !conn.cursor_updated_at;
	let cursor = conn.cursor_updated_at ? { updatedAt: new Date(conn.cursor_updated_at).toISOString(), itemId: conn.cursor_item_id } : null;
	const stats = { upserted: 0, unchanged: 0, deleted: 0, complete: false };
	try {
		const token = await tenantToken(conn.tenant_id, { fetchImpl });
		const owner = await ownerIdentity(userId);
		const acl = buildAcl({ tenantId: conn.tenant_id, audience: conn.audience, groupId: conn.group_id, ownerObjectId: ownerObjectIdInTenant(owner.subjects, conn.tenant_id) });
		const items = prepareItems(await loadSourceItems(userId, { includePrivate: conn.include_private }), { acl, origin, ownerName: owner.name });
		const indexed = await loadIndexed(userId);
		const { upserts, deletes } = planSync({ current: items, indexed, cursor });
		const opts = { fetchImpl, sleep };

		for (const itemId of deletes) {
			if (Date.now() > deadline) break;
			await deleteItem(token, conn.connection_id, itemId, opts);
			await sql`delete from m365_connector_items where user_id = ${userId} and item_id = ${itemId}`;
			stats.deleted++;
		}
		for (const row of upserts) {
			if (Date.now() > deadline) break;
			if (indexed.get(row.itemId)?.hash === row.hash) {
				stats.unchanged++;
			} else {
				await putItem(token, conn.connection_id, row.ext, opts);
				await sql`
					insert into m365_connector_items (user_id, item_id, kind, content_hash, source_updated_at, synced_at)
					values (${userId}, ${row.itemId}, ${row.kind}, ${row.hash}, ${row.updatedAt}, now())
					on conflict (user_id, item_id) do update set content_hash = excluded.content_hash,
						source_updated_at = excluded.source_updated_at, synced_at = now()
				`;
				stats.upserted++;
			}
			cursor = advanceCursor(cursor, row);
		}
		stats.complete = stats.deleted === deletes.length && stats.upserted + stats.unchanged === upserts.length;
		await sql`
			update m365_connections set cursor_updated_at = ${cursor?.updatedAt || null}, cursor_item_id = ${cursor?.itemId || null},
				items_indexed = (select count(*)::int from m365_connector_items where user_id = ${userId}),
				last_sync_at = case when ${stats.complete} then now() else last_sync_at end,
				last_full_sync_at = case when ${stats.complete && fullRun} then now() else last_full_sync_at end,
				last_error = null, last_error_code = null, last_error_at = null, next_attempt_at = null, updated_at = now()
			where user_id = ${userId}
		`;
		return stats;
	} catch (err) {
		await sql`
			update m365_connections set cursor_updated_at = ${cursor?.updatedAt || null}, cursor_item_id = ${cursor?.itemId || null},
				items_indexed = (select count(*)::int from m365_connector_items where user_id = ${userId})
			where user_id = ${userId}
		`;
		const failure = await recordFailure(userId, err);
		return { ...stats, error: failure };
	}
}

/** The status the settings page renders. */
export async function connectorStatus(userId) {
	const configured = Boolean(connectorAppConfig());
	const conn = await getConnection(userId);
	const owner = await ownerIdentity(userId);
	const base = { configured, missing: missingConnectorConfig(), requiredPermissions: REQUIRED_PERMISSIONS, redirectUri: consentRedirectUri() };
	if (!conn) return { ...base, connected: false, microsoftLinked: owner.subjects.length > 0 };
	const [counts] = await sql`
		select count(*) filter (where kind = 'agent')::int as agents, count(*) filter (where kind = 'model')::int as models,
		       count(*) filter (where kind = 'avatar')::int as avatars
		from m365_connector_items where user_id = ${userId}
	`;
	return {
		...base,
		connected: true,
		microsoftLinked: owner.subjects.length > 0,
		ownerInTenant: Boolean(ownerObjectIdInTenant(owner.subjects, conn.tenant_id)),
		tenantId: conn.tenant_id,
		connectionId: conn.connection_id,
		status: conn.status,
		audience: conn.audience,
		groupId: conn.group_id,
		includePrivate: conn.include_private,
		itemsIndexed: conn.items_indexed,
		counts: counts || { agents: 0, models: 0, avatars: 0 },
		lastSyncAt: conn.last_sync_at,
		lastSyncStartedAt: conn.last_sync_started_at,
		lastFullSyncAt: conn.last_full_sync_at,
		connectedAt: conn.connected_at,
		nextAttemptAt: conn.next_attempt_at,
		lastError: conn.last_error ? { code: conn.last_error_code, message: conn.last_error, at: conn.last_error_at } : null,
	};
}
