// SCIM 2.0 (RFC 7643 schema, RFC 7644 protocol): the pure half. Filter
// parsing, PATCH application, resource rendering and the discovery documents.
// No database here; api/_lib/team-enterprise.js stores, api/scim/v2.js serves.
//
// Written against what Microsoft Entra ID's provisioning service actually
// sends, which bends RFC 7644 in a few documented ways this module accepts:
//
//   - op names capitalized ("Add", "Replace", "Remove").
//   - booleans as strings ("False") in a replace of `active`.
//   - a no-path replace whose value object uses dotted keys
//     ({ "name.givenName": "Ada" }) as well as nested objects.
//   - value-filtered paths: emails[type eq "work"].value,
//     members[value eq "<id>"].
//   - group member removal both as a filtered path and as
//     { path: "members", value: [{ value: "<id>" }] }.
//
// Attributes this service does not store (the enterprise extension's
// department, manager, employeeNumber, and so on) are accepted and ignored, so
// a default Entra attribute mapping provisions cleanly; the Schemas document
// lists exactly what is kept.

export const SCHEMA_USER = 'urn:ietf:params:scim:schemas:core:2.0:User';
export const SCHEMA_GROUP = 'urn:ietf:params:scim:schemas:core:2.0:Group';
export const SCHEMA_ENTERPRISE_USER = 'urn:ietf:params:scim:schemas:extension:enterprise:2.0:User';
export const SCHEMA_LIST = 'urn:ietf:params:scim:api:messages:2.0:ListResponse';
export const SCHEMA_PATCH = 'urn:ietf:params:scim:api:messages:2.0:PatchOp';
export const SCHEMA_ERROR = 'urn:ietf:params:scim:api:messages:2.0:Error';
export const SCHEMA_SPC = 'urn:ietf:params:scim:schemas:core:2.0:ServiceProviderConfig';
export const SCHEMA_RESOURCE_TYPE = 'urn:ietf:params:scim:schemas:core:2.0:ResourceType';
export const SCHEMA_SCHEMA = 'urn:ietf:params:scim:schemas:core:2.0:Schema';
export const CONTENT_TYPE = 'application/scim+json';
export const MAX_PAGE = 200;
export const MAX_OPERATIONS = 100;

export class ScimError extends Error {
	/** @param {number} status @param {string} detail @param {string|null} scimType */
	constructor(status, detail, scimType = null) {
		super(detail);
		this.status = status;
		this.scimType = scimType;
	}
}

/** RFC 7644 3.12 error body. `status` is a string by spec. */
export function errorBody(status, detail, scimType = null) {
	const body = { schemas: [SCHEMA_ERROR], status: String(status), detail };
	if (scimType) body.scimType = scimType;
	return body;
}

// ── Filters (RFC 7644 3.4.2.2) ───────────────────────────────────────────────
//
// The subset provisioning clients use: `attr eq value` comparisons joined by
// `and`. Anything else is a 400 invalidFilter, never a silently ignored filter
// that would return every user to a client asking about one.

const USER_FILTER_ATTRS = {
	username: 'userName',
	externalid: 'externalId',
	id: 'id',
	displayname: 'displayName',
	'emails.value': 'email',
	'emails[type eq "work"].value': 'email',
	emails: 'email',
	active: 'active',
};
const GROUP_FILTER_ATTRS = {
	displayname: 'displayName',
	externalid: 'externalId',
	id: 'id',
	members: 'member',
	'members.value': 'member',
};

function tokenizeFilter(input) {
	const tokens = [];
	let i = 0;
	const s = String(input);
	while (i < s.length) {
		const c = s[i];
		if (c === ' ' || c === '\t') { i++; continue; }
		if (c === '"') {
			let j = i + 1;
			let out = '';
			while (j < s.length && s[j] !== '"') {
				if (s[j] === '\\' && j + 1 < s.length) { out += s[j + 1]; j += 2; continue; }
				out += s[j++];
			}
			if (j >= s.length) throw new ScimError(400, 'unterminated string in filter', 'invalidFilter');
			tokens.push({ t: 'str', v: out });
			i = j + 1;
			continue;
		}
		// A bare word: an attribute path (which may carry a bracketed value
		// filter with quoted strings inside), an operator, or a literal.
		let j = i;
		let depth = 0;
		while (j < s.length) {
			const d = s[j];
			if (d === '[') depth++;
			else if (d === ']') depth--;
			else if (d === '"' && depth > 0) {
				j++;
				while (j < s.length && s[j] !== '"') j++;
			} else if ((d === ' ' || d === '\t') && depth === 0) break;
			j++;
		}
		tokens.push({ t: 'word', v: s.slice(i, j) });
		i = j;
	}
	return tokens;
}

