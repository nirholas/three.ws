-- Migration: Microsoft Marketplace leads (the HTTPS endpoint lead destination).
-- Apply: node scripts/apply-migrations.mjs --apply --file 20261111160847_microsoft_marketplace_leads.sql
-- Idempotent.
--
-- Partner Center posts every lead for an offer to /api/microsoft-marketplace/leads/<token>.
-- api/_lib/microsoft-leads.js stores the raw payload, the documented fields
-- parsed out of it, the owner notification outcome and the drafted reply. The
-- reply is never sent automatically; the admin view (/admin/microsoft/leads)
-- copies it and records the follow-up status and notes.
--
-- Personal data is limited to what Microsoft sends (name, email, phone,
-- country, company, job title, the customer's note). Nothing else about the
-- request is kept (no IP, no headers). Retention (redactExpiredLeads, run by
-- api/cron/microsoft-leads.js): DNC leads after 30 days, closed leads 365 days
-- after closing, every lead after 730 days lose their personal fields; the
-- company, country, source, action, offer, status and timestamps stay.

CREATE TABLE IF NOT EXISTS microsoft_marketplace_leads (
	id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	dedupe_key         text NOT NULL UNIQUE,
	raw_payload        jsonb NOT NULL,
	lead_source_raw    text,
	source             text NOT NULL,
	action             text,
	publisher_id       text,
	offer_id           text,
	offer_title        text,
	description        text,
	first_name         text,
	last_name          text,
	email              text,
	phone              text,
	country            text,
	company            text,
	job_title          text,
	received_at        timestamptz NOT NULL DEFAULT now(),
	status             text NOT NULL DEFAULT 'new',
	status_changed_at  timestamptz,
	owner_notes        text,
	notified_at        timestamptz,
	notify_channels    jsonb,
	draft_status       text NOT NULL DEFAULT 'pending',
	draft_subject      text,
	draft_body         text,
	draft_provider     text,
	draft_model        text,
	draft_error        text,
	draft_attempts     integer NOT NULL DEFAULT 0,
	draft_updated_at   timestamptz,
	redacted_at        timestamptz,
	updated_at         timestamptz NOT NULL DEFAULT now(),
	CONSTRAINT microsoft_marketplace_leads_status CHECK (status IN ('new', 'contacted', 'qualified', 'closed')),
	CONSTRAINT microsoft_marketplace_leads_draft_status CHECK (draft_status IN ('pending', 'ready', 'failed', 'skipped'))
);

CREATE INDEX IF NOT EXISTS microsoft_marketplace_leads_received_idx
	ON microsoft_marketplace_leads (received_at DESC);
CREATE INDEX IF NOT EXISTS microsoft_marketplace_leads_status_idx
	ON microsoft_marketplace_leads (status, received_at DESC);
CREATE INDEX IF NOT EXISTS microsoft_marketplace_leads_followup_idx
	ON microsoft_marketplace_leads (draft_status, received_at)
	WHERE draft_status IN ('pending', 'failed') OR notified_at IS NULL;
