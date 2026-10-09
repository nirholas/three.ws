// What the crawler reads off a live page. Every function exported here runs
// INSIDE the page via page.evaluate, so each one must be self-contained: no
// closures over module scope, no imports.

// Read the page: title, cleaned main text, and every followable anchor with its
// on-screen rectangle. Anchors get a data-tws-crawl index so the crawler can
// scroll a chosen one into view and re-measure it without a fragile selector.
export function readPage(maxLinks) {
	const vw = window.innerWidth;
	const vh = window.innerHeight;

	const pickRoot = () => {
		const candidates = [...document.querySelectorAll('main, article, [role="main"], #content, #main, .content, .post, .article')];
		let best = null;
		let bestLen = 0;
		for (const el of candidates) {
			const len = (el.innerText || '').length;
			if (len > bestLen) { best = el; bestLen = len; }
		}
		return best && bestLen > 600 ? best : document.body;
	};

	const cleanText = (root) => {
		if (!root) return '';
		const clone = root.cloneNode(true);
		clone.querySelectorAll('script, style, noscript, svg, canvas, iframe, form, nav, footer, header, aside, button, select, [aria-hidden="true"], [hidden]').forEach((n) => n.remove());
		// innerText on a detached clone ignores layout, so fall back to textContent
		// with block elements turned into line breaks.
		clone.querySelectorAll('p, div, li, h1, h2, h3, h4, h5, h6, tr, br, section, article, blockquote, pre').forEach((n) => n.append('\n'));
		return (clone.textContent || '')
			.split('\n')
			.map((l) => l.replace(/\s+/g, ' ').trim())
			.filter((l) => l.length > 1)
			.join('\n');
	};

	const isShown = (el) => {
		const cs = getComputedStyle(el);
		return cs.visibility !== 'hidden' && cs.display !== 'none' && Number(cs.opacity) > 0.05;
	};

	const anchors = [...document.querySelectorAll('a[href]')];
	const links = [];
	for (let i = 0; i < anchors.length && links.length < maxLinks; i++) {
		const a = anchors[i];
		const href = a.href;
		if (!href || !/^https?:/i.test(href)) continue;
		a.setAttribute('data-tws-crawl', String(i));
		const r = a.getBoundingClientRect();
		const sized = r.width >= 6 && r.height >= 6;
		const onScreen = sized && r.bottom > 0 && r.right > 0 && r.top < vh && r.left < vw;
		links.push({
			i,
			href,
			text: (a.innerText || a.getAttribute('aria-label') || a.title || '').replace(/\s+/g, ' ').trim().slice(0, 140),
			visible: onScreen && isShown(a),
			x: r.left / vw,
			y: r.top / vh,
			w: r.width / vw,
			h: r.height / vh,
		});
	}

	const docH = Math.max(document.documentElement.scrollHeight, document.body?.scrollHeight || 0, vh);
	return {
		title: (document.title || document.querySelector('h1')?.innerText || '').replace(/\s+/g, ' ').trim().slice(0, 200),
		lang: document.documentElement.lang || '',
		text: cleanText(pickRoot()).slice(0, 120000),
		links,
		scrollY: docH > vh ? window.scrollY / (docH - vh) : 0,
	};
}

// Bring one anchor to the middle of the screen. Returns false when the anchor
// vanished (single-page apps re-render).
export function revealLink(index) {
	const a = document.querySelector(`a[data-tws-crawl="${index}"]`);
	if (!a) return false;
	a.scrollIntoView({ block: 'center', inline: 'nearest', behavior: 'instant' });
	return true;
}

// Re-measure only what is on screen right now, in the shape the live step
// carries: normalized rects clipped to the viewport.
export function visibleLinks(maxLinks) {
	const vw = window.innerWidth;
	const vh = window.innerHeight;
	const out = [];
	for (const a of document.querySelectorAll('a[data-tws-crawl]')) {
		if (out.length >= maxLinks) break;
		const r = a.getBoundingClientRect();
		if (r.width < 6 || r.height < 6 || r.bottom <= 0 || r.right <= 0 || r.top >= vh || r.left >= vw) continue;
		const cs = getComputedStyle(a);
		if (cs.visibility === 'hidden' || cs.display === 'none' || Number(cs.opacity) <= 0.05) continue;
		const x = Math.max(0, r.left);
		const y = Math.max(0, r.top);
		out.push({
			i: Number(a.getAttribute('data-tws-crawl')),
			href: a.href,
			t: (a.innerText || a.getAttribute('aria-label') || '').replace(/\s+/g, ' ').trim().slice(0, 80),
			x: x / vw,
			y: y / vh,
			w: (Math.min(vw, r.right) - x) / vw,
			h: (Math.min(vh, r.bottom) - y) / vh,
		});
	}
	const docH = Math.max(document.documentElement.scrollHeight, document.body?.scrollHeight || 0, vh);
	return { links: out, scrollY: docH > vh ? window.scrollY / (docH - vh) : 0 };
}

// Consent walls cover the very page viewers came to watch. Hide the common
// vendors' overlays (never click them: the crawler accepts nothing on anyone's
// behalf). Injected as an init script on every document.
export const CONSENT_CSS = [
	'#onetrust-banner-sdk', '#onetrust-consent-sdk', '.onetrust-pc-dark-filter', '#CybotCookiebotDialog',
	'#CybotCookiebotDialogBodyUnderlay', '.fc-consent-root', '.qc-cmp2-container', '#qc-cmp2-container',
	'#truste-consent-track', '.truste_box_overlay', '.cc-window', '.cc-banner', '#cookie-banner', '#cookieBanner',
	'#cookie-notice', '.cookie-notice', '#cookie-consent', '.cookie-consent', '#gdpr-banner', '.gdpr-banner',
	'[id^="sp_message_container"]', '.sp_veil', '#usercentrics-root', '#didomi-host', '.didomi-popup-backdrop',
	'#iubenda-cs-banner', '.osano-cm-window', '#hs-eu-cookie-confirmation',
].join(',') + '{display:none !important;visibility:hidden !important}'
	+ 'html,body{overflow:auto !important}';
