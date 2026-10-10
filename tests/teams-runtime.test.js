// Specialist team runtime: role permissions, the policy, finding expiry and
// research reuse. The pure rules are pinned directly; the board and the Trader's
// cite-or-research flow run as real SQL against an in-process Postgres (PGlite)
// built from the team migration itself, so the constraints under test are the
// ones production enforces.
//
// Only the two outside executors are replaced: researchMint (it reaches the
// chain and the intel worker) and the agent trade engine (it quotes against a
// live venue). Both are spied so a test can prove they were, or were not, run.

import { readFileSync } from 'node:fs';
import { beforeAll, beforeEach, describe, it, expect, vi } from 'vitest';
import { PublicKey } from '@solana/web3.js';

const holder = vi.hoisted(() => ({ db: null, research: null, trade: null }));

// The team modules build their column lists as sql fragments at import time, so
// the in-process database exists before any of them load.
vi.mock('../api/_lib/db.js', async (importActual) => {
	const actual = await importActual();
	const { createPgliteSql } = await import('./_helpers/pglite-sql.js');
	holder.db ??= createPgliteSql();
	return { ...actual, sql: (...args) => holder.db.sql(...args) };
});
vi.mock('../api/_lib/r2.js', () => ({ publicUrlOrNull: () => null, thumbnailUrl: () => null }));
vi.mock('../api/_lib/teams/research.js', async (importActual) => {
	const actual = await importActual();
	return {
		...actual,
		researchMint: (...args) => holder.research(...args),
		loadIntelRow: async () => null,
	};
});
vi.mock('../api/agents/agent-trade.js', () => ({
	parseTradeInput: (body) => ({ ...body }),
	previewAgentTrade: (...args) => holder.trade.preview(...args),
	executeAgentTrade: (...args) => holder.trade.execute(...args),
}));

process.env.DATABASE_URL ||= 'postgres://pglite.test/db';

import {
	ROLES, FIXED_ROLES, PERMISSIONS, SIGNING_PERMISSIONS, TeamError,
	effectivePermissions, normalizeGrant, can, assertCan, canSign, defaultPermissions,
} from '../api/_lib/teams/roles.js';
import {
	POLICY_DEFAULTS, normalizeTeamPolicy, expiryFor, isLive, pickReusableResearch, traderClearance,
} from '../api/_lib/teams/findings.js';
import { scoreResearch } from '../api/_lib/teams/research.js';

// Synthetic 32-byte keys: valid Solana address shapes that are nobody's coin.
const MINT = (n) => new PublicKey(Uint8Array.from({ length: 32 }, (_, i) => (i * 7 + n) & 255)).toBase58();

const OWNER = '11111111-1111-4111-8111-111111111111';
const ALL_PERMISSIONS = Object.keys(PERMISSIONS);

function thrown(fn) {
	try {
		fn();
	} catch (e) {
		return e;
	}
	return null;
}

async function rejected(promise) {
	try {
		await promise;
	} catch (e) {
		return e;
	}
	return null;
}

// ── role permissions ────────────────────────────────────────────────────────

