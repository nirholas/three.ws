/**
 * Copy and classification shared by the Forge handlers (api/forge.js and
 * api/gpt-forge.js) for a sketch job that falls back to an image lane.
 *
 * The scribble worker is the only lane built for a drawing, but a drawing is
 * still a picture: when that worker is down or fails a job, the standard image
 * lanes build it instead and the user is told so in these words. No worker,
 * vendor or host is named.
 */

export const SKETCH_FALLBACK_NOTE =
	'The sketch engine could not finish your drawing, so a standard image engine is building it instead. It reads your drawing as a picture, so the shape may follow your outline less closely.';

// Shown when the worker could not read the drawing at all. Every lane would fail
// on the same file, so the job ends here instead of hopping.
export const SKETCH_UNREADABLE_MESSAGE =
	'Your drawing could not be read. Draw it again, or upload a PNG, JPG or WebP of it.';

/**
 * The sketch/photo worker reports a caller-side image fault as
 * "input image unusable: <reason>" (workers/model-triposg/main.py). A worker
 * that refuses the input is healthy, so the lane is not cooled for it.
 */
export function isUnusableInputError(raw) {
	return /input image unusable/i.test(String(raw || ''));
}
