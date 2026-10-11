// Event Market announcement lane: each draft kind, handle tagging, the one-per-kind
// dedupe, and the poster's refusal to send anything not approved. The database is
// an in-memory fake that answers exactly the queries the lane issues.

import { describe, it, expect, vi, beforeEach } from 'vitest';

const db = { optOut: new Set(), markets: [], outcomes: [], picks: [], ann: [], agentX: new Map(), users: [], nextId: 1 };
const id = () => `00000000-0000-4000-8000-${String(db.nextId++).padStart(12, '0')}`;

vi.mock('../api/_lib/db.js', () => ({
	sql: vi.fn(async (strings, ...v) => {
		const q = strings.join('?').replace(/\s+/g, ' ').trim().toLowerCase();
		if (q.includes('from agent_x_connections')) return db.agentX.has(v[0]) ? [{ username: db.agentX.get(v[0]) }] : [];
		if (q.includes('from social_connections')) return [];
		if (q.includes('from event_markets m where m.status')) return db.markets.filter((m) => ['open', 'locked', 'resolved'].includes(m.status) && db.ann.filter((a) => a.market_id === m.id).length < 4);
		if (q.includes('select kind, baseline from event_market_announcements')) return db.ann.filter((a) => a.market_id === v[0]);
		if (q.includes('from event_market_picks p join users')) return db.users;
		if (q.startsWith('insert into event_market_announcements')) {
			const [market_id, kind, draft_text, card_url, tags, baseline] = v;
			if (db.ann.some((a) => a.market_id === market_id && a.kind === kind)) return [];
			const row = { id: id(), market_id, kind, draft_text, card_url, tags, status: 'draft', baseline: JSON.parse(baseline), posted_at: null };
			db.ann.push(row);
			return [row];
		}
		if (q.includes('select * from event_market_announcements where id')) return db.ann.filter((a) => a.id === v[0]);
		if (q.includes("count(*)::int as n from event_market_announcements")) return [{ n: db.ann.filter((a) => a.status === 'posted').length }];
		if (q.includes("set status = 'posting'")) {
			const a = db.ann.find((x) => x.id === v[0] && x.status === 'approved');
			if (!a) return [];
			a.status = 'posting';
			return [{ id: a.id }];
		}
		if (q.includes("set status = 'posted'")) {
			const a = db.ann.find((x) => x.id === v[1]);
			Object.assign(a, { status: 'posted', post_url: v[0], posted_at: new Date() });
			return [a];
		}
		if (q.includes("set status = 'approved', updated_at")) {
			const a = db.ann.find((x) => x.id === v[0] && x.status === 'posting');
			if (a) a.status = 'approved';
			return [];
		}
		if (q.includes("set status = 'approved', approved_by")) {
			const a = db.ann.find((x) => x.id === v[1] && x.status === 'draft');
			if (!a) return [];
			Object.assign(a, { status: 'approved', approved_by: v[0] });
			return [a];
		}
		if (q.includes('set draft_text')) {
			const a = db.ann.find((x) => x.id === v[1]);
			Object.assign(a, { draft_text: v[0], status: 'draft' });
			return [a];
		}
		throw new Error(`unhandled query: ${q}`);
	}),
}));

// The getMarket view as the core module serves it: outcomes carry crowd share,
// the winner is an object, odds say whether the split is only the even prior.
const PRIOR = 50;
function view(mid) {
	const m = db.markets.find((x) => x.id === mid);
	if (!m) return null;
	const outs = db.outcomes.filter((o) => o.market_id === mid);
	const picks = db.picks.filter((p) => p.market_id === mid);
	const total = picks.reduce((n, p) => n + p.points, 0);
	return {
		...m,
		pick_count: picks.length,
		odds: { even_prior: picks.length === 0 },
		winner: m.winner_outcome_id ? { outcome_id: m.winner_outcome_id } : null,
		outcomes: outs.map((o) => {
			const points = picks.filter((p) => p.outcome_id === o.id).reduce((n, p) => n + p.points, 0);
			return { ...o, points, share: (points + PRIOR) / (total + PRIOR * outs.length) };
		}),
	};
}
vi.mock('../api/_lib/event-markets/index.js', () => ({ getMarket: async (mid) => globalThis.__view(mid) }));
globalThis.__view = view;
vi.mock('../api/_lib/event-markets/entrants.js', () => ({
	taggableEntrants: async (market) => market.outcomes.filter((o) => !db.optOut.has(o.id)).map((outcome) => ({ outcome, accountId: `acct-${outcome.ref_id}` })),
}));

const { buildDraft, draftPending, oddsShifted, lint } = await import('../api/_lib/event-markets/announce.js');
const { approveAnnouncements, editAnnouncement } = await import('../api/_lib/event-markets/review.js');
const { sendAnnouncement, PosterError } = await import('../api/_lib/event-markets/poster.js');

const NOW = new Date('2026-10-12T12:00:00Z');
const M = id();
const A = id(), B = id(), C = id();

