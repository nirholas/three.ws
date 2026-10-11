// /apps/*: behavior shared by the app pages. Copy buttons everywhere, and on
// /apps/desktop the download block, filled from the release feed the desktop
// release pipeline publishes (apps/desktop/cloudbuild.yaml). The feed lists only
// the platforms that have shipped, so the page offers exactly those and says so
// plainly for the rest.

import { pickPrimary, detectPlatform, formatBytes, isUsableRelease, PLATFORM_LABEL } from './forge-desktop-release.js';

const FEED_URL = '/releases/desktop/release.json';

const $ = (sel, root = document) => root.querySelector(sel);

function el(tag, attrs = {}, children = []) {
	const node = document.createElement(tag);
	for (const [k, v] of Object.entries(attrs)) {
		if (v === undefined || v === null || v === false) continue;
		if (k === 'class') node.className = v;
		else if (k === 'text') node.textContent = v;
		else node.setAttribute(k, v === true ? '' : String(v));
	}
	for (const child of [].concat(children)) {
		if (child !== null && child !== undefined) node.append(child);
	}
	return node;
}

let toastTimer = 0;
function toast(message) {
	const t = $('#apToast');
	if (!t) return;
	t.textContent = message;
	t.hidden = false;
	clearTimeout(toastTimer);
	toastTimer = setTimeout(() => {
		t.hidden = true;
	}, 2200);
}

async function copyText(text, label = 'Copied') {
	try {
		await navigator.clipboard.writeText(text);
		toast(label);
	} catch {
		toast('Copy failed. Select the text and copy it by hand.');
	}
}

function wireCopyButtons() {
	for (const btn of document.querySelectorAll('[data-copy]')) {
		btn.addEventListener('click', () => {
			const target = $(btn.dataset.copy);
			if (target) void copyText(target.textContent.trim());
		});
	}
}

// ── Desktop release feed ────────────────────────────────────────────────────

/** @returns {Promise<{ status: 'ok', release: object } | { status: 'unpublished' } | { status: 'error', message: string }>} */
async function loadRelease() {
	let res;
	try {
		res = await fetch(FEED_URL, { headers: { accept: 'application/json' }, cache: 'no-cache' });
	} catch {
		return { status: 'error', message: 'Could not reach three.ws. Check your connection and try again.' };
	}
	if (res.status === 404) return { status: 'unpublished' };
	if (!res.ok) return { status: 'error', message: `The release feed answered ${res.status}. Try again in a moment.` };
	if (!(res.headers.get('content-type') || '').includes('json')) return { status: 'unpublished' };
	try {
		const release = await res.json();
		return isUsableRelease(release) ? { status: 'ok', release } : { status: 'unpublished' };
	} catch {
		return { status: 'error', message: 'The release feed was not valid JSON. Try again in a moment.' };
	}
}

function formatDate(iso) {
	const d = new Date(`${iso}T00:00:00Z`);
	if (Number.isNaN(d.getTime())) return iso;
	return d.toLocaleDateString(undefined, { year: 'numeric', month: 'long', day: 'numeric', timeZone: 'UTC' });
}

function renderError(root, message) {
	const retry = el('button', { type: 'button', class: 'ap-btn', text: 'Try again' });
	retry.addEventListener('click', () => void initDesktop());
	root.replaceChildren(el('div', { class: 'ap-alert', role: 'alert' }, [el('p', { text: message }), retry]));
}

function renderUnpublished(root) {
	root.replaceChildren(
		el('div', { class: 'ap-actions' }, [el('a', { class: 'ap-btn ap-btn--primary', href: '#ap-source', text: 'Run it from source' })]),
		el('p', { class: 'ap-hint' }, [
			el('span', { class: 'ap-pill ap-pill--soon', text: 'Installers coming soon' }),
			' The first installers have not been published yet. Until then the app runs from source in three commands.',
		]),
	);
}

function renderReady(root, release) {
	const platform = detectPlatform(navigator);
	const primary = pickPrimary(release.files, platform);
	const shipped = [...new Set(release.files.map((f) => PLATFORM_LABEL[f.platform]))];
	const actions = el('div', { class: 'ap-actions' });

	if (primary) {
		actions.append(
			el('a', { class: 'ap-btn ap-btn--primary', href: primary.url, download: primary.name }, [
				el('span', { text: `Download for ${PLATFORM_LABEL[primary.platform]}` }),
				el('span', { class: 'ap-btn__meta', text: `${primary.label}, ${formatBytes(primary.size)}` }),
			]),
		);
	}
	actions.append(el('a', { class: 'ap-btn', href: '#ap-downloads', text: primary ? 'Other downloads' : 'Choose a download' }));

	const hint = el('p', { class: 'ap-hint' }, [`Version ${release.version}`, release.date ? `, released ${formatDate(release.date)}` : '', '. ']);
	if (platform === 'mac') hint.append('The macOS build has not shipped yet; this release is for ' + shipped.join(' and ') + '. On a Mac, run it from source below.');
	else if (!primary) hint.append('This release is for ' + shipped.join(' and ') + ', which are computers, not phones. For your phone, pick a platform from the app list.');
	else hint.append('Unsigned build: your OS may ask you to confirm before it opens.');
	root.replaceChildren(actions, hint);

	const rows = $('#apDlRows');
	rows.replaceChildren();
	for (const f of release.files) {
		const hash = el('button', { type: 'button', class: 'ap-hash', title: 'Copy the full SHA-256', 'aria-label': `Copy the SHA-256 of ${f.name}` }, [
			el('code', { text: `${f.sha256.slice(0, 12)}…` }),
		]);
		hash.addEventListener('click', () => void copyText(f.sha256, 'SHA-256 copied'));
		rows.append(
			el('tr', {}, [
				el('td', { text: `${PLATFORM_LABEL[f.platform]} ${f.arch}` }),
				el('td', {}, [el('a', { href: f.url, download: f.name, text: f.label }), f.signed ? null : el('span', { class: 'ap-pill ap-pill--soon', text: 'unsigned' })]),
				el('td', { class: 'ap-num', text: formatBytes(f.size) }),
				el('td', {}, [hash]),
			]),
		);
	}
	$('#apDlMeta').textContent = `three.ws Desktop ${release.version}${release.date ? `, ${formatDate(release.date)}` : ''}`;
	$('#ap-downloads').hidden = false;

	const mins = release.minimumOS;
	if (mins) {
		for (const [key, text] of Object.entries(mins)) {
			const dd = $(`[data-os="${key}"]`);
			if (dd) dd.textContent = text;
		}
	}
}

async function initDesktop() {
	const root = $('#apGet');
	if (!root) return;
	root.replaceChildren(el('span', { class: 'ap-sk ap-sk--btn', 'aria-hidden': 'true' }));
	const result = await loadRelease();
	if (result.status === 'ok') renderReady(root, result.release);
	else if (result.status === 'unpublished') renderUnpublished(root);
	else renderError(root, result.message);
}

wireCopyButtons();
void initDesktop();
