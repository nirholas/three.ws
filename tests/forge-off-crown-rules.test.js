// Forge-Off contest rules, end to end through the real handlers.
//
// The crowns, the event endpoint and the vote store run unmodified against an
// in-memory stand-in for Postgres (the only stubbed boundary). The stand-in
// keeps three tables (forge_creations, forge_votes, the two winner tables) and
// answers each query from what its SQL text asks for, so a query that forgets
// a filter (visibility, a vote deadline) gets the rows it would really get.
//
// Every time is derived from the shipped event config, so moving the event's
// dates in data/forge-off-events.json does not break these tests.

import { describe, it, expect, beforeEach, vi } from 'vitest';

vi.hoisted(() => {
	Object.assign(process.env, {
		DATABASE_URL: 'postgres://test:test@localhost:5432/test',
		S3_ENDPOINT: 'https://s3.example.com',
		S3_BUCKET: 'test-bucket',
		S3_PUBLIC_DOMAIN: 'https://cdn.example.com',
		S3_ACCESS_KEY_ID: 'test-key',
		S3_SECRET_ACCESS_KEY: 'test-secret',
	});
});

const db = { creations: [], votes: [], eventWinners: [], boardWinners: [] };

const iso = (d) => new Date(d).toISOString();
const ms = (d) => new Date(d).getTime();
const rawCount = (id) => db.votes.filter((v) => v.creation_id === id).length;

// The WHERE clauses a forge_creations query states, applied to a row.
function passesStatedFilters(text, c) {
	if (text.includes("status = 'done'") && c.status !== 'done') return false;
	if (text.includes('glb_url is not null') && !c.glb_url) return false;
	if (text.includes("outcome != 'rejected'") && c.outcome === 'rejected') return false;
	if (text.includes("visibility = 'public'") && !(c.visibility == null || c.visibility === 'public')) return false;
	if (text.includes("safety_status is distinct from 'blocked'") && c.safety_status === 'blocked') return false;
	if (text.includes("safety_status is distinct from 'held'") && c.safety_status === 'held') return false;
	return true;
}

function inWindow(c, values) {
	const [from, to] = values;
	return ms(c.created_at) >= ms(from) && ms(c.created_at) < ms(to);
}

async function fakeSql(strings, ...values) {
	const text = strings.join('?').replace(/\s+/g, ' ').toLowerCase();
	if (text.includes('insert into forge_event_winners')) {
		const [event_slug, board_key, theme, creation_id, votes, prompt, glb_url, preview_image_url, model_category] = values;
		if (db.eventWinners.some((w) => w.event_slug === event_slug && w.board_key === board_key)) return [];
		db.eventWinners.push({ event_slug, board_key, theme, creation_id, votes, prompt, glb_url, preview_image_url, model_category, crowned_at: new Date() });
		return [{ board_key }];
	}
	if (text.includes('insert into forge_board_winners')) {
		const [week_start, creation_id, votes, prompt] = values;
		if (db.boardWinners.some((w) => w.week_start === week_start)) return [];
		db.boardWinners.push({ week_start, creation_id, votes, prompt });
		return [{ week_start }];
	}
	if (text.includes('from forge_event_winners')) {
		return db.eventWinners.map((w) => {
			const c = db.creations.find((x) => x.id === w.creation_id) || null;
			return {
				...w,
				creation_status: c?.status ?? null,
				creation_glb_url: c?.glb_url ?? null,
				creation_outcome: c?.outcome ?? null,
				creation_visibility: c?.visibility ?? null,
				creation_safety_status: c?.safety_status ?? null,
			};
		});
	}
	if (text.includes('insert into forge_votes')) {
		const [creation_id, voter_key, ip_hash] = values;
		if (!db.votes.some((v) => v.creation_id === creation_id && v.voter_key === voter_key)) {
			db.votes.push({ creation_id, voter_key, ip_hash, created_at: new Date() });
		}
		return [];
	}
	if (text.includes('update forge_creations set vote_count')) {
		return [{ vote_count: rawCount(values[0]) }];
	}
	if (text.includes('from forge_votes')) {
		return db.votes
			.filter((v) => {
				const c = db.creations.find((x) => x.id === v.creation_id);
				return c && inWindow(c, values) && passesStatedFilters(text, c);
			})
			.map((v) => ({ ...v }));
	}
	if (text.includes('from forge_creations') && text.includes('where id = ?')) {
		const c = db.creations.find((x) => x.id === values[0]);
		return c && passesStatedFilters(text, c) ? [{ id: c.id }] : [];
	}
	if (text.includes('from forge_creations')) {
		const rows = db.creations.filter((c) => inWindow(c, values) && passesStatedFilters(text, c));
		if (text.includes('vote_count >= 1')) {
			// The legacy single-row crown read: the denormalized all-time tally.
			return rows
				.map((c) => ({ ...c, vote_count: rawCount(c.id) }))
				.filter((c) => c.vote_count >= 1)
				.sort((a, b) => b.vote_count - a.vote_count || ms(b.created_at) - ms(a.created_at))
				.slice(0, 1);
		}
		return rows.map((c) => ({ ...c, vote_count: rawCount(c.id) }));
	}
	return [];
}

