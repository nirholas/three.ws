import { describe, it, expect } from 'vitest';
import { readFileSync, existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';

const DOCS = [
	'docs/forge.md',
	'docs/how-forge-works.md',
	'docs/forge-pipeline.md',
	'docs/forge-background-generation.md',
	'docs/nvidia-models.md',
	'docs/ops/forge-error-triage.md',
];
const read = (p) => readFileSync(p, 'utf8');

// Generating needs an account (api/_lib/creator-account.js, requireCreator in
// api/forge.js). Lines that name the x402 pay-per-call twin are exempt: a
// wallet-signed x402 call is a platform job and genuinely needs no account.
const BANNED = [
	/no login/i,
	/no account/i,
	/no sign-?up/i,
	/without (an account|signing in)/i,
	/no key is required/i,
	/anonymous users aren.t left out/i,
	/keyless agent shape/i,
	/10 generations per IP per day/i,
	/rate limits are per client IP/i,
];

describe('Forge docs do not promise anonymous generation', () => {
	for (const doc of DOCS) {
		it(doc, () => {
			const bad = [];
			read(doc)
				.split('\n')
				.forEach((line, i) => {
					if (/x402/i.test(line)) return;
					for (const re of BANNED) if (re.test(line)) bad.push(`${doc}:${i + 1} ${re}`);
				});
			expect(bad).toEqual([]);
		});
	}

	it('forge.md states the sign-in requirement and where to get a key', () => {
		const t = read('docs/forge.md');
		expect(t).toContain('sign_in_required');
		expect(t).toContain('/dashboard/api-keys');
	});
});

describe('Forge docs internal links resolve', () => {
	for (const doc of DOCS) {
		it(doc, () => {
			const text = read(doc);
			const dead = [];
			for (const m of text.matchAll(/\]\((?!https?:|mailto:|#)([^)\s]+)\)/g)) {
				const target = m[1].split('#')[0];
				if (!target) continue;
				if (target.startsWith('/docs/')) {
					// Site route served from docs/<slug>.md.
					if (!existsSync(resolve('docs', target.slice('/docs/'.length) + '.md'))) dead.push(m[1]);
					continue;
				}
				// Other site routes (pages, APIs) are not files in docs/: only check relative links.
				if (target.startsWith('/')) continue;
				if (!existsSync(resolve(dirname(doc), target))) dead.push(m[1]);
			}
			expect(dead).toEqual([]);
		});
	}
});
