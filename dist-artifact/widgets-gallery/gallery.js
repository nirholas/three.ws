// Widget gallery — native DOM, no framework. Renders showcase cards from
// /widgets-gallery/showcase.json with a real iframe and a copy-paste snippet
// per widget. If a showcase id isn't a real widget yet, the iframe shows the
// /w/<id> fallback page; the copy snippet still works once the id is filled in.

const GRID_EL = document.getElementById('gallery-grid');

const ORIGIN = location.origin;

(async function init() {
	let showcase;
	try {
		const res = await fetch('/widgets-gallery/showcase.json', { cache: 'no-cache' });
		if (!res.ok) throw new Error(`showcase.json ${res.status}`);
		showcase = await res.json();
	} catch (err) {
		GRID_EL.innerHTML = '';
		GRID_EL.appendChild(errorEl('Could not load showcase config.', err.message));
		GRID_EL.removeAttribute('aria-busy');
		return;
	}

	GRID_EL.innerHTML = '';
	for (const w of showcase.widgets || []) {
		GRID_EL.appendChild(renderShowcase(w));
	}
	GRID_EL.removeAttribute('aria-busy');
})();

function renderShowcase(w) {
	const root = document.createElement('article');
	root.className = 'showcase';
	root.setAttribute('aria-labelledby', `sc-${w.id}-title`);

	const widgetUrl = `${ORIGIN}/#widget=${encodeURIComponent(w.id)}&kiosk=true`;
	const pageUrl   = `${ORIGIN}/w/${encodeURIComponent(w.id)}`;
	const snippet   = `<iframe src="${widgetUrl}" width="${w.width}" height="${w.height}" style="border:0;border-radius:12px;max-width:100%" allow="autoplay; xr-spatial-tracking; clipboard-write" loading="lazy"></iframe>`;

	const frame = document.createElement('div');
	frame.className = 'showcase-frame';
	frame.style.aspectRatio = `${w.width} / ${w.height}`;

	const iframe = document.createElement('iframe');
	iframe.src = widgetUrl;
	iframe.title = `${w.label} demo`;
	iframe.loading = 'lazy';
	iframe.allow = 'autoplay; xr-spatial-tracking; clipboard-write';
	frame.appendChild(iframe);

	const meta = document.createElement('div');
	meta.className = 'showcase-meta';

	const tag = document.createElement('span');
	tag.className = 'type-tag';
	tag.textContent = w.type;
	meta.appendChild(tag);

	const h = document.createElement('h3');
	h.id = `sc-${w.id}-title`;
	h.textContent = w.label;
	meta.appendChild(h);

	const desc = document.createElement('p');
	desc.textContent = w.tagline;
	meta.appendChild(desc);

	const code = document.createElement('pre');
	code.className = 'snippet';
	code.setAttribute('aria-label', 'Embed snippet');
	const codeInner = document.createElement('code');
	codeInner.textContent = snippet;
	code.appendChild(codeInner);
	meta.appendChild(code);

	const row = document.createElement('div');
	row.className = 'snippet-row';

	const copyBtn = document.createElement('button');
	copyBtn.type = 'button';
	copyBtn.textContent = 'Copy iframe';
	copyBtn.setAttribute('aria-label', `Copy embed snippet for ${w.label}`);
	copyBtn.addEventListener('click', () => copy(snippet, copyBtn));
	row.appendChild(copyBtn);

	const copyUrlBtn = document.createElement('button');
	copyUrlBtn.type = 'button';
	copyUrlBtn.textContent = 'Copy URL';
	copyUrlBtn.setAttribute('aria-label', `Copy shareable URL for ${w.label}`);
	copyUrlBtn.addEventListener('click', () => copy(pageUrl, copyUrlBtn));
	row.appendChild(copyUrlBtn);

	const studio = document.createElement('a');
	studio.href = `/studio?template=${encodeURIComponent(w.id)}`;
	studio.textContent = 'Open in Studio';
	studio.setAttribute('aria-label', `Clone ${w.label} into the Studio`);
	row.appendChild(studio);

	meta.appendChild(row);

	root.appendChild(frame);
	root.appendChild(meta);
	return root;
}

async function copy(text, btn) {
	try {
		await navigator.clipboard.writeText(text);
	} catch {
		// Fallback for old browsers
		const ta = document.createElement('textarea');
		ta.value = text;
		ta.style.position = 'fixed';
		ta.style.opacity = '0';
		document.body.appendChild(ta);
		ta.select();
		try { document.execCommand('copy'); } catch {}
		ta.remove();
	}
	const orig = btn.textContent;
	btn.classList.add('copied');
	btn.textContent = 'Copied!';
	setTimeout(() => {
		btn.textContent = orig;
		btn.classList.remove('copied');
	}, 1400);
}

function errorEl(msg, detail) {
	const e = document.createElement('div');
	e.className = 'error-state';
	e.textContent = detail ? `${msg} (${detail})` : msg;
	return e;
}
