// Turning a live generation state into one honest line of copy.
//
// Every state below comes straight off the pipeline. Nothing here invents a
// stage the worker has not entered, and no number is fabricated: an ETA is
// rendered only when the API reported one, and the cold-start line appears only
// when the API said the GPU worker is spinning up. That is the difference
// between a progress indicator people trust and a fake progress bar.

const LANES = {
	nvidia: 'free NVIDIA NIM',
	huggingface: 'free Hunyuan3D',
	trellis: 'Fast',
	trellis_selfhost: 'TRELLIS',
	hunyuan3d: 'Hunyuan3D',
	triposg: 'TripoSG',
	meshy: 'Meshy',
	tripo: 'Tripo',
	rodin: 'Rodin',
	stability: 'Stability',
};

/** Human name for a generation backend id, or null when it is unknown. */
export function laneLabel(id) {
	return LANES[String(id || '').trim()] || null;
}

/**
 * One line of narration for a generation state.
 *
 * @param {object} state
 * @param {string} [state.status]        submitting | queued | image | running | done | failed
 * @param {number} [state.etaSeconds]    Seconds remaining, when the API reported one.
 * @param {string} [state.backend]       Lane id, when known.
 * @param {boolean} [state.coldStart]    The worker is booting.
 * @param {number} [state.coldSeconds]   Reported spin-up budget.
 * @returns {string}
 */
export function stageNarration(state = {}) {
	const status = String(state.status || '').toLowerCase();
	const eta = Number(state.etaSeconds) > 0 ? Math.round(Number(state.etaSeconds)) : null;
	const etaSuffix = eta ? `: ~${eta}s` : '';
	const lane = laneLabel(state.backend);
	const laneSuffix = lane ? ` on the ${lane} lane` : ' on the free lane';
	const cold = Boolean(state.coldStart);
	const coldSeconds = Number(state.coldSeconds) > 0 ? Math.round(Number(state.coldSeconds)) : null;
	const coldWho = lane ? ` ${lane}` : '';

	switch (status) {
		case 'submitting':
		case 'submit':
			return `Sending your prompt${laneSuffix}…`;
		case 'queued':
		case 'pending':
		case 'queue':
			if (cold) {
				return coldSeconds
					? `Waking up the${coldWho} GPU worker (about ${coldSeconds}s), then sculpting starts`
					: `Waking up the${coldWho} GPU worker, then sculpting starts`;
			}
			return `Queued${laneSuffix}${etaSuffix}`;
		case 'image':
		case 'texturing':
			return 'Drafting the look…';
		case 'running':
		case 'reconstruct':
		case 'mesh':
			return `Building geometry & texturing${etaSuffix}`;
		case 'done':
		case 'ready':
			return 'Model ready: dropping it into the room';
		case 'failed':
		case 'error':
			return 'Generation failed: try a more concrete, single-object prompt';
		default:
			return `Working${etaSuffix}`;
	}
}

/** Trim a prompt into a card-sized label: the first clause, never mid-word. */
export function promptTitle(prompt, max = 48) {
	const text = String(prompt || '').replace(/\s+/g, ' ').trim();
	if (!text) return 'Model';
	const clause = text.split(/[,.;:]|\s+[--]\s+/)[0].trim() || text;
	if (clause.length <= max) return clause;
	const cut = clause.slice(0, max);
	const space = cut.lastIndexOf(' ');
	return `${(space > max * 0.6 ? cut.slice(0, space) : cut).trim()}…`;
}
