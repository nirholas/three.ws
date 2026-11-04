-- Share funnel: after a creation is shared, is the link opened, does the AR button
-- get pressed, does an unfurl card render, and does any of it lead to a new forge.
--
-- share_funnel_daily is an aggregate counter and nothing else. One row per
-- (day, surface, kind). There is deliberately no ip, user id, creation id or URL
-- path column: the platform avoids raw-IP logging, and a funnel rate does not
-- need to know WHO opened a link, only how many did.
--
--   surface  ar | oembed_agent | oembed_play | creation_page | og_image | diorama_share
--   kind     view | action | cta_click
--
-- forge_creations.source records where a generation was started from. 'share'
-- means the maker arrived from a shared link's "make your own" call to action
-- (/forge?from=share). Null is every row before this migration and every
-- generation started directly.
--
-- Idempotent: safe to apply twice.
create table if not exists share_funnel_daily (
	day     date    not null,
	surface text    not null,
	kind    text    not null,
	count   bigint  not null default 0,
	primary key (day, surface, kind),
	constraint share_funnel_daily_surface_chk
		check (surface in ('ar', 'oembed_agent', 'oembed_play', 'creation_page', 'og_image', 'diorama_share')),
	constraint share_funnel_daily_kind_chk
		check (kind in ('view', 'action', 'cta_click'))
);

alter table forge_creations
	add column if not exists source text;

create index if not exists forge_creations_source_idx
	on forge_creations (created_at desc)
	where source is not null;
