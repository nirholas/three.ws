// iOS Quick Look — opens a USDZ companion using the <a rel="ar"> trick.
// Safari activates Quick Look when an anchor with rel="ar" is activated
// programmatically, which avoids requiring a real user gesture on a link.

function isIOS() {
	return (
		/iphone|ipad|ipod/i.test(navigator.userAgent) ||
		(navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1)
	);
}

export function canUseQuickLook() {
	return isIOS();
}

export function openQuickLook(usdzURI) {
	const a = document.createElement('a');
	a.rel = 'ar';
	a.href = usdzURI;
	// iOS requires a child element to trigger Quick Look on programmatic .click()
	a.appendChild(document.createElement('img'));
	a.click();
}
