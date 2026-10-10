//
// Web Push handlers, imported into the VitePWA-generated service worker via
// `workbox.importScripts: ['/push-sw.js']` (see vite.config.js). Kept as a plain
// classic worker script (no imports) so importScripts can pull it in.
//
// Responsibilities:
//   • push           — render the OS notification from the JSON payload
//                      api/_lib/notify-prefs.js#pushPayloadFor produced.
//   • notificationclick — focus or open the target URL (tagged ?source=push so
//                      the app records a `returned` funnel event), and beacon a
//                      `opened` event so sent→opened→returned is measurable.
//   • approvals       — an approval push (api/_lib/approvals.js) gets Approve
//                      and Deny buttons. Tapping one posts the decision with the
//                      payload hash the notification showed, so the server only
//                      executes that exact action, then shows the outcome. A
//                      signed-out browser or any failure opens /approvals instead.

self.addEventListener('push', (event) => {
	let data = {};
	try {
		data = event.data ? event.data.json() : {};
	} catch {
		// Some push services deliver a bare string; degrade gracefully.
		data = { title: 'three.ws', body: event.data ? event.data.text() : '' };
	}

	const title = data.title || 'three.ws';
	const options = {
		body: data.body || '',
		tag: data.tag || undefined,
		// Coalesce repeats of the same type into one notification line.
		renotify: Boolean(data.tag),
		icon: '/pwa-192x192.png',
		badge: '/pwa-192x192.png',
		data: {
			url: data.url || '/dashboard/',
			notificationId: data.notificationId || null,
			category: data.category || null,
			approval: data.approval && data.approval.id ? data.approval : null,
		},
	};
	if (options.data.approval) {
		// A decision is owed: keep it on screen until it is answered, and offer
		// the answer right on the notification where the platform supports it.
		options.requireInteraction = true;
		options.actions = [
			{ action: 'approve', title: 'Approve' },
			{ action: 'deny', title: 'Deny' },
		];
	}

	event.waitUntil(self.registration.showNotification(title, options));
});

self.addEventListener('notificationclick', (event) => {
	event.notification.close();
	const d = event.notification.data || {};
	const rawUrl = typeof d.url === 'string' && d.url ? d.url : '/dashboard/';

	if (d.approval && (event.action === 'approve' || event.action === 'deny')) {
		event.waitUntil(answerApproval(d, event.action, rawUrl));
		return;
	}

	event.waitUntil((async () => {
		// Record the open before navigating so the beacon isn't cut off.
		await trackOpen(d.notificationId);

		// Same-origin internal links open/focus an existing tab and carry the
		// push attribution params; external links (e.g. solscan) open directly.
		const isInternal = rawUrl.startsWith('/');
		const target = isInternal ? withPushParams(rawUrl, d.notificationId) : rawUrl;

		if (isInternal) {
			const all = await clients.matchAll({ type: 'window', includeUncontrolled: true });
			const origin = self.location.origin;
			for (const c of all) {
				if (c.url.startsWith(origin) && 'focus' in c) {
					await c.focus();
					if ('navigate' in c) { try { await c.navigate(target); } catch { /* cross-doc nav blocked */ } }
					return;
				}
			}
		}
		if (clients.openWindow) await clients.openWindow(target);
	})());
});

function withPushParams(path, notificationId) {
	const sep = path.includes('?') ? '&' : '?';
	let out = `${path}${sep}source=push`;
	if (notificationId) out += `&n=${encodeURIComponent(notificationId)}`;
	return out;
}

// Fire-and-forget funnel beacon. credentials:'include' carries the session
// cookie so the server can attribute the open; a logged-out click is a no-op.
async function trackOpen(notificationId) {
	try {
		await fetch('/api/notifications/track', {
			method: 'POST',
			credentials: 'include',
			headers: { 'content-type': 'application/json' },
			body: JSON.stringify({
				notification_id: notificationId || undefined,
				channel: 'push',
				event: 'opened',
			}),
		});
	} catch {
		/* offline / blocked — the open still proceeds */
	}
}

// Answer an approval straight from the notification. The decision carries the
// payload hash and signed link token the push was built with, so the server
// rejects it if the request changed since. Any answer the server does not
// accept falls back to opening the request so the owner can see why.
async function answerApproval(d, action, url) {
	const a = d.approval;
	const decision = action === 'approve' ? 'approve' : 'deny';
	try {
		const tokRes = await fetch('/api/csrf-token', { credentials: 'include' });
		if (!tokRes.ok) throw new Error('signed_out');
		const tok = await tokRes.json();
		const csrf = (tok && (tok.token || (tok.data && tok.data.token))) || '';
		const res = await fetch(`/api/approvals/${encodeURIComponent(a.id)}`, {
			method: 'POST',
			credentials: 'include',
			headers: { 'content-type': 'application/json', 'x-csrf-token': csrf },
			body: JSON.stringify({ decision, payload_hash: a.hash, token: a.token, via: 'push' }),
		});
		const body = await res.json().catch(() => ({}));
		if (!res.ok) throw new Error((body && body.error_description) || (body && body.error) || `HTTP ${res.status}`);
		const r = body.request || {};
		await trackOpen(d.notificationId);
		await self.registration.showNotification(outcomeTitle(decision, r.status), {
			body: outcomeBody(r),
			tag: `approval:${a.id}`,
			icon: '/pwa-192x192.png',
			badge: '/pwa-192x192.png',
			data: { url: `/approvals/${a.id}`, notificationId: d.notificationId || null, category: d.category || null },
		});
	} catch (err) {
		await self.registration.showNotification('Could not answer from the notification', {
			body: `${err && err.message ? err.message : 'Something went wrong'}. Tap to review it on three.ws.`,
			tag: `approval:${a.id}`,
			icon: '/pwa-192x192.png',
			badge: '/pwa-192x192.png',
			data: { url, notificationId: d.notificationId || null, category: d.category || null },
		});
	}
}

function outcomeTitle(decision, status) {
	if (decision === 'deny') return 'Denied. Nothing was sent.';
	if (status === 'executed') return 'Approved and executed';
	if (status === 'failed') return 'Approved, but it did not execute';
	return 'Approved';
}

function outcomeBody(r) {
	const parts = [r.summary || ''];
	if (r.status === 'failed' && r.result && r.result.note) parts.push(r.result.note);
	if (r.signature) parts.push(`Tx ${String(r.signature).slice(0, 8)}...`);
	return parts.filter(Boolean).join('\n');
}
