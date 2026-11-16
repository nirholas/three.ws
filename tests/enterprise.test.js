// /enterprise: data/enterprise.json, the forbidden-claims gate, the pricing
// company link, and the contact form's lead built for the Microsoft leads
// pipeline (api/_lib/enterprise-contact.js, api/_lib/microsoft-leads.js).

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import {
	validateEnterprise,
	findForbiddenClaims,
	renderedClaims,
	identityStatus,
	marketplaceTarget,
	marketplacePurchaseLine,
	pricingCompanyLink,
	publisherLine,
} from '../src/enterprise-model.js';
import { buildEnterpriseLead, isHoneypotHit, splitName, INTERESTS } from '../api/_lib/enterprise-contact.js';
import { validateLeadPayload, parseLead, ownerMessage, draftPrompt } from '../api/_lib/microsoft-leads.js';

const enterprise = JSON.parse(readFileSync(new URL('../data/enterprise.json', import.meta.url), 'utf8'));
const surfaces = JSON.parse(readFileSync(new URL('../data/microsoft-surfaces.json', import.meta.url), 'utf8'));
const clone = (v) => JSON.parse(JSON.stringify(v));

describe('data/enterprise.json', () => {
	it('is valid and makes no forbidden claim', () => {
		expect(validateEnterprise(enterprise, surfaces)).toEqual([]);
	});

	it('renders every deployment surface the work order names', () => {
		for (const id of ['teams', 'power-platform', 'edge', 'store', 'mcp', 'marketplace']) expect(enterprise.surfaces).toContain(id);
	});

	it('never states the attestation as certified', () => {
		expect(['in preparation', 'submitted']).toContain(enterprise.attestation.status);
	});
});

describe('forbidden claims', () => {
	const cases = [
		['attestation.status', 'certified'],
		['identity[0].status', 'Microsoft certified'],
		['buy[0].summary', 'three.ws is co-sell ready on Microsoft Marketplace.'],
		['buy[0].summary', 'A Microsoft Solutions Partner for data and AI.'],
		['support[0].value', 'Gold partner support line.'],
		['security[0].value', 'Endorsed by Microsoft for enterprise use.'],
		['security[0].value', 'SOC 2 Type II compliant.'],
	];
	for (const [path, text] of cases) {
		it(`fails when ${path} says "${text}"`, () => {
			const bad = clone(enterprise);
			const [, key, idx, field] = path.match(/^(\w+)(?:\[(\d+)\])?\.(\w+)$/);
			if (idx === undefined) bad[key][field] = text;
			else bad[key][Number(idx)][field] = text;
			const errors = validateEnterprise(bad, surfaces);
			expect(errors.some((e) => e.includes(text))).toBe(true);
		});
	}

	it('fails when a rendered surface status claims certification', () => {
		const bad = clone(surfaces);
		bad.surfaces.find((s) => s.id === 'teams').status = 'certified';
		expect(validateEnterprise(enterprise, bad).some((e) => e.includes('microsoft-surfaces.teams.status'))).toBe(true);
	});

	it('allows the two approved Microsoft claims and honest negatives', () => {
		const ok = [
			'three.ws and Microsoft have announced a partnership',
			'three.ws is live on Microsoft Marketplace',
			'three.ws holds no SOC 2 or ISO 27001 report today.',
			'Listed on AppSource as an uncertified visual.',
			'It is not yet submitted for Microsoft certification.',
		].map((text, i) => ({ path: `ok[${i}]`, text }));
		expect(findForbiddenClaims(ok)).toEqual([]);
	});

	it('includes the surface text it renders, not surfaces it hides', () => {
		const paths = renderedClaims({ surfaces: ['teams'] }, surfaces).map((s) => s.path);
		expect(paths).toContain('microsoft-surfaces.teams.status');
		expect(paths.some((p) => p.includes('vscode'))).toBe(false);
	});
});

