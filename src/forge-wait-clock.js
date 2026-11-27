// The two clocks behind the Forge wait meter.
//
// A generation has two durations that the page used to treat as one:
//
//   total  from the click (or, for a resumed page, from the job's start). This
//          is the "Elapsed" readout and the tab title: how long the person has
//          been waiting. It only ever moves forward.
//   lane   from the moment the job was accepted by a GPU lane. The measured lane
//          range (/api/nvidia/stats p50 and p95) is created_at to completed_at
//          of the job row, and that row is written only after the art director,
//          the reference image and the lane submit have finished. So the range
//          is only comparable with this clock, never with the total one.
//
// The server's `elapsed_seconds` on every poll is the job row's age. It pushes
// the lane clock forward when the row is older than this tab thought (a coalesced
// job already in flight), and pulls it back only when the job moved to another
// lane (a failover successor is a new, younger row). The age is read when the
// server handles the poll, so a slow response carries an old figure (measured
// live: a poll answered 34 s after it was sent reported 22 s for a job 51 s old).
// A job cannot get younger on the lane it is on, so a younger age on the same
// lane is ignored. The one exception is the first age
// after acceptance or a resume: until then the lane start is a local guess (the
// moment the submit answered, or the click for a resumed page), so the first
// server figure replaces it either way. The total clock is only ever pushed
// forward, because the time before the row existed was real waiting too.
//
// Nothing here advances on its own: every read is a function of the injected
// clock, and forge.js re-reads once a second.

// A drift smaller than this is an ordinary poll round-trip, not a correction.
const DRIFT_S = 2;

export function createWaitClock({ now = () => performance.now() } = {}) {
	let startMs = null;
	let laneStartMs = null;
	// True while laneStartMs is a local guess no server age has confirmed yet.
	let provisional = false;

	const ageS = (fromMs) => (now() - fromMs) / 1000;

	const api = {
		/** A fresh generation started (the click). */
		start() {
			startMs = now();
			laneStartMs = null;
			provisional = false;
		},
		/**
		 * A generation that already exists was picked up again (reload, rejoin).
		 * `waitedS` is the time since its click. `onLane` is false when the submit
		 * had not answered yet, so no job is on a lane.
		 */
		resume(waitedS = 0, { onLane = true } = {}) {
			const s = Math.max(0, Number(waitedS) || 0);
			startMs = now() - s * 1000;
			laneStartMs = onLane ? startMs : null;
			provisional = onLane;
		},
		/**
		 * The submit answered with a job id. The row was written moments before,
		 * so this is the local stand-in for its created_at until a poll says more.
		 */
		accepted() {
			if (startMs === null) startMs = now();
			if (laneStartMs === null) {
				laneStartMs = now();
				provisional = true;
			}
		},
		/**
		 * Fold in the server's age of the job row. `laneChanged` is true when this
		 * poll moved the job to another lane; that and the first age after a local
		 * guess are the only cases where the lane clock may go back. Returns true
		 * when a clock moved.
		 */
		anchor(serverJobAgeS, { laneChanged = false } = {}) {
			const s = Number(serverJobAgeS);
			if (!Number.isFinite(s) || s < 0 || startMs === null) return false;
			let moved = false;
			const drift = laneStartMs === null ? Infinity : s - ageS(laneStartMs);
			const mayRewind = laneChanged || provisional;
			provisional = false;
			if (drift >= DRIFT_S || (mayRewind && Math.abs(drift) >= DRIFT_S)) {
				laneStartMs = now() - s * 1000;
				moved = true;
			}
			if (s - ageS(startMs) >= DRIFT_S) {
				startMs = now() - s * 1000;
				moved = true;
			}
			return moved;
		},
		/** Whole seconds since the wait began. */
		totalS() {
			return startMs === null ? 0 : Math.floor(ageS(startMs));
		},
		/** Whole seconds the job has been on its lane, or null before acceptance. */
		laneS() {
			return laneStartMs === null ? null : Math.max(0, Math.floor(ageS(laneStartMs)));
		},
	};
	return api;
}