function seed({ status = 'open', locks = '2026-10-13T06:00:00Z', winner = null } = {}) {
	Object.assign(db, { optOut: new Set(), markets: [], outcomes: [], picks: [], ann: [], agentX: new Map(), users: [] });
	db.markets.push({ id: M, slug: 'spring-build-round', title: 'the Spring Build Round', status, locks_at: locks, winner_outcome_id: winner, created_at: NOW });
	db.outcomes.push(
		{ id: A, market_id: M, label: 'Atlas', ref_kind: 'agent', ref_id: 'agent-a', position: 0 },
		{ id: B, market_id: M, label: 'Borealis', ref_kind: 'agent', ref_id: 'agent-b', position: 1 },
		{ id: C, market_id: M, label: 'Cinder', ref_kind: 'agent', ref_id: 'agent-c', position: 2 },
	);
	db.agentX.set('agent-a', 'atlas_agent');
	db.agentX.set('agent-b', 'borealis');
}
const ctx = async (extra = {}) => ({ market: view(M), handles: new Map([[A, 'atlas_agent'], [B, 'borealis']]), now: NOW, ...extra });

beforeEach(() => seed());

describe('draft kinds', () => {
	it('opened: tags only entrants with a linked handle, names the rest, carries link and card', async () => {
		const d = buildDraft('opened', await ctx());
		expect(d.tags).toEqual(['atlas_agent', 'borealis']);
		expect(d.text).toContain('@atlas_agent');
		expect(d.text).toContain('Cinder');
		expect(d.text).not.toContain('@Cinder');
		expect(d.text).toContain('https://three.ws/event-markets/spring-build-round');
		expect(d.card_url).toContain('slug=spring-build-round');
		expect(lint(d.text)).toEqual([]);
	});

	it('opened: an entrant with no linked handle is never tagged', async () => {
		const d = buildDraft('opened', await ctx({ handles: new Map() }));
		expect(d.tags).toEqual([]);
		expect(d.text).not.toMatch(/@\w/);
	});

	it('locking_soon: says the hours left and the leader once picks exist', async () => {
		db.picks.push({ market_id: M, outcome_id: A, points: 80 }, { market_id: M, outcome_id: B, points: 20 });
		const d = buildDraft('locking_soon', await ctx());
		expect(d.text).toContain('in 18 hours');
		expect(d.text).toContain('@atlas_agent leads');
		expect(d.tags).toEqual(['atlas_agent']);
	});

	it('locking_soon: an empty market says so instead of inventing a favourite', async () => {
		const d = buildDraft('locking_soon', await ctx());
		expect(d.text).toContain('No picks have landed yet');
		expect(d.tags).toEqual([]);
	});

	it('odds_shift: names the new leader and the pick count', async () => {
		db.picks.push({ market_id: M, outcome_id: B, points: 90 }, { market_id: M, outcome_id: A, points: 10 });
		const d = buildDraft('odds_shift', await ctx({ baseline: { leader_id: A } }));
		expect(d.text).toContain('@borealis now leads');
		expect(d.text).toContain('after Atlas held the top spot');
	});

	it('resolved: names the winner and the first forecasters, and only when a winner exists', async () => {
		seed({ status: 'resolved', winner: B });
		db.picks.push({ market_id: M, outcome_id: B, points: 60 }, { market_id: M, outcome_id: A, points: 40 });
		const d = buildDraft('resolved', await ctx({ forecasters: ['Mira', 'Jo'] }));
		expect(d.text).toContain('@borealis won');
		expect(d.text).toContain('First to call it: Mira and Jo.');
		db.markets[0].winner_outcome_id = null;
		expect(buildDraft('resolved', await ctx())).toBeNull();
	});

	it('every draft fits in 280 weighted characters even with a long field', async () => {
		const many = Array.from({ length: 40 }, (_, i) => ({ id: id(), market_id: M, label: `Entrant number ${i} with a long name`, ref_kind: 'agent' }));
		const d = buildDraft('opened', { market: { ...db.markets[0], pick_count: 0, odds: { even_prior: true }, outcomes: many.map((o) => ({ ...o, share: 1 / 40 })) }, handles: new Map(many.map((o, i) => [o.id, `h${i}`])), now: NOW });
		expect(d.text.length).toBeLessThanOrEqual(280);
	});

	it('house voice: no price promises or em dashes', () => {
		expect(lint('Atlas will moon, a guaranteed 10x.').length).toBeGreaterThan(0);
	});
});

describe('odds shift threshold', () => {
	const withPicks = (picks) => { db.picks.push(...picks.map((p) => ({ market_id: M, ...p }))); return view(M); };
	it('stays quiet below the minimum picks', () => {
		expect(oddsShifted(withPicks([{ outcome_id: B, points: 100 }]), { leader_id: A })).toBe(false);
	});
	it('fires when the leader changes with enough picks', () => {
		expect(oddsShifted(withPicks(Array.from({ length: 5 }, () => ({ outcome_id: B, points: 20 }))), { leader_id: A })).toBe(true);
	});
	it('fires when the leader gains the configured points, not before', () => {
		const base = { leader_id: A, shares: { [A]: 0.34 } };
		const mk = (n) => withPicks([...Array.from({ length: 5 }, () => ({ outcome_id: A, points: n })), { outcome_id: B, points: 40 }, { outcome_id: C, points: 40 }]);
		expect(oddsShifted(mk(60), base)).toBe(true);
		db.picks.length = 0;
		expect(oddsShifted(mk(4), base)).toBe(false);
	});
});

