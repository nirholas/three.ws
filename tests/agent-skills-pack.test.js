// The Agent Skills pack and the standalone repos it generates are how every
// external Claude surface learns three.ws, and both are assembled by a script
// rather than hand-maintained. These tests lock the two contracts that silently
// break a distributed skill: frontmatter that a client cannot route on, and a
// standalone repo that ships a skill the platform never vetted.
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

import { collectSkills } from '../scripts/build-skills-pack.mjs';

const ROOT = path.resolve(import.meta.dirname, '..');
const pack = JSON.parse(fs.readFileSync(path.join(ROOT, '.agents/skills/skills-pack.json'), 'utf8'));
const skills = collectSkills();

describe('agent skills pack', () => {
	it('is in sync with the skill folders on disk', () => {
		expect(pack.skills.map((s) => s.name)).toEqual(skills.map((s) => s.name));
	});

	it('describes every category it counts', () => {
		for (const category of Object.keys(pack.counts)) {
			expect(pack.categories[category], `no description for ${category}`).toBeTruthy();
		}
	});

	it('gives every skill a trigger a client can route on', () => {
		for (const skill of skills) {
			expect(skill.description.length, `${skill.name}: description too short to trigger on`).toBeGreaterThan(40);
			expect(skill.name).toMatch(/^[a-z0-9][a-z0-9-]{0,63}$/);
		}
	});

	it('keeps our own triggers inside the spec length limit', () => {
		// Only our skills: vendored partner drops stay byte-identical to what their
		// publisher shipped, and several of theirs run past the spec's 1024 chars.
		for (const skill of skills.filter((s) => s.origin === 'three.ws')) {
			expect(skill.description.length, `${skill.name}: description over the 1024-char spec limit`).toBeLessThanOrEqual(1024);
		}
	});

	it('keeps the cross-platform-safe subset free of coin and payment-rail content', () => {
		// This subset is what ships to non-crypto tracks, so the markers that matter
		// are the unambiguous ones. "no payment required" is fine; naming a token,
		// a chain, or the payment protocol is not.
		const banned = /(\$THREE|\bUSDC\b|\bx402\b|\bSolana\b|\bpump\.fun\b|\bmainnet\b|private key)/i;
		for (const skill of skills.filter((s) => s.crossPlatformSafe)) {
			const body = fs.readFileSync(path.join(ROOT, skill.path, 'SKILL.md'), 'utf8');
			const hit = body.split('\n').find((line) => banned.test(line));
			expect(hit, `${skill.name} is marked cross-platform-safe but mentions: ${hit}`).toBeUndefined();
		}
	});
});

describe('standalone skill repos', () => {
	it('only ever select three.ws-origin skills', async () => {
		const { REPO_SPECS } = await import('../scripts/build-standalone-skill-repos.mjs');
		for (const spec of REPO_SPECS) {
			const selected = skills.filter(spec.select);
			expect(selected.length, `${spec.repo} selects nothing`).toBeGreaterThan(0);
			for (const skill of selected) {
				expect(skill.origin, `${spec.repo} would republish a vendored skill: ${skill.name}`).toBe('three.ws');
			}
		}
	});

	it('never publish the maintainer-only ops skills', async () => {
		const { REPO_SPECS } = await import('../scripts/build-standalone-skill-repos.mjs');
		for (const spec of REPO_SPECS) {
			for (const skill of skills.filter(spec.select)) {
				expect(skill.category, `${spec.repo} includes ${skill.name}`).not.toBe('ops/production');
			}
		}
	});
});
