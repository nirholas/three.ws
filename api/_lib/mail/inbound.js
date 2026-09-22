// Inbound agent mail: turn a verified provider webhook into stored messages.
//
// Pipeline for `email.received`:
//   1. Resolve every recipient (to, cc) on the agents domain to an active
//      mailbox. Mail for an address nobody holds is dropped, not stored.
//   2. Fetch the full message from the provider (the webhook carries only an
//      envelope), score it (./spam.js) and thread it (./threading.js).
//   3. Store attachments in object storage unless the malware scan flagged the
//      message; they are only ever served as downloads.
//   4. Insert the message once per mailbox (unique on the provider id, so a
//      retried webhook is a no-op), then tell the owner: a `mail_received`
//      notification, and the agent's `on_mail_received` wallet intents.
//
// The body of an inbound email is untrusted data. Nothing in this file passes
// it to a model or interprets it: the intents it can fire are owner-authored
// notify/freeze rules that never read the body, and every reader downstream
// (MCP tools, the inbox page) labels it as untrusted content.
//
// Delivery events (`email.delivered`, `email.bounced`, ...) update the status
// of the outbound send they belong to; events for mail this feature did not
// send (platform transactional email) match no row and are ignored.

import { sql } from '../db.js';
import { putObject } from '../r2.js';
import { insertNotification } from '../notify.js';
import { onMailReceived } from '../wallet-intents.js';
import { mailDomain, MAX_INBOUND_ATTACHMENT_BYTES, MAX_INBOUND_TOTAL_BYTES } from './config.js';
import { scoreInbound } from './spam.js';
import { normalizeMessageId, normalizeSubject, parseAddress, parseReferences, threadCandidates } from './threading.js';

function recipientsOnDomain(list, domain) {
	const out = [];
	for (const raw of list || []) {
		const { address } = parseAddress(raw);
		if (address.endsWith(`@${domain}`) && !out.includes(address)) out.push(address);
	}
	return out;
}

function headerValue(headers, name) {
	if (!headers) return null;
	const want = name.toLowerCase();
	for (const [k, v] of Object.entries(headers)) if (String(k).toLowerCase() === want) return Array.isArray(v) ? v.join(' ') : String(v);
	return null;
}

async function resolveThread(mailboxId, { inReplyTo, references, subject, counterparty }) {
	const ids = threadCandidates({ inReplyTo, references });
	if (ids.length) {
		const [hit] = await sql`
			select thread_id from agent_mail_messages
			where mailbox_id = ${mailboxId} and lower(message_id) = any(${ids})
			order by created_at desc limit 1
		`;
		if (hit) return hit.thread_id;
	}
	const norm = normalizeSubject(subject);
	if (norm) {
		const [hit] = await sql`
			select thread_id, subject from agent_mail_messages
			where mailbox_id = ${mailboxId} and created_at > now() - interval '30 days'
			  and (from_address = ${counterparty} or ${counterparty} = any(to_addresses))
			order by created_at desc limit 20
		`.then((rows) => rows.filter((r) => normalizeSubject(r.subject) === norm));
		if (hit) return hit.thread_id;
	}
	return null;
}

function safeFilename(name, i) {
	const s = String(name || `attachment-${i + 1}`).replace(/[^\w.\- ]+/g, '_').replace(/^\.+/, '').slice(0, 120);
	return s || `attachment-${i + 1}`;
}

async function storeAttachments({ provider, email, mailboxId, messageKey, quarantine }) {
	const out = [];
	let total = 0;
	for (const [i, a] of email.attachments.entries()) {
		const base = { filename: a.filename, size: a.size, content_type: a.contentType };
		if (quarantine) {
			out.push({ ...base, quarantined: true });
			continue;
		}
		if (a.size > MAX_INBOUND_ATTACHMENT_BYTES || total + a.size > MAX_INBOUND_TOTAL_BYTES) {
			out.push({ ...base, skipped_reason: 'Over the attachment size limit, so it was not stored.' });
			continue;
		}
		try {
			const file = await provider.downloadInboundAttachment(email.id, a.id, MAX_INBOUND_ATTACHMENT_BYTES);
			const key = `agent-mail/${mailboxId}/${messageKey}/${i}-${safeFilename(a.filename, i)}`;
			await putObject({ key, body: file.buffer, contentType: 'application/octet-stream', metadata: { 'original-type': String(file.contentType).slice(0, 100) } });
			total += file.buffer.length;
			out.push({ ...base, size: file.buffer.length, key });
		} catch (err) {
			out.push({ ...base, skipped_reason: `Could not be stored: ${String(err?.message || 'download failed').slice(0, 160)}` });
		}
	}
	return out;
}

