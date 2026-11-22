// Operator-only docs (ops runbooks, security reviews, partner and fundraising
// material, unsent drafts) were reachable on the live site three ways: the
// search index indexed every doc under docs/, including the ops/security/internal
// subtrees the copy step withheld, and the copy step plus docs/ALL.md published
// everything outside those three folders. One rule (scripts/lib/private-docs.mjs)
// now feeds all three outputs.

import { describe, it, expect } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { isPrivateDoc } from '../scripts/lib/private-docs.mjs';
import { buildIndex } from '../scripts/build-docs-search-index.mjs';

describe('isPrivateDoc', () => {
	it.each([
		'ops/gcp-production.md',
		'security/SECURITY_AUDIT.md',
		'internal/README.md',
		'partners/prospects.md',
		'fundraising/three-ws-inception-deck.pdf',
		'event-readiness/LIVE-OPS.md',
		'agora/tasks/00-INDEX.md',
		'money-map.md',
		'openusd-export/bench-results.json',
		'ops\\windows-style.md',
		'./ops/leading-dot.md',
	])('withholds %s', (rel) => {
		expect(isPrivateDoc(rel)).toBe(true);
	});

	it.each(['', 'README.md', 'tutorials/add-a-3d-assistant.md', 'compliance/backup-and-recovery-policy.md', 'agora/README.md', 'opsec-for-users.md', 'openusd-export/previews/a.png'])(
		'publishes %s',
		(rel) => {
			expect(isPrivateDoc(rel)).toBe(false);
		},
	);
});

describe('docs search index', () => {
	it('never indexes a private doc', () => {
		const dir = mkdtempSync(join(tmpdir(), 'private-docs-'));
		try {
			mkdirSync(join(dir, 'ops'));
			mkdirSync(join(dir, 'partners'));
			mkdirSync(join(dir, 'tutorials'));
			const body = (t) => `# ${t}\n\n${'Enough prose to count as a real section of documentation. '.repeat(3)}\n`;
			writeFileSync(join(dir, 'ops', 'runbook.md'), body('Operator runbook'));
			writeFileSync(join(dir, 'partners', 'prospects.md'), body('Prospect list'));
			writeFileSync(join(dir, 'money-map.md'), body('Money map'));
			writeFileSync(join(dir, 'tutorials', 'hello.md'), body('Hello tutorial'));
			const index = buildIndex(dir);
			const slugs = index.docs.map((d) => d[0]);
			expect(slugs).toEqual(['tutorials/hello']);
		} finally {
			rmSync(dir, { recursive: true, force: true });
		}
	});
});

describe('data/pages.json', () => {
	// A declared page goes into the sitemap and the smoke:prod sweep. Declaring a
	// doc the build withholds advertises a 404 and fails every post-deploy smoke.
	it('declares no private doc', async () => {
		const { readFileSync } = await import('node:fs');
		const pages = JSON.parse(readFileSync(new URL('../data/pages.json', import.meta.url), 'utf8'));
		const paths = [];
		const walk = (node) => {
			if (Array.isArray(node)) return node.forEach(walk);
			if (node && typeof node === 'object') {
				if (typeof node.path === 'string') paths.push(node.path);
				Object.values(node).forEach(walk);
			}
		};
		walk(pages);
		const leaked = paths
			.filter((p) => p.startsWith('/docs/'))
			.filter((p) => {
				// The docs SPA renders /docs/<slug> from /docs/<slug>.md.
				const rel = p.slice('/docs/'.length).replace(/\/+$/, '');
				return isPrivateDoc(`${rel}.md`);
			});
		expect(leaked).toEqual([]);
	});
});
