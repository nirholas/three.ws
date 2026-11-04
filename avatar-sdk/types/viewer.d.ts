// Type declarations for @three-ws/avatar/viewer.
//
// Registers a `<three-ws-viewer>` custom element on import. Pure visual
// renderer: GLB + OrbitControls + ambient/dir lights. No chat, no voice,
// no skills. Peer-depends on `three`.

export {};

declare global {
	interface HTMLElementTagNameMap {
		'three-ws-viewer': ThreeWsViewerElement;
	}
}

/**
 * `<three-ws-viewer src="..." alt="..." background="..." ar>`
 *
 * Attributes:
 *  - `src` — GLB URL (required to render anything). Supports
 *    `EXT_meshopt_compression` and `KHR_draco_mesh_compression` transparently.
 *  - `alt` — accessibility label and caption text. Defaults to
 *    `"3D model viewer"` when unset so the canvas is never unlabeled.
 *  - `background` — CSS color string, or `'transparent'`. Default transparent.
 *  - `auto-rotate` - opt-in boolean. Slowly spins the model when idle.
 *    Ignored under `prefers-reduced-motion: reduce`.
 *  - `autoplay` - opt-in boolean. Loops the model's own animation clip (the
 *    clip named by `animation-name`, else the first one), like
 *    `<model-viewer autoplay>`. Under `prefers-reduced-motion: reduce` the clip
 *    is held at its first frame instead of looping.
 *  - `animation-name` - which embedded clip `autoplay` plays.
 *  - `ar` — opt-in boolean. Renders a "View in AR" button that opens the
 *    platform's device-aware AR launcher (`three.ws/api/ar`) in a new tab:
 *    Android → Google Scene Viewer, iOS → Apple Quick Look, desktop → the
 *    interactive viewer. Absent by default; existing embeds are unaffected.
 *
 * Accessibility: the canvas is keyboard-focusable (`role="img"`, matching
 * `<model-viewer>`'s own pattern) and orbits/zooms via Arrow keys and
 * `+`/`-`/PageUp/PageDown. `prefers-reduced-motion: reduce` disables orbit
 * damping (no lingering inertia after a drag or key press).
 *
 * Performance: on a detected low-power device (coarse pointer + ≤4 cores or
 * ≤4GB `deviceMemory`) the viewer starts at a lower pixel ratio, skips MSAA
 * and the PMREM environment prefilter. Independently, if live frame time
 * shows sustained <~24fps for ~1.5s, pixel ratio is stepped down once at
 * runtime (never re-escalated mid-session).
 *
 * Events:
 *  - `load`      — `CustomEvent<{ url: string }>` once the GLB is parsed and added.
 *  - `error`     — `CustomEvent<{ url: string, error: Error }>` on load failure.
 *  - `ar-launch` — `CustomEvent<{ src: string, launchUrl: string }>` when the
 *    AR button is activated.
 */
export class ThreeWsViewerElement extends HTMLElement {
	/** GLB URL. Reflects the `src` attribute. */
	src: string | null;
	/** Accessibility label and caption. Reflects the `alt` attribute. */
	alt: string | null;
	/** CSS color or 'transparent'. Reflects the `background` attribute. */
	background: string | null;
	/** Show the "View in AR" button. Reflects the `ar` attribute. */
	ar: boolean;
	/** Spin the model when idle. Reflects the `auto-rotate` attribute. */
	autoRotate: boolean;
	/** Loop the model's own clip. Reflects the `autoplay` attribute. */
	autoplay: boolean;
	/** Embedded clip `autoplay` plays. Reflects the `animation-name` attribute. */
	animationName: string | null;
	/** Names of the clips the loaded model carries, in file order. */
	readonly availableAnimations: string[];
}

export default ThreeWsViewerElement;
