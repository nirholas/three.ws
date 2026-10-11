import { describe, it, expect } from 'vitest';
import { buildProfile } from '../scripts/build-github-profile.mjs';
import { renderVisuals, shortTitle } from '../scripts/lib/profile-visuals.mjs';

const repo = (name, stars, extra = {}) => ({
	name,
	description: `${name} description`,
	stargazerCount: stars,
	forkCount: 1,
	topics: ['ai-agents'],
	language: 'TypeScript',
	createdAt: '2026-03-04T07:00:00Z',
	...extra,
});

const repos = [
	repo('big-tool', 900, { topics: ['cli'] }),
	repo('agent-mcp', 40, { topics: ['mcp-server'], language: 'Python', createdAt: '2025-11-02T20:00:00Z' }),
	repo('avatar-kit', 12, { topics: ['3d'], language: null }),
	repo('quiet-thing', 0, { createdAt: null }),
];

describe('github profile', () => {
	it('renders every chart in both themes as well-formed SVG', () => {
		const { assets } = buildProfile(repos);
		const names = ['stats', 'planet', 'top-stars', 'city', 'growth', 'languages', 'punchcard'];
		expect(Object.keys(assets).sort()).toEqual(names.flatMap((n) => [`${n}-dark.svg`, `${n}-light.svg`]).sort());
		for (const body of Object.values(assets)) {
			expect(body.startsWith('<svg xmlns="http://www.w3.org/2000/svg"')).toBe(true);
			expect(body).toContain('<title id="t">');
			expect(body.match(/<g\b/g)?.length ?? 0).toBe(body.match(/<\/g>/g)?.length ?? 0);
			expect(body).not.toMatch(/NaN|undefined|Infinity/);
		}
	});

	it('computes the headline numbers from the repo list', () => {
		const { assets } = buildProfile(repos);
		const stats = assets['stats-dark.svg'];
		expect(stats).toContain('Repositories: 4');
		expect(stats).toContain('Stars: 952');
		expect(stats).toContain('Languages: 2');
		expect(assets['languages-dark.svg']).toContain('Docs and config: 1');
		expect(assets['top-stars-dark.svg']).toContain('big-tool: 900 stars');
	});

	it('keeps a section on the same color when an earlier section is empty', () => {
		const { groups } = buildProfile(repos);
		const mcp = groups.find((g) => g.title.startsWith('MCP'));
		expect(mcp.slot).toBe(2);
		const dark = renderVisuals(repos, groups)['planet-dark.svg'];
		expect(dark).toContain('fill="#199e70"');
	});

	it('frames the README as a personal profile, not a product page', () => {
		const { readme, llms } = buildProfile(repos);
		const header = readme.slice(0, readme.indexOf('## Start here'));
		expect(header).not.toMatch(/three\.ws/i);
		expect(readme).toContain('srcset="./assets/planet-dark.svg"');
		expect(llms).not.toMatch(/three\.ws ecosystem|## Platform/);
	});

	it('shortens section titles for tight labels', () => {
		expect(shortTitle('Developer tools and everything else')).toBe('Developer tools');
		expect(shortTitle('MCP servers for AI agents')).toBe('MCP servers');
	});
});
