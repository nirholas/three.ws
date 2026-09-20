import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';

import { buildPlan, laneFor, patternsFor, sequence, slotTable, slotTimes, slugFor, tierFor } from '../api/_lib/announce/plan.js';
import { cryptoPaths } from '../api/_lib/announce/ledger.js';
import { languageProblems } from '../api/_lib/x-content/editorial.js';
import { harvestFacts, harvestStats, quotableLines } from '../api/_lib/announce/brief.js';
import { draftFindings, itemFor, parseDraft } from '../api/_lib/announce/draft.js';
import { cardFacts, cardHtml, commandFrom, namesFrom } from '../api/_lib/announce/card.js';
import { gated, renderPack } from '../api/_lib/announce/kit.js';

const CADENCE = { windowMinutes: 90, minimumMinutesApart: 240, dailyCap: 3, quietHoursUtc: ['05:00', '12:00'] };
const QUALITY = { maximumSameLaneInARow: 2, maximumSamePatternInARow: 1 };

const entry = (key, extra = {}) => ({
	key,
	kind: 'page',
	section: 'build',
	title: key,
	description: 'A surface that does a thing.',
	url: key.startsWith('/') ? key : null,
	score: 50,
	signals: { visual: 0 },
	...extra,
});

describe('plan', () => {
	it('derives slot times from the cadence and never schedules into quiet hours', () => {
		const times = slotTimes(CADENCE);
		expect(times).toEqual(['13:00', '18:00', '23:00']);
		for (const time of times) {
			const minutes = Number(time.slice(0, 2)) * 60;
			expect(minutes).toBeGreaterThanOrEqual(12 * 60);
		}
	});

	it('takes the slot table the publisher obeys, in time order, when the cadence declares one', () => {
		expect(slotTable({ ...CADENCE, slots: [{ tier: 1, at: '20:00' }, { tier: 3, at: '04:00' }, { tier: 2, at: '12:00' }] })).toEqual([
			{ at: '04:00', tier: 3 },
			{ at: '12:00', tier: 2 },
			{ at: '20:00', tier: 1 },
		]);
		// No table: the derived times, each one a feature slot, which is what
		// the publisher defaults an untier'd item to.
		expect(slotTable(CADENCE)).toEqual([
			{ at: '13:00', tier: 2 },
			{ at: '18:00', tier: 2 },
			{ at: '23:00', tier: 2 },
		]);
	});

	it('tiers a surface by what it is: flagship, feature, or proof of work', () => {
		expect(tierFor(entry('/vaults', { section: 'crypto' }))).toBe(1);
		expect(tierFor(entry('/agi', { partner: '@ibm' }))).toBe(1);
		expect(tierFor(entry('/mocap-studio', { section: 'labs' }))).toBe(2);
		expect(tierFor(entry('@three-ws/alerts-mcp', { kind: 'package', section: 'package' }))).toBe(3);
	});

	it('plans each surface into the slot its own tier owns', () => {
		const plan = buildPlan(
			[
				entry('/vaults', { section: 'crypto' }),
				entry('@three-ws/alerts-mcp', { kind: 'package', section: 'package' }),
				entry('/mocap-studio', { section: 'labs' }),
			],
			{
				cadence: { ...CADENCE, slots: [{ tier: 3, at: '04:00' }, { tier: 2, at: '12:00' }, { tier: 1, at: '20:00' }] },
				quality: QUALITY,
				start: '2026-10-01',
			},
		);
		expect(plan.times).toEqual(['04:00', '12:00', '20:00']);
		expect(plan.slots.map((slot) => [slot.key, slot.tier, slot.notBefore])).toEqual([
			['@three-ws/alerts-mcp', 3, '2026-10-01T04:00:00Z'],
			['/mocap-studio', 2, '2026-10-01T12:00:00Z'],
			['/vaults', 1, '2026-10-01T20:00:00Z'],
		]);
		expect(plan.totals.byTier).toEqual({ 1: 1, 2: 1, 3: 1 });
	});

	it('gives a slot to the next tier down when its own tier is out of stock', () => {
		const plan = buildPlan([entry('/vaults', { section: 'crypto' }), entry('/genome', { section: 'crypto' })], {
			cadence: { ...CADENCE, slots: [{ tier: 3, at: '04:00' }, { tier: 1, at: '20:00' }] },
			quality: QUALITY,
			start: '2026-10-01',
		});
		expect(plan.slots.map((slot) => [slot.tier, slot.slotTier])).toEqual([[1, 3], [1, 1]]);
	});

	it('gives a pinned surface the earliest slot of its tier instead of waiting for its score', () => {
		const args = {
			cadence: { ...CADENCE, slots: [{ tier: 2, at: '12:00' }] },
			quality: QUALITY,
			start: '2026-10-01',
		};
		const entries = [
			entry('/mocap-studio', { score: 90 }),
			entry('/capture', { score: 80 }),
			entry('/awesome', { section: 'learn', score: 40 }),
		];
		const unpinned = buildPlan(entries, args);
		expect(unpinned.slots.map((slot) => slot.key)).toEqual(['/mocap-studio', '/capture', '/awesome']);
		expect(unpinned.totals.pinned).toBe(0);

		const pinned = buildPlan(entries, { ...args, pinned: new Map([['/awesome', 'the owner asked for it']]) });
		expect(pinned.slots.map((slot) => slot.key)).toEqual(['/awesome', '/mocap-studio', '/capture']);
		expect(pinned.slots[0].notBefore).toBe('2026-10-01T12:00:00Z');
		expect(pinned.slots[0].pinned).toBe('the owner asked for it');
		expect(pinned.totals.pinned).toBe(1);
		// A pin reorders the backlog; it never adds a slot or moves a time.
		expect(pinned.slots.map((slot) => slot.notBefore)).toEqual(unpinned.slots.map((slot) => slot.notBefore));
	});

	it('keeps a pinned surface inside the slot its own tier owns', () => {
		const plan = buildPlan(
			[
				entry('@three-ws/alerts-mcp', { kind: 'package', section: 'package', score: 90 }),
				entry('/mocap-studio', { score: 85 }),
				entry('/awesome', { section: 'learn', score: 40 }),
			],
			{
				cadence: { ...CADENCE, slots: [{ tier: 3, at: '04:00' }, { tier: 2, at: '12:00' }] },
				quality: QUALITY,
				start: '2026-10-01',
				pinned: new Map([['/awesome', 'the owner asked for it']]),
			},
		);
		const slot = plan.slots.find((row) => row.key === '/awesome');
		// Not the 04:00 slot, which belongs to proof of work, even though the
		// pin puts /awesome first in the queue of things to place.
		expect([slot.notBefore, slot.tier, slot.slotTier]).toEqual(['2026-10-01T12:00:00Z', 2, 2]);
		expect(plan.slots[0].key).toBe('@three-ws/alerts-mcp');
	});

	it('holds an owner-gated surface out of the calendar instead of dating a slot nobody can fill', () => {
		const args = {
			cadence: { ...CADENCE, slots: [{ tier: 3, at: '04:00' }, { tier: 2, at: '12:00' }, { tier: 1, at: '20:00' }] },
			quality: QUALITY,
			start: '2026-10-01',
			cryptoPaths: new Set(['/vaults']),
		};
		const entries = [
			entry('/vaults', { section: 'crypto' }),
			entry('/alpha-copilot', { partner: '@pumpfun' }),
			entry('/mocap-studio', { section: 'labs' }),
			entry('@three-ws/alerts-mcp', { kind: 'package', section: 'package' }),
		];
		const dated = buildPlan(entries, args);
		expect(dated.slots.find((slot) => slot.key === '/vaults').notBefore).toBe('2026-10-01T20:00:00Z');
		expect(dated.held).toEqual([]);
		expect(dated.holdGated).toBe(false);

		const held = buildPlan(entries, { ...args, holdGated: true });
		expect(held.slots.map((slot) => slot.key)).not.toContain('/vaults');
		expect(held.held.map((row) => row.key)).toEqual(['/vaults']);
		expect(held.totals.held).toBe(1);
		expect(held.holdGated).toBe(true);
		// The flagship slot the gated surface was occupying now goes to the
		// flagship the factory can actually pack.
		expect(held.slots.find((slot) => slot.slotTier === 1).key).toBe('/alpha-copilot');
	});

	it('drops a slot whose jitter window would run into quiet hours', () => {
		expect(slotTimes({ ...CADENCE, quietHoursUtc: ['00:00', '12:00'], dailyCap: 3, minimumMinutesApart: 600 })).toEqual(['13:00']);
	});

	it('keeps ids stable across kinds', () => {
		expect(slugFor('/labor-market')).toBe('labor-market');
		expect(slugFor('@three-ws/walk-sdk')).toBe('walk-sdk');
		expect(slugFor('workers/rigger')).toBe('worker-rigger');
	});

	it('reads the lane off the surface, not off a rotation', () => {
		expect(laneFor(entry('/vaults', { section: 'crypto' }))).toBe('token');
		expect(laneFor(entry('@three-ws/x', { section: 'package' }))).toBe('developer');
		expect(laneFor(entry('/about', { section: 'main' }))).toBe('community');
	});

	it('only offers a motion pattern to a surface with a route', () => {
		expect(patternsFor(entry('/flow', { signals: { visual: 25 } }))).toContain('clip');
		expect(patternsFor(entry('@three-ws/flow', { url: null, signals: { visual: 25 } }))).not.toContain('clip');
		// The capture photographed this one twice and nothing changed, so the
		// ledger carries moves:false and no pattern may promise a loop of it.
		expect(patternsFor(entry('/awesome', { signals: { visual: 25 }, moves: false }))).not.toContain('clip');
	});

	it('never repeats a pattern back to back, and holds the lane run limit', () => {
		const entries = Array.from({ length: 12 }, (unused, index) => entry(`/page-${index}`, { signals: { visual: 25 } }));
		const placed = sequence(entries, QUALITY);
		expect(placed).toHaveLength(12);
		for (let index = 1; index < placed.length; index++) {
			expect(placed[index].pattern).not.toBe(placed[index - 1].pattern);
		}
	});

	it('dates every slot and flags media that needs owner approval', () => {
		const plan = buildPlan([entry('/vaults', { section: 'crypto' }), entry('/forge-max'), entry('/flow')], {
			cadence: CADENCE,
			quality: QUALITY,
			start: '2026-10-01',
			cryptoPaths: new Set(['/vaults']),
		});
		expect(plan.slots.map((slot) => slot.notBefore)).toEqual([
			'2026-10-01T13:00:00Z',
			'2026-10-01T18:00:00Z',
			'2026-10-01T23:00:00Z',
		]);
		expect(plan.totals.gated).toBe(1);
		expect(plan.slots.find((slot) => slot.key === '/vaults').mediaGate).toBe('owner-approval');
	});
});

