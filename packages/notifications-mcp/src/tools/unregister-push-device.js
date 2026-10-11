// `unregister_push_device` — remove a Web Push device. Write, destructive, idempotent.
//
// Wraps DELETE /api/push/subscribe { endpoint } → { ok }. Removes the device's
// push subscription so it stops receiving push notifications. Destructive in
// that it tears down a registration (reversible only by registering again), but
// idempotent: deleting an endpoint that isn't registered still returns ok.

import { z } from 'zod';

import { apiRequest } from '../lib/api.js';

const subscription = z
	.object({
		endpoint: z.string().url().max(2048),
		keys: z.object({
			p256dh: z.string().min(1).max(256),
			auth: z.string().min(1).max(256),
		}),
	})
	.describe('A full Web Push subscription object; its endpoint is used to locate the device.');

export const def = {
	name: 'unregister_push_device',
	title: 'Unregister push device',
	annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: true, openWorldHint: true },
	description:
		'Remove a Web Push device so the account stops receiving push notifications on it. Identify the ' +
		'device by its push `endpoint` URL (preferred) or by passing the full `subscription` object — at ' +
		'least one is required. Destructive: it tears down the device registration (reverse it by calling ' +
		'register_push_device again). Idempotent: removing an endpoint that is not registered still returns ' +
		'`{ ok: true }`. This affects only push delivery to that device; in_app, email, and telegram ' +
		'preferences are unchanged. Use this when a browser or device should stop getting push; to silence a whole ' +
		'category everywhere use set_preferences instead.',
	inputSchema: {
		endpoint: z
			.string()
			.url()
			.max(2048)
			.optional()
			.describe('The push endpoint URL of the device to remove. Provide this or `subscription`.'),
		subscription: subscription.optional().describe('Alternatively, the full subscription object; its endpoint is used.'),
	},
	async handler(args) {
		const endpoint = args?.endpoint || args?.subscription?.endpoint;
		if (!endpoint) {
			throw Object.assign(new Error('Provide `endpoint` (or a `subscription`) of the device to unregister.'), {
				code: 'validation_error',
				status: 400,
			});
		}
		const data = await apiRequest('/api/push/subscribe', { method: 'DELETE', body: { endpoint } });
		return { ok: data?.ok !== false, unregistered: true, endpoint };
	},
};
