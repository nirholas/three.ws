// Build program: scoring, ranking, submission validation and the refusal paths
// of createSubmission, against a scripted sql layer.

import { beforeEach, describe, expect, it, vi } from 'vitest';

let script = [];
vi.mock('../api/_lib/db.js', () => ({
	sql: async (strings) => {
		const text = strings.join('?');
		const hit = script.find((s) => s.match.test(text));
		return hit ? hit.rows : [];
	},
}));

const { activityScore, rankEntries, submissionSchema, createSubmission, BuildError, serializeRound } = await import('../api/_lib/build-program.js');

const ROUND = '11111111-1111-4111-8111-111111111111';
const AGENT = '22222222-2222-4222-8222-222222222222';
const USER = '33333333-3333-4333-8333-333333333333';
const THREE = 'FeMbDoX7R1Psc4GEcvJdsbNbZA3bfztcyDCatJVJpump';
const valid = { roundId: ROUND, trackId: 'agents', agentId: AGENT, title: 'Scout bot', summary: 'An agent that screens new launches for rug risk.', repoUrl: 'https://github.com/example/scout' };

describe('scoring', () => {
	it('weights volume, calls and launches', () => {
		expect(activityScore({ volumeUsd: 100, callsServed: 4, launches: 2 })).toBe(170);
		expect(activityScore({})).toBe(0);
	});

	it('ranks by score, ties share a rank, order is stable', () => {
		const out = rankEntries([
			{ agentId: 'b', score: 10 },
			{ agentId: 'a', score: 10 },
			{ agentId: 'c', score: 30 },
			{ agentId: 'd', score: 1 },
		]);
		expect(out.map((e) => [e.agentId, e.rank])).toEqual([['c', 1], ['a', 2], ['b', 2], ['d', 4]]);
	});
});

describe('submission schema', () => {
	it('accepts a repo-linked entry', () => {
		expect(submissionSchema.safeParse(valid).success).toBe(true);
	});

	it('requires at least one link', () => {
		const { repoUrl, ...none } = valid;
		const r = submissionSchema.safeParse(none);
		expect(r.success).toBe(false);
		expect(r.error.issues[0].message).toMatch(/Link a repository/);
	});

	it('rejects http urls and malformed mints', () => {
		expect(submissionSchema.safeParse({ ...valid, repoUrl: 'http://example.com/x' }).success).toBe(false);
		expect(submissionSchema.safeParse({ ...valid, repoUrl: undefined, launchMint: 'not-a-mint' }).success).toBe(false);
		expect(submissionSchema.safeParse({ ...valid, repoUrl: undefined, launchMint: THREE }).success).toBe(true);
	});
});

describe('createSubmission', () => {
	const open = { match: /FROM program_rounds WHERE id/, rows: [{ id: ROUND, status: 'open', starts_at: '2020-01-01T00:00:00Z', ends_at: '2099-01-01T00:00:00Z', tracks: [{ id: 'agents', title: 'Agents' }] }] };
	const mine = { match: /FROM agent_identities WHERE id/, rows: [{ id: AGENT, user_id: USER }] };
	beforeEach(() => { script = []; });

	const code = async (input = valid, user = USER) => {
		try { await createSubmission(user, input); return null; } catch (e) { expect(e).toBeInstanceOf(BuildError); return e.code; }
	};

	it('refuses an unknown round', async () => { expect(await code()).toBe('round_not_found'); });

	it('refuses a closed round', async () => {
		script = [{ ...open, rows: [{ ...open.rows[0], status: 'judging' }] }];
		expect(await code()).toBe('round_closed');
	});

	it('refuses a round past its end', async () => {
		script = [{ ...open, rows: [{ ...open.rows[0], ends_at: '2021-01-01T00:00:00Z' }] }];
		expect(await code()).toBe('round_closed');
	});

	it('refuses a track the round does not list', async () => {
		script = [open];
		expect(await code({ ...valid, trackId: 'nope' })).toBe('unknown_track');
	});

	it('refuses an agent owned by someone else', async () => {
		script = [open, mine];
		expect(await code(valid, '44444444-4444-4444-8444-444444444444')).toBe('not_your_agent');
	});

	it('refuses a launch mint the agent did not launch', async () => {
		script = [open, mine];
		expect(await code({ ...valid, launchMint: THREE })).toBe('launch_not_found');
	});

	it('allows one live submission per user per round', async () => {
		script = [open, mine, { match: /FROM program_submissions WHERE round_id/, rows: [{ id: 'x' }] }];
		expect(await code()).toBe('already_submitted');
	});

	it('files a valid entry', async () => {
		script = [open, mine, { match: /INSERT INTO program_submissions/, rows: [{ id: 's1', round_id: ROUND, track_id: 'agents', agent_id: AGENT, title: valid.title, summary: valid.summary, repo_url: valid.repoUrl, status: 'submitted', created_at: '2026-11-04T00:00:00Z' }] }];
		const s = await createSubmission(USER, valid);
		expect(s).toMatchObject({ id: 's1', status: 'submitted', repoUrl: valid.repoUrl });
	});
});

describe('serializeRound', () => {
	it('exposes the prize pool and counts without internals', () => {
		const r = serializeRound({ id: 'r', slug: 's', title: 'T', description: 'd', status: 'open', starts_at: '2026-11-01T00:00:00Z', ends_at: '2026-12-01T00:00:00Z', prize_pool: [{ currency: 'USDC', amount: 1000 }], buyback_bps: 5000, fee_revenue_usd: '12.5', submissions: 3 });
		expect(r).toMatchObject({ slug: 's', prizePool: [{ currency: 'USDC', amount: 1000 }], buybackBps: 5000, feeRevenueUsd: 12.5, submissions: 3 });
	});
});
