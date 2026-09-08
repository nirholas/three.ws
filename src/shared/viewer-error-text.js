// GLTFLoader (and three's FileLoader under it) reject with the raw transport
// string, e.g. `fetch for "https://host/u/abc/model.glb" responded with 502:
// Bad Gateway`. Shown as-is that names an internal URL, leaks a storage key,
// and tells the viewer nothing they can act on. Map the failures a visitor can
// actually reach onto plain language with a next step.
//
// Anything unrecognised keeps its own message: the callers that throw by hand
// already write for a person (avatar-embed's `avatar <id> not found`), so
// replacing those with a generic string would lose information.

/**
 * Human, actionable text for a model-load failure.
 *
 * @param {unknown} err  the rejection from a viewer load
 * @returns {string} copy safe to show a visitor
 */
export function viewerErrorText(err) {
	// An Error with an empty message must not fall through to String(err),
	// which yields the useless literal "Error".
	const msg = (typeof err?.message === 'string' ? err.message : String(err ?? '')).trim();
	if (/responded with 4\d\d/.test(msg)) {
		return /\b40[13]\b/.test(msg)
			? 'This avatar is private. Sign in with the account that owns it.'
			: 'This avatar is no longer available.';
	}
	if (/responded with 5\d\d/.test(msg)) {
		return 'The avatar service is unavailable. Refresh to try again.';
	}
	if (/failed to fetch|networkerror|load failed|err_/i.test(msg)) {
		return 'Connection lost. Check your network and refresh.';
	}
	if (/gltf|json|unsupported|unexpected token/i.test(msg)) {
		return "This avatar's 3D file could not be read.";
	}
	return msg || 'Could not load avatar.';
}