describe('statuses and links', () => {
	const signin = enterprise.identity.find((i) => i.id === 'microsoft-signin');
	const saml = enterprise.identity.find((i) => i.id === 'saml');

	it('turns Microsoft sign-in live only when the production probe says so', () => {
		expect(identityStatus(signin, { ready: false, sso: false })).toEqual({ label: 'built, not switched on', tone: 'pending' });
		expect(identityStatus(signin, null).label).toBe('built, not switched on');
		expect(identityStatus(signin, { ready: true, sso: true })).toEqual({ label: 'live', tone: 'ok' });
		expect(identityStatus(saml, { sso: true }).label).toBe('available on request');
	});

	it('links the publisher profile until the offer URL is configured', () => {
		expect(marketplaceTarget(enterprise).url).toBe(enterprise.marketplace.publisher_profile_url);
		const live = clone(enterprise);
		live.marketplace.offer_url = 'https://marketplace.microsoft.com/en-us/product/saas/three-ws';
		expect(marketplaceTarget(live)).toMatchObject({ url: live.marketplace.offer_url, kind: 'offer' });
	});

	it('points the /pricing company row at /enterprise until the offer is live', () => {
		expect(pricingCompanyLink({ marketplace: { offer_url: '' } })).toMatchObject({ href: '/enterprise', external: false });
		expect(pricingCompanyLink({ marketplace: { offer_url: 'https://marketplace.microsoft.com/x' } })).toMatchObject({ href: 'https://marketplace.microsoft.com/x', external: true });
	});

	it('rejects a non-https offer URL', () => {
		const bad = clone(enterprise);
		bad.marketplace.offer_url = 'http://example.com';
		expect(validateEnterprise(bad, surfaces).some((e) => e.includes('offer_url'))).toBe(true);
	});

	it('describes the purchase probe truthfully', () => {
		expect(marketplacePurchaseLine({ ready: false }).tone).toBe('pending');
		expect(marketplacePurchaseLine({ ready: true }).tone).toBe('ok');
		expect(marketplacePurchaseLine(undefined).tone).toBe('unknown');
	});

	it('never invents a legal entity', () => {
		expect(publisherLine({ publisher: { name: 'three.ws', legal_entity: '' } })).toMatch(/provided with the order form/);
		expect(publisherLine({ publisher: { name: 'three.ws', legal_entity: 'Example Ltd, Ireland' } })).toBe('Example Ltd, Ireland (trading as three.ws)');
	});
});

describe('contact form lead', () => {
	const form = { name: 'Avery Quinn Park', email: 'Avery@Contoso.com', company: 'Contoso', title: 'IT Director', country: 'United States', interest: 'security', team_size: '251-1000', message: 'We need your SIG Lite answers.' };

	it('builds a lead the leads pipeline accepts and labels as the enterprise page', () => {
		const out = buildEnterpriseLead(form);
		expect(out.ok).toBe(true);
		expect(validateLeadPayload(out.lead)).toEqual({ ok: true, errors: [] });
		const parsed = parseLead(out.lead);
		expect(parsed).toMatchObject({ source: 'Website', action: 'PLT', firstName: 'Avery Quinn', lastName: 'Park', email: 'avery@contoso.com', company: 'Contoso', jobTitle: 'IT Director' });
		expect(parsed.description).toContain(INTERESTS.security);
		expect(parsed.description).toContain('Team size: 251-1000');
		expect(parsed.description).toContain('SIG Lite');
	});

	it('names the enterprise page in the owner message and the draft prompt', () => {
		const lead = { ...parseLead(buildEnterpriseLead(form).lead), id: 'x' };
		expect(ownerMessage(lead, 'https://three.ws').title).toBe('Enterprise page inquiry: Avery Quinn Park, Contoso');
		const { system, user } = draftPrompt(lead);
		expect(system).toContain('three.ws enterprise page');
		expect(user).toContain('three.ws/enterprise');
	});

	it('returns a message per field that needs attention', () => {
		const out = buildEnterpriseLead({ email: 'not-an-email', interest: 'bribe', team_size: '7' });
		expect(out.ok).toBe(false);
		expect(Object.keys(out.errors).sort()).toEqual(['company', 'email', 'interest', 'name', 'team_size']);
	});

	it('caps field lengths', () => {
		const out = buildEnterpriseLead({ ...form, message: 'x'.repeat(4001) });
		expect(out.ok).toBe(false);
		expect(out.errors.message).toMatch(/4000/);
	});

	it('spots the honeypot and splits names', () => {
		expect(isHoneypotHit({ website: 'http://spam' })).toBe(true);
		expect(isHoneypotHit({ website: '' })).toBe(false);
		expect(splitName('Cher')).toEqual({ first: 'Cher', last: null });
		expect(splitName('  ')).toEqual({ first: null, last: null });
	});
});
