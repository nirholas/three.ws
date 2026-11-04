// src/irl/glasses/native-bridge.js: the web half of the native Meta Wearables lane.
//
// The lens web app (and any WebView) cannot hear or see through the glasses. The
// iOS and Android shells carry a Capacitor plugin, `ThreeWsWearables`, that wraps
// the Meta Wearables Device Access Toolkit. This module is how /irl reaches it,
// feature-detected so the plain web build never loads native code and never
// throws when the plugin is absent.
//
// Voice. The toolkit routes the glasses microphone and speakers as the system's
// Bluetooth audio device. The plugin's job is to open that route
// (`startAudioRoute`); once it is open the WebView's own getUserMedia capture and
// <audio> playback ride the glasses, so the conversation runs through the same
// TalkController pipeline as every other talk surface. Nothing here re-implements
// speech: no new vendor, no second transcription path.
//
// Camera. Frames come back from `capturePhoto` as an in-memory JPEG, are decoded,
// matched against the pin's stored marker anchor, and dropped. The frame is never
// uploaded and never written anywhere (docs/irl/THREAT-MODEL.md): this module has
// no network code at all, and `relocalize` returns numbers only.

import { cornerCenter, cornerRightMid, pickBestMarker } from '../qr-detect.js';
import { markerPoseCamera, DEFAULT_MARKER_SIZE_M } from '../marker-pose.js';
import { markerRoomId } from '../marker-anchor.js';

export const WEARABLES_PLUGIN = 'ThreeWsWearables';

/** Session states the plugin reports, in lifecycle order. */
export const SESSION_STATES = Object.freeze([
	'unavailable', // toolkit not present on this OS version or build
	'disconnected', // toolkit present, no glasses paired / in range
	'connecting',
	'connected', // glasses paired and a device session is live
	'error',
]);

/**
 * The native plugin, or null on the plain web build. Never throws.
 * @param {object} [win]  window-like (injectable for tests)
 */
export function getWearablesPlugin(win = typeof window !== 'undefined' ? window : undefined) {
	try {
		const cap = win?.Capacitor;
		if (!cap) return null;
		const native = typeof cap.isNativePlatform === 'function' ? cap.isNativePlatform() : false;
		if (!native) return null;
		const plugin = cap.Plugins?.[WEARABLES_PLUGIN];
		return plugin && typeof plugin.getSession === 'function' ? plugin : null;
	} catch {
		return null;
	}
}

/** Whether this build can reach glasses natively at all. */
export function nativeWearablesAvailable(win) {
	return getWearablesPlugin(win) !== null;
}

function coded(message, code) {
	const e = new Error(message);
	e.code = code;
	return e;
}

/**
 * Pose of the pin's marker as seen in one glasses frame, in camera space, or a
 * reason it could not be computed. Pure: numbers in, numbers out.
 *
 * @param {object} p
 * @param {Array<{rawValue?:string, cornerPoints:Array<{x:number,y:number}>}>} p.detections  QR detections in the frame
 * @param {{w:number,h:number}} p.frame
 * @param {number} p.vfovDeg  glasses camera vertical field of view
 * @param {string} p.anchorRoomId  the pin's stored marker room id (`m-...`)
 * @param {number} [p.markerSizeM]
 * @returns {{ok:true, center:object, right:object, distanceM:number, roomId:string}
 *          |{ok:false, reason:'no_marker'|'wrong_marker'|'bad_read'}}
 */
export function relocalizeFromDetections({ detections, frame, vfovDeg, anchorRoomId, markerSizeM = DEFAULT_MARKER_SIZE_M }) {
	const mine = (detections || []).filter((d) => markerRoomId(d?.rawValue) === anchorRoomId);
	if (!mine.length) {
		const any = pickBestMarker(detections, { frame });
		return { ok: false, reason: any ? 'wrong_marker' : 'no_marker' };
	}
	const best = pickBestMarker(mine, { frame });
	if (!best) return { ok: false, reason: 'no_marker' };
	const pose = markerPoseCamera({
		center: cornerCenter(best.cornerPoints),
		rightMid: cornerRightMid(best.cornerPoints),
		spanPx: best.spanPx,
		frame,
		vfovDeg,
		markerSizeM,
	});
	if (!pose.ok) return { ok: false, reason: 'bad_read' };
	return { ok: true, center: pose.center, right: pose.right, distanceM: pose.distanceM, roomId: anchorRoomId };
}

/**
 * The wearables lane, bound to one plugin instance.
 *
 * @param {object} deps
 * @param {object} deps.plugin  the native ThreeWsWearables plugin
 * @param {(blob: Blob) => Promise<{bitmap: any, w:number, h:number, close?:()=>void}>} deps.decode  JPEG to bitmap
 * @param {(bitmap:any) => Promise<Array>} deps.detectQr  QR detector over a decoded bitmap
 */
export function createWearablesLane({ plugin, decode, detectQr }) {
	if (!plugin) throw coded('Native wearables plugin missing', 'unavailable');
	const listeners = new Set();
	let handle = null;
	let routeOpen = false;

	async function status() {
		return plugin.getSession();
	}

	async function watchSession(fn) {
		listeners.add(fn);
		if (!handle) {
			handle = await plugin.addListener('sessionChanged', (s) => {
				for (const l of listeners) {
					try { l(s); } catch { /* a listener must not break the session feed */ }
				}
			});
		}
		return async () => {
			listeners.delete(fn);
			if (!listeners.size && handle) {
				const h = handle;
				handle = null;
				await h.remove();
			}
		};
	}

	/** Open the glasses mic and speakers as the system audio route. */
	async function startVoice() {
		const s = await plugin.getSession();
		if (s.state !== 'connected') throw coded(`Glasses are ${s.state}`, 'not_connected');
		const route = await plugin.startAudioRoute();
		routeOpen = true;
		return route;
	}

	async function stopVoice() {
		if (!routeOpen) return;
		routeOpen = false;
		await plugin.stopAudioRoute();
	}

	/**
	 * Take one frame, find the pin's marker in it, return its camera-space pose.
	 * The frame stays in memory for the duration of this call only.
	 */
	async function relocalize({ anchorRoomId, vfovDeg, markerSizeM }) {
		const s = await plugin.getSession();
		if (s.state !== 'connected') throw coded(`Glasses are ${s.state}`, 'not_connected');
		let decoded = null;
		try {
			const shot = await plugin.capturePhoto();
			const bytes = Uint8Array.from(atob(shot.base64), (c) => c.charCodeAt(0));
			decoded = await decode(new Blob([bytes], { type: shot.mime || 'image/jpeg' }));
			const detections = await detectQr(decoded.bitmap);
			return relocalizeFromDetections({
				detections,
				frame: { w: decoded.w, h: decoded.h },
				vfovDeg: vfovDeg ?? shot.vfovDeg,
				anchorRoomId,
				markerSizeM,
			});
		} finally {
			decoded?.close?.();
			decoded = null;
		}
	}

	return { status, watchSession, startVoice, stopVoice, relocalize };
}
