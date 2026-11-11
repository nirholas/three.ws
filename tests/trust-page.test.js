// The trust center (/trust, /trust/subprocessors, /.well-known/security.txt)
// only means something if every claim stays tied to real code. These tests fail
// when a cited file is renamed or deleted, when the subprocessor list drifts out
// of shape, or when security.txt stops meeting RFC 9116.
import { describe, it, expect } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { resolve, dirname } from 'node:path';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const read = (p) => readFileSync(resolve(ROOT, p), 'utf8');
const list = JSON.parse(read('data/subprocessors.json'));

function repoLinks(html) {
	return [...html.matchAll(/https:\/\/github\.com\/nirholas\/three\.ws\/blob\/main\/([^"#?]+)/g)].map((m) => decodeURIComponent(m[1]));
}

describe('data/subprocessors.json', () => {
	it('has a valid lastReviewed date that is not in the future', () => {
		expect(list.lastReviewed).toMatch(/^\d{4}-\d{2}-\d{2}$/);
		const d = new Date(`${list.lastReviewed}T00:00:00Z`);
		expect(Number.isNaN(d.getTime())).toBe(false);
		expect(d.getTime()).toBeLessThanOrEqual(Date.now());
	});

	it('gives every subprocessor a name, known group, purpose, data, region, evidence and terms', () => {
		const groups = new Set(list.groups.map((g) => g.id));
		const names = new Set();
		expect(list.subprocessors.length).toBeGreaterThan(0);
		for (const sp of list.subprocessors) {
			expect(sp.name, JSON.stringify(sp)).toBeTruthy();
			expect(names.has(sp.name), `duplicate ${sp.name}`).toBe(false);
			names.add(sp.name);
			expect(groups.has(sp.group), `${sp.name} group ${sp.group}`).toBe(true);
			expect(sp.purpose.length, sp.name).toBeGreaterThan(10);
			expect(Array.isArray(sp.data) && sp.data.length > 0, sp.name).toBe(true);
			expect(sp.region, sp.name).toBeTruthy();
			expect(sp.evidence.length, sp.name).toBeGreaterThan(0);
			expect(sp.terms, sp.name).toMatch(/^https:\/\//);
		}
	});

	it('cites evidence files that exist in the repository', () => {
		for (const sp of list.subprocessors) {
			for (const p of sp.evidence) expect(existsSync(resolve(ROOT, p)), `${sp.name}: ${p}`).toBe(true);
		}
	});

	it('uses every declared group', () => {
		for (const g of list.groups) expect(list.subprocessors.some((sp) => sp.group === g.id), g.id).toBe(true);
	});
});

describe('trust pages', () => {
	for (const page of ['pages/trust.html', 'pages/trust-subprocessors.html']) {
		it(`${page} links only to repository files that exist`, () => {
			const links = repoLinks(read(page));
			for (const p of links) expect(existsSync(resolve(ROOT, p)), `${page} -> ${p}`).toBe(true);
		});
	}

	it('gives every /trust section evidence, and keeps the anchors other pages link to', () => {
		const html = read('pages/trust.html');
		for (const id of ['hosting', 'encryption', 'authentication', 'access', 'logging', 'retention', 'backups', 'custody', 'ai', 'incidents', 'disclosure', 'compliance']) {
			const m = html.match(new RegExp(`<section class="tr-section" id="${id}"[\\s\\S]*?</section>`));
			expect(m, `section #${id}`).toBeTruthy();
			if (id !== 'compliance') expect(m[0], `#${id} evidence`).toContain('class="tr-evidence"');
		}
	});

	it('makes no certification claim and keeps Publisher Attestation in preparation', () => {
		const html = read('pages/trust.html');
		expect(html).toMatch(/Publisher Attestation[\s\S]{0,200}In preparation/);
		expect(html).not.toMatch(/SOC 2[^<]*(certified|compliant)/i);
		expect(html).not.toMatch(/ISO[^<]*(certified|compliant)/i);
		expect(html).not.toMatch(/Microsoft[^<.]*(certified|endorsed|partner of the year)/i);
		expect(html).not.toMatch(/[\u2013\u2014]/);
	});

	it('is routed in production and in the Vite build', () => {
		const routes = JSON.parse(read('vercel.json')).routes;
		const dest = (path) => routes.find((r) => r.src && r.dest && new RegExp(`^${r.src}$`).test(path))?.dest;
		expect(dest('/trust')).toBe('/trust.html');
		expect(dest('/trust/subprocessors')).toBe('/trust-subprocessors.html');
		const vite = read('vite.config.js');
		expect(vite).toContain("resolve(__dirname, 'pages/trust.html')");
		expect(vite).toContain("resolve(__dirname, 'pages/trust-subprocessors.html')");
	});
});

describe('/.well-known/security.txt (RFC 9116)', () => {
	const txt = read('public/.well-known/security.txt');
	const fields = {};
	for (const line of txt.split('\n')) {
		const m = line.match(/^([A-Za-z-]+):\s*(.+)$/);
		if (m) (fields[m[1].toLowerCase()] ||= []).push(m[2].trim());
	}

	it('has the required Contact and exactly one Expires within a year', () => {
		expect(fields.contact?.length).toBeGreaterThan(0);
		for (const c of fields.contact) expect(c).toMatch(/^(mailto:|https:\/\/|tel:)/);
		expect(fields.expires).toHaveLength(1);
		const exp = new Date(fields.expires[0]).getTime();
		expect(exp).toBeGreaterThan(Date.now());
		expect(exp - Date.now()).toBeLessThanOrEqual(366 * 24 * 3600 * 1000);
	});

	it('names a policy, preferred languages and an https canonical URL', () => {
		expect(fields.policy?.[0]).toBe('https://three.ws/trust#disclosure');
		expect(fields['preferred-languages']).toHaveLength(1);
		expect(fields.canonical?.[0]).toBe('https://three.ws/.well-known/security.txt');
	});

	it('uses only fields RFC 9116 defines', () => {
		const known = new Set(['acknowledgments', 'canonical', 'contact', 'encryption', 'expires', 'hiring', 'policy', 'preferred-languages', 'csaf']);
		for (const k of Object.keys(fields)) expect(known.has(k), k).toBe(true);
	});
});