describe('role permissions', () => {
	it('a Researcher can never sign, even when its row is hand-edited to hold every permission', () => {
		const tampered = { role: 'researcher', status: 'active', permissions: ALL_PERMISSIONS };
		expect(canSign(tampered)).toBe(false);
		expect(can(tampered, 'trade.execute')).toBe(false);
		expect(can(tampered, 'trade.quote')).toBe(false);
		expect(can(tampered, 'launch.prepare')).toBe(false);
		expect(effectivePermissions('researcher', ALL_PERMISSIONS)).toEqual(['findings.read', 'findings.write', 'research.run']);
	});

	it('only the Trader may ever hold a signing permission', () => {
		for (const role of ROLES) {
			const member = { role, status: 'active', permissions: ALL_PERMISSIONS };
			expect(canSign(member), role).toBe(role === 'trader');
		}
		expect([...SIGNING_PERMISSIONS]).toEqual(['trade.execute']);
	});

	it('refuses a grant above the role ceiling instead of silently dropping it', () => {
		for (const role of ['researcher', 'entry', 'launcher', 'custom']) {
			const e = thrown(() => normalizeGrant(role, ['findings.read', 'trade.execute']));
			expect(e).toBeInstanceOf(TeamError);
			expect(e.status).toBe(403);
			expect(e.code).toBe('permission_above_role');
		}
		expect(normalizeGrant('trader', ['trade.quote', 'trade.execute', 'trade.quote'])).toEqual(['trade.quote', 'trade.execute']);
	});

	it('rejects unknown permissions, unknown roles and non-array grants', () => {
		expect(thrown(() => normalizeGrant('researcher', ['wallet.drain'])).code).toBe('bad_permissions');
		expect(thrown(() => normalizeGrant('admin', [])).code).toBe('bad_role');
		expect(thrown(() => normalizeGrant('trader', 'trade.execute')).code).toBe('bad_permissions');
		expect(normalizeGrant('launcher', null)).toEqual(defaultPermissions('launcher'));
	});

	it('assertCan names the missing permission and a removed member holds nothing', () => {
		const researcher = { role: 'researcher', status: 'active', permissions: null };
		const e = thrown(() => assertCan(researcher, 'trade.quote'));
		expect(e.status).toBe(403);
		expect(e.code).toBe('permission_denied');
		expect(e.detail).toEqual({ permission: 'trade.quote', role: 'researcher' });
		expect(can({ role: 'trader', status: 'removed', permissions: null }, 'findings.read')).toBe(false);
	});

	it('a grant can narrow a role below its default', () => {
		const quoteOnly = { role: 'trader', status: 'active', permissions: ['findings.read', 'trade.quote'] };
		expect(can(quoteOnly, 'trade.quote')).toBe(true);
		expect(canSign(quoteOnly)).toBe(false);
	});
});

// ── policy ───────────────────────────────────────────────────────────────────

describe('team policy', () => {
	it('fills defaults and refuses out-of-range caps rather than clamping them', () => {
		expect(normalizeTeamPolicy({})).toEqual({ ...POLICY_DEFAULTS, entry: { ...POLICY_DEFAULTS.entry } });
		expect(thrown(() => normalizeTeamPolicy({ per_trade_sol: 5000 })).code).toBe('bad_policy');
		expect(thrown(() => normalizeTeamPolicy({ finding_ttl_seconds: 5 })).code).toBe('bad_policy');
		expect(thrown(() => normalizeTeamPolicy({ per_trade_sol: 1, daily_budget_sol: 0.5 })).code).toBe('bad_policy');
	});

	it('validates the Entry gates and lets null clear a market-cap bound', () => {
		const p = normalizeTeamPolicy({ entry: { min_quality_score: 72.4, max_market_cap_usd: 250000, require_smart_money: true } });
		expect(p.entry.min_quality_score).toBe(72);
		expect(p.entry.max_market_cap_usd).toBe(250000);
		expect(p.entry.require_smart_money).toBe(true);
		expect(normalizeTeamPolicy({ entry: { max_market_cap_usd: null } }, p).entry.max_market_cap_usd).toBe(null);
		expect(thrown(() => normalizeTeamPolicy({ entry: { max_bundle_score: 2 } })).code).toBe('bad_policy');
		expect(thrown(() => normalizeTeamPolicy({ entry: { min_market_cap_usd: 10, max_market_cap_usd: 5 } })).code).toBe('bad_policy');
	});
});

// ── expiry and reuse (pure) ──────────────────────────────────────────────────

