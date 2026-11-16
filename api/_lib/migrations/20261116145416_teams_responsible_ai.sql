-- Migration: Responsible AI records for the three.ws Teams bot.
-- Apply: npm run db:migrate
-- Idempotent.
--
-- teams_ai_messages   one row per bot message that carries model-generated
--                     text or a generated 3D model (the messages Teams shows
--                     with the "AI generated" label). It links the Teams
--                     message id to the agent or forge job that produced it,
--                     so feedback and reports on that message can name their
--                     subject. It never holds the message text.
-- teams_ai_feedback   the thumbs up / thumbs down a person gave one of those
--                     messages, with the optional comment they typed. One row
--                     per person per message; a changed vote replaces it.
-- content_reports     "Report" submissions on generated content: the reason,
--                     the optional comment, and an excerpt of the reported
--                     bot output (capped) so a reviewer can judge it. Reviewed
--                     in /admin/microsoft.
--
-- Conversation and person ids are stored as sha256 hashes: the rows can be
-- grouped per conversation and per reporter (one vote, one report each)
-- without keeping a Teams identifier. The tenant id is kept as is, because a
-- report or a feedback trend has to be attributable to an organisation.
-- Retention (api/_lib/privacy-retention.js): messages 90 days, feedback 365
-- days, reports 365 days after a reviewer closes them.

begin;

create table if not exists teams_ai_messages (
    conversation_hash text        not null,
    activity_id       text        not null,
    tenant_id         text,
    kind              text        not null check (kind in ('agent_reply', 'forge_model')),
    agent_id          uuid        references agent_identities(id) on delete set null,
    forge_key         text,
    model             text,
    cited_docs        uuid[]      not null default '{}',
    created_at        timestamptz not null default now(),
    primary key (conversation_hash, activity_id)
);

create index if not exists teams_ai_messages_created on teams_ai_messages (created_at);

create table if not exists teams_ai_feedback (
    id                bigserial   primary key,
    conversation_hash text        not null,
    activity_id       text        not null,
    reporter_hash     text        not null,
    tenant_id         text,
    kind              text        check (kind in ('agent_reply', 'forge_model')),
    agent_id          uuid        references agent_identities(id) on delete set null,
    forge_key         text,
    reaction          text        not null check (reaction in ('like', 'dislike')),
    comment           text        check (char_length(comment) <= 1000),
    created_at        timestamptz not null default now(),
    updated_at        timestamptz not null default now(),
    unique (conversation_hash, activity_id, reporter_hash)
);

create index if not exists teams_ai_feedback_created on teams_ai_feedback (created_at desc);
create index if not exists teams_ai_feedback_agent on teams_ai_feedback (agent_id, created_at desc) where agent_id is not null;

create table if not exists content_reports (
    id                uuid        primary key default gen_random_uuid(),
    surface           text        not null check (surface in ('teams')),
    subject_kind      text        not null check (subject_kind in ('agent_reply', 'forge_model', 'bot_message')),
    conversation_hash text        not null,
    activity_id       text        not null,
    tenant_id         text,
    reporter_hash     text        not null,
    agent_id          uuid        references agent_identities(id) on delete set null,
    forge_key         text,
    model_url         text,
    reason            text        not null check (reason in ('harmful', 'hateful', 'sexual', 'violent', 'self_harm', 'misinformation', 'privacy', 'copyright', 'other')),
    comment           text        check (char_length(comment) <= 1000),
    excerpt           text        check (char_length(excerpt) <= 2000),
    status            text        not null default 'open' check (status in ('open', 'actioned', 'dismissed')),
    resolution        text        check (char_length(resolution) <= 1000),
    reviewed_by       text,
    reviewed_at       timestamptz,
    created_at        timestamptz not null default now(),
    unique (surface, conversation_hash, activity_id, reporter_hash)
);

create index if not exists content_reports_open on content_reports (created_at desc) where status = 'open';
create index if not exists content_reports_created on content_reports (created_at desc);

commit;
