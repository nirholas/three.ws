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