vi.mock('../api/_lib/db.js', () => ({
	sql: (...a) => fakeSql(...a),
	isDbUnavailableError: () => false,
}));
vi.mock('../api/_lib/rate-limit.js', () => ({
	limits: { publicIp: vi.fn(async () => ({ success: true })) },
	clientIp: vi.fn(() => '127.0.0.1'),
}));
vi.mock('../api/_lib/cron-auth.js', () => ({ requireCron: () => true }));
// The legacy event endpoint ranked boards through listShowcase; this mirrors
// that query's semantics (window, public bar, all-time vote_count ordering) so
// the endpoint test measures the endpoint, not a missing database.
vi.mock('../api/_lib/forge-store.js', async (importActual) => {
	const actual = await importActual();
	return {
		...actual,
		forgeStoreEnabled: () => true,
		listShowcase: async ({ limit = 12, from, to } = {}) =>
			db.creations
				.filter((c) => c.status === 'done' && c.glb_url && c.outcome !== 'rejected')
				.filter((c) => c.visibility == null || c.visibility === 'public')
				.filter((c) => (!from || ms(c.created_at) >= ms(from)) && (!to || ms(c.created_at) < ms(to)))
				.map((c) => ({ id: c.id, prompt: c.prompt, preview_image_url: c.preview_image_url, created_at: c.created_at, vote_count: rawCount(c.id), voted: false }))
				.sort((a, b) => b.vote_count - a.vote_count || ms(b.created_at) - ms(a.created_at))
				.slice(0, limit),
	};
});

const { getEvent } = await import('../api/_lib/forge-off-events.js');
const { castVote, hashClient } = await import('../api/_lib/forge-store.js');
const eventCrown = (await import('../api/cron/forge-off-event-crown.js')).default;
const weeklyCrown = (await import('../api/cron/forge-off-crown.js')).default;
const eventApi = (await import('../api/forge-off/event.js')).default;

const SLUG = 'ibm-forge-off-open';
const EVENT = getEvent(SLUG);
const DAY1 = EVENT.days[0];
const H = 3_600_000;

function mkReq(url, headers = {}) {
	return { method: 'GET', url, headers, on() {}, destroy() {} };
}
function mkRes() {
	return {
		statusCode: 200,
		headers: {},
		body: '',
		setHeader(k, v) { this.headers[k.toLowerCase()] = v; },
		getHeader(k) { return this.headers[k.toLowerCase()]; },
		end(c) { if (c !== undefined) this.body += String(c); this.writableEnded = true; },
	};
}
async function call(handler, url, headers) {
	const res = mkRes();
	await handler(mkReq(url, headers), res);
	return { status: res.statusCode, body: JSON.parse(res.body) };
}

