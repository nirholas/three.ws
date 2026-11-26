// Dev-server answer for /manifest.webmanifest.
//
// vite-plugin-pwa writes the web manifest into dist/ at build time only, so in
// `npm run dev` every page linking it (nearly all of them) logged a manifest
// 404 on load. This serves the same manifest object the build emits, passed in
// from vite.config.js, so dev never drifts from production. Its own service
// worker stays off in dev on purpose: a dev SW caches modules across edits.

const PATH = '/manifest.webmanifest';

/**
 * @param {object} manifest the PWA manifest object vite-plugin-pwa builds from
 * @returns {(req: import('node:http').IncomingMessage, res: import('node:http').ServerResponse, next: () => void) => void}
 */
export function devWebManifestMiddleware(manifest) {
	const body = JSON.stringify(manifest);
	return (req, res, next) => {
		const pathname = String(req.url || '').split('?')[0];
		if (pathname !== PATH || (req.method !== 'GET' && req.method !== 'HEAD')) return next();
		res.statusCode = 200;
		res.setHeader('content-type', 'application/manifest+json');
		res.setHeader('cache-control', 'no-cache');
		if (req.method === 'HEAD') return res.end();
		return res.end(body);
	};
}
