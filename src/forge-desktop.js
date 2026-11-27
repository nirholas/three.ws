// /forge-desktop: the three.ws Forge download page. Reads the release feed the
// Forge release pipeline publishes (apps/forge-desktop/cloudbuild.yaml and
// scripts/release-mac.sh) and offers the build for the visitor's OS, every
// other build with its size, full SHA-256 and signing state, and the release
// notes. A platform the release has no build for is said plainly, with running
// from source as the way in. Until a release is published the feed 404s and
// the page leads with running from source.

import { detectPlatform, formatBytes, pickPrimary, planDownloads, readReleaseFeed, signingSummary, PLATFORM_LABEL } from './forge-desktop-release.js';

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

/** Where new builds are announced: every release gets a changelog entry. */
function followLine() {
	return el('p', { class: 'fd-follow' }, [
		'New builds are announced on the ',
		el('a', { href: '/changelog', text: 'changelog' }),
		' and its ',
		el('a', { href: '/changelog.xml', type: 'application/rss+xml', text: 'RSS feed' }),
		'.',
	]);
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
	const src = el('a', { class: 'fd-btn', href: '#fd-source', text: 'Run it from source' });
	root.replaceChildren(
		el('div', { class: 'fd-alert', role: 'alert' }, [
			el('p', { class: 'fd-alert__title', text: 'The download list did not load.' }),
			el('p', { text: message }),
			el('div', { class: 'fd-get__actions' }, [retry, src]),
		]),
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
			el('span', { class: 'fd-pill', text: 'Not released yet' }),
			' No installer has been published yet. Forge runs from source today, in five commands.',
		]),
		followLine(),
	);
}

function downloadButton(file, { big = false } = {}) {
	return el('a', { class: `fd-btn${big ? ' fd-btn--primary fd-btn--lg' : ''}`, href: file.url, download: file.name }, [
		el('span', { text: `Download for ${PLATFORM_LABEL[file.platform]}` }),
		el('span', { class: 'fd-btn__meta', text: `${file.label}, ${formatBytes(file.size)}` }),
	]);
}

function renderReady(root, release) {
	root.dataset.state = 'ready';
	const platform = detectPlatform(navigator);
	const plan = planDownloads(release, platform);
	const actions = el('div', { class: 'fd-get__actions' });

	if (plan.primary) {
		actions.append(downloadButton(plan.primary, { big: true }));
		actions.append(el('a', { class: 'fd-btn', href: '#fd-downloads', text: 'All downloads' }));
	} else if (plan.missingForVisitor) {
		root.dataset.state = 'missing';
		actions.append(el('a', { class: 'fd-btn fd-btn--primary fd-btn--lg', href: '#fd-source', text: `Run it from source on ${PLATFORM_LABEL[platform]}` }));
		for (const p of plan.available) actions.append(downloadButton(pickPrimary(release.files, p)));
	} else {
		actions.append(el('a', { class: 'fd-btn fd-btn--primary', href: '#fd-downloads', text: 'See the downloads' }));
	}

	const hint = el('p', { class: 'fd-get__hint' }, [`Version ${release.version}`, release.date ? `, released ${formatDate(release.date)}` : '', '. ', plan.note]);
	const signing = signingSummary(release.files);
	if (signing.state !== 'all') {
		const how = el('a', { href: '#fdUnsigned', text: 'How to open an unsigned build' });
		how.addEventListener('click', () => {
			$('#fdUnsigned').open = true;
		});
		hint.append(' ', el('span', { class: 'fd-pill fd-pill--warn', text: 'Not code-signed' }), ' ', how, '.');
	}
	root.replaceChildren(actions, hint, followLine());
	if (plan.available.includes('mac')) {
		$('#fdReqMac').textContent = 'macOS 12 Monterey or later on an Apple silicon Mac (M1 or later).';
	}
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
		const copy = el('button', { type: 'button', class: 'fd-btn fd-btn--sm fd-hash__copy', 'aria-label': `Copy the SHA-256 of ${f.name}`, text: 'Copy' });
		copy.addEventListener('click', () => void copyText(f.sha256, 'SHA-256 copied'));
		const hash = el('div', { class: 'fd-hash' }, [el('code', { class: 'fd-hash__value', text: f.sha256.toLowerCase() }), copy]);
		rows.append(
			el('tr', {}, [
				el('td', {}, [
					el('span', { class: 'fd-plat', text: PLATFORM_LABEL[f.platform] || f.platform }),
					el('span', { class: 'fd-muted fd-small', text: ` ${f.arch}` }),
				]),
				el('td', {}, [
					el('a', { href: f.url, download: f.name, text: f.label }),
					el('span', { class: `fd-pill${f.signed ? ' fd-pill--ok' : ' fd-pill--warn'}`, text: f.signed ? 'signed' : 'unsigned' }),
					el('span', { class: 'fd-muted fd-small fd-file', text: f.name }),
				]),
				el('td', { class: 'fd-num', text: formatBytes(f.size) }),
				el('td', {}, [hash]),
			]),
		);
	}
	$('#fdDlMeta').textContent = `three.ws Forge ${release.version}${release.date ? `, ${formatDate(release.date)}` : ''}`;
	const signing = signingSummary(release.files);
	const signingEl = $('#fdSigning');
	signingEl.textContent = signing.text;
	signingEl.dataset.state = signing.state;

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
			el('p', { text: 'Check the download first with sha256sum <file> and compare it with the SHA-256 on this page. Then make the AppImage executable with chmod +x and run it, or install the .deb with sudo apt install ./<file>.deb.' }),
			el('p', { text: 'If the AppImage does not start on Ubuntu 22.04 or later, install FUSE 2 first: sudo apt install libfuse2 (libfuse2t64 on Ubuntu 24.04), or use the .deb instead.' }),
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
	const result = await readReleaseFeed(fetch, FEED_URL);
	if (result.status === 'ok') renderReady(root, result.release);
	else if (result.status === 'unpublished') renderUnpublished(root);
	else renderError(root, result.message);
}

initShots();
initCopy();
void init();
