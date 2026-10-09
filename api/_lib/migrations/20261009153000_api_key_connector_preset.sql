-- API key presets and the coarse "spend" scope.
--
-- A key issued for an unattended agent (Grok Bot, a schedule, CI) carries
-- preset = 'connector'. The server strips every spend-capable scope from such a
-- key at authentication time, so it can read, generate and edit agent data and
-- can never move funds, however its scope string is edited later.
--
-- Existing keys keep exactly the power they have today: preset stays null, and
-- a key that already holds wallet:write or services:write also gets the new
-- "spend" token so the dashboard shows what it can really do.

alter table api_keys add column if not exists preset text;

alter table api_keys drop constraint if exists api_keys_preset_check;
alter table api_keys add constraint api_keys_preset_check
    check (preset is null or preset = 'connector');

update api_keys
   set scope = scope || ' spend'
 where preset is null
   and (scope ~ '(^| )wallet:write( |$)' or scope ~ '(^| )services:write( |$)')
   and scope !~ '(^| )spend( |$)';
