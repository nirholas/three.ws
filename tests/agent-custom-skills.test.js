// Prompt-only custom skills: the injection plan (order and token cap), the
// system-prompt block the chat paths add, and the owner-only routes at
// /api/agents/:id/custom-skills (api/agents/[id]/custom-skills.js).
//
// The database is an in-memory agent_custom_skills table that understands
// exactly the statements api/_lib/agent-custom-skills.js issues. Community
// imports read the real committed registry under community-skills/, so an
// import here carries the same SKILL.md body production would inject.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Readable } from 'node:stream';

const OWNER = '11111111-1111-4111-8111-111111111111';
const STRANGER = '22222222-2222-4222-8222-222222222222';
const AGENT = '33333333-3333-4333-8333-333333333333';
const OTHER_AGENT = '44444444-4444-4444-8444-444444444444';

const COLUMNS = { __fragment: 'custom-skill-columns' };
const db = { rows: [], clock: 0, seq: 0 };

function nextUuid() {
	db.seq += 1;
	return `aaaaaaaa-aaaa-4aaa-8aaa-${String(db.seq).padStart(12, '0')}`;
}

function nextTime() {
	db.clock += 1;
	return new Date(Date.UTC(2026, 8, 1, 0, 0, db.clock)).toISOString();
}

function insertRow(q, values) {
	const base = { id: nextUuid(), kind: 'prompt', installed_at: nextTime(), author: null, source_slug: null, source_version: null, source_sha256: null };
	let row;
	if (q.includes('source_sha256')) {
		const [agent_id, user_id, slug, name, description, author, tags, version, content, enabled, source_slug, source_version, source_sha256] = values;
		row = { ...base, agent_id, user_id, slug, name, description, author, tags, version, content, enabled, source: 'community', source_slug, source_version, source_sha256 };
	} else {
		const [agent_id, user_id, slug, name, description, tags, version, content, enabled] = values;
		row = { ...base, agent_id, user_id, slug, name, description, tags, version, content, enabled, source: 'custom' };
	}
	row.updated_at = row.installed_at;
	db.rows.push(row);
	return [{ ...row }];
}

function query(q, values) {
	if (q.startsWith('SELECT id, user_id, name FROM agent_identities')) {
		const owners = { [AGENT]: OWNER, [OTHER_AGENT]: STRANGER };
		return owners[values[0]] ? [{ id: values[0], user_id: owners[values[0]], name: 'Scout' }] : [];
	}
	const ofAgent = (id) => db.rows.filter((r) => r.agent_id === id);
	if (q.startsWith('SELECT ? FROM agent_custom_skills WHERE agent_id = ? ORDER BY')) return ofAgent(values[1]).map((r) => ({ ...r }));
	if (q.startsWith('SELECT ? FROM agent_custom_skills WHERE id = ? AND agent_id = ?')) {
		return db.rows.filter((r) => r.id === values[1] && r.agent_id === values[2]).map((r) => ({ ...r }));
	}
	if (q.startsWith('SELECT id, slug, version, content, enabled, installed_at FROM agent_custom_skills')) {
		return ofAgent(values[0]).filter((r) => r.enabled).map((r) => ({ ...r }));
	}
	if (q.startsWith('SELECT count(*)::int AS n FROM agent_custom_skills')) return [{ n: ofAgent(values[0]).length }];
	if (q.startsWith('SELECT slug FROM agent_custom_skills WHERE agent_id = ? AND slug LIKE ?')) {
		const prefix = values[1].replace(/%$/, '');
		return ofAgent(values[0]).filter((r) => r.slug.startsWith(prefix)).map((r) => ({ slug: r.slug }));
	}
	if (q.startsWith('SELECT id FROM agent_custom_skills WHERE agent_id = ? AND slug = ?')) {
		return ofAgent(values[0]).filter((r) => r.slug === values[1]).map((r) => ({ id: r.id }));
	}
	if (q.startsWith('INSERT INTO agent_custom_skills')) return insertRow(q, values);
	if (q.startsWith('UPDATE agent_custom_skills SET')) {
		const [name, description, tags, version, content, enabled, source_version, source_sha256, id, agentId] = values;
		const row = db.rows.find((r) => r.id === id && r.agent_id === agentId);
		Object.assign(row, { name, description, tags, version, content, enabled, source_version, source_sha256, updated_at: nextTime() });
		return [{ ...row }];
	}
	if (q.startsWith('DELETE FROM agent_custom_skills WHERE id = ? AND agent_id = ?')) {
		db.rows = db.rows.filter((r) => !(r.id === values[0] && r.agent_id === values[1]));
		return [];
	}
	throw new Error(`unexpected query in test: ${q.slice(0, 120)}`);
}

