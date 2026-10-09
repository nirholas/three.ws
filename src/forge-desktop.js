// /forge-desktop: the three.ws Forge download page. Reads the release feed the
// Forge release pipeline publishes (apps/forge-desktop/cloudbuild.yaml and
// scripts/release-mac.sh) and offers the build for the visitor's OS, every
// other build with its size and SHA-256, and the release notes. Until the first
// release is published the feed 404s and the page leads with running from source.

import { pickPrimary, detectPlatform, formatBytes, isUsableRelease, PLATFORM_LABEL } from './forge-desktop-release.js';

const FEED_URL = '/releases/forge/release.json';

const SHOTS = {
	generate: {
		src: '/forge-desktop/forge-generate.webp',
		alt: 'three.ws Forge with an armchair from the CC0 library open in the 3D viewport',
		caption: 'The viewport, with Import, Export, Publish, Smooth and Decimate on the toolbar.',
	},
	library: {
		src: '/forge-desktop/forge-library.webp',
		alt: 'The three.ws library popover searching for chairs, showing a grid of thumbnails',
		caption: 'Import, then three.ws library: search the free CC0 models and open one in a click.',
	},
	publish: {
		src: '/forge-desktop/forge-publish.webp',
		alt: 'The Publish to three.ws popover asking the user to sign in',
		caption: 'Publish sends the open model to your three.ws account as a shareable 3D page.',
	},
	settings: {
		src: '/forge-desktop/forge-settings.webp',
		alt: 'Settings, three.ws section, offering browser sign-in or an API key',
		caption: 'Settings, then three.ws: sign in through your browser, or paste an API key on managed machines.',
	},
};

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
	const t = $('#fdToast');
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

// ── Release feed ────────────────────────────────────────────────────────────

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
	const type = res.headers.get('content-type') || '';
	if (!type.includes('json')) return { status: 'unpublished' };
	try {
		const release = await res.json();
		if (!isUsableRelease(release)) return { status: 'unpublished' };
		return { status: 'ok', release };
	} catch {
		return { status: 'error', message: 'The release feed was not valid JSON. Try again in a moment.' };
	}
}

function renderLoading(root) {
	root.dataset.state = 'loading';
	root.replaceChildren(
		el('div', { class: 'fd-get__skeleton', 'aria-hidden': 'true' }, [el('span', { class: 'fd-sk fd-sk--btn' }), el('span', { class: 'fd-sk fd-sk--line' })]),
	);
}

function renderError(root, message) {
	root.dataset.state = 'error';
	const retry = el('button', { type: 'button', class: 'fd-btn', text: 'Try again' });
	retry.addEventListener('click', () => void init());
	root.replaceChildren(
		el('div', { class: 'fd-alert', role: 'alert' }, [el('p', { text: message }), retry]),
	);
}

function renderUnpublished(root) {
	root.dataset.state = 'unpublished';
	const src = el('a', { class: 'fd-btn fd-btn--primary', href: '#fd-source', text: 'Run it from source' });
	const repo = el('a', {
		class: 'fd-btn',
		href: 'https://github.com/nirholas/three.ws/tree/main/apps/forge-desktop',
		rel: 'noopener',
		target: '_blank',
		text: 'View the source',
	});
	root.replaceChildren(
		el('div', { class: 'fd-get__actions' }, [src, repo]),
		el('p', { class: 'fd-get__hint' }, [
			el('span', { class: 'fd-pill', text: 'Installers coming soon' }),
			' Signed installers for Windows, macOS and Linux will be listed here when the first release ships. Until then, Forge runs from source in five commands.',
		]),
	);
}

function renderReady(root, release) {
	root.dataset.state = 'ready';
	const platform = detectPlatform(navigator);
	const primary = pickPrimary(release.files, platform);
	const actions = el('div', { class: 'fd-get__actions' });

	if (primary) {
		actions.append(
			el('a', { class: 'fd-btn fd-btn--primary fd-btn--lg', href: primary.url, download: primary.name }, [
				el('span', { text: `Download for ${PLATFORM_LABEL[primary.platform]}` }),
				el('span', { class: 'fd-btn__meta', text: `${primary.label}, ${formatBytes(primary.size)}` }),
			]),
		);
	}
	actions.append(el('a', { class: 'fd-btn', href: '#fd-downloads', text: primary ? 'Other platforms' : 'Choose a download' }));

	const hint = el('p', { class: 'fd-get__hint' }, [`Version ${release.version}`, release.date ? `, released ${formatDate(release.date)}` : '', '.']);
	if (platform === 'mac') hint.append(' Apple silicon Macs only.');
	if (!primary && platform === 'other') hint.append(' Forge runs on Windows, macOS and Linux computers.');
	root.replaceChildren(actions, hint);
	renderDownloads(release);
}

function formatDate(iso) {
	const d = new Date(`${iso}T00:00:00Z`);
	if (Number.isNaN(d.getTime())) return iso;
	return d.toLocaleDateString(undefined, { year: 'numeric', month: 'long', day: 'numeric', timeZone: 'UTC' });
}