function normalizeFilterAttr(raw) {
	// Strip a schema URN prefix ("urn:...:User:userName" means "userName").
	let a = raw;
	if (a.toLowerCase().startsWith(`${SCHEMA_USER.toLowerCase()}:`)) a = a.slice(SCHEMA_USER.length + 1);
	if (a.toLowerCase().startsWith(`${SCHEMA_GROUP.toLowerCase()}:`)) a = a.slice(SCHEMA_GROUP.length + 1);
	return a.replace(/\s+/g, ' ').toLowerCase();
}

/**
 * Parse a filter into [{ field, value }] (all ANDed). `kind` is 'user' or
 * 'group'. Throws ScimError 400 invalidFilter on anything unsupported.
 */
export function parseFilter(filter, kind = 'user') {
	if (filter == null || String(filter).trim() === '') return [];
	const attrs = kind === 'group' ? GROUP_FILTER_ATTRS : USER_FILTER_ATTRS;
	const tokens = tokenizeFilter(filter);
	const out = [];
	let i = 0;
	while (i < tokens.length) {
		const a = tokens[i];
		const op = tokens[i + 1];
		const v = tokens[i + 2];
		if (!a || a.t !== 'word' || !op || op.t !== 'word' || !v) {
			throw new ScimError(400, `unsupported filter: ${filter}`, 'invalidFilter');
		}
		if (op.v.toLowerCase() !== 'eq') {
			throw new ScimError(400, `only the eq operator is supported (got ${op.v})`, 'invalidFilter');
		}
		const field = attrs[normalizeFilterAttr(a.v)];
		if (!field) throw new ScimError(400, `filtering on ${a.v} is not supported`, 'invalidFilter');
		let value;
		if (v.t === 'str') value = v.v;
		else if (/^(true|false)$/i.test(v.v)) value = v.v.toLowerCase() === 'true';
		else throw new ScimError(400, `filter values must be quoted strings or booleans (got ${v.v})`, 'invalidFilter');
		out.push({ field, value });
		i += 3;
		if (i < tokens.length) {
			if (tokens[i].t !== 'word' || tokens[i].v.toLowerCase() !== 'and') {
				throw new ScimError(400, 'only "and" may join filter expressions', 'invalidFilter');
			}
			i++;
			if (i >= tokens.length) throw new ScimError(400, 'filter ends after "and"', 'invalidFilter');
		}
	}
	return out;
}

/** Page parameters (RFC 7644 3.4.2.4): 1-based startIndex, count capped. */
export function parsePaging(searchParams) {
	const si = Number.parseInt(searchParams.get('startIndex') ?? '1', 10);
	const ct = Number.parseInt(searchParams.get('count') ?? '100', 10);
	return {
		startIndex: Number.isFinite(si) && si >= 1 ? si : 1,
		count: Number.isFinite(ct) ? Math.max(0, Math.min(MAX_PAGE, ct)) : 100,
	};
}

export function listResponse(resources, { totalResults, startIndex }) {
	return {
		schemas: [SCHEMA_LIST],
		totalResults,
		startIndex,
		itemsPerPage: resources.length,
		Resources: resources,
	};
}

/** `excludedAttributes=members` (Entra sends it on group reads). */
export function excludes(searchParams, attr) {
	const raw = searchParams.get('excludedAttributes');
	if (!raw) return false;
	return raw.split(',').map((s) => s.trim().toLowerCase()).includes(attr.toLowerCase());
}

// ── Users ────────────────────────────────────────────────────────────────────

const str = (v, max) => {
	if (v == null) return null;
	const s = String(v).trim();
	return s ? s.slice(0, max) : null;
};

/** SCIM booleans, including Entra's "True"/"False" strings. */
export function toBool(v) {
	if (typeof v === 'boolean') return v;
	if (typeof v === 'string' && /^(true|false)$/i.test(v.trim())) return v.trim().toLowerCase() === 'true';
	throw new ScimError(400, `expected a boolean, got ${JSON.stringify(v)}`, 'invalidValue');
}

