// Text → avatar: the lane plan for a PROMPT with no photos.
//
// POST /api/avatars/reconstruct serves two very different inputs. A selfie goes
// to the avatar-reconstruction service, a face-texture-transfer pipeline: it
// finds the face in the photo, warps it onto a fixed template body, and throws
// the rest of the image away. That is the right tool for a likeness and the
// wrong one for a description. A prompt routed through it came back as the
// template body in its own clothes with a garbled face pasted on, whatever the
// prompt asked for ("a silver-haired explorer in a teal flight jacket and brown
// boots" rendered as a stylized woman in purple leggings, 2026-09-18).
//
// So a prompt now takes the forge's full-body path instead:
//   1. Paint ONE full-body reference image of the character from the prompt
//      (single humanoid, neutral A-pose, head to feet in frame).
//   2. Reconstruct that image into a textured mesh on an image→3D engine that
//      keeps the whole figure: our self-hosted Hunyuan3D-2.1 worker first, then
//      self-hosted TRELLIS, then the platform/external image→3D lanes, then the
//      caller's own Meshy/Tripo key.
//   3. The unchanged reconstruct-finalize tail auto-rigs the bare mesh (UniRig
//      on our own GPU) and materializes the avatar + agent, exactly as before.
//
// The face pipeline (gcp `reconstruct` mode) is never a candidate here.

import { BACKENDS } from './forge-tiers.js';
import { laneAllowedInTerritory } from './forge-territory.js';

// Composition cues appended to the user's own words. They say nothing about
// style, so "an anime ninja" stays anime and "a photoreal chef" stays photoreal;
// they only fix the framing the reconstruction and the rigger both depend on:
// one figure, whole body in frame, limbs readable and separable, nothing in the
// hands fusing into the silhouette, a plain background that mattes cleanly.
export const PROMPT_AVATAR_FRAMING =
	', full-body character, one single person standing upright in a neutral A-pose facing the camera, ' +
	'arms held slightly away from the body, legs slightly apart, the entire figure visible from head to feet ' +
	'with nothing cropped, centered, plain light gray studio background, soft even lighting, ' +
	'empty hands with no props, no text, sharp detail';

// The Hunyuan3D worker's high tier: deepest shape octree and the sharpest PBR
// paint pass. An avatar is the product here, and the worker is ours.
export const PROMPT_AVATAR_TIER = 'high';

export function promptAvatarImagePrompt(prompt) {
	return `${String(prompt || '').trim()}${PROMPT_AVATAR_FRAMING}`;
}

// Ordered image→3D lane plan for a text avatar.
//
// `platform` is getRegenProviderCandidates() ([{ name, instance }]), `byok` the
// caller's own provider adapters in the same shape, and `health` an optional
// laneHealthSnapshot().byId for the self-host lanes. Returns
// [{ name, instance, mode, lane, params }]: `name` is what lands in
// avatar_regen_jobs.provider (so the status poll and the sweep load the same
// adapter), `mode` is what the adapter is asked to run.
//
// A self-host lane whose probe says its model is not loaded or the service is
// unreachable is moved to the back rather than dropped: its submit would be
// accepted and the job would then fail on the worker, which costs the user the
// whole wait. A lane that is merely in a failure cooldown keeps its place, since
// one failed job (often a bad input) is not an outage.
export function planPromptAvatarLanes({ platform = [], byok = [], health = {}, country = null } = {}) {
	const byName = new Map(platform.filter((p) => p?.instance).map((p) => [p.name, p.instance]));
	const plan = [];
	const gcp = byName.get('gcp');
	const supports = (instance, mode) => {
		try {
			return typeof instance?.supportsMode === 'function' ? Boolean(instance.supportsMode(mode)) : true;
		} catch {
			return false;
		}
	};
	const selfHost = (mode, lane) => ({
		name: 'gcp',
		instance: gcp,
		mode,
		lane,
		params: { tier: PROMPT_AVATAR_TIER, path: 'image' },
	});

	// TRELLIS.2 leads: MIT licensed, served in every region. Two Tencent lanes
	// exist, self-host Hunyuan3D and the HuggingFace Spaces chain running it, and
	// both are dropped for the EU, the UK, South Korea and an unknown country.
	if (gcp && supports(gcp, 'trellis2')) plan.push(selfHost('trellis2', 'trellis2'));
	if (gcp && supports(gcp, 'hunyuan') && laneAllowedInTerritory('hunyuan3d', country)) {
		plan.push(selfHost('hunyuan', 'hunyuan3d'));
	}
	if (gcp && supports(gcp, 'trellis')) plan.push(selfHost('trellis', 'trellis_selfhost'));
	// Replicate's reconstruct model is TRELLIS (generic image→3D), and the HF
	// Spaces chain is Hunyuan3D / TRELLIS / TripoSR: both keep the whole figure.
	for (const name of ['replicate', 'huggingface']) {
		const instance = byName.get(name);
		if (instance && laneAllowedInTerritory(name, country)) {
			plan.push({ name, instance, mode: 'reconstruct', lane: name, params: {} });
		}
	}
	for (const p of byok) {
		if (p?.instance) plan.push({ name: p.name, instance: p.instance, mode: 'reconstruct', lane: p.name, params: {} });
	}

	const hardDown = (entry) => {
		if (!BACKENDS[entry.lane]) return false;
		const rec = health?.[entry.lane];
		return Boolean(rec && rec.status === 'down' && !rec.cooled);
	};
	return [...plan.filter((e) => !hardDown(e)), ...plan.filter(hardDown)];
}
