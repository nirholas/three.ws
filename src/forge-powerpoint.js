// "PowerPoint": download a creation as a one-slide deck with the model as an
// interactive 3D object (GET /api/forge/export-pptx, built server-side by
// api/forge/export-pptx.js). Shared by the Forge export menu and the model
// page's download row, so both say the same thing when something goes wrong.
//
// The deck is built from the stored creation, so a model that only exists as
// an unsaved in-browser edit cannot be exported; the menu row says so instead
// of quietly exporting the unedited model.

export const PPTX_ENDPOINT = '/api/forge/export-pptx';

export class PptxExportError extends Error {
	constructor(message, code) {
		super(message);
		this.name = 'PptxExportError';
		this.code = code;
	}
}

/** The filename from a Content-Disposition header, or null. */
export function filenameFromDisposition(header) {
	if (!header) return null;
	const star = /filename\*\s*=\s*UTF-8''([^;]+)/i.exec(header);
	if (star) {
		try {
			return decodeURIComponent(star[1].trim());
		} catch {
			// Malformed percent-encoding: fall through to the plain parameter.
		}
	}
	const plain = /filename\s*=\s*"?([^";]+)"?/i.exec(header);
	return plain ? plain[1].trim() : null;
}

/** What to tell the user for a failed export, by status and server message. */
export function pptxErrorMessage(status, body = {}) {
	const server = body.error_description || body.message;
	if (status === 404 && body.error === 'model_not_found' && server) return server;
	if (status === 404)
		return 'This model is private or no longer available. Only public and unlisted models export to PowerPoint: make it unlisted, then try again.';
	if (status === 429)
		return 'Too many PowerPoint exports in a few minutes. Wait a moment and try again.';
	if (status === 413 || status === 422 || status === 502) return server || 'This model could not be put on a slide.';
	if (status >= 500) return 'three.ws could not build the slide just now. Try again in a minute.';
	return server || `The export failed (${status}). Try again.`;
}

export function saveBlob(blob, filename) {
	const a = document.createElement('a');
	a.href = URL.createObjectURL(blob);
	a.download = filename;
	a.rel = 'noopener';
	document.body.appendChild(a);
	a.click();
	a.remove();
	// The click hands the blob to the download manager synchronously; revoke
	// once it has had time to take it.
	setTimeout(() => URL.revokeObjectURL(a.href), 30_000);
}

/**
 * Fetch the deck for a creation and hand it to the browser as a download.
 * Throws PptxExportError with a message written for the user.
 *
 * @param {string} creationId
 * @returns {Promise<{ filename: string, bytes: number, poster: string|null }>}
 */
export async function downloadPptx(creationId) {
	if (!creationId) throw new PptxExportError('Save the model first, then export it.', 'no_creation');
	let res;
	try {
		res = await fetch(`${PPTX_ENDPOINT}?id=${encodeURIComponent(creationId)}`, {
			headers: { accept: 'application/vnd.openxmlformats-officedocument.presentationml.presentation' },
		});
	} catch {
		throw new PptxExportError('Could not reach three.ws. Check your connection and try again.', 'network');
	}
	if (!res.ok) {
		const body = await res.json().catch(() => ({}));
		throw new PptxExportError(pptxErrorMessage(res.status, body), body.error || `http_${res.status}`);
	}
	const blob = await res.blob();
	const filename = filenameFromDisposition(res.headers.get('content-disposition')) || 'three-ws-model.pptx';
	saveBlob(blob, filename);
	return { filename, bytes: blob.size, poster: res.headers.get('x-pptx-poster') };
}

/**
 * The "PowerPoint" row in the Forge export menu. Hidden until a stored model
 * is on screen, like the slicer and Minecraft rows.
 */
export function mountPowerPointMenuItem(menu, { isLocalEdit = () => false } = {}) {
	let creationId = null;
	let busy = false;
	const item = document.createElement('button');
	item.type = 'button';
	item.className = 'export-item';
	item.setAttribute('role', 'menuitem');
	item.dataset.format = 'pptx';
	item.hidden = true;
	item.innerHTML = `
		<span class="fmt">.pptx</span>
		<span class="blurb">PowerPoint slide with this model as an interactive 3D object you can rotate. Microsoft 365, Windows, Mac and the web.</span>
		<span class="status" aria-live="polite"></span>`;
	const status = item.querySelector('.status');
	let clearTimer = null;

	item.addEventListener('click', async () => {
		if (busy || !creationId) return;
		clearTimeout(clearTimer);
		status.classList.remove('is-error');
		if (isLocalEdit()) {
			status.textContent = 'exports the saved model only: reset your mesh edits first';
			status.classList.add('is-error');
			return;
		}
		busy = true;
		const forId = creationId;
		item.setAttribute('aria-disabled', 'true');
		item.setAttribute('aria-busy', 'true');
		status.innerHTML = '<span class="export-spinner" aria-hidden="true"></span> building slide';
		try {
			await downloadPptx(forId);
			if (forId !== creationId) return;
			status.textContent = 'saved ✓';
			clearTimer = setTimeout(() => {
				if (status.textContent === 'saved ✓') status.textContent = '';
			}, 4000);
		} catch (err) {
			if (forId !== creationId) return;
			status.textContent = err?.message || 'The export failed. Try again.';
			status.classList.add('is-error');
		} finally {
			busy = false;
			item.removeAttribute('aria-disabled');
			item.removeAttribute('aria-busy');
		}
	});
	menu.appendChild(item);

	return {
		setCreation(id) {
			creationId = id || null;
			item.hidden = !creationId;
			clearTimeout(clearTimer);
			status.textContent = '';
			status.classList.remove('is-error');
		},
	};
}
