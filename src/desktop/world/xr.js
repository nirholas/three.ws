// WebXR for the world. VR is the only headset mode here; AR lives in src/ar.
// When no immersive-vr runtime exists the caller is told plainly, so the
// headset on the desk can offer first-person view instead of a silent no-op.

export async function vrSupported() {
	try {
		return !!(navigator.xr && (await navigator.xr.isSessionSupported('immersive-vr')));
	} catch {
		return false;
	}
}

/**
 * Start an immersive-vr session on `renderer`. The XR camera rig is placed
 * at the player's feet so the visitor stands where their avatar stood.
 * @param {import('three').WebGLRenderer} renderer
 * @param {{ onEnd?: () => void }} [o]
 * @returns {Promise<XRSession>}
 */
export async function enterVR(renderer, { onEnd } = {}) {
	if (!(await vrSupported())) throw new Error('No VR headset is available in this browser.');
	renderer.xr.enabled = true;
	renderer.xr.setReferenceSpaceType('local-floor');
	let session;
	try {
		session = await navigator.xr.requestSession('immersive-vr', { optionalFeatures: ['local-floor', 'bounded-floor', 'hand-tracking'] });
	} catch (err) {
		renderer.xr.enabled = false;
		throw err;
	}
	session.addEventListener(
		'end',
		() => {
			renderer.xr.enabled = false;
			onEnd?.();
		},
		{ once: true },
	);
	await renderer.xr.setSession(session);
	return session;
}
