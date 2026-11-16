// MSAL v5 redirect bridge for the OneDrive and SharePoint actions
// (/auth/microsoft/redirect, the SPA redirect URI on the three.ws Entra app).
// The sign-in popup lands here; this hands the response back to the opener
// over BroadcastChannel so loginPopup / acquireTokenPopup resolve there.
// Served from our own origin with no-store caching and no COOP header, as
// MSAL requires.

import { broadcastResponseToMainFrame } from '@azure/msal-browser/redirect-bridge';

const msg = document.getElementById('bridge-msg');

broadcastResponseToMainFrame()
	.then(() => {
		if (msg) msg.textContent = 'Signed in. This window closes on its own.';
	})
	.catch(() => {
		if (msg) msg.textContent = 'Sign-in could not finish here. Close this window and try again from three.ws.';
	});
