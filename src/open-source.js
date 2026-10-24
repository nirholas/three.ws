// /open-source: lists every direct npm dependency, GPU worker model, and
// asset source three.ws is built on, grouped by area. Data comes from
// GET /api/open-source-credits, itself a static read of
// data/open-source-credits.json generated at build time by
// scripts/build-open-source-credits.mjs (never hand-edited).

const $ = (id) => document.getElementById(id);

const KIND_LABEL = {
	npm: 'Package',
	model: 'Model',
	asset: 'Asset source',
	vendored: 'Vendored',
};

function escapeHtml(s) {
	return String(s).replace(/[&<>"']/g, (c) =>
		({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c],
	);
}

function renderCard(entry) {
	const kindLabel = KIND_LABEL[entry.kind] || entry.kind;
	const links = [];
	if (entry.repo && /^https?:\/\//.test(entry.repo)) {
		links.push(`<a href="${escapeHtml(entry.repo)}" rel="noopener" target="_blank">Source</a>`);
	}
	if (entry.funding) links.push(`<a href="${escapeHtml(entry.funding)}" rel="noopener" target="_blank">Sponsor</a>`);
	return `
		<div class="os-card">
			<div class="name">
				<span>${escapeHtml(entry.name)}${entry.version ? ` <span class="license">v${escapeHtml(entry.version)}</span>` : ''}</span>
				<span class="kind">${escapeHtml(kindLabel)}</span>
			</div>
			<div class="license">${escapeHtml(entry.license)}</div>
			${entry.powers ? `<div class="powers">${escapeHtml(entry.powers)}</div>` : ''}
			${links.length ? `<div class="links">${links.join('')}</div>` : ''}
		</div>
	`;
}

function renderAreas(data) {
	const areasHost = $('areas-host');
	const jump = $('os-jump');
	const byArea = new Map(data.areas.map((a) => [a.id, { ...a, entries: [] }]));
	for (const entry of data.entries) {
		byArea.get(entry.area)?.entries.push(entry);
	}
	const populated = [...byArea.values()].filter((a) => a.entries.length);
	if (!populated.length) {
		$('empty-state').hidden = false;
		return;
	}
	jump.innerHTML = populated
		.map((a) => `<a href="#area-${escapeHtml(a.id)}">${escapeHtml(a.label)}</a>`)
		.join('');
	areasHost.innerHTML = populated
		.map(
			(a) => `
		<section class="os-area" id="area-${escapeHtml(a.id)}" aria-label="${escapeHtml(a.label)}">
			<h2>${escapeHtml(a.label)} <span class="count">(${a.entries.length})</span></h2>
			<div class="os-grid">${a.entries.map(renderCard).join('')}</div>
		</section>
	`,
		)
		.join('');
}

async function load() {
	$('loading-state').hidden = false;
	$('error-state').hidden = true;
	$('empty-state').hidden = true;
	try {
		const res = await fetch('/api/open-source-credits');
		if (!res.ok) throw new Error(`HTTP ${res.status}`);
		const data = await res.json();
		if (!data?.entries?.length) {
			$('loading-state').hidden = true;
			$('empty-state').hidden = false;
			return;
		}
		renderAreas(data);
		$('loading-state').hidden = true;
	} catch (err) {
		$('loading-state').hidden = true;
		$('error-state').hidden = false;
		$('error-msg').textContent = `The credits service did not respond (${err.message}). Nothing else on three.ws is affected.`;
	}
}

$('retry-btn')?.addEventListener('click', load);

load();