vi.mock('../api/_lib/db.js', () => ({
	sql: vi.fn((strings, ...values) => {
		const q = strings.join('?').replace(/\s+/g, ' ').trim();
		if (q.startsWith('id, agent_id, kind, slug')) return COLUMNS;
		return Promise.resolve().then(() => query(q, values));
	}),
}));

const authState = { user: null };
vi.mock('../api/_lib/auth.js', () => ({
	getRequestUser: vi.fn(async () => authState.user),
	hasScope: (granted, required) => {
		const g = new Set(String(granted || '').split(/\s+/).filter(Boolean));
		return required.split(/\s+/).every((s) => g.has(s));
	},
}));

// CSRF has its own suite; here it passes so the cases exercise the skill logic.
vi.mock('../api/_lib/csrf.js', () => ({ requireCsrf: vi.fn(async () => true) }));

vi.mock('../api/_lib/rate-limit.js', () => ({
	limits: { authIp: vi.fn(async () => ({ success: true })) },
	clientIp: () => '127.0.0.1',
}));

const lib = await import('../api/_lib/agent-custom-skills.js');
const { getCommunitySkill } = await import('../api/_lib/community-skills.js');
const { default: handler } = await import('../api/agents/[id]/custom-skills.js');

function mockRes() {
	return {
		statusCode: 200,
		_headers: {},
		_body: '',
		setHeader(k, v) { this._headers[k.toLowerCase()] = v; },
		getHeader(k) { return this._headers[k.toLowerCase()]; },
		end(b) { this._body = b || ''; },
		get headersSent() { return false; },
		get writableEnded() { return false; },
		get json() { try { return JSON.parse(this._body); } catch { return null; } },
	};
}

async function call(method, path, body) {
	const req = Readable.from(body != null ? [Buffer.from(JSON.stringify(body))] : []);
	const [agentId, skillId] = path.split('/');
	const qs = new URLSearchParams({ id: agentId, ...(skillId ? { skill_id: skillId } : {}) });
	req.method = method;
	req.url = `/api/agents/[id]/custom-skills?${qs}`;
	req.headers = { origin: 'http://localhost:3000', 'content-type': 'application/json' };
	const res = mockRes();
	await handler(req, res);
	return { status: res.statusCode, body: res.json };
}

function skill(over) {
	return { id: `s-${over.slug}`, version: '1.0.0', enabled: true, content: 'x'.repeat(400), installed_at: '2026-09-01T00:00:00Z', ...over };
}

beforeEach(() => {
	db.rows = [];
	db.clock = 0;
	db.seq = 0;
	authState.user = { id: OWNER, source: 'session' };
});

describe('planInjection', () => {
	it('orders skills by install time, then id, regardless of input order', () => {
		const plan = lib.planInjection([
			skill({ slug: 'third', installed_at: '2026-09-03T00:00:00Z' }),
			skill({ slug: 'first', installed_at: '2026-09-01T00:00:00Z', id: 'b' }),
			skill({ slug: 'tie-winner', installed_at: '2026-09-01T00:00:00Z', id: 'a' }),
			skill({ slug: 'second', installed_at: '2026-09-02T00:00:00Z' }),
		]);
		expect(plan.skills.map((s) => s.slug)).toEqual(['tie-winner', 'first', 'second', 'third']);
		expect(plan.skills.every((s) => s.injected)).toBe(true);
		expect(plan.budget).toMatchObject({ cap_tokens: lib.CUSTOM_SKILL_TOKEN_CAP, used_tokens: 400, injected_count: 4, skipped_over_budget: [] });
	});

	it('skips a skill that would overflow the cap whole, and lets a later smaller one in', () => {
		const plan = lib.planInjection(
			[
				skill({ slug: 'a', content: 'x'.repeat(400), installed_at: '2026-09-01T00:00:00Z' }),
				skill({ slug: 'too-big', content: 'x'.repeat(400), installed_at: '2026-09-02T00:00:00Z' }),
				skill({ slug: 'small', content: 'x'.repeat(40), installed_at: '2026-09-03T00:00:00Z' }),
			],
			150,
		);
		expect(plan.skills.map((s) => [s.slug, s.injected, s.skip_reason])).toEqual([
			['a', true, null],
			['too-big', false, 'over_budget'],
			['small', true, null],
		]);
		expect(plan.budget).toMatchObject({ used_tokens: 110, enabled_tokens: 210, remaining_tokens: 40, injected_count: 2, skipped_over_budget: ['too-big'] });
	});

	it('never injects a disabled skill and does not charge it to the budget', () => {
		const plan = lib.planInjection([skill({ slug: 'off', enabled: false }), skill({ slug: 'on', installed_at: '2026-09-02T00:00:00Z' })]);
		expect(plan.skills.map((s) => [s.slug, s.skip_reason])).toEqual([['off', 'disabled'], ['on', null]]);
		expect(plan.budget.used_tokens).toBe(100);
		expect(plan.budget.enabled_tokens).toBe(100);
	});

	it('fits two of the largest skills the registry accepts side by side', async () => {
		const { LIMITS } = await import('../community-skills/tools/registry.mjs');
		expect(lib.estimateTokens('x'.repeat(LIMITS.bodyMaxChars)) * 2).toBeLessThanOrEqual(lib.CUSTOM_SKILL_TOKEN_CAP);
	});
});

