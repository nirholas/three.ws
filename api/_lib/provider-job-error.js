// Shared, vendor-free copy for a failed-generation job's raw error string.
//
// Every async generation pipeline (the avatar flows: selfie or prompt to 3D, in
// api/avatars, and the forge text-to-3D / image-to-3D poll in api/forge.js) stores
// the provider's RAW error for operators, but must never relay it to a buyer.
// Raw strings from the Replicate/Meshy/Tripo/GCP/NVIDIA adapters can carry a
// vendor name ("Meshy account is out of credits."), a billing page URL, an
// internal task id or node name, an IP, or a leaked key. This collapses any of
// them into neutral, actionable copy by failure-mode keyword. The raw value
// stays in the DB / server logs only.
//
// The mapped phrasings deliberately contain stable tokens ("content safety",
// "face", "resources", "too long"/"try again", "temporarily unavailable",
// "busy") so the avatar pipeline's classifier and the browser's friendly-error
// remapper can branch on the masked output without re-reading vendor text.
//
// Returns null for empty input so the caller can omit the field entirely.
export function sanitizeJobError(raw) {
	if (!raw) return null;
	const s = String(raw).toLowerCase();
	if (s.includes('nsfw') || s.includes('safety')) {
		return 'This was flagged by content safety. Try a different prompt or photo.';
	}
	if (s.includes('no face') || (s.includes('face') && s.includes('detect'))) {
		return 'No clear face was detected. Try a brighter, front-facing photo.';
	}
	if (s.includes('oom') || s.includes('out of memory') || s.includes('memory')) {
		return 'The engine ran out of resources. Try again with a simpler request.';
	}
	if (s.includes('timeout') || s.includes('timed out')) {
		return 'The engine took too long, please try again.';
	}
	if (s.includes('credit') || s.includes('billing') || s.includes('quota') || s.includes('payment')) {
		return 'The 3D engine is temporarily unavailable, please try again later.';
	}
	if (s.includes('rate') && s.includes('limit')) {
		return 'The 3D engine is busy right now, wait a moment and try again.';
	}
	return '3D generation hit a snag, please try again.';
}
