/**
 * /stories: success stories with results anyone can check.
 *
 * Reads GET /api/spotlight/stories, which returns only Agent Spotlight entries
 * whose agent OWNER opted in (curated write-ups never qualify on their own) and
 * whose agent has at least one verified result: a coin launched, creator fees,
 * or service income. Figures are computed server-side
 * (api/_lib/spotlight-metrics.js); this page only draws them, grouped by
 * category, each card linking to the full entry and to the coin on Solscan.
 *
 * Few entries qualify at first, so the empty state is the page most visitors
 * see early on. It tells a builder exactly how to get on it.
 */

import { apiFetch } from './api.js';
import { el, entryPath, errorMessage, monogram } from './spotlight-shared.js';
import { verifiedSummary, verifiedCoinList } from './spotlight-verified.js';

const root = document.getElementById('st-root');
const methodEl = document.getElementById('st-method');

function card(entry) {
	const art = entry.agent.thumbnail
		? el('img', { src: entry.agent.thumbnail, alt: '', loading: 'lazy', decoding: 'async', width: 56, height: 56 })
		: monogram(entry.agent);
	const by = [el('span', { text: entry.agent.name })];
	if (entry.builder?.name) {
		by.push(document.createTextNode(' · built by '));
		by.push(
			entry.builder.profile_url
				? el('a', { href: entry.builder.profile_url, text: entry.builder.name })
				: el('span', { text: entry.builder.name }),
		);
	}
	return el('article', { class: 'st-card', 'aria-labelledby': `st-${entry.id}` }, [
		el('div', { class: 'st-card-head' }, [
			art,
			el('div', {}, [
				el('h3', { class: 'st-card-title', id: `st-${entry.id}`, text: entry.title }),
				el('p', { class: 'st-card-by' }, by),
			]),
		]),
		el('p', { class: 'st-card-tagline', text: entry.tagline }),
		verifiedSummary(entry),
		verifiedCoinList(entry.verified, { limit: 3 }),
		el('div', { class: 'st-card-foot' }, [
			el('a', { class: 'sp-btn sp-btn-sm sp-btn-primary', href: entryPath(entry), text: 'Read the full story' }),
			el('a', { class: 'sp-btn sp-btn-sm', href: `/agents/${entry.agent.id}`, text: `Talk to ${entry.agent.name}` }),
		]),
	]);
}

function renderGroups(groups) {
	root.replaceChildren(
		...groups.map((g) =>
			el('section', { class: 'st-group', 'aria-labelledby': `st-g-${g.slug}` }, [
				el('h2', { class: 'st-group-title', id: `st-g-${g.slug}`, text: g.label }),
				el('div', { class: 'st-grid' }, g.entries.map(card)),
			]),
		),
	);
}

function renderEmpty(consented) {
	const waiting =
		consented > 0
			? `${consented.toLocaleString('en-US')} ${consented === 1 ? 'builder has' : 'builders have'} opted in and will appear here as soon as their agent has a verified result.`
			: null;
	root.replaceChildren(
		el('section', { class: 'sp-empty' }, [
			el('h3', { text: 'No success stories yet. Yours could be the first.' }),
			el('p', {
				text: 'A story is a Spotlight entry whose builder chose to feature it, for an agent with a result anyone can check: a coin it launched, creator fees it earned, or income from other agents paying for its skills.',
			}),
			waiting ? el('p', { text: waiting }) : null,
			el('p', {
				text: 'New entry: tick "Feature this as a success story" when you submit. Already showcased: open your entry and choose "Feature as a success story".',
			}),
			el('div', { class: 'sp-ctas' }, [
				el('a', { class: 'sp-btn sp-btn-primary', href: '/spotlight?submit=1', text: 'Submit your agent' }),
				el('a', { class: 'sp-btn', href: '/launch', text: 'Launch a coin for your agent' }),
			]),
		]),
	);
}

function renderError(message) {
	const retry = el('button', { type: 'button', class: 'sp-btn sp-btn-primary', text: 'Try again' });
	retry.addEventListener('click', load);
	root.replaceChildren(
		el('section', { class: 'sp-error', role: 'alert' }, [
			el('h3', { text: 'Stories did not load' }),
			el('p', { text: `${message}. The showcase itself is unaffected.` }),
			el('div', { class: 'sp-ctas' }, [retry, el('a', { class: 'sp-btn', href: '/spotlight', text: 'Open the showcase' })]),
		]),
	);
}

function renderSkeleton() {
	root.replaceChildren(
		el('div', { class: 'st-grid', 'aria-hidden': 'true' }, [1, 2, 3].map(() => el('div', { class: 'sp-skeleton st-skel' }))),
	);
}

async function load() {
	root.setAttribute('aria-busy', 'true');
	renderSkeleton();
	try {
		const res = await apiFetch('/api/spotlight/stories', { allowAnonymous: true });
		const data = await res.json().catch(() => null);
		if (!res.ok) throw new Error(errorMessage(data, `the stories feed returned ${res.status}`));
		if (methodEl && data.method) methodEl.textContent = `How it works: ${data.method}`;
		if (!data.total) renderEmpty(data.consented || 0);
		else renderGroups(data.groups || []);
	} catch (err) {
		renderError(err?.message || 'could not reach the stories feed');
	} finally {
		root.setAttribute('aria-busy', 'false');
	}
}

load();
