// Rendering helpers for the console views. A tagged template that escapes
// every interpolation unless it is already-safe markup, plus the shared
// loading, empty and error states so every view designs them the same way.

class Safe {
	constructor(value) {
		this.value = value;
	}
	toString() {
		return this.value;
	}
}

export function esc(value) {
	return String(value ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
}

export function raw(markup) {
	return new Safe(String(markup ?? ''));
}

function part(v) {
	if (v == null || v === false) return '';
	if (v instanceof Safe) return v.value;
	if (Array.isArray(v)) return v.map(part).join('');
	return esc(v);
}

export function html(strings, ...values) {
	let out = strings[0];
	for (let i = 0; i < values.length; i++) out += part(values[i]) + strings[i + 1];
	return new Safe(out);
}

export function mount(el, markup) {
	el.innerHTML = String(markup);
	return el;
}

export function skeletonLines(n = 3, cls = '') {
	return html`${Array.from({ length: n }, (_, i) => html`<div class="sk sk-line ${cls}" style="width:${[92, 76, 84, 64, 88][i % 5]}%"></div>`)}`;
}

export function emptyState({ icon = 'empty', title, message, actions = [] }) {
	return html`<div class="state state-empty">
		<div class="state-ico ico-${icon}" aria-hidden="true"></div>
		<h3>${title}</h3>
		${message ? html`<p>${message}</p>` : ''}
		${actions.length ? html`<div class="state-actions">${actions.map((a) => html`<button type="button" class="btn ${a.primary ? 'btn-primary' : ''}" data-action="${a.action}">${a.label}</button>`)}</div>` : ''}
	</div>`;
}

// What went wrong, in the server's own words, and a way out.
export function errorState(err, { title = 'Something went wrong', retry = 'retry' } = {}) {
	const offline = /fetch failed|ENOTFOUND|ECONNREFUSED|network/i.test(String(err?.message || ''));
	const message = offline
		? 'three.ws could not be reached. Check your connection, then try again.'
		: err?.message || 'The server did not answer.';
	return html`<div class="state state-error" role="alert">
		<div class="state-ico ico-alert" aria-hidden="true"></div>
		<h3>${offline ? 'You are offline' : title}</h3>
		<p>${message}</p>
		<div class="state-actions"><button type="button" class="btn" data-action="${retry}">Try again</button></div>
	</div>`;
}

export function initials(name) {
	const parts = String(name || '?').trim().split(/\s+/).filter(Boolean);
	return ((parts[0]?.[0] || '?') + (parts[1]?.[0] || '')).toUpperCase();
}

// A stable hue from an id, so an agent without a thumbnail keeps its color.
export function hueFor(id) {
	let h = 0;
	for (const ch of String(id || '')) h = (h * 31 + ch.charCodeAt(0)) % 360;
	return h;
}

export function avatar(agent, size = 40) {
	if (agent?.thumbnail && /^https:\/\//.test(agent.thumbnail)) {
		return html`<img class="avatar" src="${agent.thumbnail}" alt="" width="${size}" height="${size}" loading="lazy" />`;
	}
	return html`<span class="avatar avatar-initials" style="--h:${hueFor(agent?.id)};width:${size}px;height:${size}px" aria-hidden="true">${initials(agent?.name)}</span>`;
}

// Delegated click handling by `data-action`, so a view re-rendering its own
// markup never has to re-bind listeners.
export function onAction(root, handlers) {
	const listener = (event) => {
		const el = event.target.closest('[data-action]');
		if (!el || !root.contains(el)) return;
		const fn = handlers[el.dataset.action];
		if (!fn) return;
		// A checkbox's click is its state change; cancelling it would undo the toggle.
		if (el.type !== 'checkbox') event.preventDefault();
		fn(el, event);
	};
	root.addEventListener('click', listener);
	return () => root.removeEventListener('click', listener);
}
