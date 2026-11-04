// Regenerate the static discovery cards in public/ from the live service
// catalog (api/_lib/service-catalog/), so the cards agents and crawlers read
// can never drift from what the platform actually sells.
//
// Why: these files went stale for weeks — agent-registration.json advertised
// ONE paid x402 endpoint while /.well-known/x402.json (rendered live from the
// catalog) advertised 40+, and every description still said "3D model viewer"
// from the pre-agent-economy era. Static files need a generator or they rot.
//
// What it patches (surgically — hand-authored fields are preserved):
//   • public/.well-known/agent-registration.json — description + the FULL
//     x402Endpoints list projected from the catalog (url, method, useCase,
//     networks, scheme, priceUsdc). `registrations` (on-chain write-back,
//     owned by scripts/erc8004-register-self.mjs) is left untouched.
//   • public/.well-known/agent-card.json: rebuilt whole as an A2A card (url,
//     interfaces, version, securitySchemes, optional x402 extension) with the
//     skills the endpoint routes, the `x402-service-catalog` one carrying live
//     counts by category. Validated before it is written.
//   • public/.well-known/ai-plugin.json: descriptions, brand logo, and legal
//     URL from scripts/lib/discovery-copy.mjs (free 3D lane first, optional
//     paid catalog second, with the live paid count).
//   • public/crypto-agent-manifest.json — repoints the dead cdn.three.ws host (no DNS; the first-party CDN is /cdn/<r2-key>)
//     sample body at the live default avatar and pins a current model id.
//
// Run: npm run build:discovery   (wired into prebuild so every deploy is fresh)

import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

import { pluginDescriptions, PLUGIN_LOGO_URL, PLUGIN_LEGAL_URL } from './lib/discovery-copy.mjs';
import {
	A2A_CURRENT_PROTOCOL_VERSION,
	A2A_ENDPOINT_PATH,
	A2A_LEGACY_PROTOCOL_VERSION,
	validateA2ACard,
} from './lib/a2a-card-rules.mjs';
import { A2A_SKILLS, A2A_SKILL_IDS, cardSkill, skillById } from '../api/_lib/a2a/skills.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const { getCatalog } = await import(path.join(root, 'api/_lib/service-catalog/index.js'));
const pkg = JSON.parse(readFileSync(path.join(root, 'package.json'), 'utf8'));

const SITE = 'https://three.ws';
// The a2a-x402 extension URI the endpoint negotiates (api/_lib/x402/a2a-server.js).
const A2A_X402_EXTENSION_URI = 'https://github.com/google-a2a/a2a-x402/v0.1';
const A2A_DOCUMENTATION_URL = `${SITE}/docs/a2a-agent`;

const DESCRIPTION =
	'three.ws: the 3D agent economy. Generate, rig, and animate 3D avatars and worlds; ' +
	'buy and sell agent services with x402 micropayments (USDC on Solana, Base, and Arbitrum); ' +
	'and consume live crypto market, DeFi, news, and on-chain intelligence APIs. ' +
	'Machine-readable paid-service catalog at https://three.ws/.well-known/x402.json.';

function readJson(rel) {
	return JSON.parse(readFileSync(path.join(root, rel), 'utf8'));
}

function writeJson(rel, value, { indent = '\t' } = {}) {
	writeFileSync(path.join(root, rel), `${JSON.stringify(value, null, indent)}\n`);
	console.log(`[discovery-cards] wrote ${rel}`);
}

const catalog = await getCatalog();
const paid = catalog.filter((e) => e.source === 'x402' && e.status === 'live');
if (paid.length < 40) {
	// The catalog rendering broke once before (empty-catalog bug, prompt 10) —
	// refuse to "regenerate" the cards down to a stub instead of shipping rot.
	throw new Error(`suspiciously small paid catalog (${paid.length} entries) — refusing to regenerate`);
}

// ── agent-registration.json (ERC-8004 registration-v1) ──────────────────────
{
	const reg = readJson('public/.well-known/agent-registration.json');
	reg.description = DESCRIPTION;
	reg.x402Endpoints = paid.map((e) => ({
		url: e.endpoint,
		method: e.method,
		description: e.useCase,
		networks: e.price.networks,
		scheme: 'exact',
		priceUsdc: e.price.usd,
	}));
	writeJson('public/.well-known/agent-registration.json', reg);
}

