// The trial reminder ledger against the real schema (api/_lib/schema.sql plus
// every migration on PGlite). The reminder cron stores the id of the in-app
// notification it sent in microsoft_saas_trial_reminders.notification_id;
// user_notifications.id is a uuid, so the column must accept one. A live run of
// scripts/microsoft-trial-live-check.mjs failed here with "invalid input syntax
// for type bigint" because the column was created as bigint.

import { beforeAll, describe, it, expect, vi } from 'vitest';
import { createPgliteSql } from './_helpers/pglite-sql.js';
import { createFullSchemaDb } from './_helpers/pglite-full-schema.js';

const holder = vi.hoisted(() => ({ db: null }));

vi.mock('../api/_lib/db.js', async (importActual) => {
	const actual = await importActual();
	return { ...actual, sql: (...args) => holder.db.sql(...args) };
});

process.env.DATABASE_URL ||= 'postgres://pglite.test/db';

const { claimTrialReminder, recordTrialReminder } = await import('../api/_lib/microsoft-trial.js');

describe('microsoft_saas_trial_reminders on the real schema', () => {
	let sql;
	beforeAll(async () => {
		const { pg } = await createFullSchemaDb();
		holder.db = createPgliteSql({ pg });
		sql = holder.db.sql;
	}, 120_000);

	it('records the uuid of the in-app notification the reminder sent', async () => {
		const [user] = await sql`insert into users (email, display_name) values ('trial.ledger@contoso.example', 'Trial Ledger') returning id`;
		const subId = 'a3d1b6f2-1c55-4f0e-9a7e-6f1b8f0c2e11';
		await sql`
			insert into microsoft_saas_subscriptions (id, offer_id, plan_id, saas_status, user_id, is_free_trial, trial_ends_at)
			values (${subId}, 'three-ws', 'pro', 'Subscribed', ${user.id}, true, now() + interval '6 days')
		`;
		const claimed = await claimTrialReminder({ subscriptionId: subId, userId: user.id, milestone: '7d', trialEndsAt: new Date(Date.now() + 6 * 86400_000) });
		expect(claimed).not.toBeNull();
		const [note] = await sql`insert into user_notifications (user_id, type, payload) values (${user.id}, 'microsoft_trial_ending', '{}'::jsonb) returning id`;

		await recordTrialReminder(claimed.id, { notificationId: note.id, emailTo: 'trial.ledger@contoso.example', emailStatus: 'sent' });

		const [row] = await sql`select notification_id::text as notification_id, email_status from microsoft_saas_trial_reminders where id = ${claimed.id}`;
		expect(row).toEqual({ notification_id: note.id, email_status: 'sent' });
		expect(await claimTrialReminder({ subscriptionId: subId, userId: user.id, milestone: '7d', trialEndsAt: new Date() })).toBeNull();
	});
});
