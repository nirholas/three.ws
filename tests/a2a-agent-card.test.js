/**
 * The A2A Agent Cards three.ws publishes.
 *
 * public/.well-known/agent-card.json is what every A2A client reads first. It
 * used to advertise the website as its `url`, a stale `version`, the pre-0.2
 * `authentication` block instead of `securitySchemes`, a payment extension marked
 * `required: true` (so a client that could not pay could not even talk to the
 * free skills), and six skills the endpoint never routed. Each rule below is one
 * of those failures, judged by the shared rules in scripts/lib/a2a-card-rules.mjs
 * (the same module `npm run validate:a2a-card` runs).
 *
 * dist/marketplace/agent-card.json is the separate card uploaded for the Google
 * Cloud Marketplace listing. It must pass the same A2A rules and differ from the
 * public card only where the listing needs it to: wording, the payment extension,
 * the skill set, and the model and billing facts.
 */

import { describe, it, expect, beforeAll } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
	A2A_CARD_RULES,
	A2A_ENDPOINT_PATH,
	MARKETPLACE_LISTING_EXTENSION_URI,
	validateA2ACard,
} from '../scripts/lib/a2a-card-rules.mjs';
import { A2A_SKILL_IDS, A2A_SKILLS } from '../api/_lib/a2a/skills.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const pkg = JSON.parse(readFileSync(path.join(root, 'package.json'), 'utf8'));
const publicCard = JSON.parse(readFileSync(path.join(root, 'public/.well-known/agent-card.json'), 'utf8'));
const ctx = { expectedVersion: pkg.version, reachableSkillIds: A2A_SKILL_IDS };

describe('public A2A agent card', () => {
	for (const rule of A2A_CARD_RULES.filter((r) => r.profiles.includes('public'))) {
		it(rule.title, () => {
			expect(rule.check(publicCard, ctx)).toBeNull();
		});
	}

	it('points at the A2A JSON-RPC endpoint, not the website', () => {
		expect(publicCard.url).toBe(`https://three.ws${A2A_ENDPOINT_PATH}`);
		expect(publicCard.documentationUrl).toMatch(/^https:\/\/three\.ws\//);
	});

	it('declares only the auth the endpoint enforces: anonymous, or an optional bearer key', () => {
		expect(Object.keys(publicCard.securitySchemes)).toEqual(['bearer']);
		expect(publicCard.securitySchemes.bearer).toMatchObject({ type: 'http', scheme: 'bearer' });
		expect(publicCard.security).toEqual([{}, { bearer: [] }]);
		expect(publicCard.securityRequirements).toEqual([{ schemes: {} }, { schemes: { bearer: { list: [] } } }]);
	});

	it('keeps the a2a-x402 payment extension, optional', () => {
		const ext = publicCard.capabilities.extensions.find((e) => e.uri === 'https://github.com/google-a2a/a2a-x402/v0.1');
		expect(ext).toBeDefined();
		expect(ext.required).toBe(false);
	});

	it('lists every routed skill, the generated catalog skill included', () => {
		expect(publicCard.skills.map((s) => s.id).sort()).toEqual([...A2A_SKILL_IDS].sort());
	});
});

describe('Marketplace A2A agent card', () => {
	let marketplace;
	beforeAll(async () => {
		const { buildMarketplaceCard } = await import('../scripts/build-marketplace-agent-card.mjs');
		marketplace = buildMarketplaceCard(publicCard);
	});

	it('passes every public and marketplace rule', () => {
		expect(validateA2ACard(marketplace, ctx, { profile: 'marketplace' })).toEqual([]);
	});

	for (const rule of A2A_CARD_RULES.filter((r) => r.profiles.includes('marketplace'))) {
		it(rule.title, () => {
			expect(rule.check(marketplace, ctx)).toBeNull();
		});
	}

	it('the public card would fail the marketplace wording rule, so the rule bites', () => {
		const failures = validateA2ACard(publicCard, ctx, { profile: 'marketplace' }).map((f) => f.id);
		expect(failures).toContain('enterprise-wording');
		expect(failures).toContain('listing-metadata');
	});

	it('offers only the 3D skills marked for the listing', () => {
		const offered = A2A_SKILLS.filter((s) => s.marketplace).map((s) => s.id);
		expect(marketplace.skills.map((s) => s.id)).toEqual(offered);
	});

	it('differs from the public card only in wording, extensions, skills and listing metadata', () => {
		const strip = ({ name, description, skills, capabilities, ...rest }) => ({
			...rest,
			capabilities: { ...capabilities, extensions: undefined },
		});
		expect(strip(marketplace)).toEqual(strip(publicCard));
	});

	it('carries no payment extension and names the default Google model', () => {
		const uris = marketplace.capabilities.extensions.map((e) => e.uri);
		expect(uris).toEqual([MARKETPLACE_LISTING_EXTENSION_URI]);
		const listing = marketplace.capabilities.extensions[0];
		expect(listing.required).toBe(false);
		const def = listing.params.models.find((m) => m.default);
		expect(def.provider).toBe('Google');
		expect(listing.params.billing.invoicedBy).toMatch(/Google/);
	});
});
