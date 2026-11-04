// A2A Agent Card rules: the JSON Schema plus the cross-field checks it cannot
// express. One module so the test (tests/a2a-agent-card.test.js), the local
// guard (npm run validate:a2a-card) and the card generators judge a card by the
// same rules and cannot drift.
//
// Two profiles:
//   public       public/.well-known/agent-card.json, read by every A2A client.
//   marketplace  dist/marketplace/agent-card.json, uploaded to Cloud Storage for
//                the Google Cloud Marketplace listing (owner-run, see
//                docs/ops/google-marketplace-agent-card.md). Same endpoint and
//                shape; enterprise wording, 3D skills only, listing metadata.

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import Ajv from 'ajv/dist/2020.js';
import addFormats from 'ajv-formats';

const here = path.dirname(fileURLToPath(import.meta.url));

export const A2A_CARD_SCHEMA = JSON.parse(
	readFileSync(path.join(here, 'a2a-agent-card.schema.json'), 'utf8'),
);

// The A2A endpoint every card advertises, and the protocol versions it speaks.
export const A2A_ENDPOINT_PATH = '/api/agents/a2a-paid';
export const A2A_CURRENT_PROTOCOL_VERSION = '1.0';
export const A2A_LEGACY_PROTOCOL_VERSION = '0.3.0';

// The listing-metadata extension the Marketplace card carries. Extensions are
// the spec's own place for agent-specific card data, so the models, competence
// and billing facts Google asks for travel there instead of as unknown
// top-level keys a strict parser would drop.
export const MARKETPLACE_LISTING_EXTENSION_URI = 'https://three.ws/a2a/extensions/marketplace-listing/v1';

// Wording that would make the enterprise card read as a payments or markets
// product. Generic terms only; callers add runtime terms (the live catalog's
// network names) through ctx.denyTerms.
export const MARKETPLACE_DENY_TERMS = [
	'crypto',
	'cryptocurrency',
	'defi',
	'on-chain',
	'onchain',
	'stablecoin',
	'token',
	'tokens',
	'blockchain',
	'wallet',
	'wallets',
	'micropayment',
	'micropayments',
	'x402',
	'memecoin',
	'airdrop',
	'trading',
	'market data',
	'mint',
];

let compiled = null;
function schemaValidator() {
	if (!compiled) {
		const ajv = new Ajv({ allErrors: true, strict: false });
		addFormats(ajv);
		compiled = ajv.compile(A2A_CARD_SCHEMA);
	}
	return compiled;
}

