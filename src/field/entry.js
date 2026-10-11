// `/` entry. The Field is home; the windowed desktop and the walkable campus
// still answer at `?view=desktop` and `?world=1`.

import { wantsLegacy } from './logic.js';

if (wantsLegacy(location.search)) {
	import('../desktop/main.js');
} else {
	import('./field.js')
		.then(({ mountField }) => mountField(document.getElementById('os')))
		.catch((err) => {
			console.error('[field] failed to start', err);
			const root = document.getElementById('os');
			if (root) root.insertAdjacentHTML('afterbegin', '<p style="padding:24px;color:#fff;font:15px system-ui">The map could not start. Every page is linked below, or <a style="color:#b8a6ff" href="/?view=desktop">open the desktop</a>.</p>');
		});
}