function renderDownloads(release) {
	const section = $('#fd-downloads');
	const rows = $('#fdDlRows');
	rows.replaceChildren();
	for (const f of release.files) {
		const hash = el('button', { type: 'button', class: 'fd-hash', title: 'Copy the full SHA-256', 'aria-label': `Copy the SHA-256 of ${f.name}` }, [
			el('code', { text: `${f.sha256.slice(0, 12)}…` }),
		]);
		hash.addEventListener('click', () => void copyText(f.sha256, 'SHA-256 copied'));
		rows.append(
			el('tr', {}, [
				el('td', {}, [
					el('span', { class: 'fd-plat', text: PLATFORM_LABEL[f.platform] || f.platform }),
					el('span', { class: 'fd-muted fd-small', text: ` ${f.arch}` }),
				]),
				el('td', {}, [
					el('a', { href: f.url, download: f.name, text: f.label }),
					f.signed ? null : el('span', { class: 'fd-pill fd-pill--warn', text: 'unsigned' }),
				]),
				el('td', { class: 'fd-num', text: formatBytes(f.size) }),
				el('td', {}, [hash]),
			]),
		);
	}
	$('#fdDlMeta').textContent = `three.ws Forge ${release.version}${release.date ? `, ${formatDate(release.date)}` : ''}`;

	const notes = $('#fdNotes');
	notes.replaceChildren();
	for (const n of release.notes || []) {
		notes.append(el('article', { class: 'fd-note' }, [el('h3', { class: 'fd-h3', text: n.title }), el('p', { text: n.summary })]));
	}

	renderUnsignedHelp(release.files);
	section.hidden = false;
}

function renderUnsignedHelp(files) {
	const unsigned = new Set(files.filter((f) => !f.signed).map((f) => f.platform));
	const details = $('#fdUnsigned');
	const body = $('#fdUnsignedBody');
	body.replaceChildren();
	if (unsigned.has('mac')) {
		body.append(
			el('h3', { class: 'fd-h3', text: 'macOS' }),
			el('p', { text: 'Open the .dmg and drag three.ws Forge to Applications. The first time you open it, macOS says it cannot verify the developer: open System Settings, then Privacy & Security, scroll to the message about three.ws Forge and choose Open Anyway.' }),
		);
	}
	if (unsigned.has('win')) {
		body.append(
			el('h3', { class: 'fd-h3', text: 'Windows' }),
			el('p', { text: 'If SmartScreen shows "Windows protected your PC", choose More info, then Run anyway. Compare the file\'s SHA-256 with the one on this page first: in PowerShell, Get-FileHash <file>.' }),
		);
	}
	if (unsigned.has('linux')) {
		body.append(
			el('h3', { class: 'fd-h3', text: 'Linux' }),
			el('p', { text: 'Make the AppImage executable with chmod +x and run it, or install the .deb with sudo apt install ./<file>.deb. Check the download first with sha256sum.' }),
		);
	}
	details.hidden = unsigned.size === 0;
}

// ── Screens ─────────────────────────────────────────────────────────────────

function initShots() {
	const tabs = [...document.querySelectorAll('.fd-tab')];
	const panel = $('#fdShotImg');
	const img = $('img', panel);
	const caption = $('#fdShotCaption');

	// Warm the cache so switching tabs never flashes an empty frame.
	for (const s of Object.values(SHOTS)) {
		const pre = new Image();
		pre.decoding = 'async';
		pre.src = s.src;
	}

	function select(tab, focus = false) {
		const shot = SHOTS[tab.dataset.shot];
		for (const t of tabs) {
			const on = t === tab;
			t.setAttribute('aria-selected', String(on));
			t.tabIndex = on ? 0 : -1;
		}
		panel.setAttribute('aria-labelledby', tab.id);
		panel.classList.add('is-swapping');
		img.onload = () => panel.classList.remove('is-swapping');
		img.src = shot.src;
		img.alt = shot.alt;
		caption.textContent = shot.caption;
		if (img.complete) panel.classList.remove('is-swapping');
		if (focus) tab.focus();
	}

	tabs.forEach((tab, i) => {
		tab.addEventListener('click', () => select(tab));
		tab.addEventListener('keydown', (e) => {
			let next = -1;
			if (e.key === 'ArrowRight') next = (i + 1) % tabs.length;
			else if (e.key === 'ArrowLeft') next = (i - 1 + tabs.length) % tabs.length;
			else if (e.key === 'Home') next = 0;
			else if (e.key === 'End') next = tabs.length - 1;
			if (next < 0) return;
			e.preventDefault();
			select(tabs[next], true);
		});
	});
}

function initCopy() {
	for (const btn of document.querySelectorAll('[data-copy]')) {
		btn.addEventListener('click', () => {
			const target = $(btn.dataset.copy);
			if (target) void copyText(target.textContent.trim(), 'Commands copied');
		});
	}
}

async function init() {
	const root = $('#fdGet');
	renderLoading(root);
	const result = await loadRelease();
	if (result.status === 'ok') renderReady(root, result.release);
	else if (result.status === 'unpublished') renderUnpublished(root);
	else renderError(root, result.message);
}

initShots();
initCopy();
void init();
