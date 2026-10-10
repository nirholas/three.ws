// Web-domain MCP tools: search, check, price, register and connect.
//
// The backend is Google Cloud Domains (api/_lib/cloud-domains.js) behind
// api/_lib/domains-service.js, the same library the REST API uses
// (api/domains/[action].js), so quotas, caching, the credit debit and the audit
// trail are identical on both surfaces.
//
// domain_register_quote is the preview: it runs the registrar's own validation
// (register with validateOnly) and the policy layer stamps a quote_id on its
// result. domain_register spends credits, so it needs that quote_id, the same
// domain/term/privacy, expected_price_usd, an idempotency_key and
// confirm_spend: true. See docs/domains.md.

import { connectDomain, connectStatus } from '../../_lib/domain-connect.js';
import {
	DomainsError,
	domainCheck,
	domainPricing,
	domainSearch,
	quoteRegistration,
	registerWithCredits,
	registrationStatus,
} from '../../_lib/domains-service.js';
import { limits } from '../../_lib/rate-limit.js';

const READ = { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true };
const WRITE = { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true };
const MONEY = { readOnlyHint: false, destructiveHint: true, idempotentHint: true, openWorldHint: true };

const CONTACT = {
	type: 'object',
	description: 'The registrant. Used for the registrant, admin and technical contacts. Hidden from the public WHOIS where the TLD allows it.',
	properties: {
		name: { type: 'string', maxLength: 120 },
		email: { type: 'string', maxLength: 254 },
		phone: { type: 'string', description: 'International format, like +14155550123.' },
		address_lines: { type: 'array', items: { type: 'string', maxLength: 120 }, minItems: 1, maxItems: 3 },
		city: { type: 'string', maxLength: 80 },
		region: { type: 'string', maxLength: 80, description: 'State or province, where the country has one.' },
		postal_code: { type: 'string', maxLength: 20 },
		country: { type: 'string', minLength: 2, maxLength: 2, description: 'Two-letter country code, like US.' },
	},
	required: ['name', 'email', 'phone', 'address_lines', 'city', 'postal_code', 'country'],
	additionalProperties: false,
};

const REGISTER_PROPS = {
	domain: { type: 'string', maxLength: 253, description: 'Fully-qualified name, like orbit.app.' },
	contact: CONTACT,
	auto_renew: { type: 'boolean', default: false, description: 'Renew each year from credits, 14 days before expiry. Off: the name expires after the one-year term.' },
	privacy: { type: 'string', enum: ['REDACTED_CONTACT_DATA', 'PRIVATE_CONTACT_DATA', 'PUBLIC_CONTACT_DATA'], description: 'WHOIS privacy. Defaults to the most private mode the TLD supports.' },
	agent_id: { type: 'string', format: 'uuid', description: 'Agent this domain is for (from list_my_agents). Optional.' },
};

function ok(structured, text) {
	return { content: [{ type: 'text', text: text || JSON.stringify(structured, null, 2) }], structuredContent: structured };
}

function failure(e) {
	if (e instanceof DomainsError || (e?.status && e.status < 500 && e?.code)) {
		const structured = { error: e.code || 'bad_request', message: e.message, ...(e.detail ? { detail: e.detail } : {}) };
		return { content: [{ type: 'text', text: `Error (${structured.error}): ${e.message}` }], structuredContent: structured, isError: true };
	}
	throw e;
}

function needsAccount() {
	return {
		content: [{ type: 'text', text: 'Connect a three.ws account (OAuth or API key) to register a domain.' }],
		structuredContent: { error: 'unauthorized' },
		isError: true,
	};
}

// Every uncached lookup is a metered registrar request, so callers (anonymous
// ones included) get an hourly budget.
async function lookupLimited(auth) {
	const rl = await limits.domainsLookup(String(auth?.userId || auth?.rateKey || 'anon'));
	if (rl.success) return null;
	return failure(new DomainsError('Domain lookups are limited per hour. Try again shortly.', { status: 429, code: 'rate_limited', detail: { retryAfterSeconds: Math.max(1, Math.ceil((rl.reset - Date.now()) / 1000)) } }));
}