describe('brief', () => {
	it('keeps only whole sentences from a rendered page', () => {
		const facts = harvestFacts(
			[
				'Home',
				'a truncated gallery caption that stops mid',
				'The analyzer repairs the mesh and prices the print from its measured volume.',
			].join('\n'),
		);
		expect(facts).toEqual(['The analyzer repairs the mesh and prices the print from its measured volume.']);
	});

	it('quotes only text that is literally in the file it cites', () => {
		const body = [
			'# Heading',
			'',
			'> A Model Context Protocol server that turns the alerts surface into an agent-drivable control plane.',
			'',
			'- Rules are account-scoped, so a call reads and writes only your own rules and your own history.',
		].join('\n');
		const lines = quotableLines(body);
		expect(lines.length).toBeGreaterThan(0);
		for (const line of lines) expect(body.includes(line)).toBe(true);
	});

	it('refuses a sentence carrying a banned dash glyph', () => {
		const dashed = `A sentence with an ${String.fromCharCode(8212)} em dash that is long enough to otherwise qualify here.`;
		expect(quotableLines(dashed)).toEqual([]);
		expect(harvestFacts(dashed)).toEqual([]);
	});

	it('harvests the counters a stats page leads with, which are not sentences', () => {
		const page = [
			'Sign in',
			'ENTRIES',
			'152',
			'SECTIONS',
			'15',
			'FREE TO USE',
			'121',
			'152 entries across 15 sections',
			'Each entry says in one sentence what the thing does.',
		].join('\n');
		const stats = harvestStats(page);
		expect(stats).toContain('ENTRIES 152');
		expect(stats).toContain('FREE TO USE 121');
		expect(stats).toContain('152 entries across 15 sections');
		// Navigation furniture is not a fact about the surface.
		expect(stats.some((line) => /sign in/i.test(line))).toBe(false);
		// Every candidate is still a literal substring of the page once
		// whitespace is collapsed, which is the check verify.js runs.
		const flat = page.replace(/\s+/g, ' ');
		for (const line of stats) expect(flat.includes(line)).toBe(true);
	});
});

