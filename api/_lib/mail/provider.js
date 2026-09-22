// The one boundary between agent mail and an email provider.
//
// Everything above this file (store, routes, MCP tools, the inbound webhook)
// speaks the normalized shapes documented here and never imports a provider SDK.
// Adding a second provider is one file that implements the same object and one
// line in PROVIDERS; AGENT_MAIL_PROVIDER selects it.
//
// Provider contract:
//   name                       stable id stored on every message row
//   configured()               true when sending and reading are possible
//   webhookConfigured()        true when inbound webhooks can be verified
//   send(msg)                  returns { id }, throws ProviderError
//     msg: { from, to[], cc[], replyTo?, subject, text, html?, headers?,
//            attachments?: [{ filename, content: Buffer, contentType }],
//            idempotencyKey }
//   verifyWebhook({ rawBody, headers }) returns { type, data }, throws ProviderError 'bad_signature'
//   getInbound(id)             -> NormalizedInbound
//     { id, from, to[], cc[], replyTo[], subject, text, html, headers,
//       messageId, createdAt, attachments: [{ id, filename, size, contentType }] }
//   downloadInboundAttachment(emailId, attachmentId, maxBytes) -> { buffer, contentType, filename }

import { resendProvider } from './resend.js';

export class ProviderError extends Error {
	constructor(code, message, { status = 502, retryable = false } = {}) {
		super(message);
		this.code = code;
		this.status = status;
		this.retryable = retryable;
	}
}

const PROVIDERS = {
	resend: resendProvider,
};

export function mailProvider() {
	const name = String(process.env.AGENT_MAIL_PROVIDER || 'resend').trim().toLowerCase();
	const make = PROVIDERS[name];
	if (!make) throw new ProviderError('provider_unknown', `Unknown AGENT_MAIL_PROVIDER "${name}".`, { status: 500 });
	return make({ ProviderError });
}
