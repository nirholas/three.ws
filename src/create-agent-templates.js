// The "Start from a template" gallery in the /create-agent wizard.
//
// Two halves. The pure helpers (searchTemplates, topTags, fillFromTemplate) know
// nothing about the DOM and are unit-tested. mountTemplateGallery wires the
// <dialog id="tpl-dialog"> in pages/create-agent.html to them: a searchable grid,
// a preview pane, and one "Use this template" action that hands the chosen
// template back to the wizard, which pours it into its own fields so everything
// stays editable and goes through the normal validation and ship flow.
//
// The catalog is data/agent-templates.json, loaded on first open so the wizard's
// initial paint never pays for it.

const MAX_TAGS = 8;

/** Lowercased search haystack for one template. */
function haystack(t) {
	return [t.name, t.tagline, t.scope, ...t.tags, ...t.tools].join(' ').toLowerCase();
}

/**
 * Templates matching every whitespace-separated word of `query`, narrowed to one
 * tag when `tag` is set. An empty query and no tag returns the whole catalog.
 */
export function searchTemplates(templates, query = '', tag = '') {
	const words = String(query).toLowerCase().split(/\s+/).filter(Boolean);
	return templates.filter((t) => {
		if (tag && !t.tags.includes(tag)) return false;
		if (!words.length) return true;
		const h = haystack(t);
		return words.every((w) => h.includes(w));
	});
}

/** The `limit` most common tags across the catalog, most common first. */
export function topTags(templates, limit = 8, exclude = ['solana']) {
	const counts = new Map();
	for (const t of templates) {
		for (const tag of t.tags) {
			if (exclude.includes(tag)) continue;
			counts.set(tag, (counts.get(tag) || 0) + 1);
		}
	}
	return [...counts.entries()]
		.sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
		.slice(0, limit)
		.map(([tag]) => tag);
}

/**
 * What choosing a template changes in the wizard, given what the user already
 * has. The persona, greeting and category are the point of picking a template,
 * so they replace whatever was there. Name, description and tags are the user's
 * own words about their own agent, so a template only fills them when empty
 * (tags are merged). Skills are added to, never removed from.
 */
export function fillFromTemplate(template, current) {
	const tags = [...(current.tags || [])];
	for (const tag of template.tags) {
		if (tags.length >= MAX_TAGS) break;
		if (!tags.includes(tag)) tags.push(tag);
	}
	const skills = new Set(current.skills || []);
	for (const skill of template.skills) skills.add(skill);
	return {
		name: current.name?.trim() ? current.name : template.name,
		description: current.description?.trim() ? current.description : template.tagline,
		tags,
		skills,
		category: template.category,
		greeting: template.greeting,
		persona: template.persona,
	};
}

const esc = (s) =>
	String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

async function loadCatalog() {
	const mod = await import('../data/agent-templates.json');
	return mod.default.templates;
}

/**
 * Wire the gallery. `onUse(template)` is called when the user confirms a
 * template; the dialog closes first. Returns `{ open, close }`.
 */
