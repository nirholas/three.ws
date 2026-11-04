// The /play chat log: live lines plus the world's scrollback.
//
// The room keeps a capped tail of recent chat per world and hands it to each
// arrival in one `chat_history` message (multiplayer/src/chat-scrollback.js).
// This view renders that tail as history above the live conversation:
//
//   - Muted rows with their real send time, then a "You're caught up" divider.
//   - Built off-screen and attached in one append, so a 60-line tail is one
//     layout, not 60.
//   - Inside the log but under aria-live="off", so a screen reader is told once
//     ("12 earlier messages") instead of hearing the whole tail read aloud.
//   - Deduped by message id against live lines: the relay and the tail can
//     overlap by a line, and a reconnect re-sends the tail.
//   - Never moves the reader: someone scrolled up keeps their place, someone at
//     the bottom stays at the bottom, and focus is never touched.

const MAX_ROWS = 200;
const NEAR_BOTTOM_PX = 60;

function node(tag, cls, text) {
	const n = document.createElement(tag);
	if (cls) n.className = cls;
	if (text != null) n.textContent = text;
	return n;
}

const pad2 = (n) => String(n).padStart(2, '0');

/**
 * The visible stamp for a line: "14:05" today, "Nov 3, 14:05" otherwise.
 * @param {number} ts epoch ms
 * @param {number} [now] epoch ms, for tests
 * @param {string} [locale]
 */
