/**
 * KHR_node_visibility for the standalone /viewer page.
 *
 * /viewer renders with <model-viewer>, whose bundled GLTFLoader ignores
 * KHR_node_visibility and takes no loader plugins, so a node hidden in the GLB
 * editor (exported as `visible: false` with its real scale) would reappear.
 * That loader still copies unknown node extensions into
 * `userData.gltfExtensions` and node extras into `userData`, so after load we
 * walk the scene and hide every node carrying either marker. The editor writes
 * both; `extras.threeWsHidden` also covers tools that kept only the intent.
 */

export function isMarkedHidden(object) {
	const ud = object && object.userData;
	if (!ud) return false;
	return ud.gltfExtensions?.KHR_node_visibility?.visible === false || ud.threeWsHidden === true;
}

/** Hides every marked node under `root`. Returns how many were hidden. */
export function hideMarkedNodes(root) {
	let hidden = 0;
	root.traverse((object) => {
		if (object.visible && isMarkedHidden(object)) {
			object.visible = false;
			hidden++;
		}
	});
	return hidden;
}

// model-viewer keeps its three.js scene under an instance Symbol('scene')
// (pinned 4.4.0, loaded with SRI). It is not public API, so a missing handle
// leaves the model exactly as model-viewer rendered it.
function sceneOf(mv) {
	const key = Object.getOwnPropertySymbols(mv).find((s) => s.description === 'scene');
	const scene = key && mv[key];
	return scene && typeof scene.traverse === 'function' ? scene : null;
}

function apply(mv) {
	const scene = sceneOf(mv);
	if (!scene) return;
	if (hideMarkedNodes(scene) > 0 && typeof scene.queueRender === 'function') scene.queueRender();
}

/** Applies node visibility on every model load of a <model-viewer>. */
export function bindModelViewer(mv) {
	if (!mv) return;
	mv.addEventListener('load', () => apply(mv));
	if (mv.loaded) apply(mv);
}

// /viewer loads this file as `<script type="module" src>` (an inline module
// would go through Vite's html-proxy in dev), so it binds the page's viewer
// itself. Importing it anywhere without a #mv model-viewer does nothing.
if (typeof document !== 'undefined') {
	const mv = document.getElementById('mv');
	if (mv && mv.localName === 'model-viewer') bindModelViewer(mv);
}
