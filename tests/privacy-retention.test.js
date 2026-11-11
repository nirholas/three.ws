// Privacy-policy retention windows must each have a job that enforces them.
//
// public/legal/privacy.html section 5 promises: session tokens expire after
// 30 days, nonces expire after 5 minutes and are purged within 24 hours, and
// widget view events are retained for 12 months. Before 2026-11-11 nothing
// deleted rows from sessions (which hold the raw sign-in IP and user agent),
// the four nonce tables, or widget_views, so every one of those rows lived
// forever. The /trust page cites these windows, so they have to be real.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { PRIVACY_RETENTION, purgePrivacyRetention } from '../api/_lib/privacy-retention.js';

const byTable = Object.fromEntries(PRIVACY_RETENTION.map((r) => [r.table, r]));

describe('privacy retention inventory', () => {
	it('covers every table behind a section 5 promise', () => {
		for (const t of ['sessions', 'siwe_nonces', 'siws_nonces', 'gate_nonces', 'embed_gate_nonces', 'widget_views']) {
			expect(byTable[t], `${t} needs an enforcing retention rule`).toBeTruthy();
		}
	});

	it('uses the windows the privacy policy states', () => {
		// Nonces: purged within 24 hours of expiry.
		for (const t of ['siwe_nonces', 'siws_nonces', 'gate_nonces', 'embed_gate_nonces']) {
			expect(byTable[t].hours, t).toBe(24);
		}
		// Sessions: removed once expired or revoked (30-day TTL, so a row never outlives ~60 days).
		expect(byTable.sessions.hours).toBe(24 * 30);
		// Widget views: 12 months.
		expect(byTable.widget_views.hours).toBe(24 * 365);
	});

	it('quotes the policy promise and the column it keys on for each rule', () => {
		for (const r of PRIVACY_RETENTION) {
			expect(r.promise.length, r.table).toBeGreaterThan(20);
			expect(r.predicate, r.table).toMatch(/\$1/);
		}
	});

	it('is wired into the db-retention cron', () => {
		const src = readFileSync(new URL('../api/cron/db-retention.js', import.meta.url), 'utf8');
		expect(src).toMatch(/import \{ purgePrivacyRetention \} from '\.\.\/_lib\/privacy-retention\.js'/);
		expect(src).toMatch(/await purgePrivacyRetention\(/);
	});
});

describe('purgePrivacyRetention', () => {
	function fakeSql(rowsPerCall) {
		const calls = [];
		const fn = async (text, params) => {
			calls.push({ text, params });
			const n = typeof rowsPerCall === 'function' ? rowsPerCall(text, calls.length) : rowsPerCall;
			return Array.from({ length: n }, () => 1);
		};
		fn.calls = calls;
		return fn;
	}

	it('issues one bounded delete per existing table with the window in hours', async () => {
		const sql = fakeSql(0);
		const out = await purgePrivacyRetention({ sql, tableExists: async () => true });
		expect(sql.calls).toHaveLength(PRIVACY_RETENTION.length);
		for (const call of sql.calls) {
			expect(call.text).toMatch(/^DELETE FROM \w+ WHERE ctid IN \(\s*SELECT ctid FROM \w+ WHERE .+ LIMIT \$2\s*\) RETURNING 1$/s);
			expect(typeof call.params[0]).toBe('number');
		}
		const sessions = sql.calls.find((c) => c.text.startsWith('DELETE FROM sessions '));
		expect(sessions.text).toMatch(/expires_at < now\(\) - \$1 \* interval '1 hour'/);
		expect(sessions.text).toMatch(/revoked_at < now\(\) - \$1 \* interval '1 hour'/);
		expect(sessions.params[0]).toBe(720);
		expect(out).toEqual({ deleted: {}, skipped: [] });
	});

	it('skips tables that do not exist on this branch', async () => {
		const sql = fakeSql(0);
		const out = await purgePrivacyRetention({ sql, tableExists: async (t) => t !== 'embed_gate_nonces' });
		expect(sql.calls.some((c) => c.text.includes('embed_gate_nonces'))).toBe(false);
		expect(out.skipped).toContain('embed_gate_nonces');
	});

	it('keeps deleting in batches until a short batch, and reports counts per table', async () => {
		const sql = fakeSql((text, n) => (text.startsWith('DELETE FROM widget_views') && n < 100 ? 5000 : 3));
		const out = await purgePrivacyRetention({ sql, tableExists: async () => true, batch: 5000, maxBatches: 4 });
		const wv = sql.calls.filter((c) => c.text.startsWith('DELETE FROM widget_views'));
		expect(wv.length).toBeGreaterThan(1);
		expect(out.deleted.widget_views).toBeGreaterThan(5000);
		expect(out.deleted.sessions).toBe(3);
	});

	it('records a failing table and still runs the rest', async () => {
		const sql = async (text) => {
			if (text.startsWith('DELETE FROM siwe_nonces')) throw new Error('boom');
			return [];
		};
		const out = await purgePrivacyRetention({ sql, tableExists: async () => true });
		expect(out.errors.siwe_nonces).toBe('boom');
	});
});
