// The vetted catalog of external MCP servers an agent can be connected to.
//
// Source of truth: data/mcp-catalog.json. Every remote entry was probed
// live by scripts/vet-mcp-integrations.mjs (initialize, then either tools/list
// for an open server or RFC 9728 / RFC 8414 discovery for a protected one), and
// `npm run check:mcp-catalog` fails the build on a malformed entry.
//
// Not to be confused with public/mcp-catalog.json, which lists the tools
// three.ws itself publishes. This file lists servers other people run.

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

export const CATALOG_PATH = fileURLToPath(new URL('../../../data/mcp-catalog.json', import.meta.url));

export const TRANSPORTS = Object.freeze(['streamable-http', 'sse', 'stdio']);
export const AUTH_TYPES = Object.freeze(['oauth', 'bearer', 'none']);
export const REGISTRATIONS = Object.freeze(['dynamic', 'platform']);
const ID_RE = /^[a-z0-9][a-z0-9-]{1,38}[a-z0-9]$/;
// The catalog lists general developer and productivity vendors. Crypto
// projects are out of scope: the platform promotes one coin, and an entry for
// any other project would be an endorsement shipped to every agent owner.
const OUT_OF_SCOPE_RE = /\b(blockchain|crypto(currency)?|defi|nfts?|web3|on-?chain|coins?|wallets?|dex)\b/i;
const ENV_RE = /^[A-Z][A-Z0-9_]{2,60}$/;

function isHttps(u) {
	try {
		return new URL(u).protocol === 'https:';
	} catch {
		return false;
	}
}

function checkRules(rules, where, errors) {
	if (rules == null) return;
	if (typeof rules !== 'object' || Array.isArray(rules)) {
		errors.push(`${where}.tiers must be an object of glob lists`);
		return;
	}
	for (const [tier, list] of Object.entries(rules)) {
		if (!['read', 'write', 'financial'].includes(tier)) errors.push(`${where}.tiers.${tier} is not a tier`);
		else if (!Array.isArray(list) || !list.every((g) => typeof g === 'string' && /^[A-Za-z0-9_*.-]+$/.test(g))) {
			errors.push(`${where}.tiers.${tier} must be a list of name globs`);
		}
	}
}

/**
 * Validate a catalog document. Returns a list of human-readable errors; empty means valid.
 * @param {any} doc
 * @returns {string[]}
 */
