// Photo capture for the AR view.
//
// Flattens the live camera feed and the WebGL canvas into one PNG and offers it
// through the native share sheet, with a desktop download fallback and a final
// URL-share → clipboard chain when the frame cannot be read. A screenshot of
// your models standing in your actual room is the thing people send to a friend,
// so it is a first-class button, not an afterthought.
//
// Requires the renderer to be built with `preserveDrawingBuffer: true`, or the
// canvas reads back blank between frames.
//
// Ported from the three.ws IRL/XR share lane (Apache-2.0).

/**
 * Flatten the camera feed (when in AR) and the 3D canvas into one PNG blob.
 *
 * @param {object} opts
 * @param {HTMLCanvasElement} opts.canvas  The WebGL canvas, drawn on top with alpha.
 * @param {HTMLVideoElement}  [opts.video] The camera passthrough, drawn behind.
 * @param {boolean}           [opts.isAR]  True when the camera feed is the backdrop.
 * @returns {Promise<Blob|null>} PNG blob, or null when the canvas has no pixels yet.
 */
export async function captureComposite({ canvas, video, isAR }) {
	if (!canvas) return null;
	const w = canvas.width;
	const h = canvas.height; // renderer pixel size, not CSS size
	if (!w || !h) return null;

	const out = document.createElement('canvas');
	out.width = w;
	out.height = h;
	const ctx = out.getContext('2d');
	if (!ctx) return null;

	if (isAR && video && !video.paused && video.videoWidth) {
		try {
			ctx.drawImage(video, 0, 0, w, h);
		} catch {
			// Tainted or not yet playing: skip the backdrop, keep the models.
		}
	}
	try {
		ctx.drawImage(canvas, 0, 0);
	} catch {
		return null;
	}

	return new Promise((resolve) => out.toBlob(resolve, 'image/png'));
}

/**
 * Share a blob through the native sheet, falling back to a download.
 *
 * @param {Blob} blob
 * @param {{filename?: string, title?: string}} [opts]
 * @returns {Promise<'shared'|'downloaded'>}
 */
export async function shareOrDownload(blob, { filename = 'ar-studio.png', title = 'AR Studio' } = {}) {
	const file = new File([blob], filename, { type: 'image/png' });
	if (navigator.share && navigator.canShare?.({ files: [file] })) {
		await navigator.share({ title, files: [file] });
		return 'shared';
	}
	const url = URL.createObjectURL(blob);
	const a = document.createElement('a');
	a.href = url;
	a.download = filename;
	a.click();
	setTimeout(() => URL.revokeObjectURL(url), 4000);
	return 'downloaded';
}

/**
 * Share a URL through the native sheet, falling back to a clipboard copy.
 * @returns {Promise<'shared'|'copied'>}
 */
export async function shareUrlOrCopy(url, { title = 'AR Studio', text = '' } = {}) {
	if (navigator.share) {
		try {
			await navigator.share({ title, url, ...(text ? { text } : {}) });
			return 'shared';
		} catch (err) {
			// A cancelled sheet is a decision, not a failure: do not fall through.
			if (err?.name === 'AbortError') throw err;
		}
	}
	await navigator.clipboard.writeText(url);
	return 'copied';
}
