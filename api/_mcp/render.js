// HTML rendering and CSS safety helpers for the render_avatar tool.

function esc(s) {
	return String(s).replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' })[c]);
}

function attr(s) {
	return String(s).replace(
		/[&<>"]/g,
		(c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c],
	);
}

// CSS inputs land inside a <style> declaration (`background: <value>`), where
// HTML attribute-escaping does not defend against `;}body{…}` breakouts. Only
// allow a strict character class that cannot terminate the declaration/rule.
export function safeCssValue(s, fallback) {
	if (!s) return fallback;
	const str = String(s).trim();
	if (!/^[a-zA-Z0-9 .,%#()\-_/+]+$/.test(str)) return fallback;
	if (str.length > 120) return fallback;
	return str;
}

export function safeCssLength(s, fallback) {
	if (!s) return fallback;
	const str = String(s).trim();
	if (!/^[0-9]+(?:\.[0-9]+)?(?:px|em|rem|vh|vw|%)$|^auto$|^100%$/.test(str)) return fallback;
	return str;
}

// Posters are rendered as an attribute value that the browser fetches; restrict
// to https(:) to block `javascript:` and `data:` URLs that could execute code.
export function safeHttpsUrl(s) {
	if (!s) return undefined;
	try {
		const u = new URL(String(s));
		return u.protocol === 'https:' ? u.toString() : undefined;
	} catch {
		return undefined;
	}
}

export function renderModelViewerHtml({ src, name, poster, background, height, width, autoRotate, ar, cameraOrbit }) {
	const attrs = [
		`src="${attr(src)}"`,
		'camera-controls',
		'shadow-intensity="1"',
		'exposure="1"',
		'tone-mapping="aces"',
		autoRotate ? 'auto-rotate' : '',
		ar ? 'ar ar-modes="webxr scene-viewer quick-look"' : '',
		poster ? `poster="${attr(poster)}"` : '',
		cameraOrbit ? `camera-orbit="${attr(cameraOrbit)}"` : '',
		`alt="${attr(name || 'Avatar')}"`,
	]
		.filter(Boolean)
		.join(' ');
	return [
		'<!doctype html>',
		'<html><head><meta charset="utf-8"><title>' + esc(name || 'Avatar') + '</title>',
		'<script type="module" src="https://ajax.googleapis.com/ajax/libs/model-viewer/4.0.0/model-viewer.min.js"></script>',
		'<style>html,body{margin:0;height:100%;background:' + attr(background) + '}',
		'model-viewer{width:' + attr(width) + ';height:' + attr(height) + ';--progress-bar-color:#6a5cff}</style>',
		'</head><body>',
		'<model-viewer ' + attrs + '></model-viewer>',
		'</body></html>',
	].join('\n');
}

export function formatAvatarList(avatars, { public: isPublic = false } = {}) {
	if (!avatars.length) return 'No avatars found.';
	return avatars
		.map((a) => {
			const url = a.model_url ? ` — ${a.model_url}` : '';
			const vis = isPublic ? '' : ` [${a.visibility}]`;
			return `• ${a.name} (slug: ${a.slug}, id: ${a.id})${vis}${url}`;
		})
		.join('\n');
}
