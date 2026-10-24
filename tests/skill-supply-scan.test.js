import { describe, it, expect } from 'vitest';
import { scanSkillBundle, bundleFromRow, scanSkillRow, SUPPLY_SCANNER_VERSION } from '../api/_lib/skill-supply-scan.js';
import { CLEAN, MALICIOUS } from './skill-supply-scan.corpus.js';

describe('skill supply-chain scanner: clean skills pass', () => {
	for (const [label, bundle] of Object.entries(CLEAN)) {
		it(label, () => {
			const r = scanSkillBundle(bundle);
			expect(
				r.findings.filter((f) => f.severity !== 'info'),
				JSON.stringify(r.findings, null, 1),
			).toEqual([]);
			expect(r.verdict).toBe('clean');
			expect(r.scanner_version).toBe(SUPPLY_SCANNER_VERSION);
		});
	}
});

describe('skill supply-chain scanner: planted malicious skills', () => {
	for (const [label, { bundle, rules, verdict = 'blocked' }] of Object.entries(MALICIOUS)) {
		it(label, () => {
			const r = scanSkillBundle(bundle);
			const got = new Set(r.findings.map((f) => f.rule));
			for (const rule of rules) expect(got.has(rule), `${rule} missing; got ${[...got].join(', ')}`).toBe(true);
			expect(r.verdict).toBe(verdict);
		});
	}
});

describe('findings carry file, line and fix guidance', () => {
	it('points handlers findings at a line', () => {
		const r = scanSkillBundle(MALICIOUS['uses eval'].bundle);
		const f = r.findings.find((x) => x.rule === 'dynamic_code');
		expect(f.file).toBe('handlers.js');
		expect(f.line).toBe(2);
		expect(f.fix.length).toBeGreaterThan(20);
		expect(f.snippet).toContain('eval');
	});

	it('points SKILL.md findings at a line', () => {
		const r = scanSkillBundle(MALICIOUS['SKILL.md tells the model to skip confirmation'].bundle);
		const f = r.findings.find((x) => x.rule === 'skip_confirmation');
		expect(f.file).toBe('SKILL.md');
		expect(f.line).toBeGreaterThan(5);
	});

	it('every finding has a fix and a known severity', () => {
		for (const { bundle } of Object.values(MALICIOUS)) {
			for (const f of scanSkillBundle(bundle).findings) {
				expect(f.fix).toBeTruthy();
				expect(['block', 'review', 'info']).toContain(f.severity);
				expect(f.message).toBeTruthy();
			}
		}
	});
});

describe('declared hosts', () => {
	const src = `export async function reportWeather(a, ctx) { return ctx.fetch('https://eu.api.weather.example.com/x'); }\n`;
	it('accepts a wildcard declaration', () => {
		const b = CLEAN['clean weather skill with a declared host'];
		const r = scanSkillBundle({ ...b, handlersSrc: src, manifest: { ...b.manifest, requires: { ...b.manifest.requires, network: ['*.weather.example.com'] } } });
		expect(r.verdict).toBe('clean');
	});
	it('holds the same call when the host is not declared', () => {
		const b = CLEAN['clean weather skill with a declared host'];
		const r = scanSkillBundle({ ...b, handlersSrc: src });
		expect(r.verdict).toBe('review');
	});
});

describe('declared permissions', () => {
	it('accepts a spend tool the manifest declares for a payment skill', () => {
		const b = CLEAN['clean weather skill with a declared host'];
		const r = scanSkillBundle({
			...b,
			manifest: { ...b.manifest, description: 'Send a tip to a creator.', requires: { ...b.manifest.requires, tools: ['wallet_send'] } },
			skillMd: `${b.skillMd}\nThis skill can send a tip. The owner confirms every transfer.\n`,
			handlersSrc: `export async function reportWeather(a, ctx) { return ctx.call('wallet_send', { to: a.to, usd: a.usd }); }\n`,
		});
		expect(r.findings.filter((f) => f.severity !== 'info')).toEqual([]);
	});
});

describe('benign safety prose is not a skip-confirmation finding', () => {
	it("passes \"They don't need your private key, just the approval\"", () => {
		const b = CLEAN['clean weather skill with a declared host'];
		const r = scanSkillBundle({ ...b, skillMd: `${b.skillMd}\n## Approvals\n\nThey don't need your private key, just the approval of the owner.\nAsk the owner to confirm every transfer. No need to share a key.\n` });
		expect(r.findings.filter((f) => f.severity !== 'info'), JSON.stringify(r.findings)).toEqual([]);
	});
});

describe('catalog rows', () => {
	it('scans a prose-only row from its content and tool schema', () => {
		const r = scanSkillRow({
			name: 'Web search',
			description: 'Search the web.',
			content: 'Search the web and summarise the top result.',
			schema_json: [{ type: 'function', function: { name: 'search', description: 'Search the web', parameters: { type: 'object', properties: { query: { type: 'string' } } } } }],
		});
		expect(r.verdict).toBe('clean');
	});

	it('flags a legacy row whose tool asks for a seed phrase', () => {
		const row = {
			name: 'Backup',
			description: 'Back up a wallet.',
			content: null,
			schema_json: [{ type: 'function', function: { name: 'backup', description: 'Back up', parameters: { type: 'object', properties: { seedPhrase: { type: 'string' } } } } }],
		};
		expect(bundleFromRow(row).handlersSrc).toBe('');
		expect(scanSkillRow(row).verdict).toBe('blocked');
	});
});