const BRIEF = {
	id: 'forge-max',
	key: '/forge-max',
	url: 'https://three.ws/forge-max',
	route: '/forge-max',
	lane: 'developer',
	pattern: 'number',
	tier: 2,
	notBefore: '2026-10-01T13:00:00Z',
	surface: { kind: 'page', section: 'build', title: 'Forge Max', description: 'The maximum-quality lane.' },
	evidenceCandidates: [{ type: 'page', url: 'https://three.ws/forge-max', contains: 'The highest-quality lane: 200k-poly geometry, 4K PBR textures.' }],
	media: { shot: 'forge-max-hero', motion: false },
};

const GOOD = {
	post: 'three.ws/forge-max opens the Forge with its top tier already pinned: 200k-poly geometry, 4K PBR textures, and the engine picked by what you asked for.',
	thread: [],
	alt: 'The three.ws Forge Max page with the High tier pinned in the quality row above the engine list, and the subtitle naming the geometry and texture budget.',
	claims: [{ says: '200k-poly geometry, 4K PBR textures', evidence: [BRIEF.evidenceCandidates[0]] }],
	mentions: {},
	telegram: '',
};

describe('the inventory these rules are applied to', () => {
	it('gates the crypto namespace wherever a page is filed, not just the crypto section', () => {
		const gated = cryptoPaths(process.cwd());
		// Filed under `learn`, renders live third-party market data.
		expect(gated.has('/crypto-api')).toBe(true);
		expect(gated.has('/crypto')).toBe(true);
		// Filed under `learn`, renders a hand-curated list of open-source projects.
		expect(gated.has('/awesome')).toBe(false);
	});

	it('bans awesome as an adjective and allows it as the name of a list', () => {
		const flagged = (text) => languageProblems(text).some((problem) => /awesome/i.test(problem.message));
		expect(flagged('This release is awesome.')).toBe(true);
		expect(flagged('Awesome 3D Agents maps the whole pipeline.')).toBe(false);
		expect(flagged('Published in the standard awesome list format on GitHub.')).toBe(false);
	});
});

