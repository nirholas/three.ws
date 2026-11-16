-- Migration: store the trial reminder's in-app notification id as a uuid.
-- Apply: node scripts/apply-migrations.mjs --apply --file 20261116162459_microsoft_trial_reminder_notification_uuid.sql
-- Idempotent.
--
-- 20261116152500_microsoft_saas_free_trial.sql declared
-- microsoft_saas_trial_reminders.notification_id as bigint, but it holds the id
-- insertNotification returns, which is user_notifications.id (uuid). Every
-- reminder write with a real notification id failed with "invalid input syntax
-- for type bigint", so the cron errored after sending the bell and before it
-- recorded the email outcome. No row can hold a non-null value under the old
-- type for that reason, so the conversion drops nothing. The guard skips the
-- change once the column is already uuid.

begin;

do $$
begin
	if exists (
		select 1 from information_schema.columns
		where table_schema = current_schema()
			and table_name = 'microsoft_saas_trial_reminders'
			and column_name = 'notification_id'
			and data_type = 'bigint'
	) then
		alter table microsoft_saas_trial_reminders
			alter column notification_id type uuid using null;
	end if;
end
$$;

commit;
