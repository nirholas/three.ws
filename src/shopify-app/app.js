// Embedded admin UI for the "Photo to 3D product media" Shopify app.
//
// App Bridge is loaded via Shopify's CDN script in pages/shopify-app.html
// (the current documented, framework-agnostic embedding path, no
// @shopify/app-bridge npm package, consistent with this repo building
// directly against Shopify's documented contracts rather than its React/Remix
// SDKs). That script attaches a global `window.shopify` with `idToken()`,
// which this module calls before every API request: embedded apps are
// required to authenticate via session tokens, not cookies.

const POLL_MS = 3_000;
const POLL_TIMEOUT_MS = 10 * 60 * 1000;
const BULK_CONCURRENCY = 3;

const els = {
	billingBanner: document.getElementById('sa-billing-banner'),
	billingActivate: document.getElementById('sa-billing-activate'),
	errorBanner: document.getElementById('sa-error-banner'),
	errorText: document.getElementById('sa-error-text'),
	errorRetry: document.getElementById('sa-error-retry'),
	boot: document.getElementById('sa-boot'),
	main: document.getElementById('sa-main'),
	selectAll: document.getElementById('sa-select-all'),
	selectCount: document.getElementById('sa-select-count'),
	bulkGenerate: document.getElementById('sa-bulk-generate'),
	empty: document.getElementById('sa-empty'),
	grid: document.getElementById('sa-grid'),
	loadMore: document.getElementById('sa-loadmore'),
	loadMoreBtn: document.getElementById('sa-loadmore-btn'),
};

/** @type {Map<string, { product: object, job: { status: string, jobId: string|null, glbUrl: string|null, error: string|null }, selected: boolean }>} */
const cards = new Map();
let pageInfo = { hasNextPage: false, endCursor: null };

function show(el) {
	if (el) el.hidden = false;
}
function hide(el) {
	if (el) el.hidden = true;
}

async function getSessionToken() {
	const deadline = Date.now() + 5_000;
	while (!window.shopify?.idToken) {
		if (Date.now() > deadline) {
			throw new Error('App Bridge did not load. Open this app from inside your Shopify admin.');
		}
		await new Promise((r) => setTimeout(r, 100));
	}
	return window.shopify.idToken();
}

async function api(path, opts = {}) {
	const token = await getSessionToken();
	const res = await fetch(path, {
		...opts,
		headers: {
			...(opts.body ? { 'content-type': 'application/json' } : {}),
			authorization: `Bearer ${token}`,
			...(opts.headers || {}),
		},
	});
	const data = await res.json().catch(() => ({}));
	if (!res.ok) {
		throw new Error(data?.error_description || data?.message || `request failed (${res.status})`);
	}
	return data;
}

function fatalError(message, onRetry) {
	els.errorText.textContent = message;
	show(els.errorBanner);
	els.errorRetry.onclick = () => {
		hide(els.errorBanner);
		onRetry();
	};
}

function productImageUrl(product) {
	return product.images?.[0]?.url || null;
}

function renderCardMedia(entry) {
	const { product, job } = entry;
	if (job.status === 'ready_to_attach' || job.status === 'attaching') {
		return `<model-viewer src="${job.glbUrl}" camera-controls auto-rotate shadow-intensity="1" style="width:100%;height:100%;background:#000;" alt="Generated 3D model preview"></model-viewer>`;
	}
	const img = productImageUrl(product);
	return img
		? `<img src="${img}" alt="" loading="lazy" />`
		: `<span style="color:var(--dim);font-size:12px;">No image</span>`;
}

function statusLabel(job) {
	switch (job.status) {
		case 'idle':
			return '';
		case 'generating':
			return 'Generating 3D model...';
		case 'ready_to_attach':
			return 'Ready to preview above.';
		case 'attaching':
			return 'Attaching to product...';
		case 'attached':
			return 'Attached.';
		case 'failed':
			return job.error ? `Failed: ${job.error}` : 'Generation failed.';
		default:
			return '';
	}
}

