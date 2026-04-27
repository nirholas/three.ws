// 3D Agent — script-tag embed.
// <script async src="https://3dagent.vercel.app/embed.js" data-widget="wdgt_..."></script>
//
// Injects a sandboxed iframe at the script tag's location, sized via data-*
// attributes (or the type's default), then forwards widget:resize events from
// the iframe to keep the host layout snug.
//
// Zero deps, plain DOM. Intentionally tiny — gets minified/cached at the edge.

(function () {
	'use strict';

	var TYPE_SIZES = {
		'turntable':         [600, 600],
		'animation-gallery': [720, 720],
		'talking-agent':     [420, 600],
		'passport':          [480, 560],
		'hotspot-tour':      [800, 600],
	};

	var ORIGIN = (function () {
		try { return new URL(document.currentScript.src).origin; }
		catch (e) { return 'https://3dagent.vercel.app'; }
	})();

	function attr(el, name, fallback) {
		var v = el && el.getAttribute && el.getAttribute(name);
		return v != null && v !== '' ? v : fallback;
	}

	function mount(scriptEl) {
		var widgetId = attr(scriptEl, 'data-widget', null);
		if (!widgetId) {
			console.warn('[3d-agent embed] missing data-widget attribute');
			return;
		}
		var type     = attr(scriptEl, 'data-type', null);
		var defaults = (type && TYPE_SIZES[type]) || [600, 600];
		var width    = attr(scriptEl, 'data-width',  String(defaults[0]));
		var height   = attr(scriptEl, 'data-height', String(defaults[1]));
		var radius   = attr(scriptEl, 'data-radius', '12');
		var border   = attr(scriptEl, 'data-border', '0');

		var src = ORIGIN + '/app#widget=' + encodeURIComponent(widgetId) + '&kiosk=true';

		var iframe = document.createElement('iframe');
		iframe.src = src;
		iframe.title = '3D Agent widget ' + widgetId;
		iframe.loading = 'lazy';
		iframe.allow = 'autoplay; xr-spatial-tracking; clipboard-write';
		iframe.setAttribute('width',  width);
		iframe.setAttribute('height', height);
		iframe.style.border       = border + 'px solid transparent';
		iframe.style.borderRadius = radius + 'px';
		iframe.style.maxWidth     = '100%';
		iframe.style.display      = 'block';

		var anchor = scriptEl.parentNode;
		if (!anchor) return;
		anchor.insertBefore(iframe, scriptEl);

		// Optional: auto-resize when the widget reports a preferred size.
		window.addEventListener('message', function (e) {
			if (e.origin !== ORIGIN) return;
			if (!e.data || e.data.type !== 'widget:resize') return;
			if (e.data.id && e.data.id !== widgetId) return;
			if (e.data.width)  iframe.setAttribute('width',  String(e.data.width));
			if (e.data.height) iframe.setAttribute('height', String(e.data.height));
		});
	}

	// Mount every <script data-widget="..."> on the page (allows multiple embeds).
	var current = document.currentScript;
	if (current && current.getAttribute('data-widget')) {
		mount(current);
		return;
	}
	var scripts = document.querySelectorAll('script[data-widget][src*="embed.js"]');
	for (var i = 0; i < scripts.length; i++) mount(scripts[i]);
})();