// ── agent-card.json (A2A card with the a2a-x402 extension) ───────────────────
// Rebuilt in full on every run, in A2A field order, so a stale hand edit (the
// website as `url`, an old `version`, the pre-0.2 `authentication` block, a
// required payment extension, skills the endpoint never routed) cannot survive
// a build. Skills come from the registry the endpoint dispatches on
// (api/_lib/a2a/skills.js); the card is checked by the same rules as
// tests/a2a-agent-card.test.js before it is written.
{
	const previous = readJson('public/.well-known/agent-card.json');
	const endpoint = `${SITE}${A2A_ENDPOINT_PATH}`;
	const byCategory = new Map();
	for (const e of paid) byCategory.set(e.category, (byCategory.get(e.category) || 0) + 1);
	const categorySummary = [...byCategory.entries()]
		.sort((a, b) => b[1] - a[1])
		.map(([cat, n]) => `${cat} (${n})`)
		.join(', ');
	const generated = {
		...cardSkill(skillById('x402-service-catalog')),
		description:
			`${paid.length} pay-per-call services settled via x402 (USDC on Solana, Base, and Arbitrum): ` +
			`${categorySummary}. Every service is listed with price, input schema, and output example ` +
			'in the machine-readable discovery document: fetch it, pick a service, and pay the 402 challenge.',
		examples: [
			'Fetch https://three.ws/.well-known/x402.json and list the market-data services',
			'Pay the 402 challenge on /api/x402/token-intel to get a token signal',
		],
	};
	const card = {
		name: previous.name || 'three.ws',
		description: DESCRIPTION,
		url: endpoint,
		preferredTransport: 'JSONRPC',
		protocolVersion: A2A_LEGACY_PROTOCOL_VERSION,
		supportedInterfaces: [
			{ url: endpoint, protocolBinding: 'JSONRPC', protocolVersion: A2A_CURRENT_PROTOCOL_VERSION },
			{ url: endpoint, protocolBinding: 'JSONRPC', protocolVersion: A2A_LEGACY_PROTOCOL_VERSION },
		],
		provider: { organization: 'three.ws', url: `${SITE}/` },
		iconUrl: PLUGIN_LOGO_URL,
		documentationUrl: A2A_DOCUMENTATION_URL,
		version: pkg.version,
		capabilities: {
			streaming: false,
			pushNotifications: false,
			stateTransitionHistory: false,
			extensions: [
				{
					uri: A2A_X402_EXTENSION_URI,
					description:
						'Optional. Activate it to call the pay-per-call skills: the first call returns the payment ' +
						'requirements and the retry with a signed payment payload settles and runs. Free skills ' +
						'never need it.',
					required: false,
				},
			],
		},
		securitySchemes: {
			bearer: {
				type: 'http',
				scheme: 'bearer',
				description:
					'Optional three.ws API key (sk_live_...) or session token. Anonymous calls work and are rate ' +
					'limited per IP; a valid key is limited per account instead and raises the search result cap. ' +
					'An invalid key is rejected with 401.',
			},
		},
		security: [{}, { bearer: [] }],
		securityRequirements: [{ schemes: {} }, { schemes: { bearer: { list: [] } } }],
		defaultInputModes: ['text/plain', 'application/json'],
		defaultOutputModes: ['application/json', 'text/plain'],
		skills: A2A_SKILLS.map((entry) => (entry.id === generated.id ? generated : cardSkill(entry))),
	};
	const failures = validateA2ACard(card, { expectedVersion: pkg.version, reachableSkillIds: A2A_SKILL_IDS });
	if (failures.length) {
		throw new Error(
			`public agent card fails the A2A rules, refusing to write it:\n${failures
				.map((f) => `  ${f.id}: ${f.problem}`)
				.join('\n')}`,
		);
	}
	writeJson('public/.well-known/agent-card.json', card);
}

// ── ai-plugin.json ───────────────────────────────────────────────────────────
// Copy (and the brand/legal URLs) live in scripts/lib/discovery-copy.mjs so the
// committed manifest and this generator can be pinned to each other by
// tests/wellknown-manifests.test.js. The descriptions state the free, keyless
// 3D lane first and the optional paid catalog second: readers used to come away
// believing every three.ws capability, generation included, was pay-per-call.
{
	const plugin = readJson('public/.well-known/ai-plugin.json');
	Object.assign(plugin, pluginDescriptions(paid.length));
	plugin.logo_url = PLUGIN_LOGO_URL;
	plugin.legal_info_url = PLUGIN_LEGAL_URL;
	writeJson('public/.well-known/ai-plugin.json', plugin);
}

// ── crypto-agent-manifest.json (sample agent-manifest/0.2) ───────────────────
{
	const manifest = readJson('public/crypto-agent-manifest.json', { indent: '  ' });
	// cdn.three.ws has no DNS and never did; the first-party CDN is the
	// `/cdn/<r2-key>` route (api/cdn-object.js). Point the sample body at the
	// live default avatar so the manifest demo actually loads.
	manifest.body.uri = 'https://three.ws/avatars/default.glb';
	manifest.brain.model = 'claude-sonnet-5';
	writeJson('public/crypto-agent-manifest.json', manifest, { indent: '  ' });
}

console.log(`[discovery-cards] done — ${paid.length} paid services projected`);
