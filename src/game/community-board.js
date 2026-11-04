// The coin's community board, read-only, inside the /play chat panel.
//
// Every coin has a persisted community stream (api/community/messages.js, the
// CoinCommunities proxy) that people post to from the coin's page. World chat
// is a different thing: ephemeral, guests allowed, gone after a few days. This
// tab shows the board so page-side conversation is visible in-world, and it is
// deliberately read-only: world chat never writes into the board. A board post
// is a public, permanent record made by a signed-in account; a world line is
// room talk from anyone, and silently promoting one into the other would
// publish words their author meant to be ephemeral. See docs/play-chat.md.

import { fetchMessages } from '../community/town-client.js';
import { netErrorMessage } from './net-error.js';
import { t } from './i18n-play.js';

const STALE_MS = 60_000;
const LIMIT = 30;
const SKELETON_ROWS = 4;

function node(tag, cls, text) {
	const n = document.createElement(tag);
	if (cls) n.className = cls;
	if (text != null) n.textContent = text;
	return n;
}

/** "now", "5m", "3h", "2d": the board shows age, not clock time. */
export function boardAge(iso, now = Date.now()) {
	const at = typeof iso === 'string' ? Date.parse(iso) : Number(iso);
	if (!Number.isFinite(at)) return '';
	const s = Math.max(0, (now - at) / 1000);
	if (s < 60) return t('play.board_age_now', 'now');
	if (s < 3600) return `${Math.floor(s / 60)}m`;
	if (s < 86400) return `${Math.floor(s / 3600)}h`;
	return `${Math.floor(s / 86400)}d`;
}

export class CommunityBoard {
	/**
	 * @param {{panel: HTMLElement, load?: typeof fetchMessages, now?: () => number}} opts
	 *   `panel` is the tabpanel element the board renders into.
	 */
	constructor({ panel, load = fetchMessages, now = Date.now }) {
		this.panel = panel;
		this.load = load;
		this.now = now;
		this.mint = '';
		this.loadedAt = 0;
		this.loading = null;
		this.list = node('div', 'cc-board-list');
		this.panel.replaceChildren(this.list);
	}

	/** Point the board at a world's coin. Nothing loads until the tab is opened. */
	setCoin(mint) {
		if (mint === this.mint) return;
		this.mint = mint || '';
		this.loadedAt = 0;
		this.loading = null;
		this.list.replaceChildren();
	}

	/** Called when the tab is shown: load on first open, refresh when stale. */
	open() {
		if (!this.mint) return Promise.resolve();
		if (this.loading) return this.loading;
		if (this.loadedAt && this.now() - this.loadedAt < STALE_MS) return Promise.resolve();
		return this.refresh();
	}

	refresh() {
		const mint = this.mint;
		if (!mint) return Promise.resolve();
		this._renderSkeleton();
		const run = this.load(mint, { limit: LIMIT })
			.then((messages) => {
				if (mint !== this.mint) return;
				this.loadedAt = this.now();
				this._renderMessages(messages || []);
			})
			.catch((err) => {
				if (mint !== this.mint) return;
				this._renderError(err);
			})
			.finally(() => {
				if (this.loading === run) this.loading = null;
				this.panel.removeAttribute('aria-busy');
			});
		this.loading = run;
		return run;
	}

	_renderSkeleton() {
		this.panel.setAttribute('aria-busy', 'true');
		const frag = document.createDocumentFragment();
		for (let i = 0; i < SKELETON_ROWS; i++) {
			const row = node('div', 'cc-board-post cc-board-skel');
			row.setAttribute('aria-hidden', 'true');
			row.append(node('span', 'cc-board-avatar'), node('span', 'cc-board-skel-line'), node('span', 'cc-board-skel-line cc-short'));
			frag.appendChild(row);
		}
		const status = node('p', 'cc-sr-only', t('play.board_loading', 'Loading the community board'));
		status.setAttribute('role', 'status');
		frag.appendChild(status);
		this.list.replaceChildren(frag);
	}

	_renderMessages(messages) {
		if (!messages.length) {
			this.list.replaceChildren(this._notice(
				t('play.board_empty_title', 'No posts on this board yet.'),
				t('play.board_empty_body', "Posts made on this coin's community page show up here."),
			));
			return;
		}
		const frag = document.createDocumentFragment();
		for (const m of messages) frag.appendChild(this._post(m));
		this.list.replaceChildren(frag);
	}

	_post(m) {
		const post = node('article', 'cc-board-post');
		const name = String(m.username || 'anon');
		const av = node('span', 'cc-board-avatar', name.replace(/^@/, '').slice(0, 2).toUpperCase());
		av.setAttribute('aria-hidden', 'true');
		if (m.avatar && /^https:\/\//.test(m.avatar)) {
			const img = node('img');
			img.alt = '';
			img.loading = 'lazy';
			img.decoding = 'async';
			img.referrerPolicy = 'no-referrer';
			img.src = m.avatar;
			img.addEventListener('error', () => img.remove(), { once: true });
			av.appendChild(img);
		}
		const meta = node('div', 'cc-board-meta');
		meta.appendChild(node('b', null, name));
		const age = node('time', null, boardAge(m.createdAt, this.now()));
		if (typeof m.createdAt === 'string') age.setAttribute('datetime', m.createdAt);
		meta.appendChild(age);
		const body = node('div', 'cc-board-body');
		body.append(meta, node('p', 'cc-board-text', String(m.content || '')));
		const likes = Number(m.likes) || 0;
		const replies = Number(m.replies) || 0;
		if (likes || replies) {
			const stats = node('div', 'cc-board-stats');
			if (likes) stats.appendChild(node('span', null, t('play.board_likes', '{{n}} likes', { n: likes })));
			if (replies) stats.appendChild(node('span', null, t('play.board_replies', '{{n}} replies', { n: replies })));
			body.appendChild(stats);
		}
		post.append(av, body);
		return post;
	}

	_renderError(err) {
		if (err?.code === 'cc_unconfigured') {
			this.list.replaceChildren(this._notice(
				t('play.board_off_title', "This server isn't connected to community boards."),
				t('play.board_off_body', 'World chat works as normal. The board appears here once it is connected.'),
			));
			return;
		}
		const retry = node('button', 'cc-board-retry', t('play.retry', 'Try again'));
		retry.type = 'button';
		retry.addEventListener('click', () => { this.refresh(); });
		const notice = this._notice(
			t('play.board_error_title', "Couldn't load the board."),
			netErrorMessage(err, t('play.board_error_body', 'The board did not answer. Try again in a moment.')),
			retry,
		);
		notice.setAttribute('role', 'alert');
		this.list.replaceChildren(notice);
	}

	_notice(title, body, action) {
		const box = node('div', 'cc-board-notice');
		box.append(node('p', 'cc-board-notice-title', title), node('p', 'cc-board-notice-body', body));
		if (action) box.appendChild(action);
		return box;
	}
}