function renderCardActions(entry) {
	const { product, job } = entry;
	if (product.has3dModel && job.status === 'idle') {
		return '';
	}
	if (job.status === 'idle' || job.status === 'failed') {
		return `<button class="sa-btn sa-btn--sm sa-act-generate" type="button">${job.status === 'failed' ? 'Retry' : 'Generate 3D model'}</button>`;
	}
	if (job.status === 'generating' || job.status === 'attaching') {
		return `<button class="sa-btn sa-btn--sm sa-btn--ghost" type="button" disabled>Working...</button>`;
	}
	if (job.status === 'ready_to_attach') {
		return `<button class="sa-btn sa-btn--sm sa-act-attach" type="button">Attach to product</button>`;
	}
	return '';
}

function renderCard(entry) {
	const { product, job, selected } = entry;
	const el = document.createElement('div');
	el.className = 'sa-card';
	el.setAttribute('role', 'listitem');
	el.dataset.productId = product.id;
	const canSelect = !product.has3dModel && job.status === 'idle';
	el.innerHTML = `
		<div class="sa-card-select">
			${canSelect ? `<label class="sa-sr-only" for="sel-${product.id}">Select ${product.title}</label><input id="sel-${product.id}" type="checkbox" class="sa-card-checkbox" ${selected ? 'checked' : ''} />` : ''}
		</div>
		<div class="sa-card-media">
			${renderCardMedia(entry)}
			${product.has3dModel ? '<span class="sa-card-badge">3D</span>' : ''}
		</div>
		<div class="sa-card-body">
			<p class="sa-card-title" title="${escapeAttr(product.title)}">${escapeHtml(product.title)}</p>
			<p class="sa-card-status ${job.status === 'failed' ? 'sa-card-status--failed' : ''} ${job.status === 'attached' ? 'sa-card-status--ready' : ''}">${escapeHtml(statusLabel(job))}</p>
			<div class="sa-card-actions">${renderCardActions(entry)}</div>
		</div>
	`;

	const checkbox = el.querySelector('.sa-card-checkbox');
	if (checkbox) {
		checkbox.addEventListener('change', () => {
			entry.selected = checkbox.checked;
			updateBulkBar();
		});
	}
	const genBtn = el.querySelector('.sa-act-generate');
	if (genBtn) genBtn.addEventListener('click', () => startGeneration(entry, { bulk: false }));
	const attachBtn = el.querySelector('.sa-act-attach');
	if (attachBtn) attachBtn.addEventListener('click', () => attachJob(entry));

	return el;
}

