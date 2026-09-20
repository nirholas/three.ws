//
// Retired-cache cleanup, imported into the VitePWA-generated service worker via
// `workbox.importScripts` (see vite.config.js). Plain classic worker script (no
// imports) so importScripts can pull it in, same as push-sw.js.
//
// Workbox's cleanupOutdatedCaches only removes old PRECACHES. A runtime cache
// whose route is deleted from the config is never touched again: it just sits in
// the visitor's Cache Storage, counted against their quota, forever. Name a
// cache here in the same change that stops writing to it.
//
//   app-assets   hashed /assets/ chunks. The route was removed because the SW
//                answering those fetches made Chrome discard every
//                <link rel=modulepreload> for them; the HTTP cache already
//                serves them (immutable, max-age=1y).
//

const RETIRED_CACHES = ['app-assets'];

self.addEventListener('activate', (event) => {
	event.waitUntil(Promise.all(RETIRED_CACHES.map((name) => caches.delete(name))));
});