export function chatStamp(ts, now = Date.now(), locale) {
	const d = new Date(ts);
	const hm = `${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
	if (d.toDateString() === new Date(now).toDateString()) return hm;
	let day;
	try {
		day = new Intl.DateTimeFormat(locale, { month: 'short', day: 'numeric' }).format(d);
	} catch {
		day = d.toDateString().slice(4, 10);
	}
	return `${day}, ${hm}`;
}

/** Strings the view needs, translated by the caller (see i18n-play.js `t`). */
const DEFAULT_COPY = {
	caughtUp: "You're caught up",
	emptyTitle: 'No messages yet.',
	emptyAction: 'Say hi',
	earlier: (n) => (n === 1 ? '1 earlier message' : `${n} earlier messages`),
};

export class ChatLogView {
	/**
	 * @param {{log: HTMLElement, empty: HTMLElement, copy?: Partial<typeof DEFAULT_COPY>,
	 *   announce?: (text: string) => void, now?: () => number, maxRows?: number}} opts
	 *   `log` is the role=log scroller; `empty` is the empty-state element the
	 *   view shows while there is nothing to read.
	 */
	constructor({ log, empty, copy = {}, announce = () => {}, now = Date.now, maxRows = MAX_ROWS }) {
		this.log = log;
		this.empty = empty;
		this.copy = { ...DEFAULT_COPY, ...copy };
		this.announce = announce;
		this.now = now;
		this.maxRows = maxRows;
		this.mids = new Set();
		this.historyShown = false;
		this.hist = node('div', 'cc-chat-hist');
		this.hist.setAttribute('aria-live', 'off');
		this.log.appendChild(this.hist);
		this._syncEmpty();
	}

	get nearBottom() {
		const l = this.log;
		return l.scrollHeight - l.scrollTop - l.clientHeight < NEAR_BOTTOM_PX;
	}

	/** Every message row, history first, oldest first. */
	rows() {
		return [...this.log.querySelectorAll('.cc-chat-msg')];
	}

	_row({ mid, name, text, ts, mine, scope, history }) {
		const row = node('div', 'cc-chat-msg' + (mine ? ' cc-mine' : '') + (scope === 'party' ? ' cc-party-msg' : '') + (history ? ' cc-hist' : ''));
		if (mid) row.dataset.mid = mid;
		const at = Number.isFinite(ts) ? ts : this.now();
		row.dataset.ts = String(at);
		const meta = node('span', 'cc-chat-meta');
		meta.appendChild(node('b', null, name));
		const time = node('time', null, chatStamp(at, this.now()));
		time.setAttribute('datetime', new Date(at).toISOString());
		meta.appendChild(time);
		row.appendChild(meta);
		row.appendChild(node('span', 'cc-chat-text', text));
		return row;
	}

	/**
	 * Add one live line. Returns false when it was a duplicate of a line already
	 * shown (same message id), so the caller can skip its unread bump.
	 */
	addLive({ mid, name, text, mine = false, scope, ts }) {
		if (mid && this.mids.has(mid)) return false;
		const stick = this.nearBottom || mine;
		if (mid) this.mids.add(mid);
		this.log.appendChild(this._row({ mid, name, text, mine, scope, ts }));
		this._trim();
		this._syncEmpty();
		if (stick) this.log.scrollTop = this.log.scrollHeight;
		return true;
	}

	/**
	 * Render the world's scrollback. The first call per world fills the history
	 * block above the live lines; a later call (a reconnect) only appends lines
	 * newer than anything on screen, which are the ones missed while away.
	 * @param {Array<{mid: string, name: string, text: string, ts: number}>} lines oldest first
	 * @returns {number} lines added
	 */
	addHistory(lines) {
		const fresh = (Array.isArray(lines) ? lines : [])
			.filter((l) => l && typeof l.mid === 'string' && typeof l.text === 'string' && Number.isFinite(l.ts) && !this.mids.has(l.mid))
			.sort((a, b) => a.ts - b.ts);
		if (this.historyShown) return this._addMissed(fresh);
		this.historyShown = true;
		if (!fresh.length) { this._syncEmpty(); return 0; }

		const stick = this.nearBottom;
		const fromBottom = this.log.scrollHeight - this.log.scrollTop;
		const frag = document.createDocumentFragment();
		for (const l of fresh) {
			this.mids.add(l.mid);
			frag.appendChild(this._row({ ...l, history: true }));
		}
		const divider = node('div', 'cc-chat-divider');
		divider.setAttribute('role', 'separator');
		divider.appendChild(node('span', null, this.copy.caughtUp));
		frag.appendChild(divider);
		this.hist.replaceChildren(frag);
		this._trim();
		this._syncEmpty();
		// At the bottom: stay there. Reading something: keep that exact line
		// under the eye, even though the content above it just grew.
		this.log.scrollTop = stick ? this.log.scrollHeight : this.log.scrollHeight - fromBottom;
		this.announce(this.copy.earlier(fresh.length));
		return fresh.length;
	}

	_addMissed(fresh) {
		const last = this.rows().at(-1);
		const newest = last ? Number(last.dataset.ts) || 0 : 0;
		const missed = fresh.filter((l) => l.ts > newest);
		if (!missed.length) return 0;
		const stick = this.nearBottom;
		const frag = document.createDocumentFragment();
		for (const l of missed) {
			this.mids.add(l.mid);
			frag.appendChild(this._row({ ...l, history: true }));
		}
		this.log.appendChild(frag);
		this._trim();
		this._syncEmpty();
		if (stick) this.log.scrollTop = this.log.scrollHeight;
		return missed.length;
	}

	/** Keep the DOM bounded: drop the oldest rows (history first) past the cap. */
	_trim() {
		const rows = this.rows();
		let over = rows.length - this.maxRows;
		for (let i = 0; over > 0; i++, over--) {
			const r = rows[i];
			if (r.dataset.mid) this.mids.delete(r.dataset.mid);
			r.remove();
		}
		if (!this.hist.querySelector('.cc-chat-msg')) this.hist.replaceChildren();
	}

	_syncEmpty() {
		this.empty.hidden = this.rows().length > 0;
	}

	/** Forget everything: a new world has its own conversation. */
	reset() {
		this.hist.replaceChildren();
		for (const r of this.log.querySelectorAll(':scope > .cc-chat-msg')) r.remove();
		this.mids.clear();
		this.historyShown = false;
		this._syncEmpty();
	}
}
