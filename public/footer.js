// Loads the canonical site footer into any page that contains
// <div id="footer-container"></div>. Mirrors /nav.js: ensures footer.css
// is on the page, fetches /footer.html, injects it, and lazy-loads the
// newsletter wiring + model-viewer module if not already present.
(function () {
	function ensureStylesheet(href) {
		if (!document.querySelector(`link[href="${href}"]`)) {
			const link = document.createElement('link');
			link.rel = 'stylesheet';
			link.href = href;
			document.head.appendChild(link);
		}
	}

	function ensureScript({ src, type, attr }) {
		if (document.querySelector(`script[src="${src}"]`)) return;
		const s = document.createElement('script');
		s.src = src;
		if (type) s.type = type;
		if (attr) s.setAttribute(attr, '');
		document.head.appendChild(s);
	}

	function init() {
		const container = document.getElementById('footer-container');
		if (!container) return;

		ensureStylesheet('/footer.css');

		fetch('/footer.html')
			.then((r) => r.text())
			.then((html) => {
				container.innerHTML = html;

				if (container.querySelector('#footer-bot-canvas')) {
					if (document.querySelector('meta[name="has-three-bundle"]')) {
						// This page already has a Vite-bundled Three.js — load the canvas
						// renderer that shares that instance, avoiding a duplicate load.
						ensureScript({ src: '/footer-bot.js', type: 'module' });
					} else {
						// Plain HTML page (login, register, etc.) — fall back to model-viewer.
						ensureScript({
							src: 'https://ajax.googleapis.com/ajax/libs/model-viewer/4.0.0/model-viewer.min.js',
							type: 'module',
						});
						// model-viewer needs a <model-viewer> element; swap the canvas for one.
						const avatar = container.querySelector('.h-footer-avatar');
						if (avatar) {
							avatar.innerHTML = `<model-viewer
								src="/animations/robotexpressive.glb"
								auto-rotate auto-rotate-delay="0" rotation-per-second="20deg"
								interaction-prompt="none" camera-controls="false" disable-zoom
								shadow-intensity="0" exposure="0.7" environment-image="neutral"
								camera-orbit="0deg 80deg 9m" field-of-view="35deg" loading="lazy"
							></model-viewer>`;
						}
					}
				}

				ensureScript({ src: '/footer-newsletter.js', attr: 'defer' });
				// If footer-newsletter.js was already loaded earlier, re-run its
				// wiring against the just-injected form by dispatching a custom
				// event the script listens for, or re-import as a fallback.
				if (window.__threewsFooterNewsletterReady) {
					window.__threewsFooterNewsletterReady();
				}
			})
			.catch(() => {});
	}

	if (document.readyState === 'loading') {
		document.addEventListener('DOMContentLoaded', init);
	} else {
		init();
	}
})();