export function mountTemplateGallery({ onUse }) {
	const $ = (id) => document.getElementById(id);
	const dialog = $('tpl-dialog');
	if (!dialog || typeof dialog.showModal !== 'function') return null;

	const opener = $('tpl-open');
	const shell = dialog.querySelector('.tpl-shell');
	const search = $('tpl-search');
	const tagBar = $('tpl-tags');
	const count = $('tpl-count');
	const grid = $('tpl-grid');
	const empty = $('tpl-empty');
	const failed = $('tpl-error');
	const preview = $('tpl-preview');

	let catalog = null;
	let selectedId = '';
	let activeTag = '';
	let visible = [];
	let focusId = '';

	const selected = () => catalog?.find((t) => t.id === selectedId) || null;

	function setView(view) {
		shell.dataset.view = view;
	}

	function renderSkeleton() {
		grid.innerHTML = Array.from({ length: 6 }, () => '<li class="tpl-skel" aria-hidden="true"></li>').join('');
		grid.setAttribute('aria-busy', 'true');
		count.textContent = 'Loading templates';
	}

	function renderTags() {
		const tags = topTags(catalog);
		tagBar.innerHTML = ['', ...tags]
			.map((tag) => {
				const on = tag === activeTag;
				return `<button type="button" class="tpl-tag" data-tag="${esc(tag)}" aria-pressed="${on}">${tag ? esc(tag) : 'All'}</button>`;
			})
			.join('');
	}

	function renderGrid() {
		visible = searchTemplates(catalog, search.value, activeTag);
		grid.removeAttribute('aria-busy');
		if (!visible.some((t) => t.id === focusId)) focusId = visible[0]?.id || '';
		grid.innerHTML = visible
			.map(
				(t) => `<li>
					<button type="button" class="tpl-card" data-id="${esc(t.id)}" aria-pressed="${t.id === selectedId}" tabindex="${t.id === focusId ? 0 : -1}">
						<span class="tpl-card-name">${esc(t.name)}</span>
						<span class="tpl-card-tag">${esc(t.tagline)}</span>
						<span class="tpl-card-meta">${t.tags
							.slice(0, 3)
							.map((x) => `<span>${esc(x)}</span>`)
							.join('')}</span>
					</button>
				</li>`,
			)
			.join('');
		empty.hidden = visible.length > 0;
		grid.hidden = visible.length === 0;
		const total = catalog.length;
		count.textContent =
			visible.length === total
				? `${total} templates`
				: `${visible.length} of ${total} templates`;
	}

	function renderPreview() {
		const t = selected();
		if (!t) {
			preview.innerHTML = `<div class="tpl-preview-empty"><p>Pick a template to preview its persona, greeting and the tools it works with.</p></div>`;
			return;
		}
		preview.innerHTML = `
			<button type="button" class="tpl-back" id="tpl-back">Back to templates</button>
			<div class="tpl-preview-scroll">
				<h3 class="tpl-preview-name">${esc(t.name)}</h3>
				<p class="tpl-preview-tag">${esc(t.tagline)}</p>
				<p class="tpl-scope"><span>Scope</span> ${esc(t.scope)}</p>
				<h4>Greeting</h4>
				<blockquote class="tpl-greeting">${esc(t.greeting)}</blockquote>
				<h4>Suggested prompts</h4>
				<ul class="tpl-prompts">${t.prompts.map((p) => `<li>${esc(p)}</li>`).join('')}</ul>
				${
					t.tools.length
						? `<h4>Works with three.ws tools</h4><p class="tpl-tools">${t.tools
								.map((x) => `<code>${esc(x)}</code>`)
								.join('')}${t.skills.map((x) => `<code>${esc(x)}</code>`).join('')}</p>`
						: ''
				}
				<h4>Persona</h4>
				<pre class="tpl-persona" tabindex="0" aria-label="Persona text for ${esc(t.name)}">${esc(t.persona)}</pre>
			</div>
			<div class="tpl-preview-foot">
				<button type="button" class="tpl-use" id="tpl-use">Use this template</button>
				<p>Fills the persona, greeting, category and skills. You can edit everything.</p>
			</div>`;
		$('tpl-back').addEventListener('click', () => setView('list'));
		$('tpl-use').addEventListener('click', use);
	}

	function select(id, { reveal = true } = {}) {
		selectedId = id;
		focusId = id;
		grid.querySelectorAll('.tpl-card').forEach((c) => {
			c.setAttribute('aria-pressed', String(c.dataset.id === id));
			c.tabIndex = c.dataset.id === id ? 0 : -1;
		});
		renderPreview();
		if (reveal) setView('detail');
	}

	function use() {
		const t = selected();
		if (!t) return;
		dialog.close('used');
		onUse(t);
	}

	function moveFocus(from, key) {
		const cards = [...grid.querySelectorAll('.tpl-card')];
		const i = cards.indexOf(from);
		if (i < 0) return;
		const cols = cards.filter((c) => c.offsetTop === cards[0].offsetTop).length || 1;
		const step = { ArrowRight: 1, ArrowLeft: -1, ArrowDown: cols, ArrowUp: -cols }[key];
		let next = key === 'Home' ? 0 : key === 'End' ? cards.length - 1 : i + step;
		next = Math.min(Math.max(next, 0), cards.length - 1);
		cards.forEach((c, n) => (c.tabIndex = n === next ? 0 : -1));
		focusId = cards[next].dataset.id;
		cards[next].focus();
	}

	async function ensureCatalog() {
		if (catalog) return true;
		failed.hidden = true;
		renderSkeleton();
		try {
			catalog = await loadCatalog();
		} catch (err) {
			console.error('[create-agent] template catalog failed to load', err);
			grid.hidden = true;
			count.textContent = '';
			failed.hidden = false;
			return false;
		}
		grid.hidden = false;
		renderTags();
		renderGrid();
		select(catalog[0].id, { reveal: false });
		return true;
	}

	function open() {
		if (!dialog.open) dialog.showModal();
		document.documentElement.classList.add('tpl-lock');
		setView('list');
		ensureCatalog();
		search.focus();
	}

	function close() {
		if (dialog.open) dialog.close();
	}

	opener?.addEventListener('click', open);
	$('tpl-close').addEventListener('click', close);
	$('tpl-retry').addEventListener('click', () => ensureCatalog());
	dialog.addEventListener('close', () => document.documentElement.classList.remove('tpl-lock'));
	dialog.addEventListener('click', (e) => {
		if (e.target === dialog) close();
	});

	search.addEventListener('input', () => catalog && renderGrid());
	$('tpl-clear').addEventListener('click', () => {
		search.value = '';
		activeTag = '';
		renderTags();
		renderGrid();
		search.focus();
	});

	tagBar.addEventListener('click', (e) => {
		const btn = e.target.closest('.tpl-tag');
		if (!btn) return;
		activeTag = btn.dataset.tag;
		renderTags();
		renderGrid();
	});

	grid.addEventListener('click', (e) => {
		const card = e.target.closest('.tpl-card');
		if (card) select(card.dataset.id);
	});
	grid.addEventListener('keydown', (e) => {
		const card = e.target.closest('.tpl-card');
		if (card && ['ArrowRight', 'ArrowLeft', 'ArrowDown', 'ArrowUp', 'Home', 'End'].includes(e.key)) {
			e.preventDefault();
			moveFocus(card, e.key);
		}
	});

	return { open, close };
}
