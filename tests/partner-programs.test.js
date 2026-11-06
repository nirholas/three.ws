/**
 * Big-tech partner programs tracker (scripts/partner-programs.mjs).
 *
 * The tracker is the record of every partner-program submission and every
 * benefit we hold, so the rules that keep it honest are tested here: the
 * validator rejects malformed entries, the plan waves are derived the same way
 * every time, --log and --benefit mutate the data the way the doc reports it,
 * promotion tags are checked and indexed across sectors, and every committed
 * sector data file plus its generated doc are in sync.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync, existsSync } from 'node:fs';
import {
	DATA,
	DOC,
	PROMO_DOC,
	MOONSHOT_DOC,
	SECTORS,
	load,
	loadAll,
	validateAll,
	renderPromo,
	renderMoonshots,
	outputs,
	validate,
	waveOf,
	score,
	due,
	render,
	logSubmission,
	recordBenefit,
} from '../scripts/partner-programs.mjs';

const base = (over = {}) => ({
	id: 'acme-startups',
	company: 'Acme',
	program: 'Acme for Startups',
	kind: 'credits',
	status: 'eligible',
	url: 'https://acme.example/startups',
	fit: 4,
	reach: 4,
	access: 4,
	next: 'Apply through the form',
	checked: '2026-11-01',
	...over,
});
const dbOf = (...programs) => ({
	updated: '2026-11-01',
	companies: [{ name: 'Acme', angle: 'Test company.' }],
	programs,
});

describe('validate', () => {
	it('accepts a well-formed program', () => {
		expect(validate(dbOf(base()))).toEqual([]);
	});

	it('rejects bad ids, duplicates, unknown companies, kinds and statuses', () => {
		const errs = validate(
			dbOf(
				base({ id: 'Bad Id' }),
				base(),
				base(),
				base({ id: 'other', company: 'Nobody' }),
				base({ id: 'k', kind: 'vibes', status: 'maybe' }),
			),
		);
		const text = errs.join('\n');
		expect(text).toMatch(/id must be kebab-case/);
		expect(text).toMatch(/duplicate id/);
		expect(text).toMatch(/company "Nobody" is not in companies/);
		expect(text).toMatch(/unknown kind "vibes"/);
		expect(text).toMatch(/unknown status "maybe"/);
	});

	it('requires scores 1-5, an http url and ISO dates', () => {
		const text = validate(dbOf(base({ fit: 6, url: 'acme.example', checked: '11/01/2026', deadline: 'soon' }))).join('\n');
		expect(text).toMatch(/fit must be an integer 1-5/);
		expect(text).toMatch(/url must be http/);
		expect(text).toMatch(/checked must be YYYY-MM-DD/);
		expect(text).toMatch(/deadline must be YYYY-MM-DD/);
	});

	it('requires a next action on active programs and a why on inactive ones', () => {
		expect(validate(dbOf(base({ next: undefined }))).join('\n')).toMatch(/needs a next action/);
		expect(validate(dbOf(base({ status: 'closed', next: undefined }))).join('\n')).toMatch(/a closed program needs a why/);
		expect(validate(dbOf(base({ status: 'member', next: undefined })))).toEqual([]);
	});

	it('rejects em-dashes and en-dashes anywhere in an entry', () => {
		expect(validate(dbOf(base({ why: 'fast \u2014 cheap' }))).join('\n')).toMatch(/em-dash or en-dash/);
		expect(validate(dbOf(base({ why: 'pages 1\u20133' }))).join('\n')).toMatch(/em-dash or en-dash/);
	});

	it('checks promotion tags and requires a note on how to get them', () => {
		expect(validate(dbOf(base({ promo: ['blog', 'social'], promo_note: 'Ask the DevRel team after launch' })))).toEqual([]);
		const text = validate(dbOf(base({ promo: ['blog', 'blog', 'billboard'] }))).join('\n');
		expect(text).toMatch(/unknown promo type "billboard"/);
		expect(text).toMatch(/duplicate promo type/);
		expect(text).toMatch(/promo needs a promo_note/);
		expect(validate(dbOf(base({ promo: 'blog' }))).join('\n')).toMatch(/promo must be an array/);
	});

	it('checks log entries and benefits', () => {
		const text = validate(
			dbOf(base({ log: [{ date: 'yesterday' }], received: [{ benefit: 'Credits', state: 'pending', expires: 'later' }] })),
		).join('\n');
		expect(text).toMatch(/log date must be YYYY-MM-DD/);
		expect(text).toMatch(/log entry needs an action/);
		expect(text).toMatch(/unknown benefit state "pending"/);
		expect(text).toMatch(/benefit expires must be YYYY-MM-DD/);
	});
});

describe('waveOf', () => {
	it('puts memberships with an open step in wave 0 and drops finished ones', () => {
		expect(waveOf(base({ status: 'member' }))).toBe(0);
		expect(waveOf(base({ status: 'member', next: undefined }))).toBeNull();
	});

	it('maps ready, preparing, research, needs_build and score to waves 1-5', () => {
		expect(waveOf(base({ status: 'ready' }))).toBe(1);
		expect(waveOf(base({ status: 'preparing' }))).toBe(1);
		expect(waveOf(base())).toBe(2);
		expect(waveOf(base({ needs_build: true }))).toBe(3);
		expect(waveOf(base({ status: 'ready', needs_build: true }))).toBe(3);
		expect(waveOf(base({ fit: 2, reach: 3, access: 4 }))).toBe(4);
		expect(waveOf(base({ fit: 5, reach: 5, access: 2 }))).toBe(5);
		expect(waveOf(base({ status: 'research' }))).toBe(5);
	});

	it('leaves submitted and inactive programs out of the plan, but honours an explicit wave', () => {
		expect(waveOf(base({ status: 'submitted' }))).toBeNull();
		expect(waveOf(base({ status: 'skip' }))).toBeNull();
		expect(waveOf(base({ wave: 1, fit: 1, reach: 1, access: 1 }))).toBe(1);
		expect(score(base())).toBe(12);
	});
});

describe('logSubmission and recordBenefit', () => {
	it('appends a log entry and moves the status', () => {
		const db = dbOf(base());
		const p = logSubmission(db, 'acme-startups', {
			action: 'Submitted the form',
			status: 'submitted',
			ref: 'https://acme.example/confirm/1',
			date: '2026-11-06',
		});
		expect(p.status).toBe('submitted');
		expect(p.checked).toBe('2026-11-06');
		expect(p.log).toEqual([
			{ date: '2026-11-06', action: 'Submitted the form', status: 'submitted', ref: 'https://acme.example/confirm/1' },
		]);
		expect(validate(db)).toEqual([]);
	});

	it('refuses unknown programs, missing actions and unknown statuses', () => {
		const db = dbOf(base());
		expect(() => logSubmission(db, 'nope', { action: 'x', date: '2026-11-06' })).toThrow(/no program/);
		expect(() => logSubmission(db, 'acme-startups', { date: '2026-11-06' })).toThrow(/--action/);
		expect(() => logSubmission(db, 'acme-startups', { action: 'x', status: 'won', date: '2026-11-06' })).toThrow(/unknown status/);
	});

	it('records a benefit and updates it in place by name', () => {
		const db = dbOf(base({ status: 'member' }));
		recordBenefit(db, 'acme-startups', { name: 'Cloud credits', value: 'USD 5,000', state: 'claimable' });
		const p = recordBenefit(db, 'acme-startups', {
			name: 'Cloud credits',
			state: 'received',
			received: '2026-11-06',
			expires: '2027-11-06',
		});
		expect(p.received).toHaveLength(1);
		expect(p.received[0]).toMatchObject({
			benefit: 'Cloud credits',
			value: 'USD 5,000',
			state: 'received',
			received: '2026-11-06',
			expires: '2027-11-06',
		});
		expect(validate(db)).toEqual([]);
	});
});

describe('due', () => {
	it('reports deadlines in the window, expiring benefits and stale submissions', () => {
		const db = dbOf(
			base({ id: 'soon', deadline: '2026-11-10' }),
			base({ id: 'later', deadline: '2027-03-01' }),
			base({ id: 'past', deadline: '2026-10-01' }),
			base({ id: 'dead', status: 'closed', why: 'Retired', deadline: '2026-11-10' }),
			base({
				id: 'perk',
				status: 'member',
				received: [{ benefit: 'API credits', state: 'claimable', expires: '2026-11-20' }],
			}),
			base({ id: 'waiting', status: 'submitted', log: [{ date: '2026-10-01', action: 'Submitted' }] }),
			base({ id: 'fresh', status: 'submitted', log: [{ date: '2026-11-01', action: 'Submitted' }] }),
		);
		const r = due(db, '2026-11-06', 30);
		expect(r.deadlines.map((d) => [d.p.id, d.days])).toEqual([['soon', 4]]);
		expect(r.expiring.map((e) => [e.p.id, e.days])).toEqual([['perk', 14]]);
		expect(r.chase.map((c) => [c.p.id, c.days])).toEqual([['waiting', 36]]);
	});
});

describe('render', () => {
	it('writes every section and the plan, ledger and log rows', () => {
		const db = dbOf(
			base({ id: 'a', status: 'ready', program: 'Acme Directory', kind: 'directory' }),
			base({
				id: 'b',
				status: 'member',
				program: 'Acme Partner Network',
				kind: 'partner-network',
				received: [{ benefit: 'Co-marketing slot', state: 'claimable' }],
				log: [{ date: '2026-10-01', action: 'Accepted', status: 'member' }],
			}),
			base({ id: 'c', status: 'skip', program: 'Acme Ventures', kind: 'grant', next: undefined, why: 'Equity only' }),
		);
		const md = render(db);
		for (const h of ['# Big-tech partner programs', '## Using this page', '## The plan', '## Benefits ledger', '## Submissions log', '## Company by company']) {
			expect(md).toContain(h);
		}
		expect(md).toContain('Wave 0: activate what we already hold');
		expect(md).toContain('Wave 1: finish what is built');
		expect(md).not.toContain('| Owner |');
		expect(md).toContain('Co-marketing slot');
		expect(md).toContain('| 2026-10-01 |');
		expect(md).toMatch(/Acme Ventures[^\n]*Equity only/);
		expect(md).not.toMatch(/[\u2013\u2014]/);
	});
});

describe('sectors and the promotion index', () => {
	const promoted = (id, promo, over = {}) => base({ id, promo, promo_note: `How to get ${id}`, ...over });

	it('rejects a program id used in two sectors', () => {
		const all = [
			{ sector: 'big-tech', db: dbOf(base()) },
			{ sector: 'ai', db: dbOf(base()) },
		];
		expect(validateAll(all).join('\n')).toMatch(/acme-startups: id also used in big-tech/);
		expect(validateAll([{ sector: 'ai', db: dbOf(base({ fit: 9 })) }]).join('\n')).toMatch(/^ai: program acme-startups: fit/);
	});

	it('renders each sector with its own title, data path and sibling links', () => {
		const md = render(dbOf(promoted('m', ['blog'])), 'motion');
		expect(md).toContain(`# ${SECTORS.motion.title}`);
		expect(md).toContain('data/partner-programs-motion.json');
		expect(md).toContain('./big-tech-programs.md');
		expect(md).toContain('./promotion-programs.md');
		expect(md).toMatch(/## Who promotes partners[\s\S]*How to get m/);
		expect(() => render(dbOf(base()), 'nope')).toThrow(/unknown sector/);
	});

	it('indexes promotion across sectors, most kinds first, and leaves out inactive programs', () => {
		const all = [
			{ sector: 'big-tech', db: dbOf(promoted('one', ['blog']), promoted('dead', ['blog', 'social'], { status: 'closed', why: 'Retired' })) },
			{ sector: 'ai', db: dbOf(promoted('many', ['blog', 'social', 'case-study'], { program: 'Many Promo' })) },
		];
		const md = renderPromo(all);
		expect(md).toContain('**2 open programs offer promotion**');
		expect(md).toMatch(/\| \[Blog post\]\(#blog-post\) \| 1 \| 1 \| \*\*2\*\* \|/);
		const best = md.slice(md.indexOf('## Best single asks'), md.indexOf('## By kind of promotion'));
		expect(best.indexOf('Many Promo')).toBeLessThan(best.indexOf('Acme for Startups'));
		expect(md).not.toContain('How to get dead');
		expect(md).not.toMatch(/[\u2013\u2014]/);
	});

	it('names the most open door into each moonshot company and lists the ones we hold', () => {
		const db = {
			updated: '2026-11-06',
			companies: [{ name: 'Giant', moonshot: true }, { name: 'Closed Giant', moonshot: true }, { name: 'Small' }],
			programs: [
				base({ id: 'giant-hard', company: 'Giant', program: 'Giant Strategic Alliance', access: 1, fit: 5, reach: 5 }),
				base({ id: 'giant-easy', company: 'Giant', program: 'Giant Developer Store', access: 5, fit: 3, reach: 3 }),
				base({ id: 'giant-held', company: 'Giant', program: 'Giant Startups', status: 'member' }),
				base({ id: 'giant-gone', company: 'Closed Giant', program: 'Old Fund', status: 'closed', why: 'Retired' }),
				base({ id: 'small-open', company: 'Small', program: 'Small Partners' }),
			],
		};
		const md = renderMoonshots([{ sector: 'brands', db }]);
		expect(md).toContain('**2 household names tracked.**');
		expect(md).toMatch(/## Doors we already walked through[\s\S]*Giant Startups[\s\S]*## The easiest door/);
		const doors = md.slice(md.indexOf('## The easiest door'), md.indexOf('## No public door yet'));
		expect(doors).toMatch(/\| 1 \| Giant \(already a member elsewhere\) \| \[Brands\]\(\.\/brand-programs\.md\) \| \[Giant Developer Store\]/);
		expect(doors).not.toContain('Strategic Alliance');
		expect(doors).not.toContain('Small Partners');
		expect(md).toMatch(/## No public door yet[\s\S]*\*\*Closed Giant\*\* \(Brands\)/);
		expect(md).not.toMatch(/[\u2013\u2014]/);
	});

	it('rejects a moonshot flag that is not true', () => {
		const db = { ...dbOf(base()), companies: [{ name: 'Acme', moonshot: 'yes' }] };
		expect(validate(db).join('\n')).toMatch(/company Acme: moonshot must be true or absent/);
	});
});

describe('committed tracker', () => {
	it('every sector data file validates and every generated doc is current', () => {
		const all = loadAll();
		expect(all.map((s) => s.sector)).toContain('big-tech');
		expect(validateAll(all)).toEqual([]);
		expect(load(DATA).programs.length).toBeGreaterThan(100);
		for (const [path, content] of outputs(all)) {
			expect(existsSync(path), path).toBe(true);
			expect(readFileSync(path, 'utf8'), path).toBe(content);
		}
		expect(outputs(all).map(([p]) => p)).toEqual(expect.arrayContaining([DOC, PROMO_DOC, MOONSHOT_DOC]));
	});
});
