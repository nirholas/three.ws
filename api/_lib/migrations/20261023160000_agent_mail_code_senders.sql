-- Agent inbox one-time-code extraction: the per-agent list of senders the
-- agent may extract verification codes and magic links from
-- (api/_lib/mail/otp.js, docs/agent-mail.md).
--
-- `code_senders` holds full addresses (noreply@example.com) and whole domains
-- written as @example.com, normalized the same way as the send allowlist. An
-- empty list means the agent may extract nothing: the owner opts each service
-- in. It is changed only from a signed-in browser session, never by the agent.

alter table agent_mail_policies
	add column if not exists code_senders text[] not null default '{}';
