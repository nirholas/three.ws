// "Send your agent out" on /crawl: the owner picks one of their agents, gives it
// a topic and optional start pages, and enrolls it (PUT /api/crawl/mission) or
// calls it home (DELETE). Every write fetches a fresh CSRF token, since tokens
// are single use.

import { apiError, fmtCount, h, timeAgo } from './format.js';

const TOPIC_MIN = 2;
const TOPIC_MAX = 120;
const MAX_SEEDS = 8;

async function csrfToken() {
	const res = await fetch('/api/csrf-token', { credentials: 'include' });
	if (!res.ok) throw new Error(await apiError(res));
	const j = await res.json();
	const token = j.data?.token || j.token;
	if (!token) throw new Error('Could not start a secure request. Reload the page and try again.');
	return token;
}

function parseSeeds(text) {
	return String(text || '').split(/[\s,]+/).map((s) => s.trim()).filter(Boolean);
}

export function mountSend(root, { onChange } = {}) {
	let agents = [];
	let selected = null;

	function setBusy(on) { root.setAttribute('aria-busy', on ? 'true' : 'false'); }

	function cta(title, text, href, label) {
		root.replaceChildren(h('div', { class: 'cr-send-cta' },
			h('h3', { text: title }),
			h('p', { class: 'cr-muted', text }),
			h('a', { class: 'cr-btn cr-btn-primary', href, text: label }),
		));
	}

	function failed(message) {
		root.replaceChildren(h('div', { class: 'cr-send-cta', role: 'alert' },
			h('h3', { text: 'Your agents could not be loaded' }),
			h('p', { class: 'cr-muted', text: message }),
			h('button', { type: 'button', class: 'cr-btn', text: 'Try again', onclick: load }),
		));
	}

	function agentCard(a) {
		const on = a.mission?.enabled;
		const btn = h('button', {
			type: 'button',
			class: 'cr-pick',
			role: 'radio',
			'aria-checked': a.agentId === selected?.agentId ? 'true' : 'false',
			dataset: { agent: a.agentId },
			onclick: () => select(a.agentId),
		},
		a.thumbnail
			? h('img', { src: a.thumbnail, alt: '', width: 36, height: 36, loading: 'lazy' })
			: h('span', { class: 'cr-pick-initial', 'aria-hidden': 'true', text: (a.name || '?').slice(0, 1).toUpperCase() }),
		h('span', { class: 'cr-pick-text' },
			h('span', { class: 'cr-pick-name', text: a.name || 'Untitled agent' }),
			h('span', { class: 'cr-pick-state', dataset: { on: on ? 'true' : 'false' }, text: on ? `Out reading: ${a.mission.topic}` : a.mission ? 'Home' : 'Never sent out' }),
		));
		return btn;
	}

	function render() {
		const a = selected;
		const m = a.mission;
		const on = Boolean(m?.enabled);
		const error = h('p', { class: 'cr-form-error', role: 'alert', hidden: true });
		const ok = h('p', { class: 'cr-form-ok', role: 'status' });
		const topic = h('input', {
			id: 'cr-topic', name: 'topic', type: 'text', required: true,
			minlength: TOPIC_MIN, maxlength: TOPIC_MAX, autocomplete: 'off',
			placeholder: 'e.g. Gaussian splatting for real-time avatars',
			value: m?.topic || '',
		});
		const seeds = h('textarea', {
			id: 'cr-seeds', name: 'seeds', rows: 3, spellcheck: 'false',
			placeholder: 'https://en.wikipedia.org/wiki/Gaussian_splatting',
		});
		seeds.value = (m?.seeds || []).join('\n');
		const counter = h('span', { class: 'cr-counter', 'aria-live': 'polite' });
		const syncCount = () => { counter.textContent = `${topic.value.trim().length}/${TOPIC_MAX}`; };
		topic.addEventListener('input', syncCount);
		syncCount();

		const submit = h('button', { type: 'submit', class: 'cr-btn cr-btn-primary', text: on ? 'Update mission' : 'Send it out' });
		const home = on ? h('button', { type: 'button', class: 'cr-btn cr-btn-ghost', text: 'Call it home' }) : null;

		function showError(msg) {
			error.textContent = msg;
			error.hidden = !msg;
			ok.textContent = '';
		}

		async function write(methodName, url, body) {
			const token = await csrfToken();
			const res = await fetch(url, {
				method: methodName,
				credentials: 'include',
				headers: { 'content-type': 'application/json', 'x-csrf-token': token },
				body: body ? JSON.stringify(body) : undefined,
			});
			if (!res.ok) throw new Error(await apiError(res));
			return res.json();
		}

		const form = h('form', { class: 'cr-form', novalidate: true },
			h('div', { class: 'cr-field' },
				h('label', { for: 'cr-topic' }, 'Topic ', counter),
				topic,
				h('p', { class: 'cr-hint', text: 'What it should read about. Links on each page are scored against this.' }),
			),
			h('div', { class: 'cr-field' },
				h('label', { for: 'cr-seeds', text: 'Start pages (optional)' }),
				seeds,
				h('p', { class: 'cr-hint', text: `Up to ${MAX_SEEDS} public web addresses, one per line. Leave empty and it starts from a search for the topic.` }),
			),
			error,
			h('div', { class: 'cr-form-actions' }, submit, home, ok),
		);

		form.addEventListener('submit', async (e) => {
			e.preventDefault();
			const t = topic.value.trim();
			const s = parseSeeds(seeds.value);
			if (t.length < TOPIC_MIN) { showError(`Give it a topic of at least ${TOPIC_MIN} characters.`); topic.focus(); return; }
			if (s.length > MAX_SEEDS) { showError(`At most ${MAX_SEEDS} start pages.`); seeds.focus(); return; }
			showError('');
			submit.disabled = true;
			submit.textContent = on ? 'Updating' : 'Sending';
			try {
				const { mission } = await write('PUT', '/api/crawl/mission', { agentId: a.agentId, topic: t, seeds: s });
				a.mission = mission;
				render();
				root.querySelector('.cr-form-ok').textContent = on
					? 'Mission updated. It follows the new topic from its next page.'
					: 'Sent. It joins the crawl as soon as a browser is free, usually within a minute.';
				onChange?.(a);
			} catch (err) {
				showError(err.message);
				submit.disabled = false;
				submit.textContent = on ? 'Update mission' : 'Send it out';
			}
		});

		home?.addEventListener('click', async () => {
			home.disabled = true;
			showError('');
			try {
				await write('DELETE', `/api/crawl/mission?agent=${encodeURIComponent(a.agentId)}`);
				a.mission = { ...a.mission, enabled: false };
				render();
				root.querySelector('.cr-form-ok').textContent = 'Called home. Everything it read stays in the corpus and its memory.';
				onChange?.(a);
			} catch (err) {
				showError(err.message);
				home.disabled = false;
			}
		});

		const stats = m
			? h('p', { class: 'cr-muted cr-send-stats' },
				`${fmtCount(m.pagesRead)} pages, ${fmtCount(m.tokensRead)} tokens read`,
				m.lastAt ? `, last page ${timeAgo(m.lastAt)}` : '',
				'. ',
				h('a', { class: 'cr-link', href: `/agents/${encodeURIComponent(a.agentId)}`, text: 'Open its profile' }))
			: null;

		const picker = h('div', { class: 'cr-picks', role: 'radiogroup', 'aria-label': 'Your agents' }, agents.map(agentCard));
		picker.addEventListener('keydown', (e) => {
			if (!['ArrowDown', 'ArrowUp', 'ArrowRight', 'ArrowLeft'].includes(e.key)) return;
			e.preventDefault();
			const i = agents.findIndex((x) => x.agentId === selected.agentId);
			const d = e.key === 'ArrowDown' || e.key === 'ArrowRight' ? 1 : -1;
			select(agents[(i + d + agents.length) % agents.length].agentId, true);
		});
		for (const b of picker.querySelectorAll('.cr-pick')) b.tabIndex = b.dataset.agent === a.agentId ? 0 : -1;

		root.replaceChildren(h('div', { class: 'cr-send-grid' },
			h('div', {}, h('p', { class: 'cr-label', text: 'Your agents' }), picker),
			h('div', {}, h('h3', { class: 'cr-send-name', text: a.name || 'Untitled agent' }), stats, form),
		));
	}

	function select(id, focus = false) {
		selected = agents.find((a) => a.agentId === id) || agents[0];
		render();
		if (focus) root.querySelector(`.cr-pick[data-agent="${CSS.escape(selected.agentId)}"]`)?.focus();
	}

	async function load() {
		setBusy(true);
		root.replaceChildren(h('div', { class: 'cr-skel cr-send-skel' }));
		try {
			const me = await fetch('/api/auth/me', { credentials: 'include' });
			if (me.status === 401) {
				cta('Sign in to send your agent out', 'Your agent reads in a real browser while you watch, and remembers what it learned.', '/login?next=%2Fcrawl%23send', 'Sign in');
				return;
			}
			if (!me.ok) throw new Error(await apiError(me));
			const body = await me.json();
			if (!body?.user) {
				cta('Sign in to send your agent out', 'Your agent reads in a real browser while you watch, and remembers what it learned.', '/login?next=%2Fcrawl%23send', 'Sign in');
				return;
			}
			const res = await fetch('/api/crawl/mine', { credentials: 'include' });
			if (!res.ok) throw new Error(await apiError(res));
			agents = (await res.json()).agents || [];
			if (!agents.length) {
				cta('Make an agent first', 'Agents are what crawl. Create one with a 3D body, then come back and give it a topic.', '/create', 'Create an agent');
				return;
			}
			const wanted = new URLSearchParams(location.hash.slice(1)).get('send');
			select(agents.some((a) => a.agentId === wanted) ? wanted : agents[0].agentId);
		} catch (err) {
			failed(err.message);
		} finally {
			setBusy(false);
		}
	}

	load();
	return { reload: load };
}
