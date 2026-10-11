// Pure helpers for the Camera app: file names, recorder mime choice and getUserMedia error mapping.

const p2 = (n) => String(n).padStart(2, '0');

/** "Camera 2026-10-11 07.45.12.png" (colons are avoided so the name is valid everywhere). */
export function captureName(date, ext) {
	const d = `${date.getFullYear()}-${p2(date.getMonth() + 1)}-${p2(date.getDate())}`;
	const t = `${p2(date.getHours())}.${p2(date.getMinutes())}.${p2(date.getSeconds())}`;
	return `Camera ${d} ${t}.${ext}`;
}

export const RECORDER_TYPES = ['video/webm;codecs=vp9,opus', 'video/webm;codecs=vp8,opus', 'video/webm', 'video/mp4'];

/** First recorder mime type the browser supports, given an `isTypeSupported` function. */
export function pickRecorderType(isSupported) {
	return RECORDER_TYPES.find((t) => isSupported(t)) || '';
}

export const extForRecorderType = (type) => (/mp4/.test(type) ? 'mp4' : 'webm');

/**
 * Map a getUserMedia failure to { kind, title, steps[] } the UI can show.
 * kinds: denied, none, busy, insecure, unsupported, other.
 */
export function classifyMediaError(err, { hasMediaDevices = true, secure = true } = {}) {
	if (!secure) {
		return { kind: 'insecure', title: 'The camera needs a secure connection', steps: ['Open three.ws over https:// (or localhost). Browsers block camera access on insecure pages.'] };
	}
	if (!hasMediaDevices) {
		return { kind: 'unsupported', title: 'This browser cannot reach a camera', steps: ['Try a current version of Chrome, Edge, Firefox or Safari.'] };
	}
	const name = err?.name || '';
	if (name === 'NotAllowedError' || name === 'SecurityError' || name === 'PermissionDeniedError') {
		return {
			kind: 'denied',
			title: 'Camera access is blocked',
			steps: ['Click the camera or lock icon in the address bar.', 'Set Camera to Allow for this site.', 'Choose Try again below.'],
		};
	}
	if (name === 'NotFoundError' || name === 'DevicesNotFoundError' || name === 'OverconstrainedError') {
		return { kind: 'none', title: 'No camera was found', steps: ['Plug in or turn on a camera.', 'Check that another app has not disabled it in system privacy settings.', 'Choose Try again below.'] };
	}
	if (name === 'NotReadableError' || name === 'TrackStartError' || name === 'AbortError') {
		return { kind: 'busy', title: 'The camera is in use by another app', steps: ['Close other apps or browser tabs that use the camera, such as a video call.', 'Choose Try again below.'] };
	}
	return { kind: 'other', title: 'The camera could not start', steps: [err?.message || 'Unknown error.', 'Choose Try again below.'] };
}

/** "0:07" elapsed label for the recording indicator. */
export function elapsedLabel(ms) {
	const s = Math.floor(ms / 1000);
	return `${Math.floor(s / 60)}:${p2(s % 60)}`;
}