describe('customSkillsPromptBlock', () => {
	it('is empty when nothing is injected', () => {
		expect(lib.customSkillsPromptBlock(lib.planInjection([]))).toBe('');
		expect(lib.customSkillsPromptBlock(lib.planInjection([skill({ slug: 'off', enabled: false })]))).toBe('');
	});

	it('renders injected skills in install order under one fixed header, and is byte-stable', () => {
		const rows = [
			skill({ slug: 'later', content: 'Do the later thing.', installed_at: '2026-09-02T00:00:00Z', version: '2.1.0' }),
			skill({ slug: 'earlier', content: 'Do the earlier thing.', installed_at: '2026-09-01T00:00:00Z' }),
		];
		const block = lib.customSkillsPromptBlock(lib.planInjection(rows));
		expect(block.startsWith('Agent skills: your owner installed these instruction sets on you.')).toBe(true);
		const earlier = block.indexOf('--- skill: earlier (v1.0.0) ---\nDo the earlier thing.');
		const later = block.indexOf('--- skill: later (v2.1.0) ---\nDo the later thing.');
		expect(earlier).toBeGreaterThan(0);
		expect(later).toBeGreaterThan(earlier);
		expect(lib.customSkillsPromptBlock(lib.planInjection([...rows].reverse()))).toBe(block);
	});
});

