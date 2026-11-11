// /trust/subprocessors: renders data/subprocessors.json as grouped tables with a
// client-side filter. The JSON is bundled at build time, so the list a reviewer
// sees is exactly the file in the repository (and tests/trust-page.test.js keeps
// every evidence path pointing at a real file).
import list from '../data/subprocessors.json';
import './trust.css';

const REPO = 'https://github.com/nirholas/three.ws/blob/main/';

const root = document.getElementById('tr-sp-root');
const meta = document.getElementById('tr-sp-meta');
const input = document.getElementById('tr-sp-q');
const count = document.getElementById('tr-sp-count');

function esc(s) {
	return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
}

function reviewedLabel(iso) {
	const d = new Date(`${iso}T00:00:00Z`);
	return Number.isNaN(d.getTime()) ? iso : d.toLocaleDateString(undefined, { year: 'numeric', month: 'long', day: 'numeric', timeZone: 'UTC' });
}

function haystack(sp) {
	return [sp.name, sp.purpose, sp.region, ...sp.data].join(' ').toLowerCase();
}

const rows = list.subprocessors.map((sp) => ({ sp, text: haystack(sp) }));

function row(sp) {
	const evidence = sp.evidence
		.map((p) => `<a href="${REPO}${encodeURI(p).replace(/\[/g, '%5B').replace(/\]/g, '%5D')}" target="_blank" rel="noopener">${esc(p)}</a>`)
		.join('');
	return `<tr>
		<td data-label="Subprocessor">${esc(sp.name)}</td>
		<td data-label="Purpose">${esc(sp.purpose)}</td>
		<td data-label="Data"><ul class="tr-sp-data">${sp.data.map((d) => `<li>${esc(d)}</li>`).join('')}</ul></td>
		<td data-label="Region">${esc(sp.region)}</td>
		<td data-label="Proof" class="tr-sp-links">${evidence}<a href="${esc(sp.terms)}" target="_blank" rel="noopener">Provider terms</a></td>
	</tr>`;
}

function group(g, items) {
	return `<section class="tr-section" aria-labelledby="g-${esc(g.id)}">
		<h2 id="g-${esc(g.id)}">${esc(g.title)} <span class="tr-count">${items.length}</span></h2>
		<p>${esc(g.intro)}</p>
		<div class="tr-table-scroll">
			<table class="tr-table tr-sp-table">
				<thead><tr><th scope="col">Subprocessor</th><th scope="col">Purpose</th><th scope="col">Data</th><th scope="col">Region</th><th scope="col">Proof</th></tr></thead>
				<tbody>${items.map(row).join('')}</tbody>
			</table>
		</div>
	</section>`;
}

function render(query) {
	const q = query.trim().toLowerCase();
	const words = q.split(/\s+/).filter(Boolean);
	const shown = rows.filter((r) => words.every((w) => r.text.includes(w))).map((r) => r.sp);
	const total = list.subprocessors.length;
	count.textContent = q ? `${shown.length} of ${total} match` : `${total} subprocessors`;

	if (!shown.length) {
		root.innerHTML = `<div class="tr-section tr-empty">
			<p>No subprocessor matches "${esc(query.trim())}". Try a provider name, a kind of data such as "email", or a region such as "us-central1".</p>
			<button type="button" id="tr-sp-clear">Clear the filter</button>
		</div>`;
		document.getElementById('tr-sp-clear').addEventListener('click', () => {
			input.value = '';
			render('');
			input.focus();
		});
	} else {
		root.innerHTML = list.groups
			.map((g) => [g, shown.filter((sp) => sp.group === g.id)])
			.filter(([, items]) => items.length)
			.map(([g, items]) => group(g, items))
			.join('');
	}
	root.setAttribute('aria-busy', 'false');
}

meta.textContent = `Last reviewed ${reviewedLabel(list.lastReviewed)}. ${list.method}`;

const initial = new URLSearchParams(location.search).get('q') || '';
input.value = initial;
render(initial);

let pending = 0;
input.addEventListener('input', () => {
	cancelAnimationFrame(pending);
	pending = requestAnimationFrame(() => {
		render(input.value);
		const url = new URL(location.href);
		if (input.value.trim()) url.searchParams.set('q', input.value.trim());
		else url.searchParams.delete('q');
		history.replaceState(null, '', url);
	});
});

document.addEventListener('keydown', (e) => {
	if (e.key === '/' && document.activeElement !== input && !/^(INPUT|TEXTAREA|SELECT)$/.test(document.activeElement?.tagName || '')) {
		e.preventDefault();
		input.focus();
	}
});
