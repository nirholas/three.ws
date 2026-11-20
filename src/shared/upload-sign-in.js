// Photo uploads need an account (api/forge-upload.js answers 401
// `sign_in_required` to anonymous callers). Making a model from a text prompt
// does not, so the Forge pages stay open and only ask at the moment a visitor
// adds a photo, before the on-device photo check spends their time on a file
// that could not be uploaded anyway.

import './upload-sign-in.css';

let check = null;

/**
 * Whether this visitor can upload. Asked once per page load: signing in
 * navigates away and back, which starts a fresh check.
 * /api/auth/me answers 200 for everyone and carries the answer in the body
 * (`{ user: null }` when signed out), so this reads the body, not the status.
 * When the answer is unknowable (offline, auth service erroring) this resolves
 * true and lets the upload endpoint decide, so a flaky probe never blocks a
 * signed-in visitor.
 * @returns {Promise<boolean>}
 */
export function signedInForUploads() {
	check ??= fetch('/api/auth/me', { credentials: 'same-origin', headers: { accept: 'application/json' } })
		.then(async (res) => {
			if (res.status === 401) return false;
			if (!res.ok) return true;
			const body = await res.json();
			return Boolean(body?.user);
		})
		.catch(() => true);
	return check;
}

/** True when an upload endpoint refused the caller for not being signed in. */
export function isSignInRequired(status, body) {
	return status === 401 && body?.error === 'sign_in_required';
}

/** Sign-in link that returns the visitor to this page afterwards. */
export function uploadSignInUrl() {
	return `/login?next=${encodeURIComponent(location.pathname + location.search)}`;
}

export const UPLOAD_SIGN_IN_SHORT = 'Sign in to add photos.';

/**
 * Fill `el` with the sign-in prompt: why, the link, and the open alternative.
 * @param {HTMLElement} el
 */
export function renderUploadSignIn(el) {
	const strong = document.createElement('strong');
	strong.textContent = 'Photos need a free account.';
	const a = document.createElement('a');
	a.href = uploadSignInUrl();
	a.textContent = 'Sign in';
	el.classList.add('upload-sign-in');
	el.replaceChildren(strong, ' ', a, ' to add photos. You can still make a model from a text prompt without one.');
}
