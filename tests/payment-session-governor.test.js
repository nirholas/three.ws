/**
 * Agent Payment Sessions: the spend governor, pinned.
 *
 * A payment session is the only thing standing between an autonomous agent and a
 * funded wallet: the agent holds a bearer token, never a key, and every payment it
 * proposes has to clear this module first. That makes `reserveSessionSpend` a money
 * chokepoint, and a bug in it fails toward MORE spend, not less. Nothing here was
 * covered by a test before this file.
 *
 * What is pinned:
 *   - token format parsing rejects everything that is not `pss_<uuid>_<random>`,
 *   - the HMAC is keyed off env.PAYMENT_SESSION_SECRET (the var operators actually
 *     set), and a token that does not hash to the stored value is rejected,
 *   - the five policy phases run in order and each returns its own error code,
 *   - the allowlist matches a bare host and its real subdomains and REFUSES the
 *     suffix lookalike (`evil-example.com` against an `example.com` entry),
 *   - the atomic reservation is race-safe: two concurrent payments that each fit
 *     but do not fit together produce exactly one winner,
 *   - a session that consumes its last cent flips to `exhausted`,
 *   - rollback restores budget, clamps at zero, and revives an exhausted session,
 *   - recordExecution derives endpoint_host and is idempotent per idempotency_key.
 *
 * The SQL is executed against an in-memory table whose UPDATE applies the same
 * predicates the real statements carry (including `(budget_usdc - spent_usdc) >=
 * amount`), so the orchestration and the race are genuinely exercised. It is not a
 * substitute for Postgres row locking, which is what makes the real statement
 * atomic; that guarantee lives in the single-statement form of the UPDATE and is
 * asserted structurally at the bottom of this file.
 */

