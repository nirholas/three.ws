// True only for an https origin whose host is readyplayer.me or one of its
// subdomains. Used to trust postMessage events from the Ready Player Me frame.
export function isReadyPlayerMeOrigin(origin) {
	let url;
	try {
		url = new URL(origin);
	} catch {
		return false;
	}
	if (url.protocol !== 'https:') return false;
	return url.hostname === 'readyplayer.me' || url.hostname.endsWith('.readyplayer.me');
}