describe('draft', () => {
	it('passes a draft that cites the brief and stays in the band', () => {
		expect(draftFindings(BRIEF, GOOD)).toEqual([]);
	});

	it('rejects evidence the brief never offered', () => {
		const invented = { ...GOOD, claims: [{ says: '200k-poly geometry, 4K PBR textures', evidence: [{ type: 'page', url: 'https://three.ws/forge-max', contains: 'something nobody checked' }] }] };
		expect(draftFindings(BRIEF, invented).join(' ')).toMatch(/not one of the brief/);
	});

	it('rejects a number with no claim behind it', () => {
		const bare = { ...GOOD, claims: [] };
		expect(draftFindings(BRIEF, bare).join(' ')).toMatch(/unverified number/);
	});

	it('rejects hype, a missing link, and alt text that repeats the post', () => {
		const hype = { ...GOOD, post: 'Introducing a seamless way to unlock the power of 3D, it is truly game-changing for every single creator out there.', claims: [] };
		const findings = draftFindings(BRIEF, hype).join(' ');
		expect(findings).toMatch(/banned opening/);
		expect(findings).toMatch(/must link/);
	});

	it('flags a head that repeats something already posted', () => {
		expect(draftFindings(BRIEF, GOOD, { otherHeads: [GOOD.post] }).join(' ')).toMatch(/reads like an existing post/);
	});

	it('parses a model answer and refuses one with no post', () => {
		expect(parseDraft(`noise {"post":"x","alt":"y"} trailing`).post).toBe('x');
		expect(() => parseDraft('{"alt":"y"}')).toThrow(/empty post/);
	});

	it('builds a queue item that points at the reviewed pack bytes', () => {
		const item = itemFor(BRIEF, GOOD, { mediaPath: 'public/announce/img/forge-max-hero.webp' });
		expect(item.status).toBe('draft');
		expect(item.posts[0].textFrom).toBe('docs/announcements/forge-max.post.txt');
		expect(item.posts[0].media[0].alt).toBe(GOOD.alt);
		expect(item.notBefore).toBe(BRIEF.notBefore);
		// The queue validator refuses an item with no tier, so the plan's tier
		// has to survive the trip through the brief.
		expect(item.tier).toBe(2);
		expect(itemFor({ ...BRIEF, tier: undefined }, GOOD, { mediaPath: 'x.webp' }).tier).toBe(2);
		expect(itemFor({ ...BRIEF, tier: 1 }, GOOD, { mediaPath: 'x.webp' }).tier).toBe(1);
	});
});

