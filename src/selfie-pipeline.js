/**
 * Selfie pipeline — bridges the 3-photo capture UI on /create to the Avaturn
 * session endpoint, then hands off to the main app's AvatarCreator modal.
 *
 * Flow:
 *   [selfie:submit] → downscale photos → POST /api/onboarding/avaturn-session
 *     → on 200 { session_url } → navigate to /#avatarSession=<encoded url>
 *     → app.js reads hash, opens AvatarCreator with the session URL
 *     → Avaturn iframe runs the editor, fires 'export' with GLB URL
 *     → app.js loads the GLB + saves it to the user's account
 */

const ENDPOINT = '/api/onboarding/avaturn-session';
const MAX_DIM = 1024; // downscale so each base64 photo stays well under 2.5MB
const JPEG_QUALITY = 0.88;

document.addEventListener('selfie:submit', (event) => {
	const ev = /** @type {CustomEvent} */ (event);
	run(ev.detail).catch((err) => {
		console.error('[selfie-pipeline]', err);
		setStatus(err.userMessage || 'Something went wrong. Try again.', { error: true });
		resetSubmit();
	});
});

/**
 * @param {{
 *   files: Record<'frontal'|'left'|'right', File | null>,
 *   bodyType: 'male' | 'female',
 *   avatarType: 'v1' | 'v2',
 *   method: 'camera' | 'upload' | null,
 * }} detail
 */
async function run(detail) {
	if (!detail?.files?.frontal || !detail.files.left || !detail.files.right) {
		throw withMessage(new Error('missing photos'), 'Please add all 3 photos.');
	}

	setStatus('Preparing photos…');
	const photos = {
		frontal: await fileToDataUrl(detail.files.frontal),
		left: await fileToDataUrl(detail.files.left),
		right: await fileToDataUrl(detail.files.right),
	};

	setStatus('Sending to avatar pipeline…');
	const res = await fetch(ENDPOINT, {
		method: 'POST',
		credentials: 'include',
		headers: { 'content-type': 'application/json' },
		body: JSON.stringify({
			photos,
			body_type: detail.bodyType,
			avatar_type: detail.avatarType,
		}),
	});

	if (!res.ok) {
		const payload = await res.json().catch(() => ({}));
		throw mapApiError(res.status, payload);
	}

	const data = await res.json();
	if (!data.session_url) {
		throw withMessage(new Error('no session_url'), 'The pipeline did not return a session.');
	}

	setStatus('Opening editor…');
	// Hand off to the main viewer, which owns the AvatarCreator modal + GLB loader.
	const target = `/#avatarSession=${encodeURIComponent(data.session_url)}`;
	window.location.assign(target);
}

/**
 * Reads a File, paints it into a canvas clamped to MAX_DIM × MAX_DIM, returns
 * a JPEG data URL. Keeps upload payloads predictable across phone camera sizes.
 * @param {File} file
 */
async function fileToDataUrl(file) {
	const bitmap = await loadBitmap(file);
	const { width, height } = fit(bitmap.width, bitmap.height, MAX_DIM);
	const canvas = document.createElement('canvas');
	canvas.width = width;
	canvas.height = height;
	const ctx = canvas.getContext('2d');
	if (!ctx) throw new Error('2d canvas unsupported');
	ctx.drawImage(bitmap, 0, 0, width, height);
	try {
		bitmap.close?.();
	} catch (_) {
		// ImageBitmap.close is optional on older browsers
	}
	return canvas.toDataURL('image/jpeg', JPEG_QUALITY);
}

/** @param {File} file @returns {Promise<ImageBitmap | HTMLImageElement>} */
async function loadBitmap(file) {
	if (typeof createImageBitmap === 'function') {
		try {
			return await createImageBitmap(file);
		} catch (_) {
			// fall through to <img> fallback
		}
	}
	return new Promise((resolve, reject) => {
		const img = new Image();
		img.onload = () => resolve(img);
		img.onerror = () => reject(new Error('could not decode image'));
		img.src = URL.createObjectURL(file);
	});
}

/**
 * @param {number} w
 * @param {number} h
 * @param {number} max
 */
function fit(w, h, max) {
	if (w <= max && h <= max) return { width: w, height: h };
	const s = Math.min(max / w, max / h);
	return { width: Math.round(w * s), height: Math.round(h * s) };
}

/**
 * @param {number} status
 * @param {{ error?: string, error_description?: string }} payload
 */
function mapApiError(status, payload) {
	const code = payload.error;
	if (status === 401) return withMessage(new Error(code || 'unauthorized'), 'Please sign in to create an avatar.');
	if (status === 413) return withMessage(new Error(code || 'too_large'), 'Photos are too large. Try again.');
	if (status === 429) return withMessage(new Error(code || 'rate_limited'), 'Too many attempts — wait a minute and try again.');
	if (status === 501) return withMessage(new Error(code || 'not_configured'), 'Avatar pipeline is not set up on this deployment.');
	if (status === 502) return withMessage(new Error(code || 'upstream_error'), 'Avatar provider is having trouble. Try again shortly.');
	return withMessage(new Error(code || `http_${status}`), payload.error_description || 'Could not create avatar.');
}

/**
 * @param {Error} err
 * @param {string} userMessage
 */
function withMessage(err, userMessage) {
	/** @type {any} */ (err).userMessage = userMessage;
	return err;
}

// ── UI helpers ─────────────────────────────────────────────────────────────
const submitBtn = /** @type {HTMLButtonElement | null} */ (document.getElementById('submit-btn'));
let errorBanner = /** @type {HTMLElement | null} */ (null);

/** @param {string} text @param {{ error?: boolean }} [opts] */
function setStatus(text, opts = {}) {
	if (submitBtn) {
		submitBtn.textContent = text;
		submitBtn.disabled = true;
		submitBtn.classList.remove('ready');
	}
	if (opts.error) {
		if (!errorBanner) {
			errorBanner = document.createElement('p');
			errorBanner.className = 'unsupported show';
			errorBanner.setAttribute('role', 'alert');
			errorBanner.style.maxWidth = '720px';
			errorBanner.style.margin = '0 auto 16px';
			const bar = document.getElementById('submit-bar');
			bar?.parentNode?.insertBefore(errorBanner, bar);
		}
		errorBanner.textContent = text;
	} else if (errorBanner) {
		errorBanner.remove();
		errorBanner = null;
	}
}

function resetSubmit() {
	if (!submitBtn) return;
	// Re-enable submit for another attempt if photos are still present.
	submitBtn.disabled = false;
	submitBtn.textContent = 'Submit';
	submitBtn.classList.add('ready');
}