let seq = 0;
function creation(overrides = {}) {
	seq += 1;
	const id = `00000000-0000-4000-8000-${String(seq).padStart(12, '0')}`;
	const row = {
		id,
		prompt: `entry ${seq}`,
		glb_url: `https://cdn.example.com/forge/${id}.glb`,
		web_glb_url: null,
		preview_image_url: `https://cdn.example.com/forge/thumb/${id}.webp`,
		model_category: 'item',
		status: 'done',
		outcome: null,
		visibility: null,
		safety_status: 'clear',
		client_key: `owner-${seq}`,
		created_at: new Date(ms(DAY1.start) + H),
		...overrides,
	};
	db.creations.push(row);
	return row;
}
let voterSeq = 0;
function vote(c, at, overrides = {}) {
	voterSeq += 1;
	db.votes.push({ creation_id: c.id, voter_key: `voter-${voterSeq}`, ip_hash: `ip-${voterSeq}`, created_at: new Date(at), ...overrides });
}
function votes(c, n, at, overrides = {}) {
	for (let i = 0; i < n; i++) vote(c, at, overrides);
}

beforeEach(() => {
	db.creations.length = 0;
	db.votes.length = 0;
	db.eventWinners.length = 0;
	db.boardWinners.length = 0;
	vi.useRealTimers();
});

const crownAt = (t, extra = '') => call(eventCrown, `/api/cron/forge-off-event-crown?now=${iso(t).replace('.000Z', 'Z')}${extra}`);

describe('event crown: the vote deadline', () => {
	it('a vote cast after the day closed does not decide that day', async () => {
		const a = creation({ created_at: new Date(ms(DAY1.start) + 1 * H) });
		const b = creation({ created_at: new Date(ms(DAY1.start) + 2 * H) });
		votes(a, 3, ms(DAY1.start) + 3 * H);
		votes(b, 2, ms(DAY1.start) + 3 * H);
		vote(b, DAY1.end); // exactly at the close: too late
		vote(b, ms(DAY1.end) + 5 * 60_000); // between the close and the cron
		const { status, body } = await crownAt(ms(DAY1.end) + 7 * 60_000);
		expect(status).toBe(200);
		expect(body.crowned.map((c) => [c.board_key, c.creation_id, c.votes])).toEqual([['day-1', a.id, 3]]);
		expect(db.eventWinners).toHaveLength(1);
		expect(db.eventWinners[0].creation_id).toBe(a.id);
	});

	it('a crown replayed days later counts the same votes as one run at the close', async () => {
		const a = creation();
		const b = creation({ created_at: new Date(ms(DAY1.start) + 2 * H) });
		votes(a, 2, ms(DAY1.end) - 1000); // one second before the close: counts
		votes(b, 5, ms(DAY1.end) + 3 * 86_400_000);
		const { body } = await crownAt(ms(DAY1.end) + 3 * 86_400_000 + H);
		expect(body.crowned.find((c) => c.board_key === 'day-1')?.creation_id).toBe(a.id);
	});
});

