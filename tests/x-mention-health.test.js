/**
 * X mention bot health sensor, unit test (x-grok 42).
 *
 * The bot has no reachability signature of its own: the webhook always
 * answers 200 to X whether or not it actually decided anything, so a wedged
 * decision path or a silently error-heavy hour looked identical to healthy
 * from the outside. This pins the verdict logic that now distinguishes them,
 * including the one state that must never read as a fault: an operator who
 * paused the bot on purpose.
 */

import { readFileSync } from 'node:fs';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { PGlite } from '@electric-sql/pglite';

const dbState = { pg: null };

vi.mock('../api/_lib/db.js', () => {
	const sql = async (strings, ...values) => {
		const text = strings.reduce((acc, part, i) => acc + part + (i < values.length ? `$${i + 1}` : ''), '');
		return (await dbState.pg.query(text, values)).rows;
	};
	return { sql, isDbUnavailableError: () => false, isDbCapacityError: () => false };
});

const { mentionBotVerdict, LAG_DEGRADED_MS, ERROR_RATE_DEGRADED, readMentionBotSignals } = await import('../api/_lib/x-mention-health.js');

const MIG = new URL('../api/_lib/migrations/', import.meta.url);
const MIGRATION = readFileSync(new URL('20261008170000_x_mention_events.sql', MIG), 'utf8');
const APP_SETTINGS = (() => {
	const src = readFileSync(new URL('20260922210000_free_tier_models.sql', MIG), 'utf8');
	const start = src.indexOf('CREATE TABLE IF NOT EXISTS app_settings');
	return src.slice(start, src.indexOf(');', start) + 2);
})();

beforeEach(async () => {
	dbState.pg = new PGlite();
	await dbState.pg.exec(APP_SETTINGS);
	await dbState.pg.exec(MIGRATION);
});

describe('readMentionBotSignals', () => {
	it('excludes synthetic -evidence rows from the unprocessed count, and counts a real row', async () => {
		await dbState.pg.query(
			`insert into x_mention_events (tweet_id, account_kind, account_ref, author_id, intent, decision) values ($1,'company','trythreews-evidence','9000000000000000001','ignore',null)`,
			['7514357880548491265'],
		);
		await dbState.pg.query(
			`insert into x_mention_events (tweet_id, account_kind, account_ref, author_id, intent, decision) values ($1,'company','trythreews','9000000000000000002','chat',null)`,
			['1900000000000000900'],
		);
		const signals = await readMentionBotSignals({ env: {} });
		expect(signals.unprocessed).toBe(1);
	});
});

describe('mentionBotVerdict', () => {
	it('reads unknown before any mention has ever been recorded', () => {
		const v = mentionBotVerdict({ paused: false, live: false, lastEventAgeMs: null, unprocessedLagMs: null, errorRate: null });
		expect(v.status).toBe('unknown');
		expect(v.mode).toBe('dry_run');
	});

	it('reads ok in dry run with fresh mentions and no lag', () => {
		const v = mentionBotVerdict({ paused: false, live: false, lastEventAgeMs: 5_000, unprocessedLagMs: 1_000, errorRate: 0, decidedLastHour: 10 });
		expect(v.status).toBe('ok');
		expect(v.mode).toBe('dry_run');
		expect(v.detail).toMatch(/dry run/);
	});

	it('reads ok and live when the bot is actually sending', () => {
		const v = mentionBotVerdict({ paused: false, live: true, lastEventAgeMs: 5_000, unprocessedLagMs: 1_000, errorRate: 0, decidedLastHour: 10 });
		expect(v.status).toBe('ok');
		expect(v.mode).toBe('live');
		expect(v.detail).toMatch(/live/);
	});

	it('degrades when the oldest undecided mention exceeds the lag threshold', () => {
		const v = mentionBotVerdict({
			paused: false,
			live: true,
			lastEventAgeMs: 30_000,
			unprocessedLagMs: LAG_DEGRADED_MS + 60_000,
			errorRate: 0,
			decidedLastHour: 10,
		});
		expect(v.status).toBe('degraded');
		expect(v.detail).toMatch(/undecided mention/);
	});

	it('degrades when the last hour error rate exceeds the threshold at real sample size', () => {
		const v = mentionBotVerdict({
			paused: false,
			live: true,
			lastEventAgeMs: 5_000,
			unprocessedLagMs: 0,
			errorRate: ERROR_RATE_DEGRADED + 0.1,
			decidedLastHour: 20,
		});
		expect(v.status).toBe('degraded');
		expect(v.detail).toMatch(/errored/);
	});

	it('does not degrade on a high error rate from too small a sample', () => {
		const v = mentionBotVerdict({
			paused: false,
			live: true,
			lastEventAgeMs: 5_000,
			unprocessedLagMs: 0,
			errorRate: 1,
			decidedLastHour: 1,
		});
		expect(v.status).toBe('ok');
	});

	it('reads paused, never down, when an operator switched the bot off on purpose', () => {
		const v = mentionBotVerdict({
			paused: true,
			live: true,
			lastEventAgeMs: LAG_DEGRADED_MS * 100,
			unprocessedLagMs: LAG_DEGRADED_MS * 100,
			errorRate: 1,
			decidedLastHour: 50,
		});
		expect(v.status).toBe('paused');
		expect(v.mode).toBe('paused');
		expect(v.status).not.toBe('down');
	});
});
