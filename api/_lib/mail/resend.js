// Resend adapter for agent mail (contract in ./provider.js).
//
// Outbound: POST /emails with an Idempotency-Key, so a retried send never
// delivers twice. Inbound: Resend receives on the agents domain's MX, posts an
// `email.received` webhook signed with the Standard Webhooks scheme (svix-id,
// svix-timestamp, svix-signature), and we fetch the full message and its
// attachments back through the receiving API.
//
// Env: RESEND_API_KEY (shared with api/_lib/email.js), RESEND_WEBHOOK_SECRET
// (the signing secret of the webhook pointed at /api/mail/inbound).

import { Resend } from 'resend';

let _client = null;
let _clientKey = null;
function client() {
	const key = process.env.RESEND_API_KEY;
	if (!_client || _clientKey !== key) {
		_client = new Resend(key);
		_clientKey = key;
	}
	return _client;
}

function headerValue(headers, ...names) {
	for (const n of names) {
		const v = typeof headers?.get === 'function' ? headers.get(n) : headers?.[n];
		if (v) return Array.isArray(v) ? v[0] : String(v);
	}
	return null;
}

function asList(v) {
	if (!v) return [];
	return (Array.isArray(v) ? v : [v]).map((s) => String(s).trim()).filter(Boolean);
}

export function resendProvider({ ProviderError }) {
	function fail(error, fallbackCode) {
		const status = Number(error?.statusCode) || 502;
		const code = error?.name || fallbackCode;
		const message = error?.message || 'The mail provider rejected the request.';
		return new ProviderError(code, message, { status: status >= 500 ? 502 : status, retryable: status >= 500 || status === 429 });
	}

	return {
		name: 'resend',

		configured() {
			return Boolean(process.env.RESEND_API_KEY);
		},

		webhookConfigured() {
			return Boolean(process.env.RESEND_WEBHOOK_SECRET);
		},

		async send({ from, to, cc = [], replyTo, subject, text, html, headers = {}, attachments = [], idempotencyKey }) {
			if (!process.env.RESEND_API_KEY) {
				throw new ProviderError('provider_not_configured', 'Outbound mail is not configured on this deployment (RESEND_API_KEY).', { status: 503 });
			}
			const payload = {
				from,
				to,
				subject,
				text,
				...(cc.length ? { cc } : {}),
				...(replyTo ? { replyTo } : {}),
				...(html ? { html } : {}),
				...(Object.keys(headers).length ? { headers } : {}),
				...(attachments.length
					? { attachments: attachments.map((a) => ({ filename: a.filename, content: a.content, contentType: a.contentType })) }
					: {}),
			};
			let res;
			try {
				res = await client().emails.send(payload, idempotencyKey ? { idempotencyKey } : undefined);
			} catch (err) {
				throw new ProviderError('provider_unreachable', err?.message || 'Could not reach the mail provider.', { retryable: true });
			}
			if (res?.error) throw fail(res.error, 'provider_rejected');
			if (!res?.data?.id) throw new ProviderError('provider_no_id', 'The mail provider accepted the request but returned no message id.');
			return { id: res.data.id };
		},

		verifyWebhook({ rawBody, headers }) {
			const secret = process.env.RESEND_WEBHOOK_SECRET;
			if (!secret) throw new ProviderError('webhook_not_configured', 'RESEND_WEBHOOK_SECRET is not set.', { status: 503 });
			const id = headerValue(headers, 'svix-id', 'webhook-id');
			const timestamp = headerValue(headers, 'svix-timestamp', 'webhook-timestamp');
			const signature = headerValue(headers, 'svix-signature', 'webhook-signature');
			if (!id || !timestamp || !signature) {
				throw new ProviderError('bad_signature', 'The webhook is missing its signature headers.', { status: 401 });
			}
			try {
				return client().webhooks.verify({
					payload: typeof rawBody === 'string' ? rawBody : rawBody.toString('utf8'),
					headers: { id, timestamp, signature },
					webhookSecret: secret,
				});
			} catch {
				throw new ProviderError('bad_signature', 'The webhook signature does not match.', { status: 401 });
			}
		},

		async getInbound(emailId) {
			let res;
			try {
				res = await client().emails.receiving.get(emailId);
			} catch (err) {
				throw new ProviderError('provider_unreachable', err?.message || 'Could not reach the mail provider.', { retryable: true });
			}
			if (res?.error) throw fail(res.error, 'inbound_fetch_failed');
			const e = res.data;
			return {
				id: e.id,
				from: e.from,
				to: asList(e.to),
				cc: asList(e.cc),
				replyTo: asList(e.reply_to),
				subject: e.subject || '',
				text: e.text ?? null,
				html: e.html ?? null,
				headers: e.headers || {},
				messageId: e.message_id || null,
				createdAt: e.created_at || null,
				attachments: (e.attachments || []).map((a) => ({
					id: a.id,
					filename: a.filename || 'attachment',
					size: Number(a.size) || 0,
					contentType: a.content_type || 'application/octet-stream',
				})),
			};
		},

		async downloadInboundAttachment(emailId, attachmentId, maxBytes) {
			let res;
			try {
				res = await client().emails.receiving.attachments.get({ emailId, id: attachmentId });
			} catch (err) {
				throw new ProviderError('provider_unreachable', err?.message || 'Could not reach the mail provider.', { retryable: true });
			}
			if (res?.error) throw fail(res.error, 'attachment_fetch_failed');
			const meta = res.data;
			if (Number(meta.size) > maxBytes) {
				throw new ProviderError('attachment_too_large', `Attachment is ${meta.size} bytes, over the ${maxBytes} byte limit.`, { status: 413 });
			}
			const r = await fetch(meta.download_url, { signal: AbortSignal.timeout(30_000) });
			if (!r.ok) throw new ProviderError('attachment_download_failed', `Attachment download answered ${r.status}.`, { retryable: r.status >= 500 });
			const buffer = Buffer.from(await r.arrayBuffer());
			if (buffer.length > maxBytes) {
				throw new ProviderError('attachment_too_large', `Attachment is over the ${maxBytes} byte limit.`, { status: 413 });
			}
			return { buffer, contentType: meta.content_type || 'application/octet-stream', filename: meta.filename || 'attachment' };
		},
	};
}