describe('event crown: who may win', () => {
	it('ties go to the entry published first', async () => {
		const first = creation({ created_at: new Date(ms(DAY1.start) + 1 * H) });
		const later = creation({ created_at: new Date(ms(DAY1.start) + 5 * H) });
		votes(first, 2, ms(DAY1.start) + 6 * H);
		votes(later, 2, ms(DAY1.start) + 6 * H);
		const { body } = await crownAt(ms(DAY1.end) + 7 * 60_000);
		expect(body.crowned[0].creation_id).toBe(first.id);
	});

	it('a vote from the browser that made the entry does not count', async () => {
		const a = creation({ created_at: new Date(ms(DAY1.start) + 5 * H), client_key: 'maker-a' });
		const b = creation({ created_at: new Date(ms(DAY1.start) + 1 * H) });
		vote(a, ms(DAY1.start) + 6 * H, { voter_key: 'maker-a' });
		votes(a, 2, ms(DAY1.start) + 6 * H);
		votes(b, 3, ms(DAY1.start) + 6 * H);
		const { body } = await crownAt(ms(DAY1.end) + 7 * 60_000);
		expect(body.crowned[0]).toMatchObject({ creation_id: b.id, votes: 3 });
	});

	it('one network rotating browser ids adds at most three votes to an entry', async () => {
		const stuffed = creation({ created_at: new Date(ms(DAY1.start) + 1 * H) });
		const honest = creation({ created_at: new Date(ms(DAY1.start) + 2 * H) });
		votes(stuffed, 40, ms(DAY1.start) + 3 * H, { ip_hash: 'one-machine' });
		votes(honest, 4, ms(DAY1.start) + 3 * H);
		const { body } = await crownAt(ms(DAY1.end) + 7 * 60_000);
		expect(body.crowned[0]).toMatchObject({ creation_id: honest.id, votes: 4 });
	});

	it('an entry not yet cleared by the content screen is not crowned; the board waits', async () => {
		const unscreened = creation({ safety_status: null });
		const runnerUp = creation({ created_at: new Date(ms(DAY1.start) + 2 * H) });
		votes(unscreened, 3, ms(DAY1.start) + 3 * H);
		votes(runnerUp, 1, ms(DAY1.start) + 3 * H);
		const first = await crownAt(ms(DAY1.end) + 7 * 60_000);
		expect(first.body.crowned).toEqual([]);
		expect(first.body.deferred).toEqual([expect.objectContaining({ board_key: 'day-1', creation_id: unscreened.id, reason: 'awaiting_content_screen' })]);
		expect(db.eventWinners).toHaveLength(0);
		unscreened.safety_status = 'clear';
		const second = await crownAt(ms(DAY1.end) + 67 * 60_000);
		expect(second.body.crowned[0]).toMatchObject({ board_key: 'day-1', creation_id: unscreened.id });
	});

	it('a private, rejected or held entry never wins', async () => {
		const priv = creation({ visibility: 'private' });
		const rejected = creation({ outcome: 'rejected' });
		const held = creation({ safety_status: 'held' });
		const ok = creation({ created_at: new Date(ms(DAY1.start) + 9 * H) });
		for (const c of [priv, rejected, held]) votes(c, 9, ms(DAY1.start) + 10 * H);
		vote(ok, ms(DAY1.start) + 10 * H);
		const { body } = await crownAt(ms(DAY1.end) + 7 * 60_000);
		expect(body.crowned[0].creation_id).toBe(ok.id);
	});
});

describe('event crown: idempotence and empty boards', () => {
	it('running the crown twice crowns each board once', async () => {
		const a = creation();
		votes(a, 2, ms(DAY1.start) + 2 * H);
		const t = ms(EVENT.end) + 7 * 60_000;
		const one = await crownAt(t);
		expect(one.body.crowned.map((c) => c.board_key)).toEqual(['day-1', 'overall']);
		const two = await crownAt(t + H);
		expect(two.status).toBe(200);
		expect(two.body.crowned).toEqual([]);
		expect(db.eventWinners.map((w) => [w.board_key, w.creation_id])).toEqual([['day-1', a.id], ['overall', a.id]]);
	});

	it('an event with no entries ends cleanly with nobody crowned', async () => {
		const { status, body } = await crownAt(ms(EVENT.end) + 7 * 60_000);
		expect(status).toBe(200);
		expect(body.ok).toBe(true);
		expect(body.crowned).toEqual([]);
		expect(db.eventWinners).toHaveLength(0);
	});

	it('an event with entries but no votes ends cleanly with nobody crowned', async () => {
		creation();
		creation({ created_at: new Date(ms(EVENT.days[3].start) + H) });
		const { body } = await crownAt(ms(EVENT.end) + 7 * 60_000);
		expect(body.crowned).toEqual([]);
		expect(db.eventWinners).toHaveLength(0);
	});
});