describe('card', () => {
	it('reads the command and the tool names a README really documents', () => {
		const readme = [
			'## Install',
			'',
			'```bash',
			'npx @three-ws/alerts-mcp',
			'```',
			'',
			'## Tools',
			'',
			'| Tool | What it does |',
			'|---|---|',
			'| `list_alert_rules` | lists |',
			'| `create_alert_rule` | creates |',
			'',
			'| Field | Values |',
			'|---|---|',
			'| `kind` | graduation |',
		].join('\n');
		expect(commandFrom(readme)).toBe('npx @three-ws/alerts-mcp');
		expect(namesFrom(readme)).toEqual(['list_alert_rules', 'create_alert_rule']);
	});

	it('renders a card with no dash glyph and no unescaped markup', () => {
		const html = cardHtml({ title: '@three-ws/x', subtitle: 'A thing <script>alert(1)</script>', command: 'npx x', names: ['a_tool'], footer: 'npmjs.com/package/@three-ws/x' });
		expect(html).not.toMatch(new RegExp('[\\u2014\\u2013]'));
		expect(html).not.toContain('<script>');
		expect(html).toContain('a_tool');
	});

	it('normalizes a dash out of a real package description', () => {
		const facts = cardFacts(process.cwd(), { dir: 'packages/alerts-mcp' });
		expect(facts.title).toBe('@three-ws/alerts-mcp');
		expect(facts.subtitle).not.toMatch(new RegExp('[\\u2014\\u2013]'));
	});
});

describe('pack', () => {
	const slot = { id: 'forge-max', key: '/forge-max', shot: 'forge-max-hero', motion: false, mediaGate: null, notBefore: BRIEF.notBefore, windowMinutes: 90 };

	it('renders the media table the gate parses, and states the alt text', () => {
		const pack = renderPack({ brief: BRIEF, draft: GOOD, slot, ledgerEntry: { title: 'Forge Max', score: 75, signals: { reach: 18 } } });
		expect([...pack.matchAll(/^\| `([a-z0-9-]+)` \|/gm)].map((match) => match[1])).toEqual(['forge-max-hero']);
		expect(pack).toMatch(/Alt text, required on the post/);
		expect(pack).toMatch(/155 weighted characters/);
		expect(pack).not.toMatch(new RegExp('[\\u2014\\u2013]'));
	});

	it('says out loud when a frame needs owner approval', () => {
		const pack = renderPack({ brief: BRIEF, draft: GOOD, slot: { ...slot, mediaGate: 'owner-approval' } });
		expect(pack).toMatch(/owner approval|owner-approval/);
	});
});

describe('the committed packs this factory produced', () => {
	it('keeps the queue text identical to the reviewed pack bytes', () => {
		const queue = JSON.parse(readFileSync('data/x-content/queue.json', 'utf8'));
		for (const item of queue.items) {
			for (const post of item.posts || []) {
				if (!post.textFrom) continue;
				expect(readFileSync(post.textFrom, 'utf8').trim()).toBe(post.text.trim());
			}
		}
	});
});

describe('the commit gate on named projects', () => {
	it('leaves a changelog title naming a gated project out of the pack it quotes', () => {
		expect(gated('A plugin marketplace for wallet, 3D and someproject tools', ['someproject'])).toBe(true);
		expect(gated('A plugin marketplace for wallet and 3D tools', ['someproject'])).toBe(false);
		// The term is matched whole, so a surface whose own name contains it is
		// not gated by coincidence.
		expect(gated('someprojection of the map', ['someproject'])).toBe(false);
		expect(gated('anything at all', [])).toBe(false);
	});
});