/**
 * Store one received email for every mailbox it addresses. Returns the rows
 * created (empty when no mailbox matched or the webhook is a replay).
 */
export async function ingestReceived({ provider, event }) {
	const data = event?.data || {};
	const domain = mailDomain();
	const envelope = recipientsOnDomain([...(data.to || []), ...(data.cc || []), ...(data.bcc || [])], domain);
	if (!envelope.length) return { stored: [], reason: 'no_recipient_on_domain' };

	const mailboxes = await sql`
		select mb.*, a.name as agent_name
		from agent_mailboxes mb join agent_identities a on a.id = mb.agent_id
		where mb.address = any(${envelope}) and mb.status = 'active' and a.deleted_at is null
	`;
	if (!mailboxes.length) return { stored: [], reason: 'no_active_mailbox' };

	const email = await provider.getInbound(data.email_id);
	const verdict = scoreInbound(email.headers);
	const sender = parseAddress(email.from);
	const inReplyTo = normalizeMessageId(headerValue(email.headers, 'in-reply-to'));
	const references = parseReferences(headerValue(email.headers, 'references'));
	const messageId = normalizeMessageId(email.messageId);

	const stored = [];
	for (const mb of mailboxes) {
		const [dupe] = await sql`
			select id from agent_mail_messages
			where mailbox_id = ${mb.id} and direction = 'in' and provider_message_id = ${email.id} limit 1
		`;
		if (dupe) continue;

		const threadId = await resolveThread(mb.id, { inReplyTo, references, subject: email.subject, counterparty: sender.address });
		const messageKey = email.id.replace(/[^\w-]/g, '').slice(0, 64);
		const attachments = await storeAttachments({ provider, email, mailboxId: mb.id, messageKey, quarantine: verdict.quarantineAttachments });

		const [row] = await sql`
			insert into agent_mail_messages
				(mailbox_id, direction, thread_id, from_address, from_name, to_addresses, cc_addresses, reply_to,
				 subject, text_body, html_body, attachments, message_id, in_reply_to, references_ids, provider,
				 provider_message_id, spam_score, spam_verdict, virus_verdict, auth_results)
			values
				(${mb.id}, 'in', coalesce(${threadId}::uuid, gen_random_uuid()), ${sender.address}, ${sender.name},
				 ${email.to.map((t) => parseAddress(t).address)}, ${email.cc.map((c) => parseAddress(c).address)},
				 ${email.replyTo.map((r) => parseAddress(r).address)},
				 ${String(email.subject || '').slice(0, 998)}, ${email.text}, ${email.html}, ${JSON.stringify(attachments)}::jsonb,
				 ${messageId}, ${inReplyTo}, ${references}, ${provider.name}, ${email.id},
				 ${verdict.score}, ${verdict.spamVerdict}, ${verdict.virusVerdict}, ${JSON.stringify(verdict.auth)}::jsonb)
			on conflict do nothing
			returning id, thread_id
		`;
		if (!row) continue;
		stored.push({ mailbox: mb, row, verdict });

		if (!verdict.isSpam) {
			insertNotification(mb.user_id, 'mail_received', {
				agent_id: mb.agent_id,
				agent_name: mb.agent_name,
				mailbox: mb.address,
				from: sender.address,
				from_name: sender.name,
				subject: String(email.subject || '').slice(0, 140),
				message_id: row.id,
				link: `/agents/${mb.agent_id}/mail?m=${row.id}`,
			});
			await onMailReceived(mb.agent_id, {
				message_id: row.id,
				from: sender.address,
				subject: String(email.subject || ''),
				spam_score: verdict.score,
			});
		}
	}
	return { stored };
}

const DELIVERY_STATUS = {
	'email.delivered': 'delivered',
	'email.delivery_delayed': 'delayed',
	'email.bounced': 'bounced',
	'email.complained': 'complained',
	'email.failed': 'failed',
};

/** Apply a provider delivery event to the outbound send it belongs to. */
export async function applyDeliveryEvent(event) {
	const status = DELIVERY_STATUS[event?.type];
	const providerId = event?.data?.email_id;
	if (!status || !providerId) return { updated: 0 };
	const reason =
		event.data?.bounce?.message || event.data?.failed?.reason || (status === 'complained' ? 'The recipient marked this message as spam.' : null);
	const rows = await sql`
		update agent_mail_sends set
			status = case when status = 'delivered' and ${status} = 'delayed' then status else ${status} end,
			error_message = coalesce(${reason}, error_message),
			updated_at = now()
		where provider_id = ${providerId} and kind = 'send'
		returning message_row_id
	`;
	for (const r of rows) {
		if (r.message_row_id) await sql`update agent_mail_messages set delivery_status = ${status} where id = ${r.message_row_id}`;
	}
	return { updated: rows.length };
}
