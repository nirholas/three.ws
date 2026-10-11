// `/` entry. The desktop is home (with its campus at `?world=1`); the Field,
// the zoomable map of every agent and surface, answers at `?view=field`.

import { wantsField } from './logic.js';

if (!wantsField(location.search)) {
	import('../desktop/main.js');
} else {
	import('./field.js')
		.then(({ mountField }) => mountField(document.getElementById('os')))
		.catch((err) => {
			console.error('[field] failed to start', err);
			const root = document.getElementById('os');
			if (root) root.insertAdjacentHTML('afterbegin', '<p style="padding:24px;color:#fff;font:15px system-ui">The map could not start. <a style="color:#b8a6ff" href="/">Open the desktop</a> instead.</p>');
		});
}