function primaryEmail(emails) {
	if (!Array.isArray(emails) || emails.length === 0) return null;
	const pick = emails.find((e) => e && (e.primary === true || /^true$/i.test(String(e.primary))))
		|| emails.find((e) => e && String(e.type || '').toLowerCase() === 'work')
		|| emails[0];
	return pick && typeof pick === 'object' ? str(pick.value, 320) : str(pick, 320);
}

/**
 * The internal user state PATCH and PUT operate on. Mirrors the columns of
 * team_people that SCIM owns.
 */
export function userStateFromRow(row) {
	return {
		userName: row.user_name || null,
		externalId: row.external_id || null,
		displayName: row.display_name || null,
		givenName: row.given_name || null,
		familyName: row.family_name || null,
		email: row.email || null,
		active: row.status === 'active',
	};
}

/** A POST or PUT body to user state. userName is required. */
export function userStateFromResource(body) {
	if (!body || typeof body !== 'object') throw new ScimError(400, 'the request body must be a SCIM User', 'invalidSyntax');
	const userName = str(body.userName, 320);
	if (!userName) throw new ScimError(400, 'userName is required', 'invalidValue');
	const name = body.name && typeof body.name === 'object' ? body.name : {};
	return {
		userName,
		externalId: str(body.externalId, 320),
		displayName: str(body.displayName, 200) || str(name.formatted, 200),
		givenName: str(name.givenName, 120),
		familyName: str(name.familyName, 120),
		email: primaryEmail(body.emails),
		active: body.active === undefined ? true : toBool(body.active),
	};
}

export function renderUser(row, { baseUrl }) {
	const name = {};
	if (row.given_name) name.givenName = row.given_name;
	if (row.family_name) name.familyName = row.family_name;
	const formatted = [row.given_name, row.family_name].filter(Boolean).join(' ');
	if (formatted) name.formatted = formatted;
	const out = {
		schemas: [SCHEMA_USER],
		id: row.id,
		userName: row.user_name,
		active: row.status === 'active',
		meta: {
			resourceType: 'User',
			created: new Date(row.created_at).toISOString(),
			lastModified: new Date(row.updated_at).toISOString(),
			location: `${baseUrl}/Users/${row.id}`,
			version: `W/"${new Date(row.updated_at).getTime()}"`,
		},
	};
	if (row.external_id) out.externalId = row.external_id;
	if (Object.keys(name).length) out.name = name;
	if (row.display_name) out.displayName = row.display_name;
	if (row.email) out.emails = [{ value: row.email, type: 'work', primary: true }];
	return out;
}

// ── PATCH paths ──────────────────────────────────────────────────────────────

/**
 * Parse a PATCH path into { attr, filter, sub }. attr is lowercased, a schema
 * URN prefix is stripped, and the enterprise extension is flagged so callers
 * can accept-and-ignore it.
 */
export function parsePath(path) {
	let p = String(path || '').trim();
	if (!p) return null;
	let extension = false;
	const lower = p.toLowerCase();
	if (lower.startsWith(`${SCHEMA_ENTERPRISE_USER.toLowerCase()}:`)) {
		extension = true;
		p = p.slice(SCHEMA_ENTERPRISE_USER.length + 1);
	} else if (lower.startsWith(`${SCHEMA_USER.toLowerCase()}:`)) {
		p = p.slice(SCHEMA_USER.length + 1);
	} else if (lower.startsWith(`${SCHEMA_GROUP.toLowerCase()}:`)) {
		p = p.slice(SCHEMA_GROUP.length + 1);
	} else if (lower.startsWith('urn:')) {
		extension = true;
	}
	const m = p.match(/^([A-Za-z][\w$-]*)(?:\[(.+)\])?(?:\.([A-Za-z][\w$-]*))?$/);
	if (!m) throw new ScimError(400, `unsupported path: ${path}`, 'invalidPath');
	let filter = null;
	if (m[2]) {
		const fm = m[2].trim().match(/^([A-Za-z][\w.]*)\s+eq\s+(?:"((?:[^"\\]|\\.)*)"|(true|false))$/i);
		if (!fm) throw new ScimError(400, `unsupported value filter in path: ${path}`, 'invalidFilter');
		filter = { attr: fm[1].toLowerCase(), value: fm[2] !== undefined ? fm[2].replace(/\\(.)/g, '$1') : fm[3].toLowerCase() === 'true' };
	}
	return { attr: m[1].toLowerCase(), filter, sub: m[3] ? m[3].toLowerCase() : null, extension };
}