function escapeRe(s) {
	return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** Every human-readable string a listing reviewer or a model would read. */
export function cardProse(card) {
	const out = [card.name, card.description];
	for (const s of card.skills || []) {
		out.push(s.name, s.description, ...(s.tags || []), ...(s.examples || []));
	}
	return out.filter((v) => typeof v === 'string').join('\n');
}

function referencedSchemeNames(card) {
	const names = new Set();
	for (const req of card.securityRequirements || []) {
		for (const name of Object.keys(req?.schemes || {})) names.add(name);
	}
	for (const req of card.security || []) {
		for (const name of Object.keys(req || {})) names.add(name);
	}
	return names;
}

/**
 * The rules. Each check returns null when the card passes, or a sentence that
 * says what is wrong. ctx: { expectedVersion, endpointPath?, reachableSkillIds?,
 * denyTerms? }.
 */
export const A2A_CARD_RULES = [
	{
		id: 'schema',
		profiles: ['public', 'marketplace'],
		title: 'matches the A2A AgentCard JSON Schema',
		check(card) {
			const validate = schemaValidator();
			if (validate(card)) return null;
			return validate.errors
				.map((e) => `${e.instancePath || '/'} ${e.message}`)
				.slice(0, 12)
				.join('; ');
		},
	},
	{
		id: 'protocol-version',
		profiles: ['public', 'marketplace'],
		title: 'declares protocolVersion for 0.3 readers and a current 1.0 interface',
		check(card) {
			if (typeof card.protocolVersion !== 'string' || !card.protocolVersion) {
				return 'protocolVersion is missing';
			}
			const versions = (card.supportedInterfaces || []).map((i) => i?.protocolVersion);
			if (!versions.includes(A2A_CURRENT_PROTOCOL_VERSION)) {
				return `no supportedInterfaces entry declares protocolVersion ${A2A_CURRENT_PROTOCOL_VERSION}`;
			}
			if (!versions.includes(card.protocolVersion)) {
				return `top-level protocolVersion ${card.protocolVersion} has no matching supportedInterfaces entry`;
			}
			return null;
		},
	},
	{
		id: 'preferred-transport',
		profiles: ['public', 'marketplace'],
		title: 'prefers the JSON-RPC transport',
		check(card) {
			if (card.preferredTransport !== 'JSONRPC') {
				return `preferredTransport is ${JSON.stringify(card.preferredTransport)}, expected "JSONRPC"`;
			}
			const bindings = new Set((card.supportedInterfaces || []).map((i) => i?.protocolBinding));
			if (!bindings.has('JSONRPC')) return 'no supportedInterfaces entry uses the JSONRPC binding';
			return null;
		},
	},
	{
		id: 'endpoint-url',
		profiles: ['public', 'marketplace'],
		title: 'url is the absolute https A2A endpoint, and every interface points at it',
		check(card, ctx) {
			const endpointPath = ctx.endpointPath || A2A_ENDPOINT_PATH;
			let u;
			try {
				u = new URL(card.url);
			} catch {
				return `url ${JSON.stringify(card.url)} is not an absolute URL`;
			}
			if (u.protocol !== 'https:') return `url ${card.url} is not https`;
			if (u.pathname !== endpointPath) return `url ${card.url} does not end in ${endpointPath}`;
			const stray = (card.supportedInterfaces || []).filter((i) => i?.url !== card.url);
			if (stray.length) return `supportedInterfaces point elsewhere: ${stray.map((i) => i?.url).join(', ')}`;
			return null;
		},
	},
	{
		id: 'documentation-url',
		profiles: ['public', 'marketplace'],
		title: 'keeps the website reachable as documentationUrl',
		check(card) {
			return typeof card.documentationUrl === 'string' && card.documentationUrl.startsWith('https://')
				? null
				: 'documentationUrl is missing';
		},
	},
	{
		id: 'version',
		profiles: ['public', 'marketplace'],
		title: 'version equals the platform version in package.json',
		check(card, ctx) {
			return card.version === ctx.expectedVersion
				? null
				: `version is ${JSON.stringify(card.version)}, package.json says ${ctx.expectedVersion}`;
		},
	},
	{
		id: 'security',
		profiles: ['public', 'marketplace'],
		title: 'declares securitySchemes with matching security requirements, and no legacy authentication key',
		check(card) {
			if ('authentication' in card) return 'the pre-0.2 authentication key is still present';
			const schemes = card.securitySchemes;
			if (!schemes || typeof schemes !== 'object' || !Object.keys(schemes).length) {
				return 'securitySchemes is missing';
			}
			if (!Array.isArray(card.securityRequirements) || !card.securityRequirements.length) {
				return 'securityRequirements (1.0) is missing';
			}
			if (!Array.isArray(card.security) || !card.security.length) return 'security (0.3) is missing';
			const unknown = [...referencedSchemeNames(card)].filter((n) => !(n in schemes));
			if (unknown.length) return `security references undeclared schemes: ${unknown.join(', ')}`;
			const legacy = JSON.stringify(card.security.map((r) => Object.keys(r).sort()));
			const current = JSON.stringify(card.securityRequirements.map((r) => Object.keys(r.schemes || {}).sort()));
			if (legacy !== current) return 'security and securityRequirements disagree';
			return null;
		},
	},
	{
		id: 'extensions-optional',
		profiles: ['public', 'marketplace'],
		title: 'marks every extension optional',
		check(card) {
			const required = (card.capabilities?.extensions || []).filter((e) => e?.required === true);
			return required.length ? `required extensions: ${required.map((e) => e.uri).join(', ')}` : null;
		},
	},
	{
		id: 'skills',
		profiles: ['public', 'marketplace'],
		title: 'every skill has a unique id and is routed by the endpoint',
		check(card, ctx) {
			const ids = (card.skills || []).map((s) => s?.id);
			const dupes = ids.filter((id, i) => ids.indexOf(id) !== i);
			if (dupes.length) return `duplicate skill ids: ${[...new Set(dupes)].join(', ')}`;
			if (ctx.reachableSkillIds) {
				const reachable = new Set(ctx.reachableSkillIds);
				const dead = ids.filter((id) => !reachable.has(id));
				if (dead.length) return `skills the endpoint does not route: ${dead.join(', ')}`;
			}
			return null;
		},
	},
	{
		id: 'enterprise-wording',
		profiles: ['marketplace'],
		title: 'describes the 3D skills only, with no payments or markets wording',
		check(card, ctx) {
			const prose = cardProse(card);
			const terms = [...MARKETPLACE_DENY_TERMS, ...(ctx.denyTerms || [])];
			const hits = terms.filter((t) => new RegExp(`(?:^|[^a-z0-9])${escapeRe(t)}(?:$|[^a-z0-9])`, 'i').test(prose));
			return hits.length ? `card prose uses: ${[...new Set(hits)].join(', ')}` : null;
		},
	},
	{
		id: 'listing-metadata',
		profiles: ['marketplace'],
		title: 'carries the models, competence and billing facts the listing asks for',
		check(card) {
			const ext = (card.capabilities?.extensions || []).find((e) => e?.uri === MARKETPLACE_LISTING_EXTENSION_URI);
			if (!ext) return `the ${MARKETPLACE_LISTING_EXTENSION_URI} extension is missing`;
			const p = ext.params || {};
			if (!Array.isArray(p.models) || !p.models.length) return 'params.models is empty';
			const badModel = p.models.find((m) => !m?.name || !m?.provider || !m?.role);
			if (badModel) return `a model entry lacks name, provider or role: ${JSON.stringify(badModel)}`;
			if (!p.models.some((m) => m.default === true)) return 'no model is marked as the default';
			if (!Array.isArray(p.competence) || !p.competence.length) return 'params.competence is empty';
			if (!/google/i.test(String(p.billing?.invoicedBy || ''))) return 'params.billing.invoicedBy does not name Google';
			return null;
		},
	},
];

/** Run every rule for a profile; returns [{ id, title, problem }] for failures. */
export function validateA2ACard(card, ctx = {}, { profile = 'public' } = {}) {
	const failures = [];
	for (const rule of A2A_CARD_RULES) {
		if (!rule.profiles.includes(profile)) continue;
		const problem = rule.check(card, ctx);
		if (problem) failures.push({ id: rule.id, title: rule.title, problem });
	}
	return failures;
}
