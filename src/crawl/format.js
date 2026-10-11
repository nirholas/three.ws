// Small display helpers shared by the /crawl modules.

const compact = new Intl.NumberFormat('en', { notation: 'compact', maximumFractionDigits: 1 });
const whole = new Intl.NumberFormat('en');

export function fmtCount(n) {
	const v = Number(n) || 0;
	return v >= 10_000 ? compact.format(v) : whole.format(v);
}

export function timeAgo(when) {
	const t = typeof when === 'number' ? when : Date.parse(when);
	if (!Number.isFinite(t)) return '';
	const s = Math.max(0, Math.round((Date.now() - t) / 1000));
	if (s < 45) return 'just now';
	const m = Math.round(s / 60);
	if (m < 60) return `${m}m ago`;
	const h = Math.round(m / 60);
	if (h < 24) return `${h}h ago`;
	const d = Math.round(h / 24);
	if (d < 30) return `${d}d ago`;
	return new Date(t).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
}

export function hostOf(url) {
	try { return new URL(url).hostname.replace(/^www\./, ''); } catch { return ''; }
}

// "en.wikipedia.org" + "/wiki/WebGL" split, for a browser-style URL bar.
export function splitUrl(url) {
	try {
		const u = new URL(url);
		const rest = `${u.pathname === '/' ? '' : u.pathname}${u.search}`;
		return { host: u.hostname.replace(/^www\./, ''), rest };
	} catch {
		return { host: String(url || ''), rest: '' };
	}
}

// Build an element tree without innerHTML, so page titles and gists from the
// open web can never inject markup.
export function h(tag, attrs = {}, ...children) {
	const el = document.createElement(tag);
	for (const [k, v] of Object.entries(attrs)) {
		if (v == null || v === false) continue;
		if (k === 'class') el.className = v;
		else if (k === 'text') el.textContent = v;
		else if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2), v);
		else if (k === 'dataset') Object.assign(el.dataset, v);
		else el.setAttribute(k, v === true ? '' : String(v));
	}
	for (const c of children.flat()) {
		if (c == null || c === false) continue;
		el.append(c instanceof Node ? c : document.createTextNode(String(c)));
	}
	return el;
}

// Read an API error body into one readable sentence.
export async function apiError(res) {
	try {
		const body = await res.json();
		return body.error_description || body.message || body.error || `Request failed (${res.status})`;
	} catch {
		return `Request failed (${res.status})`;
	}
}

// Only http(s) links from the corpus become hrefs.
export function safeHref(url) {
	return /^https?:\/\//i.test(String(url || '')) ? url : null;
}