function normalizeOp(op) {
	const o = String(op || '').toLowerCase();
	if (!['add', 'replace', 'remove'].includes(o)) throw new ScimError(400, `unsupported op: ${op}`, 'invalidSyntax');
	return o;
}

/** Validate a PatchOp body and return its operations with normalized op names. */
export function readPatchOps(body) {
	if (!body || typeof body !== 'object') throw new ScimError(400, 'the request body must be a SCIM PatchOp', 'invalidSyntax');
	const schemas = Array.isArray(body.schemas) ? body.schemas : [];
	if (!schemas.includes(SCHEMA_PATCH)) throw new ScimError(400, `schemas must include ${SCHEMA_PATCH}`, 'invalidSyntax');
	const ops = body.Operations ?? body.operations;
	if (!Array.isArray(ops) || ops.length === 0) throw new ScimError(400, 'Operations must be a non-empty array', 'invalidSyntax');
	if (ops.length > MAX_OPERATIONS) throw new ScimError(400, `at most ${MAX_OPERATIONS} operations per request`, 'tooMany');
	return ops.map((o) => ({ op: normalizeOp(o?.op), path: o?.path ?? null, value: o?.value }));
}

function scalarOf(value) {
	// Entra sometimes wraps a single value: [{ value: "x" }] or { value: "x" }.
	if (Array.isArray(value)) return value.length ? scalarOf(value[0]) : null;
	if (value && typeof value === 'object' && 'value' in value) return value.value;
	return value;
}

/** Apply one attribute assignment to user state. `remove` clears it. */
function setUserAttr(state, parsed, value, op) {
	if (parsed.extension) return; // enterprise extension: accepted, not stored
	const remove = op === 'remove';
	const { attr, sub, filter } = parsed;
	switch (attr) {
		case 'username': {
			if (remove) throw new ScimError(400, 'userName cannot be removed', 'mutability');
			const v = str(scalarOf(value), 320);
			if (!v) throw new ScimError(400, 'userName cannot be empty', 'invalidValue');
			state.userName = v;
			return;
		}
		case 'externalid': state.externalId = remove ? null : str(scalarOf(value), 320); return;
		case 'displayname': state.displayName = remove ? null : str(scalarOf(value), 200); return;
		case 'active': {
			if (remove) throw new ScimError(400, 'active cannot be removed', 'mutability');
			state.active = toBool(scalarOf(value));
			return;
		}
		case 'name': {
			if (sub === 'givenname') { state.givenName = remove ? null : str(scalarOf(value), 120); return; }
			if (sub === 'familyname') { state.familyName = remove ? null : str(scalarOf(value), 120); return; }
			if (sub === 'formatted') { if (!state.displayName && !remove) state.displayName = str(scalarOf(value), 200); return; }
			if (sub) return; // middleName, honorificPrefix, ...: not stored
			if (remove) { state.givenName = null; state.familyName = null; return; }
			if (value && typeof value === 'object') {
				if ('givenName' in value) state.givenName = str(value.givenName, 120);
				if ('familyName' in value) state.familyName = str(value.familyName, 120);
				if (!state.displayName && value.formatted) state.displayName = str(value.formatted, 200);
			}
			return;
		}
		case 'emails': {
			// Only the primary work address is kept. A filter that selects some
			// other type (home, other) is accepted and ignored.
			if (filter) {
				const wantsWork = filter.attr === 'type' && String(filter.value).toLowerCase() === 'work';
				const wantsPrimary = filter.attr === 'primary' && filter.value === true;
				if (!wantsWork && !wantsPrimary) return;
			}
			if (remove) { state.email = null; return; }
			if (sub === 'value' || filter) { state.email = str(scalarOf(value), 320); return; }
			if (sub) return; // emails.type, emails.primary alone: nothing to store
			state.email = Array.isArray(value) ? primaryEmail(value) : str(scalarOf(value), 320);
			return;
		}
		default:
			// phoneNumbers, addresses, title, preferredLanguage, roles, ...:
			// accepted and not stored (see the Schemas document).
	}
}

/**
 * Apply a PatchOp to user state. Returns a new state; the input is untouched.
 */
