/**
 * /open?link=<web+threews link>: the manifest's protocol_handlers target.
 *
 * Windows hands every web+threews: link (from Teams, Outlook, Word, the Run box
 * or another browser) to the installed app at this URL. The parser decides
 * whether it is a supported, safe link; a good one replaces this page with its
 * destination so Back does not bounce through it, and a bad one stays here and
 * says what was wrong.
 */

import { parseThreewsLink } from './pwa/protocol-link.js';

const link = new URLSearchParams(location.search).get('link');
const result = parseThreewsLink(link);

if (result.ok) {
	document.getElementById('ol-msg').textContent = `Opening ${result.kind === 'forge' ? 'the forge' : `this ${result.kind}`}.`;
	location.replace(result.target);
} else {
	document.title = 'Link not opened · three.ws';
	document.getElementById('ol-title').textContent = 'This link could not be opened';
	document.getElementById('ol-msg').textContent = result.message;
	if (typeof link === 'string' && link.trim()) {
		const raw = document.getElementById('ol-raw');
		raw.textContent = link.length > 300 ? `${link.slice(0, 300)}...` : link;
		raw.hidden = false;
	}
	document.getElementById('ol-actions').hidden = false;
}
