// The PowerPoint add-in's OAuth redirect target (/office/powerpoint/auth).
// Inside PowerPoint the sign-in runs in an Office dialog: post this URL (code
// and state) back to the task pane, which checks the state and swaps the code.
// In a plain browser tab the pane redirected the whole page here, so send the
// code back to the pane the same way.

import './taskpane.css';

async function relay() {
	const href = location.href;
	if (window.Office?.onReady) {
		try {
			const info = await Office.onReady();
			if (info?.host && typeof Office.context?.ui?.messageParent === 'function') {
				Office.context.ui.messageParent(href);
				document.getElementById('op-auth-msg').textContent = 'Signed in. You can close this window.';
				return;
			}
		} catch {
			// Not an Office dialog: fall through to the page redirect.
		}
	}
	location.replace(`/office/powerpoint${location.search}`);
}

relay();