export const toolDefs = [
	{
		name: 'domain_search',
		title: 'Search web domains',
		group: 'domains',
		annotations: READ,
		description:
			'Suggest web domains for a name across TLDs, live from Google Cloud Domains. Each result gives availability, the yearly registration price and the renewal price (registrations are one year, so they are the same figure). Pass tlds to also check the exact name on those extensions (up to 6). Searches are cached and the registrar allows a limited number of live requests a day.',
		inputSchema: {
			type: 'object',
			properties: {
				query: { type: 'string', minLength: 1, maxLength: 80, description: 'A name or idea, like "orbit" or "Orbit Labs".' },
				tlds: { type: 'array', items: { type: 'string', maxLength: 24 }, maxItems: 6, description: 'Extensions to check the exact name on, like ["com","xyz"].' },
				limit: { type: 'integer', minimum: 1, maximum: 40, default: 20 },
			},
			required: ['query'],
			additionalProperties: false,
		},
		async handler(args, auth) {
			const limited = await lookupLimited(auth);
			if (limited) return limited;
			try {
				return ok(await domainSearch(args.query, { tlds: args.tlds, limit: args.limit ?? 20 }));
			} catch (e) {
				return failure(e);
			}
		},
	},
	{
		name: 'domain_check',
		title: 'Check one web domain',
		group: 'domains',
		annotations: READ,
		description:
			'One answer for one fully-qualified name: available or not, with a clear reason when it is not (already registered, or an extension the registrar does not sell), the exact yearly registration and renewal price, the WHOIS privacy modes the TLD supports and any notices a registration must acknowledge.',
		inputSchema: {
			type: 'object',
			properties: { domain: { type: 'string', maxLength: 253, description: 'Fully-qualified name, like orbit.app.' } },
			required: ['domain'],
			additionalProperties: false,
		},
		async handler(args, auth) {
			const limited = await lookupLimited(auth);
			if (limited) return limited;
			try {
				return ok(await domainCheck(args.domain));
			} catch (e) {
				return failure(e);
			}
		},
	},
	{
		name: 'domain_pricing',
		title: 'List domain TLD pricing',
		group: 'domains',
		annotations: READ,
		description:
			'The extensions Google Cloud Domains sells with their yearly registration and renewal price, cheapest first. Served from a snapshot of the registrar (so it costs no live requests); the response says when it was taken. Filter with tld or max_price_usd. A specific name can price above its extension (premium names), so use domain_check for the exact figure.',
		inputSchema: {
			type: 'object',
			properties: {
				tld: { type: 'string', maxLength: 24, description: 'One extension, like "app".' },
				max_price_usd: { type: 'number', minimum: 0 },
				limit: { type: 'integer', minimum: 1, maximum: 300, default: 100 },
			},
			additionalProperties: false,
		},
		async handler(args) {
			return ok(domainPricing({ tld: args.tld, maxPriceUsd: args.max_price_usd, limit: args.limit ?? 100 }));
		},
	},
	{
		name: 'domain_register_quote',
		title: 'Quote a domain registration',
		group: 'domains',
		tier: 'write',
		scope: 'wallet:read',
		annotations: WRITE,
		description:
			'Price a domain registration without buying it: the exact yearly price, the one-year term, the renewal terms for your auto_renew choice, the privacy mode, the notices that apply and your credit balance. It validates the registration with the registrar (validate-only), so a bad contact or an unavailable name fails here, before any spend. Show the result to the owner; domain_register needs the quote_id this returns.',
		inputSchema: {
			type: 'object',
			properties: { ...REGISTER_PROPS },
			required: ['domain', 'contact'],
			additionalProperties: false,
		},
		async handler(args, auth) {
			if (!auth?.userId) return needsAccount();
			const limited = await lookupLimited(auth);
			if (limited) return limited;
			try {
				return ok(await quoteRegistration({ userId: auth.userId, domain: args.domain, contact: args.contact, autoRenew: args.auto_renew, privacy: args.privacy }));
			} catch (e) {
				return failure(e);
			}
		},
	},
	{
		name: 'domain_register',
		title: 'Register a domain (spends credits)',
		group: 'domains',
		tier: 'financial',
		confirmFlag: 'confirm_spend',
		previewTool: 'domain_register_quote',
		scope: 'wallet:write',
		annotations: MONEY,
		description:
			'Register the domain domain_register_quote priced, paying the exact yearly price from your prepaid credits (refunded in full if the registrar fails). Requires the quote_id from the quote, the same domain/auto_renew/privacy, expected_price_usd from the quote, an idempotency_key (a retry returns the same registration, never a second charge) and confirm_spend: true, which you may only send after the owner explicitly approved the quote. Registration is asynchronous: poll domain_status until it is active.',
		inputSchema: {
			type: 'object',
			properties: {
				...REGISTER_PROPS,
				expected_price_usd: { type: 'number', minimum: 0, description: 'priceUsd from the quote. If the live price differs, nothing is charged.' },
				idempotency_key: { type: 'string', minLength: 8, maxLength: 128, description: 'A unique key for this purchase. Reuse it on a retry.' },
				quote_id: { type: 'string', description: 'From domain_register_quote.' },
				confirm_spend: { type: 'boolean', description: 'Must be true, and only after the owner said yes to the quote.' },
			},
			required: ['domain', 'contact', 'expected_price_usd', 'idempotency_key', 'quote_id', 'confirm_spend'],
			additionalProperties: false,
		},
		async handler(args, auth) {
			if (!auth?.userId) return needsAccount();
			const rl = await limits.domainsRegister(String(auth.userId));
			if (!rl.success) return failure(new DomainsError('Too many registration attempts this hour.', { status: 429, code: 'rate_limited' }));
			try {
				const out = await registerWithCredits({
					userId: auth.userId,
					domain: args.domain,
					contact: args.contact,
					autoRenew: args.auto_renew,
					privacy: args.privacy,
					expectedPriceUsd: args.expected_price_usd,
					confirm: true,
					idempotencyKey: args.idempotency_key,
					agentId: args.agent_id || null,
					source: 'mcp',
				});
				return ok(out);
			} catch (e) {
				return failure(e);
			}
		},
	},
	{
		name: 'domain_status',
		title: 'Poll a domain registration',
		group: 'domains',
		scope: 'wallet:read',
		annotations: READ,
		description: 'The state of a registration you started: registering, active (with its expiry) or failed (credits refunded). Polls the registrar and settles the registration. Pass the registration id from domain_register or the domain name.',
		inputSchema: {
			type: 'object',
			properties: { id: { type: 'string', format: 'uuid' }, domain: { type: 'string', maxLength: 253 } },
			additionalProperties: false,
		},
		async handler(args, auth) {
			if (!auth?.userId) return needsAccount();
			if (!args.id && !args.domain) return failure(new DomainsError('Pass the registration id or the domain.', { code: 'bad_request' }));
			try {
				return ok(await registrationStatus({ userId: auth.userId, id: args.id, domain: args.domain }));
			} catch (e) {
				return failure(e);
			}
		},
	},
	{
		name: 'domain_connect',
		title: 'Connect a domain to an agent page',
		group: 'domains',
		tier: 'write',
		scope: 'agents:write',
		annotations: WRITE,
		description:
			"Serve an agent's public page on a domain you registered here: creates the DNS zone and records, points the registration at it, issues a managed HTTPS certificate on the load balancer and routes the host to the agent. Idempotent. The domain must be an active registration on your account. Follow with domain_connect_status until the host is live.",
		inputSchema: {
			type: 'object',
			properties: { domain: { type: 'string', maxLength: 253 }, agent_id: { type: 'string', format: 'uuid', description: 'Agent UUID (from list_my_agents).' } },
			required: ['domain', 'agent_id'],
			additionalProperties: false,
		},
		async handler(args, auth) {
			if (!auth?.userId) return needsAccount();
			try {
				return ok(await connectDomain({ userId: auth.userId, agentId: args.agent_id, domain: args.domain }));
			} catch (e) {
				return failure(e);
			}
		},
	},
	{
		name: 'domain_connect_status',
		title: 'Check a connected domain',
		group: 'domains',
		scope: 'agents:read',
		annotations: READ,
		description: 'Whether a connected domain is live: the certificate state, the DNS nameservers in use and the URL once HTTPS is serving. Promotes the host to live when its certificate turns active.',
		inputSchema: { type: 'object', properties: { domain: { type: 'string', maxLength: 253 } }, required: ['domain'], additionalProperties: false },
		async handler(args, auth) {
			if (!auth?.userId) return needsAccount();
			try {
				return ok(await connectStatus({ userId: auth.userId, domain: args.domain }));
			} catch (e) {
				return failure(e);
			}
		},
	},
];
