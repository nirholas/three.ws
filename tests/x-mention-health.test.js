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

import { describe, it, expect } from 'vitest';
import { mentionBotVerdict, LAG_DEGRADED_MS, ERROR_RATE_DEGRADED } from '../api/_lib/x-mention-health.js';

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