import { describe, it, expect, beforeAll, beforeEach, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { createHmac } from 'node:crypto';

process.env.PAYMENT_SESSION_SECRET = 'test-payment-session-secret';

// ── In-memory payment_sessions / payment_session_executions ──────────────────
//
// The fake `sql` tag routes on the distinctive text of each statement the governor
// issues and applies that statement's real semantics to the store. Statements run
// one at a time (JS is single-threaded between awaits), which is precisely the
// serialization Postgres row locking provides for the reservation UPDATE.
const store = { sessions: new Map(), executions: [], railReservations: [] };

function normalizeSql(strings) {
	return strings.join(' ? ').replace(/\s+/g, ' ').trim();
}

function runStatement(text, values) {
	// verifySessionToken: lookup by id + token hash
	if (text.startsWith('SELECT id, user_id, agent_id')) {
		const [id, hash] = values;
		const row = store.sessions.get(id);
		return row && row.token_hash === hash ? [{ ...row }] : [];
	}

	// reserveSessionSpend phase 3: mark an already-expired session
	if (text.includes("SET status = 'expired'")) {
		const [id] = values;
		const row = store.sessions.get(id);
		if (row && row.status === 'active') row.status = 'expired';
		return [];
	}

	// reserveSessionSpend phase 6: the atomic reservation
	if (text.includes('SET spent_usdc = spent_usdc + ')) {
		const [amount, id, guardAmount] = values;
		const row = store.sessions.get(id);
		if (!row) return [];
		const fits = BigInt(row.budget_usdc) - BigInt(row.spent_usdc) >= BigInt(guardAmount);
		if (row.status !== 'active' || !fits) return [];
		row.spent_usdc = (BigInt(row.spent_usdc) + BigInt(amount)).toString();
		return [{ id: row.id, spent_usdc: row.spent_usdc, budget_usdc: row.budget_usdc }];
	}

	// reserveSessionSpend: precise-error read after a lost race
	if (text.startsWith('SELECT budget_usdc, spent_usdc')) {
		const [id] = values;
		const row = store.sessions.get(id);
		return row ? [{ budget_usdc: row.budget_usdc, spent_usdc: row.spent_usdc }] : [];
	}

	// reserveSessionSpend: flip a fully consumed session
	if (text.includes("SET status = 'exhausted'")) {
		const [id] = values;
		const row = store.sessions.get(id);
		if (row && row.status === 'active') row.status = 'exhausted';
		return [];
	}

	// rollbackReservation
	if (text.includes('greatest(0, spent_usdc - ')) {
		const [amount, id] = values;
		const row = store.sessions.get(id);
		if (!row || !['active', 'exhausted'].includes(row.status)) return [];
		const next = BigInt(row.spent_usdc) - BigInt(amount);
		row.spent_usdc = (next < 0n ? 0n : next).toString();
		if (row.status === 'exhausted') row.status = 'active';
		return [];
	}

	// recordExecution
	if (text.startsWith('INSERT INTO payment_session_executions')) {
		const [sessionId, userId, endpointUrl, host, method, amount, network, txHash,
			payer, payee, status, errorCode, errorMessage, responseBody, durationMs, idem,
			policyDigest, verdictCode, verdictSignature, verdictSignedAt] = values;
		if (idem != null && store.executions.some((e) => e.idempotency_key === idem)) return [];
		store.executions.push({
			session_id: sessionId, user_id: userId, endpoint_url: endpointUrl,
			endpoint_host: host, method, amount_usdc: amount, network, tx_hash: txHash,
			payer_address: payer, payee_address: payee, status, error_code: errorCode,
			error_message: errorMessage, response_body: responseBody,
			duration_ms: durationMs, idempotency_key: idem,
			policy_digest: policyDigest, verdict_code: verdictCode,
			verdict_signature: verdictSignature, verdict_signed_at: verdictSignedAt,
		});
		return [];
	}

	// reserveSessionSpend: advisory lock taken ahead of the rail-daily reserve
	// (api/_lib/locked-sql.js). A no-op here: JS runs single-threaded between
	// awaits, which already serializes the statements that follow it.
	if (text.includes('pg_advisory_xact_lock')) return [];

	// reserveSessionSpend: rail-daily pre-check (advisory read before the atomic reserve)
	if (text.startsWith('SELECT coalesce(sum(amount_usdc), 0) AS spent')) {
		const [id, network] = values;
		const cutoff = Date.now() - 24 * HOUR;
		const spent = store.railReservations
			.filter((r) => r.session_id === id && r.network === network && r.created_at > cutoff)
			.reduce((acc, r) => acc + BigInt(r.amount_usdc), 0n);
		return [{ spent: spent.toString() }];
	}

	// reserveSessionSpend: the atomic rail-daily reservation (lock statement, then this,
	// inside one sql.transaction, see api/_lib/locked-sql.js)
	if (text.includes('INSERT INTO payment_session_rail_reservations')) {
		const [id, network, , , amount, , capAtomics] = values;
		const cutoff = Date.now() - 24 * HOUR;
		const spent = store.railReservations
			.filter((r) => r.session_id === id && r.network === network && r.created_at > cutoff)
			.reduce((acc, r) => acc + BigInt(r.amount_usdc), 0n);
		if (spent + BigInt(amount) > BigInt(capAtomics)) return [];
		const resId = `rail_${store.railReservations.length}_${Date.now()}_${Math.random()}`;
		store.railReservations.push({ id: resId, session_id: id, network, amount_usdc: amount, created_at: Date.now() });
		return [{ id: resId }];
	}

	// reserveSessionSpend (budget-reservation failure) / rollbackReservation: release a rail reservation
	if (text.startsWith('DELETE FROM payment_session_rail_reservations')) {
		const [id] = values;
		store.railReservations = store.railReservations.filter((r) => r.id !== id);
		return [];
	}

	throw new Error(`unrouted SQL in test fake: ${text.slice(0, 90)}`);
}

vi.mock('../api/_lib/db.js', () => {
	const sqlFn = (strings, ...values) => Promise.resolve(runStatement(normalizeSql(strings), values));
	// Each element of `queries` is already an invoked (and thus already-pending)
	// sql`` call under this mock, mirroring tests/advisory-lock-snapshot.test.js's
	// convention for exercising api/_lib/locked-sql.js's runLocked().
	sqlFn.transaction = async (queries) => Promise.all(queries);
	return {
		sql: sqlFn,
		isDbUnavailableError: () => false,
		isDbCapacityError: () => false,
	};
});

const {
	usdToAtomics, atomicsToUsd, hashToken, extractSessionId, normalizeHost,
	generateSessionToken, verifySessionToken, reserveSessionSpend,
	rollbackReservation, recordExecution, signVerdict, verifyVerdictSignature,
	SpendGovernorError,
} = await import('../api/_lib/pay/spend-governor.js');
const { replay, resolveRailDailyCapAtomics, computePolicyDigest, computeRequestHash, NETWORK_TO_CAIP2 } =
	await import('../api/_lib/pay/policy.js');

const SESSION_ID = '11111111-2222-4333-8444-555555555555';
const HOUR = 3600 * 1000;

function seedSession(partial = {}) {
	const token = partial.token ?? generateSessionToken(partial.id ?? SESSION_ID);
	const row = {
		id: partial.id ?? SESSION_ID,
		user_id: 'user-1',
		agent_id: null,
		label: 'test session',
		budget_usdc: String(partial.budget_usdc ?? 1_000_000), // $1.00
		spent_usdc: String(partial.spent_usdc ?? 0),
		max_per_tx_usdc: partial.max_per_tx_usdc ?? null,
		allowed_hosts: partial.allowed_hosts ?? [],
		blocked_hosts: partial.blocked_hosts ?? [],
		approval_threshold_usdc: partial.approval_threshold_usdc ?? null,
		per_rail_daily_usdc: partial.per_rail_daily_usdc ?? {},
		network: partial.network ?? 'solana',
		connector_ref: null,
		status: partial.status ?? 'active',
		expires_at: new Date(Date.now() + (partial.ttlMs ?? HOUR)).toISOString(),
		session_metadata: {},
		token_hash: hashToken(token),
	};
	store.sessions.set(row.id, row);
	return { token, row };
}

async function expectGovernorError(promise, code) {
	await expect(promise).rejects.toBeInstanceOf(SpendGovernorError);
	await promise.catch((err) => expect(err.code).toBe(code));
}

beforeEach(() => {
	store.sessions.clear();
	store.executions.length = 0;
	store.railReservations.length = 0;
});

// ── Money arithmetic ─────────────────────────────────────────────────────────

describe('USDC atomics', () => {
	it('converts dollars to 6-decimal atomic units', () => {
		expect(usdToAtomics(1)).toBe(1_000_000n);
		expect(usdToAtomics(0.01)).toBe(10_000n);
		expect(usdToAtomics(0.000001)).toBe(1n);
	});

	it('rounds to the nearest atom rather than truncating toward zero', () => {
		// $0.0000005 is half an atom. Truncation would silently price it at zero,
		// which would let a caller buy an unlimited number of free sub-atom calls.
		expect(usdToAtomics(0.0000005)).toBe(1n);
		expect(usdToAtomics(0.0000004)).toBe(0n);
	});

	it('round-trips a realistic micropayment', () => {
		expect(atomicsToUsd(usdToAtomics(0.05))).toBeCloseTo(0.05, 9);
	});
});

// ── Token handling ───────────────────────────────────────────────────────────

describe('session tokens', () => {
	it('mints a prefixed token that carries its own session id', () => {
		const token = generateSessionToken(SESSION_ID);
		expect(token.startsWith('pss_')).toBe(true);
		expect(extractSessionId(token)).toBe(SESSION_ID);
	});

	it('refuses every malformed token shape', () => {
		for (const bad of [
			'', null, undefined,
			'not-a-token',
			SESSION_ID,                       // bare uuid, no prefix
			`sk_${SESSION_ID}_abc`,           // wrong prefix
			`pss_${SESSION_ID}`,              // no random segment
			`pss_${SESSION_ID.slice(0, 20)}_abc`, // short uuid
			`pss_${SESSION_ID}-abc`,          // wrong separator
		]) {
			expect(extractSessionId(bad)).toBeNull();
		}
	});

	it('hashes with the configured PAYMENT_SESSION_SECRET', () => {
		// Pins the bug this file was written after: env.PAYMENT_SESSION_SECRET did not
		// exist on the env object, so an operator setting it got a token keyed off an
		// unrelated secret and rotating that unrelated secret revoked every session.
		const token = generateSessionToken(SESSION_ID);
		const expected = createHmac('sha256', 'test-payment-session-secret')
			.update(token).digest('hex');
		expect(hashToken(token)).toBe(expected);
	});

	it('rejects a token whose hash does not match the stored session', async () => {
		seedSession();
		const forged = generateSessionToken(SESSION_ID);
		await expectGovernorError(verifySessionToken(forged), 'invalid_token');
	});

	it('rejects a structurally invalid token before any DB read', async () => {
		await expectGovernorError(verifySessionToken('garbage'), 'invalid_token');
	});

	it('maps each governance code to the right HTTP status', () => {
		expect(new SpendGovernorError('invalid_token', 'x').status).toBe(401);
		expect(new SpendGovernorError('session_not_found', 'x').status).toBe(404);
		expect(new SpendGovernorError('allowlist_blocked', 'x').status).toBe(403);
		expect(new SpendGovernorError('per_tx_exceeded', 'x').status).toBe(402);
		expect(new SpendGovernorError('insufficient_budget', 'x').status).toBe(402);
		// An unmapped code must not fall through to 200 or 500.
		expect(new SpendGovernorError('something_new', 'x').status).toBe(403);
	});
});

// ── Host normalization and the allowlist ─────────────────────────────────────

describe('normalizeHost', () => {
	it('reduces any URL shape to a bare lowercase hostname', () => {
		expect(normalizeHost('HTTPS://Api.Example.COM:443/v1/data?k=1')).toBe('api.example.com');
		expect(normalizeHost('api.example.com')).toBe('api.example.com');
		expect(normalizeHost('  Api.Example.com  ')).toBe('api.example.com');
		expect(normalizeHost('api.example.com/path')).toBe('api.example.com');
	});

	it('returns empty for blank input rather than a truthy placeholder', () => {
		expect(normalizeHost('')).toBe('');
		expect(normalizeHost(null)).toBe('');
		expect(normalizeHost('   ')).toBe('');
	});
});

describe('allowlist enforcement', () => {
	it('allows the exact host', async () => {
		const { token } = seedSession({ allowed_hosts: ['api.example.com'] });
		const { session } = await reserveSessionSpend({
			token, url: 'https://api.example.com/data', amountAtomics: 10_000n,
		});
		expect(session.spent_usdc).toBe('10000');
	});

	it('allows a real subdomain of an allowlisted apex', async () => {
		const { token } = seedSession({ allowed_hosts: ['example.com'] });
		await expect(reserveSessionSpend({
			token, url: 'https://api.example.com/data', amountAtomics: 10_000n,
		})).resolves.toBeTruthy();
	});

	it('refuses a suffix lookalike that is not a subdomain', async () => {
		// The bug this guards: endsWith(host) instead of endsWith('.' + host) would
		// let anyone who registers evil-example.com collect payments from a session
		// whose owner only ever approved example.com.
		const { token } = seedSession({ allowed_hosts: ['example.com'] });
		await expectGovernorError(reserveSessionSpend({
			token, url: 'https://evil-example.com/data', amountAtomics: 10_000n,
		}), 'allowlist_blocked');
	});

	it('refuses an unrelated host', async () => {
		const { token } = seedSession({ allowed_hosts: ['example.com'] });
		await expectGovernorError(reserveSessionSpend({
			token, url: 'https://attacker.test/data', amountAtomics: 10_000n,
		}), 'allowlist_blocked');
	});

	it('compares case- and port-insensitively', async () => {
		const { token } = seedSession({ allowed_hosts: ['HTTPS://API.Example.com:443/'] });
		await expect(reserveSessionSpend({
			token, url: 'https://api.example.com/data', amountAtomics: 10_000n,
		})).resolves.toBeTruthy();
	});

	it('refuses an unparseable target URL instead of defaulting to allow', async () => {
		const { token } = seedSession({ allowed_hosts: ['example.com'] });
		await expectGovernorError(reserveSessionSpend({
			token, url: 'not a url', amountAtomics: 10_000n,
		}), 'allowlist_blocked');
	});

	it('treats an empty allowlist as no host restriction', async () => {
		const { token } = seedSession({ allowed_hosts: [] });
		await expect(reserveSessionSpend({
			token, url: 'https://anything.test/data', amountAtomics: 10_000n,
		})).resolves.toBeTruthy();
	});

	it('does not charge the session when the allowlist rejects', async () => {
		const { token, row } = seedSession({ allowed_hosts: ['example.com'] });
		await reserveSessionSpend({
			token, url: 'https://attacker.test/x', amountAtomics: 10_000n,
		}).catch(() => {});
		expect(store.sessions.get(row.id).spent_usdc).toBe('0');
	});
});

// ── Session state ────────────────────────────────────────────────────────────

describe('session state gates', () => {
	for (const status of ['exhausted', 'cancelled', 'expired']) {
		it(`refuses a ${status} session`, async () => {
			const { token } = seedSession({ status });
			await expectGovernorError(reserveSessionSpend({
				token, url: 'https://api.example.com/x', amountAtomics: 10_000n,
			}), 'session_inactive');
		});
	}

	it('refuses a session past its expiry and marks the row expired', async () => {
		const { token, row } = seedSession({ ttlMs: -1000 });
		await expectGovernorError(reserveSessionSpend({
			token, url: 'https://api.example.com/x', amountAtomics: 10_000n,
		}), 'session_expired');
		// The sweep runs every 5 minutes; the governor must not wait for it.
		expect(store.sessions.get(row.id).status).toBe('expired');
	});
});

// ── Per-transaction ceiling ──────────────────────────────────────────────────

describe('per-transaction ceiling', () => {
	it('refuses a payment over the cap', async () => {
		const { token } = seedSession({ max_per_tx_usdc: '50000' }); // $0.05
		await expectGovernorError(reserveSessionSpend({
			token, url: 'https://api.example.com/x', amountAtomics: 60_000n,
		}), 'per_tx_exceeded');
	});

	it('allows a payment exactly at the cap', async () => {
		const { token } = seedSession({ max_per_tx_usdc: '50000' });
		await expect(reserveSessionSpend({
			token, url: 'https://api.example.com/x', amountAtomics: 50_000n,
		})).resolves.toBeTruthy();
	});

	it('reports both the amount and the cap so the agent can adapt', async () => {
		const { token } = seedSession({ max_per_tx_usdc: '50000' });
		await reserveSessionSpend({
			token, url: 'https://api.example.com/x', amountAtomics: 60_000n,
		}).catch((err) => {
			expect(err.detail).toMatchObject({ amount_usd: 0.06, cap_usd: 0.05 });
		});
	});

	it('treats a null cap as unlimited per transaction', async () => {
		const { token } = seedSession({ max_per_tx_usdc: null });
		await expect(reserveSessionSpend({
			token, url: 'https://api.example.com/x', amountAtomics: 999_999n,
		})).resolves.toBeTruthy();
	});
});

// ── Budget: the part that decides whether money is real ──────────────────────

describe('atomic budget reservation', () => {
	it('debits the session on a successful reservation', async () => {
		const { token, row } = seedSession({ budget_usdc: '1000000' });
		await reserveSessionSpend({ token, url: 'https://a.test/x', amountAtomics: 250_000n });
		expect(store.sessions.get(row.id).spent_usdc).toBe('250000');
	});

	it('refuses a payment larger than the remaining budget', async () => {
		const { token } = seedSession({ budget_usdc: '1000000', spent_usdc: '900000' });
		await expectGovernorError(reserveSessionSpend({
			token, url: 'https://a.test/x', amountAtomics: 200_000n,
		}), 'insufficient_budget');
	});

	it('reports need and remaining so the caller can right-size a retry', async () => {
		const { token } = seedSession({ budget_usdc: '1000000', spent_usdc: '900000' });
		await reserveSessionSpend({
			token, url: 'https://a.test/x', amountAtomics: 200_000n,
		}).catch((err) => {
			expect(err.detail).toMatchObject({ need_usd: 0.2, remaining_usd: 0.1 });
		});
	});

	it('allows a payment that exactly drains the budget', async () => {
		const { token, row } = seedSession({ budget_usdc: '1000000' });
		await expect(reserveSessionSpend({
			token, url: 'https://a.test/x', amountAtomics: 1_000_000n,
		})).resolves.toBeTruthy();
		expect(store.sessions.get(row.id).spent_usdc).toBe('1000000');
	});

	it('flips a fully consumed session to exhausted', async () => {
		const { token, row } = seedSession({ budget_usdc: '1000000' });
		await reserveSessionSpend({ token, url: 'https://a.test/x', amountAtomics: 1_000_000n });
		expect(store.sessions.get(row.id).status).toBe('exhausted');
	});

	it('leaves a partially spent session active', async () => {
		const { token, row } = seedSession({ budget_usdc: '1000000' });
		await reserveSessionSpend({ token, url: 'https://a.test/x', amountAtomics: 999_999n });
		expect(store.sessions.get(row.id).status).toBe('active');
	});

	it('lets exactly one of two concurrent payments win when only one fits', async () => {
		// The overdraft this prevents: with a read-then-write check both callers read
		// $1.00 remaining, both decide $0.80 fits, and the session ends $0.60 in the
		// red. The reservation is a single predicated UPDATE, so the loser sees the
		// winner's committed spend.
		const { token, row } = seedSession({ budget_usdc: '1000000' });
		const pay = () => reserveSessionSpend({
			token, url: 'https://a.test/x', amountAtomics: 800_000n,
		}).then(() => 'ok', (err) => err.code);

		const results = await Promise.all([pay(), pay()]);

		expect(results.filter((r) => r === 'ok')).toHaveLength(1);
		expect(results.filter((r) => r === 'insufficient_budget')).toHaveLength(1);
		expect(store.sessions.get(row.id).spent_usdc).toBe('800000');
	});

	it('lets both concurrent payments through when both fit', async () => {
		const { token, row } = seedSession({ budget_usdc: '1000000' });
		const pay = () => reserveSessionSpend({
			token, url: 'https://a.test/x', amountAtomics: 400_000n,
		}).then(() => 'ok', (err) => err.code);

		expect(await Promise.all([pay(), pay()])).toEqual(['ok', 'ok']);
		expect(store.sessions.get(row.id).spent_usdc).toBe('800000');
	});

	it('never lets ten concurrent payments exceed the budget', async () => {
		const { token, row } = seedSession({ budget_usdc: '1000000' });
		const results = await Promise.all(Array.from({ length: 10 }, () =>
			reserveSessionSpend({ token, url: 'https://a.test/x', amountAtomics: 300_000n })
				.then(() => 'ok', (err) => err.code)));

		expect(results.filter((r) => r === 'ok')).toHaveLength(3); // 3 x $0.30 fits in $1.00
		expect(BigInt(store.sessions.get(row.id).spent_usdc))
			.toBeLessThanOrEqual(BigInt(row.budget_usdc));
	});
});

// ── Rollback ─────────────────────────────────────────────────────────────────

describe('rollbackReservation', () => {
	it('returns the reserved amount to the budget', async () => {
		const { token, row } = seedSession({ budget_usdc: '1000000' });
		await reserveSessionSpend({ token, url: 'https://a.test/x', amountAtomics: 250_000n });
		await rollbackReservation(row.id, 250_000n);
		expect(store.sessions.get(row.id).spent_usdc).toBe('0');
	});

	it('revives a session that rollback un-exhausts', async () => {
		const { token, row } = seedSession({ budget_usdc: '1000000' });
		await reserveSessionSpend({ token, url: 'https://a.test/x', amountAtomics: 1_000_000n });
		expect(store.sessions.get(row.id).status).toBe('exhausted');

		await rollbackReservation(row.id, 1_000_000n);
		const after = store.sessions.get(row.id);
		expect(after.spent_usdc).toBe('0');
		expect(after.status).toBe('active');
	});

	it('clamps at zero so an over-rollback cannot mint budget', async () => {
		const { row } = seedSession({ budget_usdc: '1000000', spent_usdc: '100000' });
		await rollbackReservation(row.id, 500_000n);
		expect(store.sessions.get(row.id).spent_usdc).toBe('0');
	});

	it('does not resurrect a cancelled session', async () => {
		const { row } = seedSession({ status: 'cancelled', spent_usdc: '100000' });
		await rollbackReservation(row.id, 100_000n);
		const after = store.sessions.get(row.id);
		expect(after.status).toBe('cancelled');
		expect(after.spent_usdc).toBe('100000');
	});
});

// ── Execution log ────────────────────────────────────────────────────────────

describe('recordExecution', () => {
	const base = {
		sessionId: SESSION_ID, userId: 'user-1', method: 'GET',
		amountAtomics: 50_000n, network: 'solana', status: 'settled',
	};

	it('derives endpoint_host from the URL for per-host reporting', async () => {
		await recordExecution({ ...base, endpointUrl: 'https://api.example.com/v1/data?k=1' });
		expect(store.executions[0].endpoint_host).toBe('api.example.com');
	});

	it('stores an empty host rather than throwing on an unparseable URL', async () => {
		await recordExecution({ ...base, endpointUrl: 'not a url' });
		expect(store.executions[0].endpoint_host).toBe('');
	});

	it('serializes the amount as an atomic-unit string', async () => {
		await recordExecution({ ...base, endpointUrl: 'https://a.test/x' });
		expect(store.executions[0].amount_usdc).toBe('50000');
	});

	it('writes one row per idempotency key, so a retry cannot double-bill', async () => {
		const row = { ...base, endpointUrl: 'https://a.test/x', idempotencyKey: 'run-42' };
		await recordExecution(row);
		await recordExecution(row);
		expect(store.executions).toHaveLength(1);
	});

	it('still records unkeyed executions individually', async () => {
		const row = { ...base, endpointUrl: 'https://a.test/x' };
		await recordExecution(row);
		await recordExecution(row);
		expect(store.executions).toHaveLength(2);
	});

	it('records a failed settlement with its error code for the audit trail', async () => {
		await recordExecution({
			...base, endpointUrl: 'https://a.test/x', status: 'failed',
			errorCode: 'settle_uncertain', errorMessage: 'socket hang up',
		});
		expect(store.executions[0]).toMatchObject({
			status: 'failed', error_code: 'settle_uncertain',
		});
	});

	it('stores the signed verdict alongside the execution', async () => {
		const { token, row } = seedSession({ budget_usdc: '1000000' });
		const reservation = await reserveSessionSpend({
			token, url: 'https://a.test/x', amountAtomics: 50_000n,
		});
		await recordExecution({
			...base, sessionId: row.id, endpointUrl: 'https://a.test/x',
			policyDigest: reservation.policyDigest,
			verdictCode: reservation.verdictCode,
			verdictSignature: reservation.verdictSignature,
			verdictSignedAt: reservation.verdictSignedAt,
		});
		expect(store.executions[0]).toMatchObject({
			policy_digest: reservation.policyDigest,
			verdict_code: 'allowed',
			verdict_signature: reservation.verdictSignature,
			verdict_signed_at: reservation.verdictSignedAt,
		});
	});
});

// ── Denylist ─────────────────────────────────────────────────────────────────

describe('blocked hosts', () => {
	it('refuses a call to a host on the denylist', async () => {
		const { token } = seedSession({ blocked_hosts: ['evil.test'] });
		await expectGovernorError(reserveSessionSpend({
			token, url: 'https://evil.test/x', amountAtomics: 10_000n,
		}), 'host_blocked');
	});

	it('allows a host that is not on the denylist', async () => {
		const { token } = seedSession({ blocked_hosts: ['evil.test'] });
		await expect(reserveSessionSpend({
			token, url: 'https://fine.test/x', amountAtomics: 10_000n,
		})).resolves.toBeTruthy();
	});

	it('blocks a host even when it also matches a broad allowlist entry', async () => {
		// An operator who denylists one bad sub-merchant under a wildcard allow
		// expects the denylist to be the final word.
		const { token } = seedSession({
			allowed_hosts: ['example.com'],
			blocked_hosts: ['bad.example.com'],
		});
		await expectGovernorError(reserveSessionSpend({
			token, url: 'https://bad.example.com/x', amountAtomics: 10_000n,
		}), 'host_blocked');
		await expect(reserveSessionSpend({
			token, url: 'https://good.example.com/x', amountAtomics: 10_000n,
		})).resolves.toBeTruthy();
	});
});

// ── Human-approval threshold ─────────────────────────────────────────────────

describe('approval threshold', () => {
	it('returns a distinct requires_approval verdict above the threshold', async () => {
		const { token } = seedSession({ approval_threshold_usdc: '50000' }); // $0.05
		await expectGovernorError(reserveSessionSpend({
			token, url: 'https://a.test/x', amountAtomics: 60_000n,
		}), 'requires_approval');
	});

	it('reports the amount and the threshold so a caller can decide', async () => {
		const { token } = seedSession({ approval_threshold_usdc: '50000' });
		await reserveSessionSpend({
			token, url: 'https://a.test/x', amountAtomics: 60_000n,
		}).catch((err) => {
			expect(err.detail).toMatchObject({ amount_usd: 0.06, threshold_usd: 0.05 });
		});
	});

	it('settles normally at or below the threshold', async () => {
		const { token, row } = seedSession({ approval_threshold_usdc: '50000' });
		const reservation = await reserveSessionSpend({
			token, url: 'https://a.test/x', amountAtomics: 50_000n,
		});
		expect(reservation.verdictCode).toBe('allowed');
		expect(store.sessions.get(row.id).spent_usdc).toBe('50000');
	});

	it('treats a null threshold as no approval requirement', async () => {
		const { token } = seedSession({ approval_threshold_usdc: null });
		await expect(reserveSessionSpend({
			token, url: 'https://a.test/x', amountAtomics: 999_999n,
		})).resolves.toBeTruthy();
	});
});

// ── Per-rail rolling 24h cap ─────────────────────────────────────────────────

describe('per-rail daily cap', () => {
	it('refuses a payment that would push the rolling 24h rail spend over the cap', async () => {
		const { token } = seedSession({ per_rail_daily_usdc: { [NETWORK_TO_CAIP2.solana]: 0.05 } });
		await expectGovernorError(reserveSessionSpend({
			token, url: 'https://a.test/x', amountAtomics: 60_000n,
		}), 'rail_daily_exceeded');
	});

	it('allows a payment within the cap and reserves it against the window', async () => {
		const { token } = seedSession({ per_rail_daily_usdc: { [NETWORK_TO_CAIP2.solana]: 0.05 } });
		await expect(reserveSessionSpend({
			token, url: 'https://a.test/x', amountAtomics: 30_000n,
		})).resolves.toBeTruthy();
		expect(store.railReservations.filter((r) => r.network === NETWORK_TO_CAIP2.solana)).toHaveLength(1);
	});

	it('lets a second payment through once the first is within the cap, and refuses what would overflow it', async () => {
		const { token } = seedSession({ per_rail_daily_usdc: { [NETWORK_TO_CAIP2.solana]: 0.05 } });
		await reserveSessionSpend({ token, url: 'https://a.test/x', amountAtomics: 30_000n });
		await expectGovernorError(reserveSessionSpend({
			token, url: 'https://a.test/x', amountAtomics: 30_000n, // 30k + 30k > 50k cap
		}), 'rail_daily_exceeded');
	});

	it('lets exactly one of two concurrent payments win when only one fits the rail cap', async () => {
		const { token } = seedSession({ budget_usdc: '1000000', per_rail_daily_usdc: { [NETWORK_TO_CAIP2.solana]: 0.05 } });
		const pay = () => reserveSessionSpend({
			token, url: 'https://a.test/x', amountAtomics: 40_000n,
		}).then(() => 'ok', (err) => err.code);

		const results = await Promise.all([pay(), pay()]);
		expect(results.filter((r) => r === 'ok')).toHaveLength(1);
		expect(results.filter((r) => r === 'rail_daily_exceeded')).toHaveLength(1);
	});

	it('releases the rail reservation on rollback, so a failed call does not eat into the next cap check', async () => {
		const { token, row } = seedSession({ budget_usdc: '1000000', per_rail_daily_usdc: { [NETWORK_TO_CAIP2.solana]: 0.05 } });
		const reservation = await reserveSessionSpend({
			token, url: 'https://a.test/x', amountAtomics: 40_000n,
		});
		await rollbackReservation(row.id, 40_000n, { railReservationId: reservation.railReservationId });
		expect(store.railReservations).toHaveLength(0);
		// The rail window is clear again, so a call that would otherwise have
		// collided with the rolled-back reservation now fits.
		await expect(reserveSessionSpend({
			token, url: 'https://a.test/x', amountAtomics: 40_000n,
		})).resolves.toBeTruthy();
	});

	it('treats an empty per_rail_daily_usdc as no cap', async () => {
		const { token } = seedSession({ per_rail_daily_usdc: {} });
		await expect(reserveSessionSpend({
			token, url: 'https://a.test/x', amountAtomics: 999_999n,
		})).resolves.toBeTruthy();
	});
});

// ── Signed verdicts ──────────────────────────────────────────────────────────

describe('signed verdicts', () => {
	it('signs an allowed verdict with a signature that verifies', async () => {
		const { token, row } = seedSession({ budget_usdc: '1000000' });
		const url = 'https://a.test/x';
		const amountAtomics = 10_000n;
		const r = await reserveSessionSpend({ token, url, amountAtomics });
		expect(r.verdictCode).toBe('allowed');

		const requestHash = computeRequestHash({ sessionId: row.id, url, amountAtomics });
		expect(verifyVerdictSignature({
			verdictCode: r.verdictCode,
			policyDigest: r.policyDigest,
			requestHash,
			timestamp: r.verdictSignedAt,
			signature: r.verdictSignature,
		})).toBe(true);
	});

	it('fails verification when any signed field is altered', async () => {
		const { token, row } = seedSession({ budget_usdc: '1000000' });
		const url = 'https://a.test/x';
		const amountAtomics = 10_000n;
		const r = await reserveSessionSpend({ token, url, amountAtomics });
		const requestHash = computeRequestHash({ sessionId: row.id, url, amountAtomics });

		expect(verifyVerdictSignature({
			verdictCode: r.verdictCode, policyDigest: 'tampered', requestHash,
			timestamp: r.verdictSignedAt, signature: r.verdictSignature,
		})).toBe(false);
		expect(verifyVerdictSignature({
			verdictCode: 'rejected', policyDigest: r.policyDigest, requestHash,
			timestamp: r.verdictSignedAt, signature: r.verdictSignature,
		})).toBe(false);
	});

	it('a rejection verdict is signed too, over its own policy digest', async () => {
		const { token } = seedSession({ blocked_hosts: ['evil.test'] });
		await reserveSessionSpend({
			token, url: 'https://evil.test/x', amountAtomics: 10_000n,
		}).catch((err) => {
			expect(err.detail.policy_digest).toBeTruthy();
			expect(err.detail.verdict_signature).toBeTruthy();
			expect(err.detail.verdict_signed_at).toBeTruthy();
		});
	});

	it('changes the policy digest when a governed field changes, so a tampered policy cannot reuse an old signature', async () => {
		const { row } = seedSession({ budget_usdc: '1000000' });
		const before = computePolicyDigest(row);
		const tampered = { ...row, approval_threshold_usdc: '1' };
		const after = computePolicyDigest(tampered);
		expect(after).not.toBe(before);
	});

	it('rejects a signature computed against the original digest once the policy (and so the digest) changes', async () => {
		const { token, row } = seedSession({ budget_usdc: '1000000' });
		const r = await reserveSessionSpend({ token, url: 'https://a.test/x', amountAtomics: 10_000n });

		// The policy actually governing this session changes after the verdict was signed.
		const tamperedDigest = computePolicyDigest({ ...row, budget_usdc: '2000000' });
		expect(tamperedDigest).not.toBe(r.policyDigest);

		// Re-signing with the tampered digest produces a different signature than
		// the one that was actually stored, so a verifier comparing against the
		// tampered digest catches the edit.
		const forgedSignature = signVerdict({
			verdictCode: r.verdictCode,
			policyDigest: tamperedDigest,
			requestHash: 'whatever-request-hash',
			timestamp: r.verdictSignedAt,
		});
		expect(forgedSignature).not.toBe(r.verdictSignature);
	});
});

// ── Parity with the dry-run simulator ────────────────────────────────────────

describe('parity: a simulated verdict and an enforced one never disagree', () => {
	// api/pay/simulate.js's replay() and this governor's reserveSessionSpend()
	// both resolve to policy.js's evaluateCall(). This test builds the same
	// policy object both callers build from a session row and runs it through
	// both paths, so a future change that lets them diverge fails here first.
	const cases = [
		{ name: 'plain allow', amountAtomics: 10_000n, expect: 'allowed' },
		{ name: 'blocked host', amountAtomics: 10_000n, url: 'https://evil.test/x',
			seed: { blocked_hosts: ['evil.test'] }, expect: 'host_blocked' },
		{ name: 'per-tx ceiling', amountAtomics: 60_000n,
			seed: { max_per_tx_usdc: '50000' }, expect: 'per_tx_exceeded' },
		{ name: 'approval threshold', amountAtomics: 60_000n,
			seed: { approval_threshold_usdc: '50000' }, expect: 'requires_approval' },
		{ name: 'rail daily cap', amountAtomics: 60_000n,
			seed: { per_rail_daily_usdc: { [NETWORK_TO_CAIP2.solana]: 0.05 } }, expect: 'rail_daily_exceeded' },
		{ name: 'insufficient budget', amountAtomics: 2_000_000n, expect: 'insufficient_budget' },
	];

	for (const c of cases) {
		it(`agrees on "${c.name}"`, async () => {
			const url = c.url ?? 'https://a.test/x';
			const { token, row } = seedSession({ budget_usdc: '1000000', ...c.seed });

			const enforced = await reserveSessionSpend({ token, url, amountAtomics: c.amountAtomics })
				.then(() => 'allowed', (err) => err.code);

			const simulated = replay([{ url, amountAtomics: c.amountAtomics }], {
				budgetAtomics: BigInt(row.budget_usdc),
				maxPerTxAtomics: row.max_per_tx_usdc,
				allowedHosts: row.allowed_hosts,
				blockedHosts: row.blocked_hosts,
				status: row.status,
				expiresAt: row.expires_at,
				railDailyCapAtomics: resolveRailDailyCapAtomics(row.network, row.per_rail_daily_usdc),
				approvalThresholdAtomics: row.approval_threshold_usdc,
			}).steps[0];
			const simulatedCode = simulated.allowed ? 'allowed' : simulated.rejection.code;

			expect(enforced).toBe(c.expect);
			expect(simulatedCode).toBe(c.expect);
		});
	}
});

// ── The atomicity guarantee itself ───────────────────────────────────────────

describe('reservation statement shape', () => {
	// The race-safety above is only real because the check and the increment are one
	// statement. A refactor that splits them into a SELECT then an UPDATE would keep
	// every test above passing against the in-memory store while reintroducing the
	// overdraft against Postgres, so the shape is pinned directly.
	let source;
	let flat;
	beforeAll(() => {
		source = readFileSync(new URL('../api/_lib/pay/spend-governor.js', import.meta.url), 'utf8');
		flat = source.replace(/\s+/g, ' ');
	});

	it('checks the remaining budget inside the UPDATE, not before it', () => {
		const start = flat.indexOf('UPDATE payment_sessions SET spent_usdc');
		expect(start).toBeGreaterThan(-1);
		const stmt = flat.slice(start, start + 300);
		expect(stmt).toContain('SET spent_usdc = spent_usdc +');
		expect(stmt).toContain('(budget_usdc - spent_usdc) >=');
		expect(stmt).toContain("AND status = 'active'");
		expect(stmt).toContain('RETURNING');
	});

	it('clamps the rollback in SQL rather than in JS', () => {
		expect(source).toContain('greatest(0, spent_usdc - ');
	});

	it('makes the execution log idempotent in SQL', () => {
		expect(source).toContain('ON CONFLICT (idempotency_key) DO NOTHING');
	});
});
