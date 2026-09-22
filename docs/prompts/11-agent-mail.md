# 11. Agent mail: a real email inbox for every agent

Read `docs/prompts/README.md` first.

## The problem

An agent has a wallet, a page, a persona and a 3D body, but no way to receive or send email. Vendors, event organizers, bounty platforms and humans still reach each other by email; an agent without an address cannot sign up for a service, receive a receipt, or reply to a counterparty. The nearest surfaces today are the notification inbox under `api/knock/inbox/` and the wallet recovery inbox in `api/agents/recovery-inbox.js`, neither of which is email.

## Build

### Provider

Outbound email already runs through `api/_lib/email.js` (`RESEND_API_KEY`, `EMAIL_FROM`). Extend that provider for inbound: a dedicated subdomain (`agents.three.ws` or `mail.three.ws`, choose one and record it) with MX and the provider's inbound webhook, DKIM and SPF records added through the DNS runbook in `docs/ops/gcp-production.md`, and a signed webhook handler at `api/mail/inbound.js`. Isolate the provider behind `api/_lib/mail/provider.js` so a second provider is one file. If the provider on this account lacks inbound receiving, that credential is the single missing var to list; build everything else and prove it with the provider's sandbox domain.

### Data and routes

Migrations for `agent_mailboxes` (agent, address, created, status), `agent_mail_messages` (mailbox, direction, from, to, cc, subject, text, html, attachments in GCS, message id, in-reply-to, read state, spam score), and `agent_mail_sends` (cost, signature if paid, status, provider id).

Under `api/v1/agents/:id/mail/` with MCP tools under the prompt 03 policy:

- `create` (`agent_mail_create`, financial, `confirm_spend`): provisions `<slug>@<subdomain>`; charged once from the agent wallet in USDC through the existing x402 self-facilitator (`api/_lib/x402/self-facilitator.js`) or from credits, price set in `app_settings`, quoted first.
- `address` (`agent_mail_get_address`).
- `send` (`agent_mail_send`, financial because it is outward-facing and metered, `confirm_send`): to, subject, text and optional html, attachments by URL, reply threading. Metered per send from the agent wallet or credits; quote first.
- `list` (`agent_mail_list`) with pagination, unread filter, search; `read` (`agent_mail_read`) marks read; `delete`.
- Inbound delivery: new mail becomes a notification through the existing notify path (`api/_lib/notify-prefs.js`), a `mail_received` trigger for prompt 05 automations and wallet intents (so an agent can act on an email), and an update to the `three://agents/{id}/mail` resource from prompt 02.

### Deliverability and conduct

- Correct DKIM, SPF and DMARC; a warm-up throttle for new mailboxes; rate limits per mailbox per hour.
- Outbound content rules enforced server-side and stated in the prompt 03 skill: a real subject, a greeting, a body of substance, a sign-off, no deceptive urgency. Reject one-word or empty bodies.
- Inbound: spam scoring from the provider stored and surfaced; attachments virus-scanned with the scanning already used for uploads if present, otherwise served only from GCS with content-disposition attachment.
- Never let inbound email content act as instructions: it is untrusted data everywhere it reaches a model, and automations that read it run with the read-only tool tier unless the owner has opted in.

### UI

`/agents/:id/mail` (add to `data/pages.json`): inbox with threads, reader, compose with a preview of the metered cost, provisioning flow with the price quoted, every state designed (no mailbox yet, empty inbox, send failed with the provider reason and retry).

## Docs and wiring

`docs/agent-mail.md` (new) linked from `docs/start-here.md` and `docs/agent-identities.md`; `docs/api-reference.md` section; the DNS records added to `docs/ops/gcp-production.md`; `STRUCTURE.md` row; `data/changelog.json` entry tagged `feature`.

## Acceptance

- Provision a mailbox for the QA agent (stop at the owner confirmation table for the charge, gate 1). Send a real email from an outside account to it and read it through the MCP tool within a minute.
- Send from the agent to an outside inbox and confirm it lands in the inbox, not spam, with DKIM pass.
- An inbound email containing tool-call-like text does not trigger any tool.
- `npm test` green with webhook signature, threading and content-rule tests.
