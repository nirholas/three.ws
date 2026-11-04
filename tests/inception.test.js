// Unit tests for the NVIDIA Inception member perk (api/_lib/inception.js).
// The DB and the credit ledger are mocked: a programmed result queue stands in for
// Neon, and creditAccount is a spy so the grant call shape is asserted exactly.

import { describe, it, expect, beforeEach, vi } from 'vitest';

const db = vi.hoisted(() => ({ queue: [], calls: [] }));
const ledger = vi.hoisted(() => ({ calls: [], replay: false }));

vi.mock('../api/_lib/db.js', () => ({
	sql: (strings, ...values) => {
		db.calls.push({ text: strings.join('?'), values });
		const next = db.queue.length ? db.queue.shift() : [];
		return next instanceof Error ? Promise.reject(next) : Promise.resolve(next);
	},
}));

vi.mock('../api/_lib/credits.js', () => ({
	creditAccount: async (args) => {
		ledger.calls.push(args);
		return { balanceUsd: 25, ledgerId: 'led-1', replay: ledger.replay };
	},
}));

const {
	validateApplication,
	submitApplication,
	approveApplication,
	rejectApplication,
	submitShoutout,
	approveShoutout,
	rejectShoutout,
	normalizeShoutoutUrl,
	shoutoutDraft,
	resolveProgram,
	PROGRAMS,
	DEFAULT_GRANT_USD,
	MAX_GRANT_USD,
} = await import('../api/_lib/inception.js');

const good = {
	company: '  Acme   Robotics ',
	website: 'acme.dev',
	contact_email: 'Founder@Acme.dev',
	inception_ref: 'https://www.nvidia.com/en-us/startups/ acme',
	use_case: 'Generate warehouse props for simulation scenes.',
};

beforeEach(() => {
	db.queue.length = 0;
	db.calls.length = 0;
	ledger.calls.length = 0;
	ledger.replay = false;
});

describe('validateApplication', () => {
	it('normalizes a good body', () => {
		const { value, errors } = validateApplication(good);
		expect(errors).toBeUndefined();
		expect(value.company).toBe('Acme Robotics');
		expect(value.website).toBe('https://acme.dev/');
		expect(value.contactEmail).toBe('founder@acme.dev');
		expect(value.inceptionRef).toContain('nvidia.com');
	});

	it('makes the Inception reference optional', () => {
		const { value } = validateApplication({ ...good, inception_ref: '' });
		expect(value.inceptionRef).toBeNull();
	});

	it('reports every bad field at once, keyed by field', () => {
		const { errors } = validateApplication({ company: '', website: 'nodot', contact_email: 'x', use_case: 'short' });
		expect(Object.keys(errors).sort()).toEqual(['company', 'contact_email', 'use_case', 'website']);
	});

	it('survives a non-object body', () => {
		expect(validateApplication(null).errors.company).toBeTruthy();
	});

	it('rejects a javascript: website instead of coercing it', () => {
		const { errors } = validateApplication({ ...good, website: 'javascript:alert(1)' });
		expect(errors.website).toBeTruthy();
	});
});

describe('submitApplication', () => {
	const value = validateApplication(good).value;

	it('returns the inserted row', async () => {
		db.queue.push([{ id: 'app-1', status: 'pending', created_at: 'now' }]);
		const row = await submitApplication('user-1', value);
		expect(row.id).toBe('app-1');
		expect(db.calls[0].values).toContain('user-1');
	});

	it('maps the one-open-application unique violation to a 409', async () => {
		db.queue.push(Object.assign(new Error('duplicate key value'), { code: '23505' }));
		await expect(submitApplication('user-1', value)).rejects.toMatchObject({
			status: 409,
			code: 'already_applied',
		});
	});

	it('does not swallow other database errors', async () => {
		db.queue.push(new Error('connection reset'));
		await expect(submitApplication('user-1', value)).rejects.toThrow('connection reset');
	});
});