function escapeHtml(s) {
	return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
function escapeAttr(s) {
	return escapeHtml(s).replace(/`/g, '&#96;');
}

function renderGrid() {
	els.grid.innerHTML = '';
	for (const entry of cards.values()) {
		els.grid.appendChild(renderCard(entry));
	}
	hide(els.empty);
	if (cards.size === 0) show(els.empty);
	els.loadMore.hidden = !pageInfo.hasNextPage;
	updateBulkBar();
}

function updateBulkBar() {
	const selectable = [...cards.values()].filter((e) => !e.product.has3dModel && e.job.status === 'idle');
	const selected = selectable.filter((e) => e.selected);
	els.selectCount.textContent = selected.length ? `${selected.length} selected` : '';
	els.bulkGenerate.disabled = selected.length === 0;
	els.selectAll.disabled = selectable.length === 0;
	els.selectAll.checked = selectable.length > 0 && selected.length === selectable.length;
}

async function loadProducts(after = null) {
	const qs = after ? `?after=${encodeURIComponent(after)}` : '';
	const data = await api(`/api/shopify/products${qs}`);
	for (const product of data.products) {
		if (!cards.has(product.id)) {
			cards.set(product.id, { product, job: { status: 'idle', jobId: null, glbUrl: null, error: null }, selected: false });
		}
	}
	pageInfo = data.pageInfo;
	renderGrid();
}

function updateCard(entry) {
	const node = renderCard(entry);
	const existing = els.grid.querySelector(`[data-product-id="${cssEscape(entry.product.id)}"]`);
	if (existing) existing.replaceWith(node);
	else renderGrid();
	updateBulkBar();
}

function cssEscape(s) {
	return window.CSS?.escape ? CSS.escape(s) : String(s).replace(/["\\]/g, '\\$&');
}

async function pollStatus(entry, { bulk }) {
	const deadline = Date.now() + POLL_TIMEOUT_MS;
	while (Date.now() < deadline) {
		let data;
		try {
			data = await api(`/api/shopify/media/status?job=${encodeURIComponent(entry.job.jobId)}`);
		} catch (err) {
			entry.job = { ...entry.job, status: 'failed', error: err.message };
			updateCard(entry);
			return;
		}
		entry.job = { ...entry.job, status: data.status, glbUrl: data.glbUrl || entry.job.glbUrl, error: data.error };
		updateCard(entry);
		if (data.status === 'ready_to_attach') {
			if (bulk) await attachJob(entry);
			return;
		}
		if (data.status === 'failed') return;
		await new Promise((r) => setTimeout(r, POLL_MS));
	}
	entry.job = { ...entry.job, status: 'failed', error: 'generation timed out' };
	updateCard(entry);
}

async function startGeneration(entry, { bulk }) {
	entry.selected = false;
	entry.job = { status: 'generating', jobId: null, glbUrl: null, error: null };
	updateCard(entry);
	try {
		const imageUrl = productImageUrl(entry.product);
		if (!imageUrl) throw new Error('this product has no image to generate from');
		const data = await api('/api/shopify/media/create', {
			method: 'POST',
			body: JSON.stringify({ productId: entry.product.id, productTitle: entry.product.title, imageUrl }),
		});
		entry.job.jobId = data.jobId;
		updateCard(entry);
		await pollStatus(entry, { bulk });
	} catch (err) {
		entry.job = { ...entry.job, status: 'failed', error: err.message };
		updateCard(entry);
	}
}

async function attachJob(entry) {
	entry.job = { ...entry.job, status: 'attaching' };
	updateCard(entry);
	try {
		await api('/api/shopify/media/attach', { method: 'POST', body: JSON.stringify({ jobId: entry.job.jobId }) });
		entry.product.has3dModel = true;
		entry.job = { ...entry.job, status: 'attached' };
	} catch (err) {
		entry.job = { ...entry.job, status: 'failed', error: err.message };
	}
	updateCard(entry);
}

async function runBulk() {
	const selected = [...cards.values()].filter((e) => e.selected);
	els.bulkGenerate.disabled = true;
	let i = 0;
	async function worker() {
		while (i < selected.length) {
			const entry = selected[i++];
			await startGeneration(entry, { bulk: true });
		}
	}
	await Promise.all(Array.from({ length: Math.min(BULK_CONCURRENCY, selected.length) }, worker));
	updateBulkBar();
}

async function loadBillingBanner() {
	const data = await api('/api/shopify/billing/status');
	if (data.status === 'active') {
		hide(els.billingBanner);
	} else {
		show(els.billingBanner);
	}
}

async function activateBilling() {
	els.billingActivate.disabled = true;
	els.billingActivate.textContent = 'Opening Shopify...';
	try {
		const data = await api('/api/shopify/billing/activate', { method: 'POST', body: '{}' });
		window.open(data.confirmationUrl, '_top');
	} catch (err) {
		els.billingActivate.disabled = false;
		els.billingActivate.textContent = 'Activate billing';
		fatalError(err.message, boot);
	}
}

els.selectAll.addEventListener('change', () => {
	for (const entry of cards.values()) {
		if (!entry.product.has3dModel && entry.job.status === 'idle') entry.selected = els.selectAll.checked;
	}
	renderGrid();
});
els.bulkGenerate.addEventListener('click', runBulk);
els.billingActivate.addEventListener('click', activateBilling);
els.loadMoreBtn.addEventListener('click', () => loadProducts(pageInfo.endCursor));

async function boot() {
	hide(els.errorBanner);
	show(els.boot);
	hide(els.main);
	try {
		await Promise.all([loadBillingBanner(), loadProducts()]);
		hide(els.boot);
		show(els.main);
	} catch (err) {
		hide(els.boot);
		fatalError(err.message, boot);
	}
}

boot();
