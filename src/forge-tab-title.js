// The browser tab's title while a Forge generation runs.
//
// A person who switches tabs to read something else while a model builds should
// be able to tell from the tab strip whether it is still running, done, or
// stopped, without coming back to look. The title is rewritten only from the
// page's real state (the same signals that switch the panels), and the page's
// own title is put back the moment the generation stops being the thing on
// screen.

import { formatClock } from './forge-eta.js';

const SUFFIX = ' · three.ws';

export function createTabTitle(doc = document) {
	let base = null;
	let last = '';
	// 'running' | 'done' | 'failed' | null. Decides what a panel switch means.
	let state = null;

	function remember() {
		// Capture the page title the first time we change it, and again if something
		// else (the locale loader, a route alias) rewrote it while we were idle.
		if (base === null || (doc.title !== last && doc.title !== base)) base = doc.title;
	}

	function set(text) {
		remember();
		last = text;
		if (doc.title !== text) doc.title = text;
	}

	// A finished-model title is for someone who looked away. Once the tab is in
	// front of them again it has done its job, so the page title comes back.
	doc.addEventListener?.('visibilitychange', () => {
		if (doc.visibilityState === 'visible' && state === 'done') api.idle();
	});

	const api = {
		/** A generation is running. `elapsedS` is the real elapsed time. */
		running(elapsedS = 0) {
			state = 'running';
			set(`Forging ${formatClock(elapsedS)}${SUFFIX}`);
		},
		/** The model finished. */
		done() {
			state = 'done';
			set(`Model ready${SUFFIX}`);
		},
		/** The generation stopped without a model. */
		failed() {
			state = 'failed';
			set(`Forge stopped${SUFFIX}`);
		},
		/** Something other than a generation is on screen: restore the page title. */
		idle() {
			state = null;
			if (base === null) return;
			if (doc.title === last) doc.title = base;
			base = null;
			last = '';
		},
		/**
		 * The page switched panels. A running generation keeps its title, a finished
		 * one keeps "Model ready" while its result is shown, an error panel reads as
		 * stopped, and every other panel gets the page's own title back.
		 */
		show(panel) {
			if (panel === 'generating') {
				if (state !== 'running') api.running(0);
			} else if (panel === 'result') {
				if (state !== 'done') api.idle();
			} else if (panel === 'error') {
				api.failed();
			} else {
				api.idle();
			}
		},
	};
	return api;
}