describe('approveApplication', () => {
	it('grants credits idempotently on inception:<id>, then stamps the row', async () => {
		db.queue.push([{ id: 'app-1', user_id: 'user-1', status: 'pending', company: 'Acme' }], []);
		const out = await approveApplication({ id: 'app-1' });
		expect(out.grantUsd).toBe(DEFAULT_GRANT_USD);
		expect(ledger.calls).toHaveLength(1);
		expect(ledger.calls[0]).toMatchObject({
			userId: 'user-1',
			amountUsd: DEFAULT_GRANT_USD,
			kind: 'grant',
			idempotencyKey: 'inception:app-1',
		});
		expect(db.calls[1].text).toContain("status = 'approved'");
	});

	it('refuses an application that is no longer pending and credits nothing', async () => {
		db.queue.push([{ id: 'app-1', user_id: 'user-1', status: 'approved', company: 'Acme' }]);
		await expect(approveApplication({ id: 'app-1' })).rejects.toMatchObject({ status: 409 });
		expect(ledger.calls).toHaveLength(0);
	});

	it('404s on an unknown id', async () => {
		db.queue.push([]);
		await expect(approveApplication({ id: 'nope' })).rejects.toMatchObject({ status: 404 });
	});

	it('rejects a grant outside the allowed range before touching the DB', async () => {
		await expect(approveApplication({ id: 'a', grantUsd: 0 })).rejects.toMatchObject({ status: 400 });
		await expect(approveApplication({ id: 'a', grantUsd: MAX_GRANT_USD + 1 })).rejects.toMatchObject({ status: 400 });
		await expect(approveApplication({ id: 'a', grantUsd: 'abc' })).rejects.toMatchObject({ status: 400 });
		expect(db.calls).toHaveLength(0);
	});

	it('repairs the status when a previous run credited but crashed before stamping', async () => {
		ledger.replay = true;
		db.queue.push([{ id: 'app-1', user_id: 'user-1', status: 'pending', company: 'Acme' }], []);
		const out = await approveApplication({ id: 'app-1' });
		expect(out.replay).toBe(true);
		expect(db.calls[1].text).toContain("status = 'approved'");
	});
});

describe('rejectApplication', () => {
	it('requires a note the applicant can act on', async () => {
		await expect(rejectApplication({ id: 'app-1', note: '  ' })).rejects.toMatchObject({ status: 400 });
		expect(db.calls).toHaveLength(0);
	});

	it('rejects a pending application', async () => {
		db.queue.push([{ id: 'app-1' }]);
		await expect(rejectApplication({ id: 'app-1', note: 'No Inception profile found.' })).resolves.toEqual({ id: 'app-1' });
	});

	it('404s when the application is not pending', async () => {
		db.queue.push([]);
		await expect(rejectApplication({ id: 'app-1', note: 'x' })).rejects.toMatchObject({ status: 404 });
	});
});

describe('programs', () => {
	it('defaults to NVIDIA Inception and rejects unknown ids, including prototype keys', () => {
		expect(resolveProgram(undefined).id).toBe('nvidia-inception');
		expect(resolveProgram('nope')).toBeNull();
		expect(resolveProgram('constructor')).toBeNull();
		expect(resolveProgram('__proto__')).toBeNull();
	});

	it('every program has a positive grant and bonus under the cap', () => {
		for (const p of Object.values(PROGRAMS)) {
			expect(p.grantUsd).toBeGreaterThan(0);
			expect(p.shoutoutBonusUsd).toBeGreaterThan(0);
			expect(p.grantUsd).toBeLessThanOrEqual(MAX_GRANT_USD);
		}
	});

	it('refuses to store an application for an unknown program', async () => {
		await expect(submitApplication('u', validateApplication(good).value, 'nope')).rejects.toMatchObject({ status: 400 });
		expect(db.calls).toHaveLength(0);
	});

	it('approval defaults to the application\'s own program grant', async () => {
		db.queue.push([{ id: 'a', user_id: 'u', program: 'aws-activate', status: 'pending', company: 'X' }], []);
		const out = await approveApplication({ id: 'a' });
		expect(out.grantUsd).toBe(PROGRAMS['aws-activate'].grantUsd);
	});
});

describe('normalizeShoutoutUrl', () => {
	it('canonicalizes X and Twitter status links and drops tracking params', () => {
		expect(normalizeShoutoutUrl('https://twitter.com/Acme_Dev/status/1853000000000000000?s=20&t=abc')).toBe('https://x.com/acme_dev/status/1853000000000000000');
		expect(normalizeShoutoutUrl('https://www.x.com/acme/status/1853000000000000000/')).toBe('https://x.com/acme/status/1853000000000000000');
	});

	it('accepts LinkedIn posts', () => {
		expect(normalizeShoutoutUrl('https://www.linkedin.com/posts/acme_built-this-activity-7123456789012345678-AbCd?utm_source=share')).toBe('https://www.linkedin.com/posts/acme_built-this-activity-7123456789012345678-AbCd');
		expect(normalizeShoutoutUrl('https://linkedin.com/feed/update/urn:li:activity:7123456789012345678')).toBe('https://www.linkedin.com/feed/update/urn:li:activity:7123456789012345678');
	});

	it('rejects profiles, other hosts, http, lookalike hosts and garbage', () => {
		for (const bad of [
			'https://x.com/acme',
			'http://x.com/acme/status/1853000000000000000',
			'https://x.com.evil.test/acme/status/1853000000000000000',
			'https://evil.test/x.com/acme/status/1853000000000000000',
			'https://example.com/post',
			'javascript:alert(1)',
			'not a url',
			'',
			null,
		]) {
			expect(normalizeShoutoutUrl(bad)).toBeNull();
		}
	});
});

