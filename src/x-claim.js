// /x/claim: list what the X mention bot made for the signed-in user's linked
// X account (GET /api/x/claim) and move it into their library (POST).

const root = document.getElementById('xc-root');

function h(tag, attrs = {}, ...kids) {
	const el = document.createElement(tag);
	for (const [k, v] of Object.entries(attrs)) {
		if (v == null || v === false) continue;
		if (k === 'text') el.textContent = v;
		else el.setAttribute(k, v === true ? '' : v);
	}
	for (const kid of kids) if (kid) el.append(kid);
	return el;
}

async function csrfToken() {
	try {
		const r = await fetch('/api/csrf-token', { credentials: 'include' });
		if (!r.ok) return null;
		const j = await r.json().catch(() => null);
		return j?.token || j?.data?.token || null;
	} catch {
		return null;
	}
}

async function load() {
	try {
		const res = await fetch('/api/x/claim', { credentials: 'include' });
		if (res.status === 401) return { state: 'signed_out' };
		if (!res.ok) return { state: 'error', message: 'The claim list could not be loaded.' };
		const data = await res.json();
		const body = data?.data ?? data;
		if (!body.linked) return { state: 'unlinked', configured: body.x_configured };
		return { state: body.creations.length ? 'list' : 'empty', ...body };
	} catch {
		return { state: 'error', message: 'Network error while loading your creations.' };
	}
}

function panel(title, text, ...actions) {
	return h('section', { class: 'xc-panel' }, h('h2', { text: title }), h('p', { text }), h('div', { class: 'xc-actions' }, ...actions));
}

function link(label, href, primary = false) {
	return h('a', { class: 'xc-btn', href, 'data-variant': primary ? 'primary' : null, text: label });
}

function item(c) {
	const when = new Date(c.created_at).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
	return h(
		'li',
		{ class: 'xc-item' },
		c.preview_image_url ? h('img', { class: 'xc-thumb', src: c.preview_image_url, alt: '', loading: 'lazy' }) : h('div', { class: 'xc-thumb', 'aria-hidden': 'true' }),
		h('div', {}, h('p', { class: 'xc-prompt', text: c.prompt || 'Untitled model' }), h('span', { class: 'xc-when', text: when })),
		h('a', { class: 'xc-btn', href: c.url, text: 'View' }),
	);
}

function renderList(view) {
	const status = h('p', { class: 'xc-status', role: 'status' });
	const button = h('button', { class: 'xc-btn', type: 'button', 'data-variant': 'primary', text: `Claim ${view.creations.length} ${view.creations.length === 1 ? 'creation' : 'creations'}` });
	button.addEventListener('click', async () => {
		button.disabled = true;
		status.removeAttribute('data-tone');
		status.textContent = 'Moving them into your library...';
		const token = await csrfToken();
		try {
			const res = await fetch('/api/x/claim', {
				method: 'POST',
				credentials: 'include',
				headers: { 'content-type': 'application/json', ...(token ? { 'x-csrf-token': token } : {}) },
				body: JSON.stringify({}),
			});
			const data = await res.json().catch(() => null);
			if (!res.ok) throw new Error(data?.error_description || 'The claim failed.');
			const n = (data?.data ?? data).claimed.length;
			render({ state: 'done', count: n });
		} catch (err) {
			button.disabled = false;
			status.dataset.tone = 'error';
			status.textContent = `${err.message} Try again.`;
		}
	});
	return h(
		'section',
		{ class: 'xc-panel' },
		h('div', { class: 'xc-head' }, h('h2', { text: `Made for @${view.username}` }), button),
		h('ul', { class: 'xc-list' }, ...view.creations.map(item)),
		status,
	);
}

function retryButton() {
	const b = h('button', { class: 'xc-btn', type: 'button', 'data-variant': 'primary', text: 'Retry' });
	b.addEventListener('click', () => location.reload());
	return b;
}

function render(view) {
	root.setAttribute('aria-busy', 'false');
	root.replaceChildren(
		(() => {
			switch (view.state) {
				case 'signed_out':
					return panel('Sign in to claim', 'Sign in to three.ws, then link the X account you asked the bot from. Everything it made for that account is waiting.', link('Sign in', '/login?next=%2Fx%2Fclaim', true), link('Make something', '/forge'));
				case 'unlinked':
					return panel(
						'Link your X account',
						view.configured === false
							? 'Linking X is not available right now. Your creations stay saved, so check back soon.'
							: 'Link the X account you asked the bot from. We read only your X id to match it, and every creation made for that id moves into your library.',
						view.configured === false ? link('Open the studio', '/forge') : link('Link X', '/api/auth/x/connect?return_to=%2Fx%2Fclaim', true),
					);
				case 'empty':
					return panel(`Nothing waiting for @${view.username}`, 'Every creation the bot made for this X account is already in your library. Ask @trythreews for something new and it lands there automatically.', link('Open your library', '/my-creations', true), link('Open the studio', '/forge'));
				case 'list':
					return renderList(view);
				case 'done':
					return panel(view.count === 1 ? '1 creation saved to your library' : `${view.count} creations saved to your library`, 'They are yours now: edit, rig, animate, or share them.', link('Open your library', '/my-creations', true));
				default:
					return panel('Something went wrong', view.message || 'Please try again.', retryButton());
			}
		})(),
	);
}

render(await load());
