// Real-world occlusion for WebXR via the depth-sensing API.
//
// On a depth-capable device the placed agent should hide behind real geometry
// a couch, a doorway, a person walking in front: instead of always painting on
// top of the camera feed. That single perception upgrade is what separates an
// object that lives in the room from a sticker pasted on video.
//
// Mechanism (three.js gpu-optimized depth path): when the live session
// negotiated `depth-sensing` with `gpu-optimized` usage, three's WebXRManager
// pulls the per-frame XRWebGLDepthInformation, wraps it as an ExternalTexture,
// and: every presenting frame: renders a fullscreen occluder quad *itself*,
// ahead of the scene (`projectObject(getDepthSensingMesh(), camera, -Infinity)`
// inside WebGLRenderer.render). That quad's fragment shader writes the
// *real-world* depth into the depth buffer, so any agent fragment behind real
// geometry fails the normal depth test and is discarded: true occlusion, no
// custom shader of our own, and no need to add the mesh to the scene graph.
// (Adding it would put the same mesh in the render list a second time and draw a
// redundant fullscreen depth pass every frame.)
//
// This helper therefore does the two things three's built-in path leaves to the
// app: (1) gate the whole thing on the feature actually being negotiated, and
// (2) configure three's occluder material so it writes depth but *no colour*
// the shader emits only gl_FragDepth, so the default colorWrite:true would paint
// undefined garbage over the camera passthrough. It also frees the occluder's
// GPU resources on exit, which three's own session-end reset() does not.
//
// Degrades silently: when the session has no depth-sensing feature (most devices
// today) or the UA only offered cpu-optimized data, three never builds the mesh,
// this never configures anything, and behavior is byte-for-byte identical to the
// pre-occlusion path: no error, no console noise, the AR button works as before.

export class DepthOcclusion {
	/**
	 * @param {import('three').WebGLRenderer} renderer Active XR renderer. The
	 *   occluder mesh is owned and drawn by `renderer.xr` itself, so the scene is
	 *   never needed here: this only reads + configures what three exposes.
	 */
	constructor(renderer) {
		this._renderer = renderer;
		/** @type {import('three').Mesh|null} three's occluder, once configured. */
		this._mesh = null;
		this._enabled = false;
	}

	/**
	 * Cheap one-shot check: did the live session actually negotiate depth-sensing?
	 * Use it right after `renderer.xr.setSession` to decide whether to stand up the
	 * occluder at all: on every other device this is false and the per-frame tick
	 * never touches depth. The optional chaining guards UAs that don't populate
	 * `enabledFeatures` (the spec leaves it optional).
	 * @param {XRSession|null|undefined} session
	 * @returns {boolean}
	 */
	static sessionHasDepth(session) {
		return !!session?.enabledFeatures?.includes?.('depth-sensing');
	}

	/**
	 * Per-frame hook. Configures three's occluder material the first frame real
	 * depth data is available, then returns immediately on every subsequent frame
	 * three owns the mesh and updates the depth texture in place, so no further
	 * work (and zero allocation) is needed in steady state. Must run before the
	 * frame's `renderer.render` so the material is set before three draws the quad.
	 * Safe to call when depth-sensing is unsupported: the renderer reports no depth
	 * and this is a no-op.
	 */
	update() {
		if (this._mesh) return; // configured: three drives the texture + draw each frame
		const xr = this._renderer.xr;
		// Three only builds the occluder for the gpu-optimized path; if the UA
		// handed back cpu-optimized data this stays false forever and we degrade.
		if (typeof xr.hasDepthSensing !== 'function' || !xr.hasDepthSensing()) return;
		const mesh = xr.getDepthSensingMesh?.();
		if (mesh) this._configure(mesh);
	}

	/** @param {import('three').Mesh} mesh three's cached depth-sensing occluder. */
	_configure(mesh) {
		const material = mesh.material;
		// The occluder exists only to stamp real-world depth: it must paint no
		// colour, or the passthrough camera feed shows shader garbage where the
		// agent isn't drawn (three's occlusion shader emits gl_FragDepth only and
		// never assigns a colour, so the default colorWrite:true is undefined out).
		material.colorWrite = false;
		material.depthWrite = true;
		// Fullscreen depth fill on a freshly-cleared buffer: always write, never
		// gate on a prior depth value.
		material.depthTest = false;
		// The vertex shader emits clip-space coordinates directly and ignores the
		// model matrix, so the mesh's world bounds are meaningless: never let
		// frustum culling drop it as the camera moves around the room.
		mesh.frustumCulled = false;
		this._mesh = mesh;
		this._enabled = true;
	}

	/** True once the occluder is live (configured for the current session). */
	get enabled() {
		return this._enabled;
	}

	/**
	 * Free the occluder on session exit. three's session-end `reset()` only nulls
	 * its references to the mesh + texture: it never disposes the geometry,
	 * material, or compiled program: so without this each AR entry would leak a
	 * fullscreen quad + shader program. By the time this runs the render loop is
	 * already stopped and no further frame draws the mesh, so freeing it is safe;
	 * three rebuilds a fresh occluder on the next session. The depth texture itself
	 * is an external handle owned by the XR runtime: material.dispose() never
	 * touches uniform textures, so it is correctly left alone.
	 */
	dispose() {
		if (this._mesh) {
			this._mesh.geometry?.dispose();
			this._mesh.material?.dispose();
			this._mesh = null;
		}
		this._enabled = false;
	}
}
