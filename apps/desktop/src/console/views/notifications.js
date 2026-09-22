// Notifications: the account inbox. New ones also arrive as native OS
// notifications (src/main/notifier.js); this is where they are read, followed
// and cleared.

import { html, mount, onAction, emptyState, errorState, skeletonLines } from '../lib/dom.js';
import { relativeTime } from '../../shared/normalize.js';

export function notificationRow(n) {
	return html`<button type="button" class="notif ${n.read ? '' : 'unread'}" data-action="open" data-id="${n.id}">
		<span class="dot" aria-hidden="true"></span>
		<span class="body"><b>${n.title}</b><p>${n.text}</p></span>
		<time datetime="${n.at || ''}">${relativeTime(n.at)}</time>
		<span class="sr-only" hidden>${n.read ? 'Read' : 'Unread'}</span>
	</button>`;
}

export function mountNotifications(root, ctx) {
	const { bridge, toast } = ctx;
	let phase = 'loading';
	let error = null;
	let items = [];
	let unread = 0;
	let hasMore = false;
	let loadingMore = false;

	function body() {
		if (phase === 'loading') return html`<div class="card">${skeletonLines(8)}</div>`;
		if (phase === 'error') return errorState(error, { title: 'Notifications could not load' });
		if (!items.length) return emptyState({ icon: 'bell', title: 'You are all caught up', message: 'Payments, finished generations, reviews, withdrawals and your agents\' messages show up here and as desktop notifications.' });
		return html`<div class="card" style="padding:6px">${items.map(notificationRow)}</div>
			${hasMore ? html`<div style="text-align:center;margin-top:14px"><button type="button" class="btn" data-action="more" ${loadingMore ? 'disabled' : ''}>${loadingMore ? 'Loading' : 'Load older'}</button></div>` : ''}`;
	}

	function render() {
		mount(root, html`<div class="view">
			<header class="head">
				<div><h1>Notifications</h1><p>${unread ? `${unread} unread` : 'Everything that happened on your account.'}</p></div>
				<div class="head-actions">
					<button type="button" class="btn btn-ghost" data-action="retry" aria-label="Refresh notifications"><span class="ico ico-refresh" aria-hidden="true"></span>Refresh</button>
					<button type="button" class="btn" data-action="read-all" ${unread ? '' : 'disabled'}>Mark all read</button>
				</div>
			</header>
			${body()}
		</div>`);
	}

	async function load() {
		phase = 'loading';
		render();
		try {
			const res = await bridge.notifications.list();
			items = res.items;
			unread = res.unread;
			hasMore = res.hasMore;
			phase = 'ready';
		} catch (err) {
			phase = 'error';
			error = err;
		}
		render();
	}

	const offUnread = bridge.notifications.onUnread((count) => {
		if (count !== unread && phase === 'ready') load();
	});

	const offActions = onAction(root, {
		retry: load,
		more: async () => {
			loadingMore = true;
			render();
			try {
				const res = await bridge.notifications.list({ before: items[items.length - 1]?.at });
				const seen = new Set(items.map((n) => n.id));
				items = items.concat(res.items.filter((n) => !seen.has(n.id)));
				hasMore = res.hasMore;
			} catch (err) {
				toast(err.message, 'bad');
			}
			loadingMore = false;
			render();
		},
		'read-all': async () => {
			try {
				await bridge.notifications.readAll();
				items = items.map((n) => ({ ...n, read: true }));
				unread = 0;
				render();
			} catch (err) {
				toast(err.message, 'bad');
			}
		},
		open: async (el) => {
			const n = items.find((x) => x.id === el.dataset.id);
			if (!n) return;
			if (!n.read) {
				n.read = true;
				unread = Math.max(0, unread - 1);
				render();
				bridge.notifications.read(n.id).catch((err) => toast(err.message, 'bad'));
			}
			if (n.link) bridge.app.openExternal(n.link);
		},
	});

	load();
	return () => {
		offUnread();
		offActions();
	};
}
