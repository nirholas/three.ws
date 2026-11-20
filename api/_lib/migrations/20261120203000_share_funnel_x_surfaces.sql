-- Share funnel: count the share panel's two X actions per entity kind.
--
-- "Share on X" (utm_campaign=grok-share) and "Ask @grok about it"
-- (utm_campaign=grok-ask) on model, avatar and anatomy pages each beacon one
-- aggregate counter. Same privacy contract as the table itself: a surface and
-- a kind, never an identifier. See docs/share-to-x.md.
--
--   x_share_model | x_share_avatar | x_share_anatomy
--   grok_ask_model | grok_ask_avatar | grok_ask_anatomy
--
-- Idempotent: drops and recreates the surface check with the widened list.
alter table share_funnel_daily
	drop constraint if exists share_funnel_daily_surface_chk;

alter table share_funnel_daily
	add constraint share_funnel_daily_surface_chk
	check (surface in (
		'ar', 'oembed_agent', 'oembed_play', 'creation_page', 'og_image', 'diorama_share',
		'x_share_model', 'x_share_avatar', 'x_share_anatomy',
		'grok_ask_model', 'grok_ask_avatar', 'grok_ask_anatomy'
	));
