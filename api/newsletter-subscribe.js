import { Resend } from 'resend';
import { z } from 'zod';
import { cors, json, method, wrap, error, readJson } from './_lib/http.js';
import { parse } from './_lib/validate.js';
import { limits, clientIp } from './_lib/rate-limit.js';
import { captureException } from './_lib/sentry.js';

const bodySchema = z.object({
	email: z.string().trim().toLowerCase().email().max(254),
});

let _client = null;
function client() {
	if (!_client) _client = new Resend(process.env.RESEND_API_KEY);
	return _client;
}

export default wrap(async (req, res) => {
	if (cors(req, res, { methods: 'POST,OPTIONS', credentials: false })) return;
	if (!method(req, res, ['POST'])) return;

	const rl = await limits.newsletterIp(clientIp(req));
	if (!rl.success) return error(res, 429, 'rate_limited', 'too many requests');

	const { email } = parse(bodySchema, await readJson(req));

	if (!process.env.RESEND_API_KEY || !process.env.RESEND_AUDIENCE_ID) {
		// Endpoint not configured — accept silently so UI flow still works in dev.
		return json(res, 200, { success: true });
	}

	try {
		await client().contacts.create({
			email,
			audienceId: process.env.RESEND_AUDIENCE_ID,
			unsubscribed: false,
		});
	} catch (err) {
		// Resend returns a non-2xx for duplicates — treat as success.
		const msg = String(err?.message || '').toLowerCase();
		if (msg.includes('already') || msg.includes('exists')) {
			return json(res, 200, { success: true });
		}
		captureException(err, { email });
		return error(res, 502, 'upstream_error', 'subscription failed');
	}

	return json(res, 200, { success: true });
});
