-- Run the three-ws-forge Edge Function: once right after each insert, and
-- every minute from pg_cron so polling continues and retries come due.
--
-- The function URL and its shared secret live in Vault, never in this file:
--   select vault.create_secret('https://<project-ref>.supabase.co', 'three_ws_project_url');
--   select vault.create_secret('<same value as THREE_WS_FORGE_SECRET>', 'three_ws_forge_secret');
-- Until both exist, the kick logs a warning and does nothing.

create extension if not exists pg_net with schema extensions;
create extension if not exists pg_cron;

create or replace function public.three_ws_kick_sweep()
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
	project_url text;
	forge_secret text;
begin
	select decrypted_secret into project_url from vault.decrypted_secrets where name = 'three_ws_project_url';
	select decrypted_secret into forge_secret from vault.decrypted_secrets where name = 'three_ws_forge_secret';
	if project_url is null or forge_secret is null then
		raise warning 'three.ws Forge: add the three_ws_project_url and three_ws_forge_secret Vault secrets so the sweep can run';
		return;
	end if;
	perform net.http_post(
		url := rtrim(project_url, '/') || '/functions/v1/three-ws-forge',
		headers := jsonb_build_object('content-type', 'application/json', 'x-three-ws-forge-secret', forge_secret),
		body := jsonb_build_object('source', 'database'),
		timeout_milliseconds := 5000
	);
end;
$$;

revoke all on function public.three_ws_kick_sweep() from public, anon, authenticated;
grant execute on function public.three_ws_kick_sweep() to service_role;

create or replace function public.three_ws_models_after_insert()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
	perform public.three_ws_kick_sweep();
	return null;
end;
$$;

drop trigger if exists three_ws_models_kick on public.three_ws_models;
create trigger three_ws_models_kick
	after insert on public.three_ws_models
	for each statement execute function public.three_ws_models_after_insert();

-- The cron tick calls the function only while some model is unfinished, so an
-- idle project spends no invocations.
select cron.schedule(
	'three-ws-forge-sweep',
	'* * * * *',
	$cron$select public.three_ws_kick_sweep()
		where exists (
			select 1 from public.three_ws_models
			where status in ('queued', 'submitting', 'generating', 'storing')
		)$cron$
);
