// The corpus table on /crawl: every page the agents read, newest first, with an
// agent filter, keyset pagination, and a JSONL download that follows the filter.

import { apiError, fmtCount, h, safeHref, timeAgo } from './format.js';

const PAGE_SIZE = 40;

export function mountCorpus({ body, select, more, note, download }) {
	let agent = '';
	let next = null;
	let loading = false;
	let fresh = 0;
	let generation = 0;
	const known = new Set();

	function skeletonRows(n = 6) {
		return Array.from({ length: n }, () => h('tr', { class: 'cr-row-skel' },
			h('td', {}, h('span', { class: 'cr-skel' })),
			h('td', {}, h('span', { class: 'cr-skel' })),
			h('td', {}, h('span', { class: 'cr-skel' })),
			h('td', {}, h('span', { class: 'cr-skel' })),
			h('td', {}, h('span', { class: 'cr-skel' })),
			h('td', {}),
		));
	}

	function row(p) {
		const href = safeHref(p.url);
		const rel = Math.round(Math.max(0, Math.min(1, Number(p.relevance) || 0)) * 100);
		return h('tr', {},
			h('td', { class: 'cr-page-cell' },
				href
					? h('a', { class: 'cr-page-title', href, target: '_blank', rel: 'noopener nofollow ugc', text: p.title || p.url })
					: h('span', { class: 'cr-page-title', text: p.title || p.url }),
				h('span', { class: 'cr-page-domain', text: p.domain || '' }),
				p.gist ? h('span', { class: 'cr-page-gist', text: p.gist }) : null,
			),
			h('td', {}, h('button', {
				type: 'button', class: 'cr-chip', text: p.agentName || 'Agent',
				title: `Only pages read by ${p.agentName || 'this agent'}`,
				onclick: () => setAgent(p.agentId),
			})),
			h('td', { class: 'cr-num', text: fmtCount(p.tokens) }),
			h('td', {},
				h('span', { class: 'cr-meter', role: 'meter', 'aria-valuemin': 0, 'aria-valuemax': 100, 'aria-valuenow': rel, 'aria-label': `${rel}% on topic` },
					h('span', { style: `width:${rel}%` })),
			),
			h('td', { class: 'cr-when' }, h('time', { datetime: p.readAt, title: new Date(p.readAt).toLocaleString(), text: timeAgo(p.readAt) })),
			h('td', {}, p.textUrl
				? h('a', { class: 'cr-link', href: p.textUrl, target: '_blank', rel: 'noopener', text: 'Text', 'aria-label': `Full text of ${p.title || p.url}` })
				: null),
		);
	}

	function emptyRow(message, action) {
		return h('tr', { class: 'cr-row-empty' }, h('td', { colspan: 6 },
			h('p', { text: message }), action || null));
	}

	function syncDownload() {
		const q = new URLSearchParams({ format: 'jsonl', limit: '500' });
		if (agent) q.set('agent', agent);
		download.href = `/api/crawl/pages?${q}`;
	}

	async function load({ append = false } = {}) {
		if (loading) return;
		loading = true;
		const gen = ++generation;
		if (!append) {
			body.replaceChildren(...skeletonRows());
			next = null;
			fresh = 0;
		}
		more.disabled = true;
		note.textContent = append ? 'Loading more pages' : '';
		const q = new URLSearchParams({ limit: String(PAGE_SIZE) });
		if (agent) q.set('agent', agent);
		if (append && next) q.set('before', String(next));
		try {
			const res = await fetch(`/api/crawl/pages?${q}`, { headers: { accept: 'application/json' } });
			if (!res.ok) throw new Error(await apiError(res));
			const data = await res.json();
			if (gen !== generation) return;
			const rows = (data.pages || []).map(row);
			if (!append) body.replaceChildren();
			if (!rows.length && !append) {
				body.append(emptyRow(agent
					? 'This agent has not filed a page yet. Pages appear here a few seconds after it finishes reading them.'
					: 'Nothing has been read yet. Send an agent out and its first pages will appear here.',
				agent ? h('button', { type: 'button', class: 'cr-btn', text: 'Show all agents', onclick: () => setAgent('') }) : h('a', { class: 'cr-btn', href: '#send', text: 'Send your agent out' })));
			}
			body.append(...rows);
			next = data.next;
			more.hidden = !next;
			more.disabled = false;
			note.textContent = '';
		} catch (err) {
			if (gen !== generation) return;
			if (!append) body.replaceChildren();
			const retry = h('button', { type: 'button', class: 'cr-btn', text: 'Try again', onclick: () => load({ append }) });
			if (append) {
				note.textContent = `Could not load more pages: ${err.message}`;
				more.disabled = false;
			} else {
				body.append(emptyRow(`The corpus could not be loaded: ${err.message}`, retry));
			}
		} finally {
			if (gen === generation) loading = false;
		}
	}

	function setAgent(id) {
		agent = id || '';
		if (select.value !== agent) select.value = agent;
		syncDownload();
		load();
	}

	// Keep the filter list in step with every agent we have seen.
	function addAgents(list) {
		for (const a of list) {
			if (!a?.agentId || known.has(a.agentId)) continue;
			known.add(a.agentId);
			select.append(h('option', { value: a.agentId, text: a.name || 'Agent' }));
		}
	}

	// A page just landed: offer it rather than reshuffling rows under the reader.
	function notifyNew(agentId) {
		if (agent && agentId !== agent) return;
		fresh += 1;
		more.hidden = false;
		note.replaceChildren(h('button', {
			type: 'button', class: 'cr-btn cr-btn-small',
			text: `Show ${fresh} new page${fresh === 1 ? '' : 's'}`,
			onclick: () => load(),
		}));
		more.hidden = !next;
	}

	select.addEventListener('change', () => setAgent(select.value));
	more.addEventListener('click', () => load({ append: true }));
	syncDownload();
	load();

	return { setAgent, addAgents, notifyNew };
}