describe('draftPending', () => {
	it('writes an opened draft once and dedupes on the next tick', async () => {
		const first = await draftPending({ now: NOW });
		expect(first.written.map((w) => w.kind).sort()).toEqual(['locking_soon', 'opened']);
		const second = await draftPending({ now: NOW });
		expect(second.written).toEqual([]);
		expect(db.ann.filter((a) => a.kind === 'opened')).toHaveLength(1);
	});

	it('does not announce locking_soon outside the window', async () => {
		db.markets[0].locks_at = '2026-10-20T00:00:00Z';
		const r = await draftPending({ now: NOW });
		expect(r.written.map((w) => w.kind)).toEqual(['opened']);
	});

	it('a rejected draft is not refilled', async () => {
		await draftPending({ now: NOW });
		db.ann.find((a) => a.kind === 'opened').status = 'rejected';
		const r = await draftPending({ now: NOW });
		expect(r.written.find((w) => w.kind === 'opened')).toBeUndefined();
	});
});

describe('review and poster', () => {
	const draftOpened = async () => {
		await draftPending({ now: NOW });
		return db.ann.find((a) => a.kind === 'opened');
	};

	it('refuses to send a draft that is not approved', async () => {
		const a = await draftOpened();
		await expect(sendAnnouncement(a.id)).rejects.toMatchObject({ code: 'not_approved' });
		await expect(sendAnnouncement(a.id, { dryRun: false, env: { EVENT_MARKET_ANNOUNCE_POST: 'on' }, client: { tweet: vi.fn() } })).rejects.toMatchObject({ code: 'not_approved' });
	});

	it('dry run after approval shows exactly the approved text and sends nothing', async () => {
		const a = await draftOpened();
		await approveAnnouncements([a.id], 'admin-1');
		const out = await sendAnnouncement(a.id);
		expect(out.dry_run).toBe(true);
		expect(out.would_send.text).toBe(a.draft_text);
		expect(out.calls).toEqual([expect.objectContaining({ call: 'tweets.create', text: a.draft_text })]);
		expect(db.ann.find((x) => x.id === a.id).status).toBe('approved');
	});

	it('a live send stays off until the flag is on, then sends the approved text once', async () => {
		const a = await draftOpened();
		await approveAnnouncements([a.id], 'admin-1');
		const client = { tweet: vi.fn(async (p) => ({ data: { id: '123', text: p.text } })) };
		await expect(sendAnnouncement(a.id, { dryRun: false, env: {}, client })).rejects.toMatchObject({ code: 'posting_disabled' });
		expect(client.tweet).not.toHaveBeenCalled();
		const out = await sendAnnouncement(a.id, { dryRun: false, env: { EVENT_MARKET_ANNOUNCE_POST: 'on' }, client });
		expect(client.tweet).toHaveBeenCalledWith({ text: a.draft_text });
		expect(out.announcement.status).toBe('posted');
		await expect(sendAnnouncement(a.id, { dryRun: false, env: { EVENT_MARKET_ANNOUNCE_POST: 'on' }, client })).rejects.toBeInstanceOf(PosterError);
		expect(client.tweet).toHaveBeenCalledTimes(1);
	});

	it('enforces the daily cap', async () => {
		const a = await draftOpened();
		await approveAnnouncements([a.id], 'admin-1');
		for (let i = 0; i < 4; i++) db.ann.push({ id: id(), market_id: id(), kind: 'opened', status: 'posted', posted_at: new Date(), tags: [] });
		await expect(sendAnnouncement(a.id)).rejects.toMatchObject({ code: 'daily_cap' });
	});

	it('an edit may not add a handle the entrant never linked, and re-opens review', async () => {
		const a = await draftOpened();
		await expect(editAnnouncement(a.id, 'Picks are open, cc @someone_else\nhttps://three.ws/event-markets/x')).rejects.toMatchObject({ code: 'validation_error' });
		await approveAnnouncements([a.id], 'admin-1');
		const edited = await editAnnouncement(a.id, `Picks are open and free to play. ${'@atlas_agent'} is in.\nhttps://three.ws/event-markets/spring-build-round`);
		expect(edited.status).toBe('draft');
	});

	it('batch approval reports each failure instead of hiding it', async () => {
		const a = await draftOpened();
		const r = await approveAnnouncements([a.id, id()], 'admin-1');
		expect(r.approved).toHaveLength(1);
		expect(r.failed).toEqual([expect.objectContaining({ reason: 'not found' })]);
	});
});