export function validateCatalog(doc) {
	const errors = [];
	if (!doc || typeof doc !== 'object') return ['catalog must be a JSON object'];
	if (doc.version !== 1) errors.push('version must be 1');
	if (!/^\d{4}-\d{2}-\d{2}$/.test(String(doc.updated || ''))) errors.push('updated must be YYYY-MM-DD');
	const categories = new Set();
	for (const c of doc.categories || []) {
		if (!c?.id || !c?.label) errors.push('every category needs id and label');
		else if (categories.has(c.id)) errors.push(`duplicate category ${c.id}`);
		else categories.add(c.id);
	}
	if (!Array.isArray(doc.servers) || doc.servers.length < 60) errors.push('servers must list at least 60 vetted entries');
	const ids = new Set();
	for (const [i, s] of (doc.servers || []).entries()) {
		const at = `servers[${i}]${s?.id ? ` (${s.id})` : ''}`;
		if (!s || typeof s !== 'object') {
			errors.push(`${at} is not an object`);
			continue;
		}
		if (!ID_RE.test(String(s.id || ''))) errors.push(`${at}.id must be a 3-40 char lowercase slug`);
		else if (ids.has(s.id)) errors.push(`${at}.id is a duplicate`);
		ids.add(s.id);
		for (const f of ['name', 'vendor', 'description']) {
			if (typeof s[f] !== 'string' || !s[f].trim()) errors.push(`${at}.${f} is required`);
		}
		if (typeof s.description === 'string' && s.description.length > 200) errors.push(`${at}.description is over 200 characters`);
		if (OUT_OF_SCOPE_RE.test([s.id, s.name, s.vendor, s.description].join(' '))) {
			errors.push(`${at} looks like a crypto project; the catalog lists general developer and productivity servers only`);
		}
		if (!categories.has(s.category)) errors.push(`${at}.category ${s.category} is not declared`);
		if (!TRANSPORTS.includes(s.transport)) errors.push(`${at}.transport must be one of ${TRANSPORTS.join(', ')}`);
		if (!isHttps(s.docs)) errors.push(`${at}.docs must be an https link`);
		if (typeof s.official !== 'boolean') errors.push(`${at}.official must be a boolean`);
		if (s.toolCount !== null && !(Number.isInteger(s.toolCount) && s.toolCount >= 0)) errors.push(`${at}.toolCount must be null or a count`);

		if (s.transport === 'stdio') {
			const p = s.package;
			if (s.url !== null) errors.push(`${at}.url must be null for a stdio server`);
			if (!p || !['npm', 'pypi'].includes(p.registry) || !p.name || !p.command || !Array.isArray(p.args)) {
				errors.push(`${at}.package needs registry (npm|pypi), name, command and args`);
			}
			for (const e of p?.env || []) if (!ENV_RE.test(String(e?.name || ''))) errors.push(`${at}.package.env has a bad name`);
		} else {
			if (!isHttps(s.url)) errors.push(`${at}.url must be https`);
			if (s.package !== null) errors.push(`${at}.package must be null for a remote server`);
		}

		const a = s.auth;
		if (!a || !AUTH_TYPES.includes(a.type)) {
			errors.push(`${at}.auth.type must be one of ${AUTH_TYPES.join(', ')}`);
		} else {
			if (a.type === 'oauth' && !REGISTRATIONS.includes(a.registration)) errors.push(`${at}.auth.registration must be dynamic or platform`);
			if (a.registration === 'platform' && !ENV_RE.test(String(a.clientEnv || ''))) errors.push(`${at}.auth.clientEnv names the platform client env prefix`);
			if ((a.type === 'bearer' || a.alt === 'bearer') && !a.tokenHelp) errors.push(`${at}.auth.tokenHelp tells the owner where to get a token`);
			if (a.header && !/^[A-Za-z0-9-]{2,60}$/.test(a.header)) errors.push(`${at}.auth.header is not a header name`);
		}
		checkRules(s.tiers, at, errors);
	}
	return errors;
}

let cached = null;

/** The parsed, validated catalog. Throws if the committed file is invalid. */
export function loadCatalog() {
	if (cached) return cached;
	const doc = JSON.parse(readFileSync(CATALOG_PATH, 'utf8'));
	const errors = validateCatalog(doc);
	if (errors.length) throw new Error(`data/mcp-catalog.json is invalid: ${errors.slice(0, 5).join('; ')}`);
	cached = doc;
	return doc;
}

/** One catalog entry by id, or null. */
export function getCatalogEntry(id) {
	return loadCatalog().servers.find((s) => s.id === id) || null;
}

/** Whether the platform holds an OAuth client for a `registration: platform` entry. */
export function platformClientConfigured(entry, env = process.env) {
	if (entry?.auth?.registration !== 'platform') return true;
	return Boolean(env[`${entry.auth.clientEnv}_CLIENT_ID`]);
}

/**
 * The public shape of one entry, with whether it can be connected server-side
 * right now. Never exposes env names beyond the documented prefix.
 */
export function presentEntry(entry, env = process.env) {
	const oauthReady = entry.auth.type !== 'oauth' || platformClientConfigured(entry, env);
	return {
		...entry,
		runtime: entry.transport === 'stdio' ? 'local' : 'hosted',
		connectable: entry.transport !== 'stdio' && (oauthReady || entry.auth.alt === 'bearer'),
		oauthAvailable: entry.auth.type === 'oauth' && oauthReady,
	};
}