describe('shoutoutDraft', () => {
	it('mentions the product and the program, and builds an encoded compose link', () => {
		const d = shoutoutDraft('nvidia-inception');
		expect(d.text).toContain('@trythreews');
		expect(d.text).toContain('#NVIDIAInception');
		expect(d.intent_url.startsWith('https://x.com/intent/post?text=')).toBe(true);
		expect(decodeURIComponent(d.intent_url.split('text=')[1])).toBe(d.text);
	});
});

describe('submitShoutout', () => {
	it('queues a canonical link for an approved application', async () => {
		db.queue.push([{ id: 'a', shoutout_url: 'https://x.com/acme/status/1853000000000000000', shoutout_status: 'submitted' }]);
		const row = await submitShoutout('u', 'nvidia-inception', 'https://twitter.com/Acme/status/1853000000000000000?s=1');
		expect(row.shoutout_status).toBe('submitted');
		expect(db.calls[0].values).toContain('https://x.com/acme/status/1853000000000000000');
		expect(db.calls[0].text).toContain("status = 'approved'");
	});

	it('422s on a link that is not a public post, without touching the DB', async () => {
		await expect(submitShoutout('u', 'nvidia-inception', 'https://x.com/acme')).rejects.toMatchObject({ status: 422 });
		expect(db.calls).toHaveLength(0);
	});

	it('409s when the application is unapproved or already paid', async () => {
		db.queue.push([]);
		await expect(submitShoutout('u', 'nvidia-inception', 'https://x.com/a/status/1853000000000000000')).rejects.toMatchObject({ code: 'shoutout_unavailable' });
	});

	it('409s when the same post was used before', async () => {
		db.queue.push(Object.assign(new Error('duplicate key'), { code: '23505' }));
		await expect(submitShoutout('u', 'nvidia-inception', 'https://x.com/a/status/1853000000000000000')).rejects.toMatchObject({ code: 'shoutout_used' });
	});
});

describe('approveShoutout / rejectShoutout', () => {
	it('pays the program bonus once, keyed on inception-shoutout:<id>', async () => {
		db.queue.push([{ id: 'a', user_id: 'u', program: 'nvidia-inception', company: 'Acme', shoutout_status: 'submitted' }], []);
		const out = await approveShoutout({ id: 'a' });
		expect(out.bonusUsd).toBe(PROGRAMS['nvidia-inception'].shoutoutBonusUsd);
		expect(ledger.calls[0]).toMatchObject({ kind: 'grant', idempotencyKey: 'inception-shoutout:a', userId: 'u' });
	});

	it('pays nothing when the shoutout is not submitted', async () => {
		for (const state of ['none', 'approved', 'rejected']) {
			db.queue.push([{ id: 'a', user_id: 'u', program: 'nvidia-inception', company: 'Acme', shoutout_status: state }]);
			await expect(approveShoutout({ id: 'a' })).rejects.toMatchObject({ status: 409 });
		}
		expect(ledger.calls).toHaveLength(0);
	});

	it('rejects an out-of-range bonus before crediting', async () => {
		db.queue.push([{ id: 'a', user_id: 'u', program: 'nvidia-inception', company: 'Acme', shoutout_status: 'submitted' }]);
		await expect(approveShoutout({ id: 'a', bonusUsd: -5 })).rejects.toMatchObject({ status: 400 });
		expect(ledger.calls).toHaveLength(0);
	});

	it('rejection needs a note and clears the link so the member can resubmit', async () => {
		await expect(rejectShoutout({ id: 'a', note: '' })).rejects.toMatchObject({ status: 400 });
		db.queue.push([{ id: 'a' }]);
		await expect(rejectShoutout({ id: 'a', note: 'Post is private.' })).resolves.toEqual({ id: 'a' });
		expect(db.calls[0].text).toContain('shoutout_url = null');
	});
});
