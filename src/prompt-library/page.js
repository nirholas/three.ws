// /prompts: the three.ws prompt library.
//
// Every prompt is copy written to be pasted into someone else's Claude, so the
// page has exactly two jobs: let people find the right one fast, and hand it
// over cleanly (clipboard, or straight into claude.ai with the prompt already
// in the box). The library itself is published data, built from
// data/prompt-library.json into /prompts.json by scripts/build-prompt-library.mjs,
// so this module never hardcodes a prompt.
import './page.css';

const SOURCE = '/prompts.json';
const CLAUDE_NEW = 'https://claude.ai/new?q=';
const COPY_RESET_MS = 1800;

const root = document.getElementById('prompt-library');
const state = {
	library: null,
	query: '',
	category: 'all',
	setup: 'all',
};

const params = new URLSearchParams(location.search);
state.query = params.get('q') || '';
state.category = params.get('category') || 'all';
state.setup = params.get('setup') || 'all';

const escapeHtml = (value) =>
	String(value)
		.replace(/&/g, '&amp;')
		.replace(/</g, '&lt;')
		.replace(/>/g, '&gt;')
		.replace(/"/g, '&quot;');

function matches(entry, query) {
	if (!query) return true;
	const haystack = [
		entry.title,
		entry.summary,
		entry.returns,
		entry.prompt,
		entry.category,
		entry.setup,
		(entry.tags || []).join(' '),
	]
		.join(' ')
		.toLowerCase();
	return query
		.toLowerCase()
		.split(/\s+/)
		.filter(Boolean)
		.every((term) => haystack.includes(term));
}

function visiblePrompts() {
	const all = state.library ? state.library.prompts : [];
	return all.filter(
		(entry) =>
			(state.category === 'all' || entry.category === state.category) &&
			(state.setup === 'all' || entry.setup === state.setup) &&
			matches(entry, state.query),
	);
}

function syncUrl() {
	const next = new URLSearchParams();
	if (state.query) next.set('q', state.query);
	if (state.category !== 'all') next.set('category', state.category);
	if (state.setup !== 'all') next.set('setup', state.setup);
	const search = next.toString();
	history.replaceState(null, '', search ? `?${search}${location.hash}` : location.pathname + location.hash);
}

function announce(message) {
	const live = document.getElementById('pl-live');
	if (live) live.textContent = message;
}

async function copyText(text) {
	try {
		await navigator.clipboard.writeText(text);
		return true;
	} catch {
		// Clipboard API needs a secure context and permission; the textarea path
		// still works in an http:// preview and in older WebViews.
		const area = document.createElement('textarea');
		area.value = text;
		area.setAttribute('readonly', '');
		area.style.position = 'fixed';
		area.style.opacity = '0';
		document.body.appendChild(area);
		area.select();
		let ok = false;
		try {
			ok = document.execCommand('copy');
		} catch {
			ok = false;
		}
		area.remove();
		return ok;
	}
}

function flashButton(button, label) {
	const original = button.dataset.label || button.textContent;
	button.dataset.label = original;
	button.dataset.copied = 'true';
	button.textContent = label;
	clearTimeout(Number(button.dataset.timer || 0));
	button.dataset.timer = String(
		setTimeout(() => {
			button.textContent = button.dataset.label;
			button.removeAttribute('data-copied');
		}, COPY_RESET_MS),
	);
}

function setupCard(setup) {
	const steps = (setup.how || [])
		.map((step) => `<li>${escapeHtml(step)}</li>`)
		.join('');
	return `
		<article class="pl-setup">
			<h3>${escapeHtml(setup.label)}<span class="pl-setup-count">${setup.count}</span></h3>
			<p>${escapeHtml(setup.blurb)}</p>
			${steps ? `<ul class="pl-setup-steps">${steps}</ul>` : ''}
		</article>`;
}

function promptCard(entry, setupsById) {
	const setup = setupsById.get(entry.setup);
	const links = (entry.links || [])
		.map(
			(link) =>
				`<a href="${escapeHtml(link.href)}"${link.href.startsWith('http') ? ' target="_blank" rel="noopener"' : ''}>${escapeHtml(link.label)}</a>`,
		)
		.join('');
	const tags = (entry.tags || []).map((tag) => `<span class="pl-tag">${escapeHtml(tag)}</span>`).join('');
	return `
		<article class="pl-card" id="${escapeHtml(entry.id)}" data-id="${escapeHtml(entry.id)}">
			<div class="pl-card-head">
				<h3><a href="#${escapeHtml(entry.id)}">${escapeHtml(entry.title)}</a></h3>
				<span class="pl-badge" data-setup="${escapeHtml(entry.setup)}">${escapeHtml(setup ? setup.label : entry.setup)}</span>
			</div>
			<p class="pl-summary">${escapeHtml(entry.summary)}</p>
			${entry.caution ? `<p class="pl-caution">${escapeHtml(entry.caution)}</p>` : ''}
			<pre class="pl-prompt" tabindex="0">${escapeHtml(entry.prompt)}</pre>
			<div class="pl-actions">
				<button type="button" class="pl-btn" data-variant="primary" data-action="copy">Copy prompt</button>
				<a class="pl-btn" data-action="open" href="${CLAUDE_NEW}${encodeURIComponent(entry.prompt)}" target="_blank" rel="noopener">Open in Claude</a>
				<button type="button" class="pl-btn" data-action="link">Copy link</button>
			</div>
			<p class="pl-returns"><b>You get:</b> ${escapeHtml(entry.returns)}</p>
			<div class="pl-foot">
				<div class="pl-links">${links}</div>
				<div class="pl-tags">${tags}</div>
			</div>
		</article>`;
}

function chip(label, count, value, group, active) {
	return `<button type="button" class="pl-chip" data-group="${group}" data-value="${escapeHtml(value)}" aria-pressed="${active}">${escapeHtml(label)}<span class="pl-chip-count">${count}</span></button>`;
}

function renderList() {
	const list = document.getElementById('pl-list');
	const line = document.getElementById('pl-result-line');
	if (!list || !state.library) return;
	const found = visiblePrompts();
	const setupsById = new Map(state.library.setups.map((setup) => [setup.id, setup]));

	line.textContent = `${found.length} of ${state.library.count} prompts`;

	if (!found.length) {
		list.innerHTML = `
			<div class="pl-state">
				<h3>No prompt matches that yet</h3>
				<p>Try a broader word, or clear the filters. If what you need is missing, the library is a single JSON file in the open repo and takes one pull request to extend.</p>
				<div class="pl-state-actions">
					<button type="button" class="pl-btn" data-variant="primary" data-action="reset">Clear filters</button>
					<a class="pl-btn" href="https://github.com/nirholas/three.ws/blob/main/data/prompt-library.json" target="_blank" rel="noopener">Add a prompt</a>
				</div>
			</div>`;
		return;
	}

	list.innerHTML = found.map((entry) => promptCard(entry, setupsById)).join('');
	for (const pre of list.querySelectorAll('.pl-prompt')) {
		if (pre.scrollHeight - pre.clientHeight > 8) {
			const card = pre.closest('.pl-card');
			const actions = card.querySelector('.pl-actions');
			const expand = document.createElement('button');
			expand.type = 'button';
			expand.className = 'pl-btn';
			expand.dataset.action = 'expand';
			expand.textContent = 'Show all';
			actions.appendChild(expand);
		}
	}
}

function renderChips() {
	const categoryRow = document.getElementById('pl-categories');
	const setupRow = document.getElementById('pl-setups-filter');
	if (!categoryRow || !state.library) return;
	categoryRow.innerHTML = [
		chip('All', state.library.count, 'all', 'category', state.category === 'all'),
		...state.library.categories.map((category) =>
			chip(category.label, category.count, category.id, 'category', state.category === category.id),
		),
	].join('');
	setupRow.innerHTML = [
		chip('Any setup', state.library.count, 'all', 'setup', state.setup === 'all'),
		...state.library.setups.map((setup) => chip(setup.label, setup.count, setup.id, 'setup', state.setup === setup.id)),
	].join('');
}

function renderShell() {
	const library = state.library;
	root.innerHTML = `
		<p class="pl-eyebrow"><span class="pl-dot"></span>Prompt library</p>
		<h1>${escapeHtml(library.title)}</h1>
		<p class="pl-lede">${escapeHtml(library.intro)}</p>
		<div class="pl-head-actions">
			<button type="button" class="pl-btn" data-variant="primary" data-action="copy-all">Copy the whole library</button>
			<a class="pl-btn" href="/prompts.txt">Plain text</a>
			<a class="pl-btn" href="/prompts.json">JSON</a>
			<a class="pl-btn" href="/docs/prompts">How this works</a>
		</div>

		<h2 class="pl-section-title">What you need first</h2>
		<p class="pl-section-note">Most of these need nothing at all. The rest ask for one connection you make once.</p>
		<div class="pl-setups">${library.setups.map(setupCard).join('')}</div>

		<h2 class="pl-section-title">The prompts</h2>
		<div class="pl-toolbar">
			<div class="pl-search-row">
				<label class="pl-search">
					<span class="pl-sr">Search the prompt library</span>
					<input id="pl-search-input" type="search" placeholder="Search prompts: avatar, embed, x402, rigging" value="${escapeHtml(state.query)}" autocomplete="off" />
					<span class="pl-kbd">/</span>
				</label>
			</div>
			<div class="pl-chips" id="pl-categories"></div>
			<div class="pl-chips" id="pl-setups-filter"></div>
			<p class="pl-result-line" id="pl-result-line"></p>
		</div>
		<div class="pl-grid" id="pl-list"></div>
		<p class="pl-sr" id="pl-live" role="status" aria-live="polite"></p>`;

	renderChips();
	renderList();

	const input = document.getElementById('pl-search-input');
	let debounce = 0;
	input.addEventListener('input', () => {
		clearTimeout(debounce);
		debounce = setTimeout(() => {
			state.query = input.value.trim();
			syncUrl();
			renderList();
		}, 120);
	});
	input.addEventListener('keydown', (event) => {
		if (event.key === 'Escape' && input.value) {
			input.value = '';
			state.query = '';
			syncUrl();
			renderList();
		}
	});

	if (location.hash.length > 1) {
		const target = document.getElementById(decodeURIComponent(location.hash.slice(1)));
		if (target) target.scrollIntoView({ block: 'center' });
	}
}

function renderError(message) {
	root.innerHTML = `
		<div class="pl-state">
			<h3>The library did not load</h3>
			<p>${escapeHtml(message)} The same prompts are always available as plain text, which needs nothing but a browser.</p>
			<div class="pl-state-actions">
				<button type="button" class="pl-btn" data-variant="primary" data-action="retry">Try again</button>
				<a class="pl-btn" href="/prompts.txt">Read the plain text version</a>
			</div>
		</div>`;
}

function renderLoading() {
	root.innerHTML = `
		<p class="pl-eyebrow"><span class="pl-dot"></span>Prompt library</p>
		<h1>Prompts you can paste into Claude</h1>
		<p class="pl-lede">Loading the library.</p>
		<div class="pl-grid" aria-hidden="true">
			${Array.from({ length: 4 })
				.map(() => '<div class="pl-skeleton"><span></span><span></span><span></span><span></span></div>')
				.join('')}
		</div>`;
}

function promptById(id) {
	return state.library ? state.library.prompts.find((entry) => entry.id === id) : null;
}

function wholeLibraryText() {
	return state.library.prompts
		.map((entry) => `# ${entry.title}\n# ${entry.summary}\n\n${entry.prompt}`)
		.join('\n\n---\n\n');
}

root.addEventListener('click', async (event) => {
	const chipEl = event.target.closest('.pl-chip');
	if (chipEl) {
		const group = chipEl.dataset.group;
		state[group] = chipEl.dataset.value;
		syncUrl();
		renderChips();
		renderList();
		return;
	}

	const button = event.target.closest('[data-action]');
	if (!button) return;
	const action = button.dataset.action;
	const card = button.closest('.pl-card');
	const entry = card ? promptById(card.dataset.id) : null;

	if (action === 'copy' && entry) {
		const ok = await copyText(entry.prompt);
		flashButton(button, ok ? 'Copied' : 'Press Ctrl+C');
		announce(ok ? `${entry.title} copied to the clipboard` : 'Copy failed, select the prompt and copy it manually');
	} else if (action === 'link' && entry) {
		const url = `${location.origin}${location.pathname}#${entry.id}`;
		const ok = await copyText(url);
		flashButton(button, ok ? 'Link copied' : 'Copy failed');
		announce(ok ? 'Link copied to the clipboard' : 'Copy failed');
	} else if (action === 'expand' && card) {
		const expanded = card.dataset.expanded === 'true';
		card.dataset.expanded = expanded ? 'false' : 'true';
		button.textContent = expanded ? 'Show all' : 'Show less';
	} else if (action === 'copy-all') {
		const ok = await copyText(wholeLibraryText());
		flashButton(button, ok ? 'Library copied' : 'Copy failed');
		announce(ok ? `All ${state.library.count} prompts copied` : 'Copy failed');
	} else if (action === 'reset') {
		state.query = '';
		state.category = 'all';
		state.setup = 'all';
		const input = document.getElementById('pl-search-input');
		if (input) input.value = '';
		syncUrl();
		renderChips();
		renderList();
	} else if (action === 'retry') {
		load();
	}
});

document.addEventListener('keydown', (event) => {
	if (event.key !== '/' || event.metaKey || event.ctrlKey || event.altKey) return;
	const tag = (event.target.tagName || '').toLowerCase();
	if (tag === 'input' || tag === 'textarea' || event.target.isContentEditable) return;
	const input = document.getElementById('pl-search-input');
	if (!input) return;
	event.preventDefault();
	input.focus();
	input.select();
});

async function load() {
	renderLoading();
	try {
		const res = await fetch(SOURCE, { headers: { accept: 'application/json' } });
		if (!res.ok) throw new Error(`The server answered ${res.status}.`);
		const data = await res.json();
		if (!data || !Array.isArray(data.prompts) || !data.prompts.length) {
			throw new Error('The library came back empty.');
		}
		state.library = data;
		renderShell();
	} catch (err) {
		renderError(err && err.message ? err.message : 'Something went wrong.');
	}
}

load();
