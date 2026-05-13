-- Avatars are now public by default.
-- This only changes the column default for new rows; existing rows are not modified.

alter table avatars alter column visibility set default 'public';