describe('finding expiry and reuse rules', () => {
	const now = Date.parse('2026-10-10T12:00:00Z');

	it('expiry follows the team TTL and a finding without one never expires', () => {
		expect(expiryFor({ finding_ttl_seconds: 600 }, now).toISOString()).toBe('2026-10-10T12:10:00.000Z');
		expect(isLive({ expires_at: '2026-10-10T12:00:01Z' }, now)).toBe(true);
		expect(isLive({ expires_at: '2026-10-10T11:59:59Z' }, now)).toBe(false);
		expect(isLive({ expires_at: null }, now)).toBe(true);
		expect(isLive(null, now)).toBe(false);
	});

	it('picks the newest live research on the mint and skips expired, other mints and other kinds', () => {
		const mint = MINT(1);
		const rows = [
			{ id: 'old', kind: 'research', subject: mint, created_at: '2026-10-10T11:50:00Z', expires_at: '2026-10-10T12:05:00Z' },
			{ id: 'newest', kind: 'research', subject: mint, created_at: '2026-10-10T11:55:00Z', expires_at: '2026-10-10T12:10:00Z' },
			{ id: 'expired', kind: 'research', subject: mint, created_at: '2026-10-10T11:58:00Z', expires_at: '2026-10-10T11:59:00Z' },
			{ id: 'other-mint', kind: 'research', subject: MINT(2), created_at: '2026-10-10T11:59:00Z', expires_at: null },
			{ id: 'signal', kind: 'entry_signal', subject: mint, created_at: '2026-10-10T11:59:30Z', expires_at: null },
		];
		expect(pickReusableResearch(rows, mint, now).id).toBe('newest');
		expect(pickReusableResearch(rows.slice(2, 3), mint, now)).toBe(null);
	});

	it('traderClearance turns a verdict into one named rule', () => {
		expect(traderClearance(null, POLICY_DEFAULTS, 'buy')).toMatchObject({ allowed: false, rule: 'no_research' });
		expect(traderClearance({ verdict: 'pass' }, POLICY_DEFAULTS, 'buy')).toMatchObject({ allowed: true, rule: 'research_pass' });
		expect(traderClearance({ verdict: 'caution' }, POLICY_DEFAULTS, 'buy')).toMatchObject({ allowed: false, rule: 'research_caution_blocked' });
		expect(traderClearance({ verdict: 'caution' }, { allow_caution: true }, 'buy')).toMatchObject({ allowed: true, rule: 'research_caution_allowed' });
		expect(traderClearance({ verdict: 'avoid' }, { allow_caution: true }, 'buy')).toMatchObject({ allowed: false, rule: 'research_avoid' });
		expect(traderClearance(null, POLICY_DEFAULTS, 'sell')).toMatchObject({ allowed: true, rule: 'sell_always_allowed' });
	});
});

describe('research scoring', () => {
	const goodIntel = { quality_score: 80, bundle_score: 0.1, dev_sold: false };

	it('a blocking firewall verdict is always avoid', () => {
		expect(scoreResearch({ safety: { verdict: 'block', score: 95 }, intel: goodIntel, smartMoney: null }).verdict).toBe('avoid');
	});

	it('passes only with a clean firewall, an intel record and no sybil or dev-sell flag', () => {
		const sm = { computed: true, smart_money_score: 70, count: 3, sybil_flag: false };
		const pass = scoreResearch({ safety: { verdict: 'allow', score: 90 }, intel: goodIntel, smartMoney: sm });
		expect(pass.verdict).toBe('pass');
		expect(pass.score).toBe(Math.round(90 * 0.6 + 80 * 0.3 + 70 * 0.1));
		expect(scoreResearch({ safety: { verdict: 'allow', score: 90 }, intel: { ...goodIntel, dev_sold: true }, smartMoney: sm }).verdict).toBe('caution');
		expect(scoreResearch({ safety: { verdict: 'allow', score: 90 }, intel: goodIntel, smartMoney: { ...sm, sybil_flag: true } }).verdict).toBe('caution');
	});

	it('moves the weight of a missing source onto safety and never passes without intel', () => {
		const r = scoreResearch({ safety: { verdict: 'allow', score: 90 }, intel: null, smartMoney: null });
		expect(r.score).toBe(90);
		expect(r.verdict).toBe('caution');
		expect(r.subscores).toEqual({ safety: 90, quality: null, smart_money: null });
	});
});

// ── the board and the Trader on Postgres ─────────────────────────────────────

