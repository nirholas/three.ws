import { describe, it, expect } from 'vitest';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { priorApproval, restoreApproval, sameCopy, staleApproved, staleReasons, stuckDigest } from '../api/_lib/x-content/refresh.js';

const fresh = { proof: () => [], head: () => [], review: () => [] };
const approved = (id, extra = {}) => ({ id, status: 'approved', kind: 'post', posts: [{ text: id }], ...extra });

describe('stale approved items', () => {
	it('names an approved item whose review expired, with the reason the publisher would give', () => {
		const rows = staleApproved([approved('a')], '/', { checks: { ...fresh, review: () => ['the review is 20 days old; facts drift, so review it again'] } });
		expect(rows).toHaveLength(1);
		expect(rows[0].reasons).toEqual(['review: the review is 20 days old; facts drift, so review it again']);
	});

	it('checks the reel only for filmed items and the head only for code and shot heads', () => {
		const loud = { proof: () => ['reel expired'], head: () => ['shot expired'], review: () => [] };
		expect(staleReasons(approved('plain'), '/', { checks: loud })).toEqual([]);
		expect(staleReasons(approved('filmed', { scenario: { steps: [] } }), '/', { checks: loud })).toEqual(['proof: reel expired']);
		expect(staleReasons(approved('shot', { head: { as: 'shot' } }), '/', { checks: loud })).toEqual(['head: shot expired']);
		expect(staleReasons(approved('card', { head: { as: 'card' } }), '/', { checks: loud })).toEqual([]);
	});

	it('leaves out what already went out, what is current, and what is not approved', () => {
		const stale = { ...fresh, review: () => ['old'] };
		const items = [approved('sent'), approved('waiting'), { ...approved('draft'), status: 'draft' }, { ...approved('posted'), status: 'posted' }];
		const rows = staleApproved(items, '/', { published: [{ id: 'sent' }], checks: stale });
		expect(rows.map((row) => row.item.id)).toEqual(['waiting']);
		expect(staleApproved(items, '/', { checks: fresh })).toEqual([]);
	});

	it('reads the real review record by default, so an unreviewed approved item counts as stale', () => {
		const root = mkdtempSync(join(tmpdir(), 'x-refresh-'));
		expect(staleReasons(approved('never-reviewed'), root).join('\n')).toMatch(/no editorial review on record/);
	});
});

describe('restoring an approval', () => {
	it('keeps who approved it and an embargo still running, with no fresh veto', () => {
		const item = approved('a', { approvedBy: 'owner', notBefore: '2026-11-20T00:00:00Z' });
		const prior = priorApproval(item);
		item.status = 'review';
		item.notBefore = '2030-01-01T00:00:00Z';
		restoreApproval(item, prior);
		expect(item).toMatchObject({ status: 'approved', approvedBy: 'owner', notBefore: '2026-11-20T00:00:00Z' });
	});

	it('carries the approval over only when the reviewed words are the same words', () => {
		expect(sameCopy({ texts: ['Parts Studio is live. '] }, { texts: ['Parts Studio is live.'] })).toBe(true);
		expect(sameCopy({ texts: ['Parts Studio is live.'] }, { texts: ['Parts Studio is live today.'] })).toBe(false);
		expect(sameCopy(null, { texts: ['x'] })).toBe(false);
		expect(sameCopy({ texts: [] }, { texts: [] })).toBe(false);
	});
});

describe('stuck digest', () => {
	it('says nothing when everything was renewed, and lists each item it could not bring back', () => {
		expect(stuckDigest([])).toBeNull();
		const digest = stuckDigest([{ id: 'forge', reason: 'the feature did not pass its scenario at step 3' }]);
		expect(digest.title).toBe('X content: 1 approved post could not be refreshed');
		expect(digest.detail).toBe('- forge: the feature did not pass its scenario at step 3');
	});
});

describe('refill job', () => {
	it('runs the same image as the partner job with its own task, name, and schedule', async () => {
		const { JOBS, jobSpec } = await import('../scripts/create-x-partners-job.mjs');
		const service = [{ name: 'DATABASE_URL', valueFrom: { secretKeyRef: { name: 'db', key: 'latest' } } }, { name: 'X_RUNNER_TASK', value: 'stale' }];
		const refill = jobSpec(service, JOBS.refill);
		const partners = jobSpec(service, JOBS.partners);
		const env = (spec) => spec.spec.template.spec.template.spec.containers[0].env;
		expect(refill.metadata.name).toBe('three-ws-x-refill');
		expect(env(refill)).toEqual([service[0], { name: 'X_RUNNER_TASK', value: 'refill' }]);
		expect(env(partners)).toEqual(expect.arrayContaining([{ name: 'X_RUNNER_TASK', value: 'partners' }, { name: 'X_PARTNERS_DAYS', value: '3' }]));
		expect(refill.spec.template.spec.template.spec.containers[0].image).toBe(partners.spec.template.spec.template.spec.containers[0].image);
		const hour = (job) => Number(job.schedule.split(' ')[1]);
		expect(hour(JOBS.refill)).toBeLessThan(hour(JOBS.partners));
	});
});
