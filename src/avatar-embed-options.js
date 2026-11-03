// Pure helpers for avatar-embed.js, kept apart so they can be unit tested
// without booting a Viewer.

/**
 * Chrome-free overlay mode. `overlay=1` and `chrome=0` are the documented
 * switches; `overlayMode=1` is what the /live and agent-exchange pages send.
 * @param {URLSearchParams} params
 */
export function isOverlayMode(params) {
	return (
		params.get('overlay') === '1' ||
		params.get('overlayMode') === '1' ||
		params.get('chrome') === '0'
	);
}

/**
 * Put a freshly loaded body into its idle clip. A GLB that is not told to play
 * anything stays in its authored pose, which for most rigs is a T-pose. Does
 * nothing if a caller already started a clip, and leaves the authored pose in
 * place if the idle clip cannot be loaded.
 * @param {{ currentAction: unknown, ensureLoaded(n: string): Promise<unknown>, play(n: string): Promise<unknown> }} animMgr
 */
export async function startRestingPose(animMgr) {
	try {
		await animMgr.ensureLoaded('idle');
		if (animMgr.currentAction) return;
		await animMgr.play('idle');
	} catch {
		// authored pose stays
	}
}
