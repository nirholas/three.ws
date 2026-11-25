// Recovery for tabs that outlive a deploy.
//
// Built chunks are content-hashed and the Cloud Run container ships only the
// current build, so a page opened before a deploy asks for chunks that no
// longer exist the next time it lazy-loads a feature. Vite announces that as a
// `vite:preloadError` window event ("Failed to fetch dynamically imported
// module", "Unable to preload CSS"); nothing listened, and the visitor was stuck
// on a half-loaded page until they reloaded by hand.
//
// installStaleChunkReload() is inlined into every page's head by the
// client-error-reporter plugin in vite.config.js, so it is written to run on its
// own with only `window` in scope, in syntax every browser we serve can parse.
// It confirms the chunk is really gone with a HEAD before reloading, and
// reloads at most once per chunk per session, so a chunk that still serves (a
// transient abort, a crawler cancelling requests) or a deploy that is still
// rolling out can never cause a reload loop. The original error is left to
// propagate either way, so the error reporter still records it.

export function installStaleChunkReload(win) {
	var KEY = 'tws:stale-chunk-reload:';
	win.addEventListener('vite:preloadError', function (ev) {
		var message = String((ev && ev.payload && ev.payload.message) || '');
		var match = message.match(/https?:\/\/[^\s'"]+/);
		if (!match) return;
		var url = match[0].replace(/[).,]+$/, '');
		if (url.indexOf(win.location.origin + '/') !== 0) return;
		try {
			if (win.sessionStorage.getItem(KEY + url)) return;
		} catch (e) {
			return;
		}
		return win
			.fetch(url, { method: 'HEAD', cache: 'no-store' })
			.then(function (res) {
				if (res.status !== 404 && res.status !== 410) return;
				try {
					win.sessionStorage.setItem(KEY + url, '1');
				} catch (e) {
					return;
				}
				win.location.reload();
			})
			.catch(function () {});
	});
}

export function staleChunkReloadSnippet() {
	return '(' + installStaleChunkReload.toString() + ')(window);';
}
