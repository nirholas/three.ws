// funding.json (floss.fund spec v1.1.0) and .zenodo.json stay valid and in
// agreement with CITATION.cff. Offline: checks shape and URL syntax only.

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';

const read = (p) => readFileSync(new URL(`../${p}`, import.meta.url), 'utf8');
const funding = JSON.parse(read('public/funding.json'));
const zenodo = JSON.parse(read('.zenodo.json'));
const cff = read('CITATION.cff');
const GUID = /^[a-z0-9-]{1,32}$/;
const isHttp = (u) => {
	try {
		return ['http:', 'https:'].includes(new URL(u).protocol) && u.length <= 250;
	} catch {
		return false;
	}
};

describe('funding.json', () => {
	it('has the required entity fields', () => {
		const e = funding.entity;
		expect(['individual', 'group', 'organisation', 'other']).toContain(e.type);
		expect(['owner', 'steward', 'maintainer', 'contributor', 'other']).toContain(e.role);
		expect(e.name.length).toBeLessThanOrEqual(250);
		expect(e.email).toMatch(/^[^@\s]+@[^@\s]+$/);
		expect(e.description.length).toBeLessThanOrEqual(2000);
		expect(isHttp(e.webpageUrl.url)).toBe(true);
	});

	it('every project is complete, unique and SPDX-licensed', () => {
		expect(funding.projects.length).toBeGreaterThanOrEqual(3);
		const guids = new Set();
		for (const p of funding.projects) {
			expect(p.guid).toMatch(GUID);
			expect(guids.has(p.guid)).toBe(false);
			guids.add(p.guid);
			expect(isHttp(p.webpageUrl.url)).toBe(true);
			expect(isHttp(p.repositoryUrl.url)).toBe(true);
			expect(p.licenses.length).toBeGreaterThan(0);
			for (const l of p.licenses) expect(l).toMatch(/^spdx:[A-Za-z0-9.+-]+$/);
			expect(p.tags.length).toBeLessThanOrEqual(10);
			for (const t of p.tags) expect(t).toMatch(/^[a-z0-9-]{1,32}$/);
		}
	});

	it('plans reference defined channels with valid enums', () => {
		const channelGuids = new Set(funding.funding.channels.map((c) => c.guid));
		for (const c of funding.funding.channels) {
			expect(c.guid).toMatch(GUID);
			expect(['bank', 'payment-provider', 'cheque', 'cash', 'other']).toContain(c.type);
		}
		for (const p of funding.funding.plans) {
			expect(p.guid).toMatch(GUID);
			expect(['active', 'inactive']).toContain(p.status);
			expect(p.currency).toMatch(/^[A-Z]{3}$/);
			expect(['one-time', 'weekly', 'fortnightly', 'monthly', 'yearly', 'other']).toContain(p.frequency);
			expect(p.amount).toBeGreaterThanOrEqual(0);
			for (const ch of p.channels) expect(channelGuids.has(ch)).toBe(true);
		}
	});

	it('plan prices match data/plans.json', () => {
		const plans = JSON.parse(read('data/plans.json')).plans;
		for (const p of funding.funding.plans) {
			expect(plans.find((x) => x.id === p.guid)?.price_usd).toBe(p.amount);
		}
	});

	it('the well-known file lists the manifest URL', () => {
		const lines = read('public/.well-known/funding-manifest-urls').split('\n').filter(Boolean);
		expect(lines).toContain('https://three.ws/funding.json');
	});
});

describe('.zenodo.json agrees with CITATION.cff', () => {
	const cffVal = (key) => cff.match(new RegExp(`^${key}: "?([^"\\n]+)"?`, 'm'))?.[1];
	it('title, license, abstract and creator names match', () => {
		expect(zenodo.title).toBe(cffVal('title'));
		expect(zenodo.license).toBe(cffVal('license'));
		expect(zenodo.description).toBe(cffVal('abstract'));
		const authorNames = [...cff.matchAll(/^\s+- name: "([^"]+)"/gm)].map((m) => m[1]);
		expect(zenodo.creators.map((c) => c.name)).toEqual(authorNames);
	});
	it('keywords match CITATION.cff keywords', () => {
		const kw = [...cff.split('keywords:')[1].matchAll(/^\s+- (.+)$/gm)].map((m) => m[1].trim());
		expect(zenodo.keywords).toEqual(kw);
	});
});
