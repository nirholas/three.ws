// Pins the wiring of every guard this repo relies on running automatically.
//
// `.gcloudignore` was the first case: scripts/check-gcloudignore.mjs existed,
// its commit message claimed it "fails before a build instead of in production",
// and it was referenced by no npm script, so nothing ran it and the omission it
// was written to catch shipped anyway (thirteen hours of 500s on 2026-09-04).
// tests/gcloudignore-wiring.test.js pins that one. An audit of the rest found the
// same shape 43 more times: guards written, never called.
//
// The ones below were measured green, repo-only and fast, then wired. This file
// exists so a `git add -A` sweep or a package.json conflict resolution cannot
// silently unwire them again: an unwired guard is not a guard. The classification
// of every guard, wired or not, is docs/ops/guard-wiring.md.

import { describe, it, expect } from 'vitest';
import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const pkg = JSON.parse(readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
const scripts = pkg.scripts;

// guard -> the script that must run it, and the script file it must invoke.
const GATE_GUARDS = {
	'check:announce': 'scripts/check-announce.mjs',
	'check:skills-seed': 'scripts/build-skills-seed.mjs',
	'check:doc-media': 'scripts/check-doc-media.mjs',
	'check:images': 'scripts/audit-image-loading.mjs',
	'audit:motion': 'scripts/build-motion-signatures.mjs',
	'audit:tour-global': 'scripts/sync-tour-global.mjs',
	'audit:route-shadowing': 'scripts/audit-route-shadowing.mjs',
};

describe('guards wired into npm run gate', () => {
	for (const [guard, file] of Object.entries(GATE_GUARDS)) {
		it(`${guard} is reachable from gate and points at a real script`, () => {
			expect(scripts[guard], `${guard} is missing from package.json`).toBeDefined();
			expect(scripts[guard]).toContain(file);
			expect(existsSync(path.join(ROOT, file))).toBe(true);
			expect(scripts.gate ?? '').toContain(`npm run ${guard}`);
		});
	}
});

describe('guards wired into the deploy path', () => {
	// findMissingDistAssets() only fires once dist/ exists, which vitest never has,
	// so audit:deploy is not fully covered by tests/deploy-artifacts.test.js. It has
	// to run after the build and before the upload, where a missing decoder asset
	// is still cheap to fix (the /scene draco outage).
	it('audit:deploy runs before gcloud builds submit', () => {
		const submit = scripts['deploy:gcp:submit'] ?? '';
		expect(submit).toContain('npm run audit:deploy');
		expect(submit.indexOf('audit:deploy')).toBeLessThan(submit.indexOf('gcloud builds submit'));
	});
});

describe('the unwired-guard classification stays honest', () => {
	const DOC = path.join(ROOT, 'docs/ops/guard-wiring.md');

	it('docs/ops/guard-wiring.md exists', () => {
		expect(existsSync(DOC)).toBe(true);
	});

	it('has a row for every guard that is still referenced by no other script', () => {
		const doc = readFileSync(DOC, 'utf8');
		const bodies = Object.values(scripts).join(' && ');
		const unwired = Object.keys(scripts)
			.filter((k) => /^(check|audit):/.test(k))
			.filter((k) => !new RegExp(`npm run ${k.replace(/[:.]/g, '\\$&')}(\\s|$|&)`).test(bodies));
		const undocumented = unwired.filter((k) => !doc.includes(`\`${k}\``));
		expect(undocumented, 'add a measured row to docs/ops/guard-wiring.md').toEqual([]);
	});
});
