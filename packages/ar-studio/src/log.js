// Tiny gated logger. A shipped page's console should be quiet: noise hides real
// problems. Diagnostics print only when the host opts in (`?ar-debug` in the
// URL, `localStorage['ar-studio:debug'] = '1'`, or `setLogLevel('debug')`);
// errors always print, because a real error is a bug to fix, not noise to mute.

const noop = () => {};

function optedIn() {
	if (typeof window === 'undefined') return false;
	try {
		const params = new URLSearchParams(window.location.search);
		if (params.has('ar-debug') && params.get('ar-debug') !== '0') return true;
		return window.localStorage?.getItem('ar-studio:debug') === '1';
	} catch {
		// Sandboxed iframe / storage disabled: treat as no opt-in.
		return false;
	}
}

let verbose = optedIn();

const bind = (method) =>
	typeof console !== 'undefined' && typeof console[method] === 'function'
		? console[method].bind(console)
		: noop;

/** Turn verbose diagnostics on or off at runtime. */
export function setVerbose(on) {
	verbose = Boolean(on);
}

/** Whether verbose diagnostics are currently enabled. */
export function isVerbose() {
	return verbose;
}

const gate = (method) => (...args) => {
	if (verbose) bind(method)(...args);
};

export const log = {
	error: (...a) => bind('error')(...a),
	warn: gate('warn'),
	info: gate('info'),
	debug: gate('debug'),
	log: gate('log'),
};

/**
 * A logger that prefixes every line with `[tag]`.
 * @param {string} tag
 */
export function createLogger(tag) {
	const prefix = `[${tag}]`;
	return {
		error: (...a) => bind('error')(prefix, ...a),
		warn: (...a) => { if (verbose) bind('warn')(prefix, ...a); },
		info: (...a) => { if (verbose) bind('info')(prefix, ...a); },
		debug: (...a) => { if (verbose) bind('debug')(prefix, ...a); },
		log: (...a) => { if (verbose) bind('log')(prefix, ...a); },
	};
}

export default log;
