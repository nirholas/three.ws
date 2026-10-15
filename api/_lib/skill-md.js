// Generates the SKILL-MD 1.0 document (https://github.com/nirholas/x402-skill-md)
// served at /.well-known/skill.md: an agent-readable index of every priced
// HTTP endpoint on three.ws, built straight from the same data the live
// /openapi.json and /.well-known/x402.json documents serve, so the three
// never drift apart.
//
// Not to be confused with /skill.md (public/skill.md), the pre-existing
// Agent Skills (agentskills.io) connector file: that one tells a model how to
// install three.ws's MCP servers and SKILL.md bundles. This generator answers
// a narrower, x402-specific question: which HTTP routes are paid, what they
// cost, and how to pay for them without a human in the loop.
import { env } from './env.js';
import { buildOpenApiDoc } from '../openapi-json.js';
import { buildExactRequirements, X402_VERSION } from './x402-spec.js';

function priceLiteral(price) {
	if (!price) return 'free';
	const amount = price.mode === 'dynamic' ? (price.min ?? price.amount) : price.amount;
	const n = Number(amount);
	if (!Number.isFinite(n) || n <= 0) return 'free';
	return `$${amount}`;
}

function paidOperations(doc) {
	const ops = [];
	for (const [path, item] of Object.entries(doc.paths || {})) {
		for (const [verb, op] of Object.entries(item || {})) {
			if (!op || typeof op !== 'object' || !op['x-payment-info']) continue;
			ops.push({ method: verb.toUpperCase(), path, op });
		}
	}
	ops.sort((a, b) => (a.path === b.path ? a.method.localeCompare(b.method) : a.path.localeCompare(b.path)));
	return ops;
}

function paramTable(parameters) {
	if (!Array.isArray(parameters) || parameters.length === 0) return '';
	const rows = parameters.map((p) => {
		const type = p.schema?.type || 'string';
		const required = p.required ? 'yes' : 'no';
		const desc = (p.description || '').replace(/\|/g, '\\|').replace(/\n/g, ' ');
		return `| \`${p.name}\` | ${p.in} | ${type} | ${required} | ${desc} |`;
	});
	return ['| Name | In | Type | Required | Description |', '| --- | --- | --- | --- | --- |', ...rows].join(
		'\n',
	);
}

function endpointSection(origin, { method, path, op }) {
	const price = priceLiteral(op['x-payment-info']?.price);
	const heading = `## \`${method} ${path}\` - ${price}`;
	const lines = [heading, ''];

	const description = op.description || op.summary || '';
	if (description) lines.push(description, '');

	const dynamicPrice = op['x-payment-info']?.price;
	if (dynamicPrice?.mode === 'dynamic') {
		lines.push(
			`Price varies by request from $${dynamicPrice.min} up to $${dynamicPrice.max} ${dynamicPrice.currency}; the heading above shows the floor.`,
			'',
		);
	}

	const table = paramTable(op.parameters);
	if (table) lines.push(table, '');

	const okDescription = op.responses?.['200']?.description;
	if (okDescription) lines.push(`Returns: ${okDescription}.`, '');

	lines.push(`Full request/response schema: ${origin}/openapi.json#/paths/${encodeURIComponent(path)}.`, '');
	return lines.join('\n').trimEnd();
}

function paymentSection(origin) {
	const exampleResource = `${origin}/api/x402/model-check`;
	const accepts = buildExactRequirements(exampleResource, '1000');
	const solana = accepts.find((a) => a.network.startsWith('solana'));
	const base = accepts.find((a) => a.network.startsWith('eip155'));

	const lines = [
		'## Payment',
		'',
		'three.ws speaks x402Version: 2 (protocol x402, scheme `exact`) over plain HTTP 402. ' +
			'Solana is the home chain and settles through an always-on facilitator; the base (EVM) rail ' +
			'settles only on deployments with a working Coinbase facilitator configured.',
		'',
		'| Rail | Network | Asset | payTo | Fee payer |',
		'| --- | --- | --- | --- | --- |',
		solana
			? `| Solana | solana mainnet | ${solana.extra?.name || 'USDC'} (\`${solana.asset}\`) | \`${solana.payTo}\` | \`${solana.extra?.feePayer}\` |`
			: '| Solana | solana mainnet | USDC | not currently configured on this deployment | - |',
		base
			? `| Base (EVM) | base mainnet | ${base.extra?.name || 'USDC'} (\`${base.asset}\`) | \`${base.payTo}\` | n/a (buyer-signed) |`
			: '| Base (EVM) | base mainnet | USDC | not currently enabled on this deployment (needs a configured facilitator) | n/a |',
		'',
		'A 402 challenge for a $0.001 call looks like this:',
		'',
		'```json',
		JSON.stringify(
			{
				x402Version: X402_VERSION,
				error: 'X-PAYMENT header is required',
				accepts,
			},
			null,
			2,
		),
		'```',
		'',
		`Full manifest, including every resource's live accepts[]: ${origin}/.well-known/x402.json.`,
	];
	return lines.join('\n');
}

export function generateSkillMd(origin = env.APP_ORIGIN) {
	const doc = buildOpenApiDoc(origin);
	const ops = paidOperations(doc);

	const parts = [
		'---',
		'skillMd: "1.0"',
		'name: three.ws',
		'license: MIT',
		'---',
		'',
		'# three.ws',
		'',
		`three.ws is a 3D generation, crypto-data and agent-launch platform reachable entirely over HTTP ` +
			`and MCP. This file documents every paid route an autonomous agent can call directly: its price, ` +
			`its parameters, and the Solana and Base rails it settles on. Agents, not browsers, are the ` +
			`primary audience; the free discovery routes below need no payment at all.`,
		'',
		`- **Base URL:** ${origin}`,
		`- **OpenAPI:** ${origin}/openapi.json`,
		`- **x402 manifest:** ${origin}/.well-known/x402.json`,
		`- **Contact:** ${origin} (see /docs/start-here for support channels)`,
		'',
		paymentSection(origin),
		'',
		'## Free routes',
		'',
		'No payment required for discovery:',
		'',
		`- \`GET /\` - the platform homepage`,
		`- \`GET /openapi.json\` - this catalog as an OpenAPI 3.1 document`,
		`- \`GET /.well-known/x402.json\` - every paid resource with its live accepts[] array`,
		`- \`GET /.well-known/skill.md\` - this document`,
		`- \`GET /llms.txt\` - a curated index of the platform for language models`,
		'',
		...ops.map((entry) => endpointSection(origin, entry)),
		'## Errors',
		'',
		'| Status | Meaning |',
		'| --- | --- |',
		'| 400 | Missing or invalid request parameters. |',
		'| 402 | Payment required: pay one of the accepts[] rails above and retry with an X-PAYMENT header. |',
		'| 404 | Unknown resource or record. |',
		'| 429 | Rate limited; back off and retry. |',
		'| 500 | Upstream or internal failure; safe to retry. |',
		'',
		'## Data source',
		'',
		'Every endpoint above calls a live production handler: real model-generation pipelines, real ' +
			'on-chain data, real database records. None of it is a fixture, a cache-only demo, or a stub ' +
			'response; a payment always buys a real computation or a real query.',
		'',
	];

	return parts.join('\n');
}