describe('weekly crown', () => {
	const WEEK = '2026-11-09'; // a Monday
	const weekStart = Date.parse(`${WEEK}T00:00:00Z`);
	const weekEnd = weekStart + 7 * 86_400_000;

	it('never crowns a private model', async () => {
		const priv = creation({ visibility: 'private', created_at: new Date(weekStart + H) });
		const pub = creation({ created_at: new Date(weekStart + 2 * H) });
		votes(priv, 5, weekStart + 3 * H);
		vote(pub, weekStart + 3 * H);
		const { body } = await call(weeklyCrown, `/api/cron/forge-off-crown?week=${WEEK}`);
		expect(body.winner?.creation_id).toBe(pub.id);
		expect(db.boardWinners.map((w) => w.creation_id)).toEqual([pub.id]);
	});

	it('counts only votes cast before the week closed', async () => {
		const a = creation({ created_at: new Date(weekStart + H) });
		const b = creation({ created_at: new Date(weekStart + 2 * H) });
		votes(a, 2, weekEnd - 1000);
		vote(b, weekStart + 3 * H);
		votes(b, 2, weekEnd);
		const { body } = await call(weeklyCrown, `/api/cron/forge-off-crown?week=${WEEK}`);
		expect(body.winner).toMatchObject({ creation_id: a.id, votes: 2 });
	});
});

describe('GET /api/forge-off/event', () => {
	it('between events, the default view is "no event right now" with past events and their winners', async () => {
		db.eventWinners.push({ event_slug: SLUG, board_key: 'overall', theme: EVENT.title, creation_id: null, votes: 4, prompt: 'gone', glb_url: 'g', preview_image_url: 'p', model_category: 'item', crowned_at: new Date(EVENT.end) });
		vi.useFakeTimers({ toFake: ['Date'] });
		vi.setSystemTime(new Date(ms(EVENT.end) + 86_400_000));
		const { status, body } = await call(eventApi, '/api/forge-off/event');
		expect(status).toBe(200);
		expect(body.phase).toBe('none');
		expect(body.slug ?? null).toBeNull();
		const past = body.events.find((e) => e.slug === SLUG);
		expect(past).toMatchObject({ phase: 'ended', title: EVENT.title });
		expect(past.winner).toMatchObject({ removed: true });
	});

	it('a closed day ranks by votes cast before its close', async () => {
		const a = creation({ created_at: new Date(ms(DAY1.start) + 1 * H) });
		const b = creation({ created_at: new Date(ms(DAY1.start) + 2 * H) });
		votes(a, 3, ms(DAY1.start) + 3 * H);
		votes(b, 2, ms(DAY1.start) + 3 * H);
		votes(b, 2, ms(DAY1.end) + 30 * 60_000);
		vi.useFakeTimers({ toFake: ['Date'] });
		vi.setSystemTime(new Date(ms(DAY1.end) + 2 * H));
		const { body } = await call(eventApi, `/api/forge-off/event?slug=${SLUG}`);
		expect(body.days[0].top.map((c) => [c.id, c.vote_count])).toEqual([[a.id, 3], [b.id, 2]]);
		expect(body.days[0].closed).toBe(true);
	});

	it('a crowned winner that was later made private is shown as withdrawn, without its model', async () => {
		const w = creation();
		db.eventWinners.push({ event_slug: SLUG, board_key: 'day-1', theme: DAY1.theme, creation_id: w.id, votes: 2, prompt: w.prompt, glb_url: w.glb_url, preview_image_url: w.preview_image_url, model_category: 'item', crowned_at: new Date(DAY1.end) });
		w.visibility = 'private';
		vi.useFakeTimers({ toFake: ['Date'] });
		vi.setSystemTime(new Date(ms(DAY1.end) + 2 * H));
		const { body } = await call(eventApi, `/api/forge-off/event?slug=${SLUG}`);
		expect(body.days[0].winner).toEqual({ removed: true, votes: 2 });
		expect(body.days[0].top.map((c) => c.id)).not.toContain(w.id);
	});
});

describe('castVote eligibility', () => {
	it('refuses a vote on a private or screen-blocked model', async () => {
		const priv = creation({ visibility: 'private' });
		const blocked = creation({ safety_status: 'blocked' });
		const unlisted = creation({ visibility: 'unlisted' });
		const pub = creation();
		const voterKey = hashClient('a-real-browser');
		expect(await castVote({ creationId: priv.id, voterKey })).toBeNull();
		expect(await castVote({ creationId: blocked.id, voterKey })).toBeNull();
		expect(await castVote({ creationId: unlisted.id, voterKey })).toBeNull();
		expect(await castVote({ creationId: pub.id, voterKey })).toMatchObject({ voted: true, voteCount: 1 });
	});
});
