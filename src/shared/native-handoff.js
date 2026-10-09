// In the three.ws iOS app, steps that move money open in Safari instead of
// running in the app's WebView (App Review guidelines 3.1.1 and 3.1.5; see
// ios/docs/REVIEW-RISK.md). The app installs `window.threeWsNative` from
// ios/src/native-bridge.js; everywhere else it is absent and this is a no-op.
//
// Call it first thing in any flow that pays, buys, deposits, tips, swaps or
// launches, and stop when it returns true:
//
//   if (leaveAppForPayment()) return null;
//
// The visitor sees a sheet that explains the hop and opens this page in Safari,
// still signed in, where the same flow runs normally.

/**
 * @param {string} [path] same-origin path Safari should land on; defaults to
 *   the current page, which is where the flow the visitor just started lives.
 * @returns {boolean} true when the app took over and the caller must not
 *   continue the payment here.
 */
export function leaveAppForPayment(path) {
	const native = globalThis.threeWsNative;
	if (typeof native?.requireSafari !== 'function') return false;
	return native.requireSafari(path) === true;
}