export function applyUserPatch(state, operations) {
	const next = { ...state };
	for (const { op, path, value } of operations) {
		if (path) {
			const parsed = parsePath(path);
			if (op === 'remove' && parsed.attr === 'emails' && !parsed.filter && !parsed.sub && Array.isArray(value)) {
				// Remove specific addresses: clear ours if it is among them.
				const drop = value.map((v) => String(scalarOf(v) || '').toLowerCase());
				if (next.email && drop.includes(next.email.toLowerCase())) next.email = null;
				continue;
			}
			setUserAttr(next, parsed, value, op);
			continue;
		}
		if (op === 'remove') throw new ScimError(400, 'remove needs a path', 'noTarget');
		if (!value || typeof value !== 'object' || Array.isArray(value)) {
			throw new ScimError(400, 'an operation without a path needs an object value', 'invalidSyntax');
		}
		for (const [key, v] of Object.entries(value)) {
			if (key === 'schemas') continue;
			if (key.toLowerCase() === SCHEMA_ENTERPRISE_USER.toLowerCase()) continue;
			setUserAttr(next, parsePath(key), v, op);
		}
	}
	return next;
}

// ── Groups ───────────────────────────────────────────────────────────────────

export function renderGroup(row, memberRows, { baseUrl, withMembers = true }) {
	const out = {
		schemas: [SCHEMA_GROUP],
		id: row.id,
		displayName: row.display_name,
		meta: {
			resourceType: 'Group',
			created: new Date(row.created_at).toISOString(),
			lastModified: new Date(row.updated_at).toISOString(),
			location: `${baseUrl}/Groups/${row.id}`,
			version: `W/"${new Date(row.updated_at).getTime()}"`,
		},
	};
	if (row.external_id) out.externalId = row.external_id;
	if (withMembers) {
		out.members = memberRows.map((m) => ({
			value: m.person_id,
			display: m.display_name || m.user_name || undefined,
			$ref: `${baseUrl}/Users/${m.person_id}`,
		}));
	}
	return out;
}

function memberIds(value) {
	const list = Array.isArray(value) ? value : value == null ? [] : [value];
	return list.map((m) => (m && typeof m === 'object' ? m.value : m)).filter((v) => typeof v === 'string' && v);
}

export function groupStateFromResource(body) {
	if (!body || typeof body !== 'object') throw new ScimError(400, 'the request body must be a SCIM Group', 'invalidSyntax');
	const displayName = str(body.displayName, 256);
	if (!displayName) throw new ScimError(400, 'displayName is required', 'invalidValue');
	return { displayName, externalId: str(body.externalId, 320), members: memberIds(body.members) };
}

/**
 * Apply a PatchOp to a group. `state` is { displayName, externalId, members:
 * string[] }. Returns a new state.
 */
export function applyGroupPatch(state, operations) {
	const next = { ...state, members: [...state.members] };
	const add = (ids) => { for (const id of ids) if (!next.members.includes(id)) next.members.push(id); };
	const drop = (ids) => { next.members = next.members.filter((m) => !ids.includes(m)); };
	for (const { op, path, value } of operations) {
		if (!path) {
			if (op === 'remove') throw new ScimError(400, 'remove needs a path', 'noTarget');
			if (!value || typeof value !== 'object' || Array.isArray(value)) {
				throw new ScimError(400, 'an operation without a path needs an object value', 'invalidSyntax');
			}
			for (const [key, v] of Object.entries(value)) {
				const k = key.toLowerCase();
				if (k === 'displayname') next.displayName = str(scalarOf(v), 256) || next.displayName;
				else if (k === 'externalid') next.externalId = str(scalarOf(v), 320);
				else if (k === 'members') { if (op === 'replace') next.members = []; add(memberIds(v)); }
			}
			continue;
		}
		const parsed = parsePath(path);
		if (parsed.attr === 'displayname') {
			if (op === 'remove') throw new ScimError(400, 'displayName cannot be removed', 'mutability');
			const v = str(scalarOf(value), 256);
			if (!v) throw new ScimError(400, 'displayName cannot be empty', 'invalidValue');
			next.displayName = v;
		} else if (parsed.attr === 'externalid') {
			next.externalId = op === 'remove' ? null : str(scalarOf(value), 320);
		} else if (parsed.attr === 'members') {
			if (parsed.filter) {
				if (parsed.filter.attr !== 'value') throw new ScimError(400, `unsupported member filter: ${path}`, 'invalidFilter');
				if (op === 'remove') drop([String(parsed.filter.value)]);
				else add([String(parsed.filter.value)]);
			} else if (op === 'remove') {
				const ids = memberIds(value);
				if (ids.length) drop(ids); else next.members = [];
			} else if (op === 'replace') {
				next.members = [];
				add(memberIds(value));
			} else {
				add(memberIds(value));
			}
		}
		// Other group attributes are accepted and ignored.
	}
	return next;
}

