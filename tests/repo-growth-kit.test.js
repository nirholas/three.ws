import { describe, it, expect } from 'vitest';
import {
	applyBadges,
	applyGrowthBlock,
	badgeRow,
	growthBlock,
	mergeTopics,
	missingFiles,
	pitchOf,
	shareLinks,
} from '../scripts/lib/repo-growth-kit.mjs';
import { decorateReadme } from '../scripts/lib/standalone-kit.mjs';

const ctx = (over = {}) => ({
	name: 'demo-repo',
	description: 'Does a useful thing for agents. And a second sentence.',
	files: new Set(['README.md', 'LICENSE']),
	readme: '# demo-repo\n\nText.\n',
	homepage: 'https://three.ws',
	pkg: null,
	license: 'MIT',
	language: 'JavaScript',
	...over,
});

describe('pitchOf', () => {
	it('keeps the first sentence and drops the terminal period', () => {
		expect(pitchOf('One. Two.')).toBe('One');
	});
	it('cuts at a word boundary when too long', () => {
		const out = pitchOf('word '.repeat(60), 40);
		expect(out.length).toBeLessThanOrEqual(40);
		expect(out.endsWith('word')).toBe(true);
	});
	it('strips banned dash glyphs', () => {
		expect(pitchOf('a \u2014 b')).toBe('a: b');
	});
});

describe('shareLinks', () => {
	it('encodes the repo url into every network', () => {
		const links = shareLinks({ name: 'demo-repo', description: 'x' });
		expect(links.length).toBe(5);
		for (const [, href] of links) expect(href).toContain(encodeURIComponent('https://github.com/nirholas/demo-repo'));
	});
});

describe('growth block', () => {
	it('is idempotent: applying twice yields the same README', () => {
		const c = ctx();
		const once = applyGrowthBlock(c.readme, growthBlock({ ...c, files: c.files }));
		const twice = applyGrowthBlock(once, growthBlock({ ...c, readme: once, files: c.files }));
		expect(twice).toBe(once);
		expect(once.match(/three\.ws:growth -->/g).length).toBe(2);
	});
	it('does not add star history or contributors the README already has', () => {
		const readme = '# x\n\n[![s](https://api.star-history.com/svg?repos=a/b)](https://star-history.com)\n[c](https://contrib.rocks/image?repo=a/b)\n';
		const block = growthBlock({ ...ctx(), readme });
		expect(block).not.toContain('## Star history');
		expect(block).not.toContain('## Contributors');
	});
	it('links agent files only when they exist', () => {
		expect(growthBlock({ ...ctx(), files: new Set() })).not.toContain('Built for AI agents');
		expect(growthBlock({ ...ctx(), files: new Set(['AGENTS.md']) })).toContain('[AGENTS.md](./AGENTS.md)');
	});
	it('inserts above the mirror footer', () => {
		const readme = '# x\n\n<!-- three.ws:ecosystem -->\nfooter\n<!-- /three.ws:ecosystem -->\n';
		const out = applyGrowthBlock(readme, growthBlock(ctx()));
		expect(out.indexOf('three.ws:growth')).toBeLessThan(out.indexOf('three.ws:ecosystem'));
	});
	it('never emits a dash glyph', () => {
		const out = growthBlock({ ...ctx({ description: 'a \u2014 b' }) });
		expect(out).not.toMatch(/[\u2014\u2013]/);
	});
});

describe('badges', () => {
	it('adds a row under the H1 only when the README has no badges', () => {
		const row = badgeRow({ name: 'demo-repo', hasLicense: true });
		const out = applyBadges('# demo\n\nbody\n', row);
		expect(out.indexOf('img.shields.io')).toBeGreaterThan(out.indexOf('# demo'));
		expect(applyBadges('# demo\n\n![b](https://img.shields.io/x)\n', row)).toContain('![b]');
		expect(applyBadges('# demo\n\n![b](https://img.shields.io/x)\n', row)).not.toContain('three.ws:badges');
	});
	it('omits the license badge when the repo has no license', () => {
		expect(badgeRow({ name: 'a', hasLicense: false })).not.toContain('github/license');
	});
});

describe('missingFiles', () => {
	it('generates the full discovery and community set for a bare repo', () => {
		const out = missingFiles(ctx());
		for (const f of ['AGENTS.md', 'llms.txt', 'llms-full.txt', 'CLAUDE.md', 'CONTRIBUTING.md', 'SECURITY.md', 'CODE_OF_CONDUCT.md', 'CITATION.cff', '.github/FUNDING.yml', '.github/PULL_REQUEST_TEMPLATE.md', '.github/ISSUE_TEMPLATE/bug.yml']) {
			expect(out).toHaveProperty([f]);
		}
	});
	it('never overwrites a file the repo already has', () => {
		const out = missingFiles(ctx({ files: new Set(['README.md', 'AGENTS.md', 'llms.txt', 'SECURITY.md', '.github/FUNDING.yml']) }));
		expect(out).not.toHaveProperty(['AGENTS.md']);
		expect(out).not.toHaveProperty(['llms.txt']);
		expect(out).not.toHaveProperty(['SECURITY.md']);
		expect(out).not.toHaveProperty(['.github/FUNDING.yml']);
		expect(out).toHaveProperty(['CLAUDE.md']);
	});
	it('does not invent a license', () => {
		expect(missingFiles(ctx({ license: null }))).not.toHaveProperty(['LICENSE']);
	});
	it('funding links the product, never a token', () => {
		expect(missingFiles(ctx())['.github/FUNDING.yml']).toContain('https://three.ws');
	});
	it('uses the repo toolchain for develop commands', () => {
		const out = missingFiles(ctx({ files: new Set(['README.md', 'Cargo.toml']) }));
		expect(out['AGENTS.md']).toContain('cargo test');
	});
});

describe('mergeTopics', () => {
	it('keeps existing topics first and never exceeds 20', () => {
		const existing = Array.from({ length: 19 }, (_, i) => `t${i}`);
		const out = mergeTopics(existing, 'Rust');
		expect(out.slice(0, 19)).toEqual(existing);
		expect(out.length).toBe(20);
	});
	it('adds the discovery topics when there is room', () => {
		const out = mergeTopics(['mcp'], 'TypeScript');
		expect(out).toEqual(expect.arrayContaining(['typescript', 'three-ws', 'ai-agents', 'llms-txt', 'agents-md']));
	});
});

describe('mirror README decoration', () => {
	it('keeps the growth block above the footer and is stable across re-runs', () => {
		const pkg = { name: '@three-ws/demo', description: 'Demo package.' };
		const c = { pkg, slug: 'nirholas/demo', dir: 'packages/demo' };
		const once = decorateReadme('# demo\n\nbody\n', c);
		const twice = decorateReadme(once, c);
		expect(twice).toBe(once);
		expect(once.indexOf('three.ws:growth')).toBeLessThan(once.indexOf('three.ws:ecosystem'));
	});
});
