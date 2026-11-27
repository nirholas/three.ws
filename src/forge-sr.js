// A polite screen reader announcement for the Forge wait.
//
// The stage panel is a live region, but it is the wrong channel for the two
// facts a person waiting needs to hear: the job is slower than typical, and the
// model is finished. This is a separate, visually hidden, polite region that is
// written only on those real transitions, so it never speaks once a second.

let region = null;

export function announcePolite(text, doc = typeof document === 'undefined' ? null : document) {
	if (!doc || !text) return;
	if (!region || !region.isConnected) {
		region = doc.createElement('div');
		region.setAttribute('role', 'status');
		region.setAttribute('aria-live', 'polite');
		region.setAttribute('aria-atomic', 'true');
		region.className = 'forge-sr-status';
		region.style.cssText =
			'position:absolute;width:1px;height:1px;margin:-1px;padding:0;overflow:hidden;clip:rect(0 0 0 0);clip-path:inset(50%);white-space:nowrap;border:0;';
		doc.body.appendChild(region);
	}
	// Clear first so an identical message twice in a row is announced twice.
	region.textContent = '';
	const target = region;
	const write = () => {
		target.textContent = text;
	};
	if (typeof requestAnimationFrame === 'function') requestAnimationFrame(write);
	else write();
}