// ── Discovery documents (RFC 7644 4) ─────────────────────────────────────────

export function serviceProviderConfig({ baseUrl, docsUrl }) {
	return {
		schemas: [SCHEMA_SPC],
		documentationUri: docsUrl,
		patch: { supported: true },
		bulk: { supported: false, maxOperations: 0, maxPayloadSize: 0 },
		filter: { supported: true, maxResults: MAX_PAGE },
		changePassword: { supported: false },
		sort: { supported: false },
		etag: { supported: false },
		authenticationSchemes: [{
			type: 'oauthbearertoken',
			name: 'OAuth Bearer Token',
			description: 'The per-team SCIM token generated in the team settings on three.ws.',
			specUri: 'https://www.rfc-editor.org/rfc/rfc6750',
			documentationUri: docsUrl,
			primary: true,
		}],
		meta: { resourceType: 'ServiceProviderConfig', location: `${baseUrl}/ServiceProviderConfig` },
	};
}

export function resourceTypes({ baseUrl }) {
	return [
		{
			schemas: [SCHEMA_RESOURCE_TYPE],
			id: 'User',
			name: 'User',
			endpoint: '/Users',
			description: 'A person with access to the team',
			schema: SCHEMA_USER,
			schemaExtensions: [{ schema: SCHEMA_ENTERPRISE_USER, required: false }],
			meta: { resourceType: 'ResourceType', location: `${baseUrl}/ResourceTypes/User` },
		},
		{
			schemas: [SCHEMA_RESOURCE_TYPE],
			id: 'Group',
			name: 'Group',
			endpoint: '/Groups',
			description: 'A directory group of team people',
			schema: SCHEMA_GROUP,
			meta: { resourceType: 'ResourceType', location: `${baseUrl}/ResourceTypes/Group` },
		},
	];
}

const attr = (name, type, extra = {}) => ({
	name,
	type,
	multiValued: false,
	required: false,
	caseExact: false,
	mutability: 'readWrite',
	returned: 'default',
	uniqueness: 'none',
	...extra,
});

export function schemas({ baseUrl }) {
	return [
		{
			schemas: [SCHEMA_SCHEMA],
			id: SCHEMA_USER,
			name: 'User',
			description: 'User Account (the attributes three.ws stores)',
			attributes: [
				attr('userName', 'string', { required: true, uniqueness: 'server' }),
				attr('externalId', 'string', { caseExact: true }),
				attr('displayName', 'string'),
				attr('name', 'complex', {
					subAttributes: [attr('givenName', 'string'), attr('familyName', 'string'), attr('formatted', 'string', { mutability: 'readOnly' })],
				}),
				attr('emails', 'complex', {
					multiValued: true,
					subAttributes: [attr('value', 'string'), attr('type', 'string', { canonicalValues: ['work'] }), attr('primary', 'boolean')],
				}),
				attr('active', 'boolean'),
			],
			meta: { resourceType: 'Schema', location: `${baseUrl}/Schemas/${SCHEMA_USER}` },
		},
		{
			schemas: [SCHEMA_SCHEMA],
			id: SCHEMA_GROUP,
			name: 'Group',
			description: 'Group',
			attributes: [
				attr('displayName', 'string', { required: true, uniqueness: 'server' }),
				attr('externalId', 'string', { caseExact: true }),
				attr('members', 'complex', {
					multiValued: true,
					subAttributes: [
						attr('value', 'string', { mutability: 'immutable' }),
						attr('display', 'string', { mutability: 'readOnly' }),
						attr('$ref', 'reference', { mutability: 'immutable', referenceTypes: ['User'] }),
					],
				}),
			],
			meta: { resourceType: 'Schema', location: `${baseUrl}/Schemas/${SCHEMA_GROUP}` },
		},
	];
}
