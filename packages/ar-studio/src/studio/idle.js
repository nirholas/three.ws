// Idle animation for any humanoid model, with no rig allowlist.
//
// A character standing in your room in a bind-pose T is the single fastest way
// to break the illusion, and most GLBs of people ship with no baked clip at all.
// So instead of shipping a curated list of supported rigs, the studio maps the
// model's own bone names onto a canonical skeleton (Mixamo, Avaturn, Unreal,
// VRM/VRoid, Daz, MakeHuman, Blender `.L`, and plain `shoulderL` conventions are
// all covered) and retargets a pre-baked idle clip onto it.
//
// Rigs that genuinely cannot be driven (no skin, a non-humanoid prop) fail the
// support gate and simply stay static: exactly as they would have anyway.
// Animation is upside here, never a gate: every failure path returns null and
// the model still shows up.
//
// The clip JSON is fetched once per page and shared by every model on it.

import { AnimationManager } from '../anim/animation-manager.js';
import { THREE_WS } from '../config.js';
import { createLogger } from '../log.js';

const log = createLogger('ar-studio:idle');

let _clipPromise = null;
let _clipKey = '';

/**
 * Fetch (once) the idle clip JSON from an animation manifest.
 *
 * @param {{manifestUrl?: string, clip?: string}} [opts]
 * @returns {Promise<object|null>} raw AnimationClip JSON, or null when unavailable
 */
export function getIdleClipJson({ manifestUrl = THREE_WS.animationManifest, clip = 'idle' } = {}) {
	const key = `${manifestUrl}#${clip}`;
	if (_clipPromise && _clipKey === key) return _clipPromise;
	_clipKey = key;
	_clipPromise = (async () => {
		const manifest = await fetch(manifestUrl, { cache: 'force-cache' }).then((r) => {
			if (!r.ok) throw new Error(`HTTP ${r.status}`);
			return r.json();
		});
		const list = Array.isArray(manifest) ? manifest : (manifest?.clips || manifest?.animations || []);
		const def = list.find((d) => d?.name === clip) || list[0];
		if (!def?.url) throw new Error(`clip "${clip}" missing from the manifest`);
		const url = new URL(def.url, manifestUrl).href;
		const res = await fetch(url, { cache: 'force-cache' });
		if (!res.ok) throw new Error(`HTTP ${res.status}`);
		return res.json();
	})().catch((err) => {
		log.warn('idle clip unavailable:', err?.message || err);
		_clipPromise = null; // let a later mount retry rather than poisoning the page
		return null;
	});
	return _clipPromise;
}

/**
 * Attach an idle-playing AnimationManager to a freshly loaded model. Call BEFORE
 * adding it to the scene: the retarget maps are captured from the authored bind
 * pose.
 *
 * @param {import('three').Object3D} model  The loaded gltf.scene (or a clone).
 * @param {{manifestUrl?: string, clip?: string, sourceUrl?: string}} [opts]
 * @returns {Promise<AnimationManager|null>} a manager already playing idle: call
 *   `.update(dt)` each frame and `.detach()` when the model is removed: or null
 *   when this rig cannot be driven.
 */
export async function mountIdle(model, { manifestUrl, clip = 'idle', sourceUrl = '' } = {}) {
	const clipJson = await getIdleClipJson({ manifestUrl, clip });
	if (!clipJson || !model) return null;
	const mgr = new AnimationManager();
	try {
		mgr.attach(model, { avatarUrl: sourceUrl });
		if (!mgr.supportsCanonicalClips()) {
			mgr.detach();
			return null;
		}
		// A rig whose arm bones did not name-map would idle its torso and legs with
		// both arms frozen out in a T. Swing those undriven arms down first (a no-op
		// when the arms do map), so a room full of models never shows that.
		mgr.relaxUndrivenArms();
		mgr.injectClip(clip, clipJson, { loop: true });
		const playing = await mgr.play(clip);
		if (!playing) {
			mgr.detach();
			return null;
		}
		// Desynchronize: start each model at a random phase so a group of them does
		// not breathe in eerie lockstep.
		const action = mgr.currentAction;
		const duration = action?.getClip?.()?.duration || 0;
		if (action && duration > 0) action.time = Math.random() * duration;
		mgr.update(0);
		return mgr;
	} catch (err) {
		log.warn('idle mount failed:', err?.message || err);
		try { mgr.detach(); } catch { /* already clean */ }
		return null;
	}
}
