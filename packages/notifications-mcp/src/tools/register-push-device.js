// `register_push_device` — register a Web Push device for the account. Write, idempotent.
//
// Wraps POST /api/push/subscribe { subscription } → { ok }. The subscription is
// exactly what the browser's `pushManager.subscribe().toJSON()` returns:
// { endpoint, keys: { p256dh, auth } }. Endpoints are globally unique and the
// upsert lets the latest owner win, so re-registering the same device is a no-op
// — idempotent.

import { z } from 'zod';

import { apiRequest } from '../lib/api.js';

const subscription = z
	.object({
		endpoint: z.string().url().max(2048).describe('The push service endpoint URL from the browser PushSubscription.'),
		keys: z
			.object({
				p256dh: z.string().min(1).max(256).describe('Base64url-encoded P-256 ECDH public key (PushSubscription.keys.p256dh).'),
				auth: z.string().min(1).max(256).describe('Base64url-encoded auth secret (PushSubscription.keys.auth).'),
			})
			.describe('The encryption keys from the browser PushSubscription.'),
	})
	.describe('A Web Push subscription, exactly as pushManager.subscribe().toJSON() returns it.');

export const def = {
	name: 'register_push_device',
	title: 'Register push device',
	annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: true },
	description:
		'Register a Web Push device so the account receives push notifications on it. Pass the browser ' +
		'`subscription` object exactly as `pushManager.subscribe().toJSON()` produces it — ' +
		'{ endpoint, keys: { p256dh, auth } }. Push endpoints are globally unique: re-registering the same ' +
		'device upserts (the latest owner wins) and is a no-op, so this is idempotent. Whether a given ' +
		'notification category actually delivers over push is still governed by set_preferences. Returns ' +
		'`{ ok: true }` on success. Use this when a browser has just granted push permission; use ' +
		'unregister_push_device to remove a device.',
	inputSchema: {
		subscription,
	},
	async handler(args) {
		const data = await apiRequest('/api/push/subscribe', {
			method: 'POST',
			body: { subscription: args.subscription },
		});
		return { ok: data?.ok !== false, registered: true, endpoint: args.subscription.endpoint };
	},
};
