/**
 * Big-tech partner programs tracker (scripts/partner-programs.mjs).
 *
 * The tracker is the record of every partner-program submission and every
 * benefit we hold, so the rules that keep it honest are tested here: the
 * validator rejects malformed entries, the plan waves are derived the same way
 * every time, --log and --benefit mutate the data the way the doc reports it,
 * and the committed data file plus generated doc are in sync.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import {
	DATA,
	DOC,
	load,
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

describe('committed tracker', () => {
	it('data/partner-programs.json validates and the generated doc is current', () => {
		const db = load(DATA);
		expect(validate(db)).toEqual([]);
		expect(db.programs.length).toBeGreaterThan(100);
		expect(readFileSync(DOC, 'utf8')).toBe(render(db) + '\n');
	});
});
