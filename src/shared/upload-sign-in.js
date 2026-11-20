// Making or uploading anything needs an account: /api/forge and
// /api/forge-upload answer 401 `sign_in_required` to anonymous callers
// (api/_lib/creator-account.js). The Forge pages stay browsable and ask at the
// moment a visitor acts: when they add a photo (before the on-device photo check
// spends their time on a file that could not be uploaded) and when they press
// Generate (before the generating panel promises work that cannot start).

import './upload-sign-in.css';

// These pages show their own sign-in prompt in context for generating and
// photo uploads, so the site-wide banner in public/nav.js stands aside for those
// two endpoints (and still covers every other call the page makes).
export const IN_PAGE_SIGN_IN_PATHS = Object.freeze(['/api/forge', '/api/forge-upload']);
if (typeof document !== 'undefined') document.documentElement.dataset.signInPrompt = IN_PAGE_SIGN_IN_PATHS.join(' ');

let check = null;

/**
 * Whether this visitor is signed in, so can upload and generate. Asked once per page load: signing in
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
export const CREATE_SIGN_IN_SHORT = 'Sign in to make a 3D model.';

function renderSignIn(el, lead, tail) {
	const strong = document.createElement('strong');
	strong.textContent = lead;
	const a = document.createElement('a');
	a.href = uploadSignInUrl();
	a.textContent = 'Sign in';
	el.classList.add('upload-sign-in');
	el.replaceChildren(strong, ' ', a, tail);
	return a;
}

/**
 * Fill `el` with the photo sign-in prompt: why, and the link back here.
 * @param {HTMLElement} el
 * @returns {HTMLAnchorElement} the sign-in link, so a caller can focus it
 */
export function renderUploadSignIn(el) {
	return renderSignIn(el, 'Photos need a free account.', ' to add photos. You come straight back here.');
}

/**
 * Fill `el` with the generate sign-in prompt: why, and the link back here.
 * Every model has an owner who can find, publish or delete it later, so making
 * one needs an account.
 * @param {HTMLElement} el
 * @returns {HTMLAnchorElement} the sign-in link, so a caller can focus it
 */
export function renderCreateSignIn(el) {
	el.classList.add('upload-sign-in--panel');
	return renderSignIn(el, 'Making a 3D model needs a free account.', ' and your model is saved to it, unlisted until you choose to publish it. You come straight back here.');
}
