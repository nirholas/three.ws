import { describe, it, expect } from 'vitest';
import { buildProfile } from '../scripts/build-github-profile.mjs';
import { renderVisuals, renderActivityVisuals, shortTitle } from '../scripts/lib/profile-visuals.mjs';
import { summarizeActivity, BULK_LINES } from '../scripts/lib/profile-activity.mjs';

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

	it('puts the star-history Top Committer badge in the header row, linked to star-history.com', () => {
		const { readme } = buildProfile(repos);
		const header = readme.split('## About')[0];
		expect(header).toContain('href="https://www.star-history.com/nirholas"');
		expect(header).toContain('https://api.star-history.com/badge?user=nirholas&year=2026');
		expect(readme).not.toContain('api.star-history.com/svg');
	});

	it('shortens section titles for tight labels', () => {
		expect(shortTitle('Developer tools and everything else')).toBe('Developer tools');
		expect(shortTitle('MCP servers for AI agents')).toBe('MCP servers');
	});

	describe('coding activity', () => {
		const now = new Date('2026-10-11T12:00:00Z');
		const ms = (iso) => Date.parse(iso);
		const data = {
			owner: 'nirholas',
			fetchedAt: '2026-10-11T12:00:00.000Z',
			calendar: [
				['2026-10-05', 3],
				['2026-10-06', 0],
				['2026-10-07', 5],
				['2026-10-08', 2],
				['2026-10-09', 4],
				['2026-10-10', 1],
				['2026-10-11', 0],
			],
			commits: {
				'big-tool': [
					[ms('2026-10-09T10:05:00Z'), 100, 20],
					[ms('2026-10-09T10:40:00Z'), 50, 5],
					[ms('2026-10-09T15:00:00Z'), 10, 0],
					[ms('2026-10-10T02:30:00Z'), BULK_LINES + 1, 0],
				],
				'agent-mcp': [[ms('2026-10-07T23:59:00Z'), 7, 3]],
				'hidden-thing': [[ms('2026-10-08T09:00:00Z'), 1000, 0]],
			},
		};
		const sum = summarizeActivity(data, { now, allow: new Set(['big-tool', 'agent-mcp']) });

		it('counts hours as distinct clock hours with a push, never more than 24 a day', () => {
			const nineth = sum.series.find((d) => d.date === '2026-10-09');
			expect(nineth.hours).toBe(2);
			expect(Math.max(...sum.series.map((d) => d.hours))).toBeLessThanOrEqual(24);
			expect(sum.totals.hours).toBe(5);
		});

		it('leaves bulk commits out of the line totals but still counts them as commits', () => {
			expect(sum.totals.added).toBe(100 + 50 + 10 + 7 + 1000);
			expect(sum.totals.removed).toBe(20 + 5 + 3);
			expect(sum.totals.bulkCommits).toBe(1);
			expect(sum.totals.publicCommits).toBe(6);
		});

		it('takes streaks and commit counts from the calendar, which includes private work', () => {
			expect(sum.totals.commits).toBe(15);
			expect(sum.totals.activeDays).toBe(5);
			expect(sum.totals.longestStreak).toBe(4);
			expect(sum.totals.longestStreakEnd).toBe('2026-10-10');
			expect(sum.totals.currentStreak).toBe(4);
			expect(sum.totals.busiest).toEqual({ date: '2026-10-07', count: 5 });
		});

		it('never names a repo outside the allow list, yet still counts its commits', () => {
			expect(sum.topRepos.map((r) => r.name)).toEqual(['big-tool', 'agent-mcp']);
			expect(JSON.stringify(sum)).not.toContain('hidden-thing');
		});

		it('places each commit in its UTC weekday and hour', () => {
			const friday = 4;
			expect(sum.rhythm[friday][10]).toBe(2);
			expect(sum.rhythm.flat().reduce((n, v) => n + v, 0)).toBe(sum.totals.publicCommits);
		});

		it('renders every activity chart in both themes as well-formed SVG', () => {
			const files = renderActivityVisuals(sum);
			const names = ['activity-volume', 'activity-habit', 'activity-calendar', 'activity-lines', 'activity-hours', 'activity-rhythm'];
			expect(Object.keys(files).sort()).toEqual(names.flatMap((n) => [`${n}-dark.svg`, `${n}-light.svg`]).sort());
			for (const body of Object.values(files)) {
				expect(body.startsWith('<svg xmlns="http://www.w3.org/2000/svg"')).toBe(true);
				expect(body.match(/<g\b/g)?.length ?? 0).toBe(body.match(/<\/g>/g)?.length ?? 0);
				expect(body).not.toMatch(/NaN|undefined|Infinity/);
			}
			expect(files['activity-volume-dark.svg']).toContain('Commits, 12 months: 15');
		});

		it('adds the about section and the activity section to the profile, and omits the latter without data', () => {
			const withData = buildProfile(repos, { activityData: data, now });
			expect(withData.readme).toContain('## About');
			expect(withData.readme).toContain('## How I build');
			expect(withData.readme).toContain('srcset="./assets/activity-calendar-dark.svg"');
			expect(withData.readme).toContain('| [big-tool](https://github.com/nirholas/big-tool) |');
			expect(withData.assets['activity-hours-light.svg']).toBeDefined();
			const without = buildProfile(repos);
			expect(without.readme).toContain('## About');
			expect(without.readme).not.toContain('## How I build');
		});
	});
});
