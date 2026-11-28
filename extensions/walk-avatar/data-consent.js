// data-consent.js: Firefox's per-category data consent, a no-op on Chromium.
//
// Firefox asks the user before an add-on transmits data, one category at a time
// (browser_specific_settings.gecko.data_collection_permissions). Walk Avatar
// sends nothing by default, so the Firefox build declares no required
// categories and lists the two features that do send data as optional:
//
//   websiteContent      "Read page sections aloud" posts the visible section's
//                       text to three.ws for speech.
//   authenticationInfo  signing in stores a three.ws token that rides along on
//                       the avatar requests.
//
// Each is requested at the moment the user turns its feature on. The Chromium
// manifest declares no categories (Chrome has no such consent layer), so every
// call below resolves true there without touching the permissions API.

export const NARRATION_DATA = 'websiteContent';
export const SIGN_IN_DATA = 'authenticationInfo';

function optionalCategories() {
	const gecko = chrome.runtime.getManifest().browser_specific_settings?.gecko;
	return gecko?.data_collection_permissions?.optional || [];
}

/** True when this build has to ask before sending `category`. */
export function consentRequired(category) {
	return optionalCategories().includes(category);
}

/**
 * Ask for `category`. Firefox only shows the prompt from a user input handler,
 * so call this synchronously at the top of a click or change handler, before
 * any `await`.
 */
export function requestDataConsent(category) {
	if (!consentRequired(category)) return Promise.resolve(true);
	return chrome.permissions.request({ data_collection: [category] }).catch(() => false);
}

export function hasDataConsent(category) {
	if (!consentRequired(category)) return Promise.resolve(true);
	return chrome.permissions.contains({ data_collection: [category] }).catch(() => false);
}

/** The categories in a permissions.onAdded / onRemoved payload. */
export function dataCategories(permissions) {
	return Array.isArray(permissions?.data_collection) ? permissions.data_collection : [];
}
