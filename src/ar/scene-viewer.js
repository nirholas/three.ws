// Android Scene Viewer fallback — launches ARCore via Intent URL.
// Acceptable to UA-sniff here: this path is only triggered when WebXR is absent.

function isAndroid() {
	return /android/i.test(navigator.userAgent);
}

export function canUseSceneViewer() {
	return isAndroid();
}

export function openSceneViewer(glbURL, { title = '', link = '' } = {}) {
	const params = new URLSearchParams({ file: glbURL, mode: 'ar_preferred' });
	if (title) params.set('title', title);
	if (link) params.set('link', link);

	// S.browser_fallback_url ensures the user lands back on the page if ARCore
	// is missing rather than ending up on an error screen.
	const fallback = encodeURIComponent(location.href);
	const intentURL =
		`intent://arvr.google.com/scene-viewer/1.2?${params.toString()}` +
		`#Intent;scheme=https;package=com.google.ar.core;` +
		`action=android.intent.action.VIEW;` +
		`S.browser_fallback_url=${fallback};end;`;

	location.href = intentURL;
}
