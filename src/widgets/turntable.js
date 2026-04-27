/**
 * Turntable Showcase Widget — chromeless hero banner.
 *
 * Brand config (background, env, autoRotate, rotationSpeed, cameraPosition)
 * is applied by app.js _applyWidgetConfig before this runs. The mount
 * handler's job is just to:
 *
 *   - frame the avatar nicely so it's centered in the viewport
 *   - guarantee autoRotate is on (config can opt-out by passing false)
 *   - apply rotationSpeed (default 0.5)
 *
 * No DOM, no chrome, no controls.
 */

const POLL_INTERVAL_MS = 100;
const POLL_MAX_MS = 8000;

/**
 * @param {import('../viewer.js').Viewer} viewer
 * @param {object} config  Turntable config (see widget-types.js 'turntable').
 * @returns {Promise<{ destroy: () => void }>}
 */
export async function mountTurntable(viewer, config) {
	const speed = typeof config.rotationSpeed === 'number' ? config.rotationSpeed : 0.5;
	if (viewer?.controls) {
		viewer.controls.autoRotate = config.autoRotate !== false;
		viewer.controls.autoRotateSpeed = speed;
	}

	await _waitForContent(viewer);
	if (viewer?.frameContent && viewer.content) {
		viewer.frameContent({ animate: false });
	}

	return {
		destroy() {
			if (viewer?.controls) viewer.controls.autoRotate = false;
		},
	};
}

function _waitForContent(viewer) {
	return new Promise((resolve) => {
		const started = Date.now();
		const poll = () => {
			if (viewer?.content) return resolve();
			if (Date.now() - started > POLL_MAX_MS) return resolve();
			setTimeout(poll, POLL_INTERVAL_MS);
		};
		poll();
	});
}