const PRE_DDL = `
	create table users (id uuid primary key);
	create table avatars (id uuid primary key default gen_random_uuid(), storage_key text, thumbnail_key text, deleted_at timestamptz);
	create table agent_identities (
		id uuid primary key default gen_random_uuid(), user_id uuid, name text, description text,
		avatar_id uuid, meta jsonb default '{}'::jsonb, deleted_at timestamptz
	);
`;

describe('findings board and Trader on Postgres', () => {
	let runtime;
	let findings;
	let team;

	const member = async (role) => (await runtime.resolveActor(team, { role, action: 'trade' })).member;
	const research = (verdict, score = 80) => async () => ({
		verdict,
		score,
		summary: `${verdict} at ${score}/100.`,
		evidence: { network: 'devnet', reasons: [] },
	});

	beforeAll(async () => {
		await holder.db.exec(PRE_DDL);
		await holder.db.exec(readFileSync(new URL('../api/_lib/migrations/20261010120000_teams.sql', import.meta.url), 'utf8'));
		runtime = await import('../api/_lib/teams/runtime.js');
		findings = await import('../api/_lib/teams/findings.js');
	});

	beforeEach(async () => {
		await holder.db.exec('delete from team_findings; delete from team_members; delete from teams; delete from agent_identities; delete from users;');
		await holder.db.query('insert into users (id) values ($1)', [OWNER]);
		const [row] = await holder.db.query(
			`insert into teams (owner_user_id, name, network, status, policy) values ($1, 'Desk', 'devnet', 'active', $2::jsonb) returning *`,
			[OWNER, JSON.stringify({ ...POLICY_DEFAULTS, finding_ttl_seconds: 600 })],
		);
		for (const role of FIXED_ROLES) {
			const [agent] = await holder.db.query(
				`insert into agent_identities (user_id, name, meta) values ($1, $2, $3::jsonb) returning id`,
				[OWNER, `Desk ${role}`, JSON.stringify({ team_id: row.id, team_role: role, solana_address: MINT(90) })],
			);
			await holder.db.query(
				`insert into team_members (team_id, agent_id, role, permissions) values ($1, $2, $3, $4::text[])`,
				[row.id, agent.id, role, defaultPermissions(role)],
			);
		}
		team = { ...row, policy: normalizeTeamPolicy({}, row.policy) };
		holder.research = vi.fn(research('pass'));
		holder.trade = {
			preview: vi.fn(async () => ({ allowed: true, blocked_reason: null, est_out: '1000' })),
			execute: vi.fn(async () => ({ ok: true, status: 200, data: { simulated: true } })),
		};
	});

	it('findLiveResearch returns the newest live finding and ignores expired ones', async () => {
		const researcher = await member('researcher');
		const mint = MINT(3);
		const base = { teamId: team.id, member: researcher, kind: 'research', subject: mint, summary: 's', evidence: {} };
		await findings.insertFinding({ ...base, verdict: 'avoid', expiresAt: new Date(Date.now() - 1000) });
		expect(await findings.findLiveResearch(team.id, mint)).toBe(null);
		const live = await findings.insertFinding({ ...base, verdict: 'pass', score: 81, expiresAt: expiryFor(team.policy) });
		const found = await findings.findLiveResearch(team.id, mint);
		expect(found.id).toBe(live.id);
		expect(found.author_role).toBe('researcher');
		expect(await findings.findLiveResearch(team.id, MINT(4))).toBe(null);
	});

	it('refuses a verdict that does not belong to the finding kind', async () => {
		const researcher = await member('researcher');
		const e = await rejected(findings.insertFinding({ teamId: team.id, member: researcher, kind: 'research', subject: MINT(3), verdict: 'executed', summary: 's' }));
		expect(e.code).toBe('bad_verdict');
	});

	it('a Trader with no live research runs it once, writes it back and cites it', async () => {
		const trader = await member('trader');
		const mint = MINT(5);
		const out = await runtime.runTrade(team, trader, { mint, side: 'buy', amount: 0.01, mode: 'quote' }, { userId: OWNER });

		expect(holder.research).toHaveBeenCalledTimes(1);
		expect(out.research.kind).toBe('research');
		expect(out.research.author_role).toBe('trader');
		expect(new Date(out.research.expires_at).getTime()).toBeGreaterThan(Date.now() + 590_000);
		expect(out.finding.kind).toBe('trade');
		expect(out.finding.verdict).toBe('quoted');
		expect(out.finding.cites).toEqual([out.research.id]);
		expect(out.finding.evidence.research_source).toBe('ran');
		expect(out.finding.evidence.rule).toBe('research_pass');
		expect(holder.trade.preview).toHaveBeenCalledTimes(1);
	});

	it('the next trade reuses the live research instead of redoing it', async () => {
		const trader = await member('trader');
		const mint = MINT(6);
		const first = await runtime.runTrade(team, trader, { mint, side: 'buy', amount: 0.01, mode: 'quote' }, { userId: OWNER });
		const second = await runtime.runTrade(team, trader, { mint, side: 'buy', amount: 0.02, mode: 'simulate' }, { userId: OWNER });

		expect(holder.research).toHaveBeenCalledTimes(1);
		expect(second.finding.evidence.research_source).toBe('reused');
		expect(second.finding.cites).toEqual([first.research.id]);
		expect(second.finding.verdict).toBe('simulated');
		expect(holder.trade.execute.mock.calls[0][0].source).toBe('discretionary');
	});

	it('a Researcher finding is what the Trader cites when one is live', async () => {
		const researcher = await member('researcher');
		const trader = await member('trader');
		const mint = MINT(7);
		const { finding: vetted, reused } = await runtime.runResearch(team, researcher, { mint });
		expect(reused).toBe(false);
		expect((await runtime.runResearch(team, researcher, { mint })).reused).toBe(true);

		const out = await runtime.runTrade(team, trader, { mint, side: 'buy', amount: 0.01, mode: 'quote' }, { userId: OWNER });
		expect(holder.research).toHaveBeenCalledTimes(1);
		expect(out.finding.cites).toEqual([vetted.id]);
		expect(out.research.author_role).toBe('researcher');
	});

	it('expired research is redone, not cited', async () => {
		const trader = await member('trader');
		const mint = MINT(8);
		const first = await runtime.runTrade(team, trader, { mint, side: 'buy', amount: 0.01, mode: 'quote' }, { userId: OWNER });
		await holder.db.query(`update team_findings set expires_at = now() - interval '1 second' where id = $1`, [first.research.id]);

		const second = await runtime.runTrade(team, trader, { mint, side: 'buy', amount: 0.01, mode: 'quote' }, { userId: OWNER });
		expect(holder.research).toHaveBeenCalledTimes(2);
		expect(second.research.id).not.toBe(first.research.id);
		expect(second.finding.cites).toEqual([second.research.id]);
		expect(second.finding.evidence.research_source).toBe('ran');
	});

	it('an avoid verdict is refused before the trade engine runs, and the refusal cites it', async () => {
		holder.research = vi.fn(research('avoid', 20));
		const trader = await member('trader');
		const out = await runtime.runTrade(team, trader, { mint: MINT(9), side: 'buy', amount: 0.01, mode: 'simulate' }, { userId: OWNER });
		expect(out.finding.verdict).toBe('refused');
		expect(out.finding.evidence.rule).toBe('research_avoid');
		expect(out.finding.cites).toEqual([out.research.id]);
		expect(holder.trade.preview).not.toHaveBeenCalled();
		expect(holder.trade.execute).not.toHaveBeenCalled();
	});

	it('a Researcher can never trade, even with a hand-edited permissions row', async () => {
		const researcher = await member('researcher');
		await holder.db.query(`update team_members set permissions = $1::text[] where id = $2`, [ALL_PERMISSIONS, researcher.id]);
		const tampered = await member('researcher');
		expect(tampered.permissions).toContain('trade.execute');

		for (const mode of ['quote', 'live']) {
			const e = await rejected(runtime.runTrade(team, tampered, { mint: MINT(10), side: 'buy', amount: 0.01, mode, confirm: true }, { userId: OWNER }));
			expect(e.code).toBe('permission_denied');
		}
		expect(holder.trade.preview).not.toHaveBeenCalled();
		expect(holder.trade.execute).not.toHaveBeenCalled();
		const [{ n }] = await holder.db.query(`select count(*)::int as n from team_findings where team_id = $1`, [team.id]);
		expect(n).toBe(0);
	});

	it('no role but the Trader passes the gate of an action it does not own', async () => {
		const entry = await member('entry');
		const launcher = await member('launcher');
		expect((await rejected(runtime.runResearch(team, entry, { mint: MINT(11) }))).code).toBe('permission_denied');
		expect((await rejected(runtime.runResearch(team, launcher, { mint: MINT(11) }))).code).toBe('permission_denied');
		expect((await rejected(runtime.runTrade(team, launcher, { mint: MINT(11), amount: 0.01 }, { userId: OWNER }))).code).toBe('permission_denied');
		expect((await rejected(runtime.runLaunchPrep(team, await member('researcher'), { name: 'Desk', symbol: 'DESK' }))).code).toBe('permission_denied');
		expect((await rejected(runtime.runEntry(team, await member('trader'), {}))).code).toBe('permission_denied');
		expect(holder.research).not.toHaveBeenCalled();
	});

	it('a live trade needs an explicit confirm and a paused team runs nothing', async () => {
		const trader = await member('trader');
		const e = await rejected(runtime.runTrade(team, trader, { mint: MINT(12), side: 'buy', amount: 0.01, mode: 'live' }, { userId: OWNER }));
		expect(e.code).toBe('confirm_required');
		const paused = await rejected(runtime.runAction({ ...team, status: 'paused' }, { action: 'research', input: { mint: MINT(12) } }, { userId: OWNER }));
		expect(paused.code).toBe('paused');
		expect(holder.research).not.toHaveBeenCalled();
	});

	it('the schema allows one active member per fixed role', async () => {
		const [agent] = await holder.db.query(`insert into agent_identities (user_id, name) values ($1, 'Second') returning id`, [OWNER]);
		const e = await rejected(holder.db.query(
			`insert into team_members (team_id, agent_id, role, permissions) values ($1, $2, 'trader', '{}')`,
			[team.id, agent.id],
		));
		expect(String(e?.message)).toMatch(/team_members_role_uniq/);
	});
});

