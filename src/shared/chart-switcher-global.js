// The chart-source switcher for buildless pages, published at /chart-switcher.js.
//
// A stable-named build entry is emitted as a facade that imports its hashed
// chunk for side effects and re-exports nothing, so a page served from public/
// cannot `import { mountSwitchableChart }` from it. Like /herald.js, it
// publishes on `window` instead: the page loads this script with a dynamic
// import, then calls `mountSwitchableChart` off `window.threeChartSwitcher`
// (see mountChart in public/oracle-coin.js for the call site).
//
// Bundled pages import src/shared/chart-switcher.js directly and never load this.

import { mountSwitchableChart } from './chart-switcher.js';

if (typeof window !== 'undefined' && !window.threeChartSwitcher) {
	window.threeChartSwitcher = { mountSwitchableChart };
}