describe('/api/agents/:id/custom-skills', () => {
	it('rejects an anonymous caller, a stranger, and a bearer token without the write scope', async () => {
		authState.user = null;
		expect((await call('GET', AGENT)).status).toBe(401);
		authState.user = { id: STRANGER, source: 'session' };
		expect((await call('GET', AGENT)).body).toMatchObject({ error: 'forbidden' });
		authState.user = { id: OWNER, source: 'bearer', scope: 'agents:read' };
		expect((await call('GET', AGENT)).status).toBe(200);
		expect((await call('POST', AGENT, { source: 'community', slug: 'risk-manager' })).body).toMatchObject({ error: 'insufficient_scope' });
	});

	it('returns an empty list with the full budget for a fresh agent', async () => {
		const { status, body } = await call('GET', AGENT);
		expect(status).toBe(200);
		expect(body.data.skills).toEqual([]);
		expect(body.data.budget).toMatchObject({ cap_tokens: lib.CUSTOM_SKILL_TOKEN_CAP, used_tokens: 0, remaining_tokens: lib.CUSTOM_SKILL_TOKEN_CAP });
	});

	it('imports a community skill with its registry body, then refuses a duplicate with the existing id', async () => {
		const registry = getCommunitySkill('risk-manager');
		const created = await call('POST', AGENT, { source: 'community', slug: 'risk-manager' });
		expect(created.status).toBe(201);
		expect(created.body.data.skill).toMatchObject({
			slug: 'risk-manager',
			source: 'community',
			source_sha256: registry.sha256,
			content: registry.body,
			injected: true,
			registry: { slug: 'risk-manager', update_available: false },
		});
		expect(created.body.data.budget.used_tokens).toBe(lib.estimateTokens(registry.body));

		const again = await call('POST', AGENT, { source: 'community', slug: 'risk-manager' });
		expect(again.status).toBe(409);
		expect(again.body).toMatchObject({ error: 'already_installed', skill_id: created.body.data.skill.id });

		expect((await call('POST', AGENT, { source: 'community', slug: 'no-such-skill' })).status).toBe(404);
	});

	it('creates a hand-written skill with a free slug and validates the body', async () => {
		const a = await call('POST', AGENT, { name: 'House Rules', content: 'Always answer in one sentence.' });
		const b = await call('POST', AGENT, { name: 'House Rules', content: 'Always sign off with the date.' });
		expect([a.status, b.status]).toEqual([201, 201]);
		expect([a.body.data.skill.slug, b.body.data.skill.slug]).toEqual(['house-rules', 'house-rules-2']);
		expect((await call('POST', AGENT, { name: 'x', content: '' })).body).toMatchObject({ error: 'validation_error' });
		expect((await call('POST', AGENT, { name: 'Clash', slug: 'house-rules', content: 'y' })).body).toMatchObject({ error: 'slug_taken' });
	});

	it('toggles enabled, edits content, and the chat prompt follows', async () => {
		const { body } = await call('POST', AGENT, { name: 'Tone', content: 'Be terse.' });
		const id = body.data.skill.id;

		const off = await call('PATCH', `${AGENT}/${id}`, { enabled: false });
		expect(off.body.data.skill).toMatchObject({ enabled: false, injected: false, skip_reason: 'disabled' });
		expect(off.body.data.budget.used_tokens).toBe(0);
		expect((await lib.agentSkillsForPrompt(AGENT)).block).toBe('');

		const on = await call('PATCH', `${AGENT}/${id}`, { enabled: true, content: 'Be terse. Use bullet points.' });
		expect(on.body.data.skill).toMatchObject({ enabled: true, injected: true, content: 'Be terse. Use bullet points.' });
		const prompt = await lib.agentSkillsForPrompt(AGENT);
		expect(prompt.applied).toEqual(['tone']);
		expect(prompt.block).toContain('--- skill: tone (v1.0.0) ---\nBe terse. Use bullet points.');

		expect((await call('PATCH', `${AGENT}/${id}`, {})).body).toMatchObject({ error: 'validation_error' });
		expect((await call('PATCH', `${AGENT}/${id}`, { resync: true })).body).toMatchObject({ error: 'not_imported' });
	});

	it('re-syncs an edited import back to the registry revision', async () => {
		const { body } = await call('POST', AGENT, { source: 'community', slug: 'dca-planner' });
		const id = body.data.skill.id;
		await call('PATCH', `${AGENT}/${id}`, { content: 'My own edit.' });
		const synced = await call('PATCH', `${AGENT}/${id}`, { resync: true });
		expect(synced.body.data.skill.content).toBe(getCommunitySkill('dca-planner').body);
	});

	it('reads one skill with its place in the budget, and deletes it for good', async () => {
		const { body } = await call('POST', AGENT, { name: 'Tone', content: 'Be terse.' });
		const id = body.data.skill.id;
		const one = await call('GET', `${AGENT}/${id}`);
		expect(one.body.data.skill).toMatchObject({ id, injected: true, tokens: 3 });

		const gone = await call('DELETE', `${AGENT}/${id}`);
		expect(gone.body.data).toMatchObject({ deleted: true, id, slug: 'tone', skills: [] });
		expect((await call('GET', `${AGENT}/${id}`)).status).toBe(404);
		expect((await call('GET', `${AGENT}/not-a-uuid`)).status).toBe(400);
	});

	it('hands the chat path every enabled skill in install order', async () => {
		await call('POST', AGENT, { source: 'community', slug: 'risk-manager' });
		await call('POST', AGENT, { name: 'Tone', content: 'Be terse.' });
		await call('POST', AGENT, { source: 'community', slug: 'token-safety-check' });
		const { applied, block } = await lib.agentSkillsForPrompt(AGENT);
		expect(applied).toEqual(['risk-manager', 'tone', 'token-safety-check']);
		expect(block.indexOf('skill: risk-manager')).toBeLessThan(block.indexOf('skill: tone'));
		expect(block.indexOf('skill: tone')).toBeLessThan(block.indexOf('skill: token-safety-check'));
	});
});