describe('role agent spec and launch handoff', () => {
	it('names each agent after the team within 60 characters and gives only the Trader trade limits', async () => {
		const { roleAgentSpec, launchPlanUrl } = await import('../api/_lib/teams/runtime.js');
		const team = { id: 't1', name: 'A'.repeat(80), policy: { ...POLICY_DEFAULTS, per_trade_sol: 0.1, daily_budget_sol: 1 } };
		for (const role of FIXED_ROLES) {
			const spec = roleAgentSpec(role, team);
			expect(spec.name.length).toBeLessThanOrEqual(60);
			expect(spec.meta).toMatchObject({ team_id: 't1', team_role: role, created_via: 'team' });
			expect(Boolean(spec.meta.trade_limits)).toBe(role === 'trader');
		}
		expect(roleAgentSpec('trader', team).meta.trade_limits).toMatchObject({ per_trade_sol: 0.1, daily_budget_sol: 1 });
		expect(thrown(() => roleAgentSpec('custom', team)).code).toBe('bad_role');

		const url = new URL(launchPlanUrl({ avatarId: 'av1', name: 'Desk & Co', symbol: 'DESK', description: '', network: 'devnet' }), 'https://three.ws');
		expect(url.pathname).toBe('/three-launchpad');
		expect(url.hash).toBe('#tl-launch');
		expect(Object.fromEntries(url.searchParams)).toEqual({ avatar: 'av1', name: 'Desk & Co', symbol: 'DESK', network: 'devnet' });
	});
});
