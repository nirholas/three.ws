/**
 * Selfie capture flow — entry for /create.
 *
 * Task 1 (this file): render the input-method choice step. When the user picks
 * a method, stash it on sessionStorage + advance the UI placeholder. Later
 * tasks wire up the 3-photo camera / upload step and the Avaturn pipeline.
 */

const SESSION_KEY = 'selfie.method';

const choices = document.querySelectorAll('.choice[data-method]');
const uploadInput = /** @type {HTMLInputElement | null} */ (document.getElementById('upload-input'));
const unsupportedMsg = document.getElementById('unsupported-msg');

const cameraSupported =
	typeof navigator !== 'undefined' &&
	navigator.mediaDevices &&
	typeof navigator.mediaDevices.getUserMedia === 'function';

if (!cameraSupported) {
	const cameraChoice = document.querySelector('.choice[data-method="camera"]');
	if (cameraChoice) {
		cameraChoice.setAttribute('aria-disabled', 'true');
		/** @type {HTMLButtonElement} */ (cameraChoice).disabled = true;
		cameraChoice.style.opacity = '0.45';
		cameraChoice.style.cursor = 'not-allowed';
	}
	unsupportedMsg?.classList.add('show');
}

choices.forEach((btn) => {
	btn.addEventListener('click', () => {
		const method = btn.getAttribute('data-method');
		if (!method) return;
		if (method === 'camera' && !cameraSupported) return;

		try {
			sessionStorage.setItem(SESSION_KEY, method);
		} catch (_) {
			// sessionStorage may be blocked (private mode, etc.) — ignore, next step re-asks.
		}

		if (method === 'upload' && uploadInput) {
			uploadInput.click();
			return;
		}

		// Camera branch: step 2 (3-photo capture UI) lands in the next task.
		// For now signal intent so the placeholder is visible during dev.
		console.info('[selfie] camera flow — capture UI pending (task 2)');
	});
});

uploadInput?.addEventListener('change', () => {
	const files = uploadInput.files;
	if (!files || files.length === 0) return;
	// Step 2 picks up these files from the <input> reference in the next task.
	console.info('[selfie] upload flow — %d file(s) selected; capture UI pending (task 2)', files.length);
});
