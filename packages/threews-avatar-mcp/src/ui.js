// MCP Apps (SEP-1865) UI resource wiring.
//
// render_avatar is an MCP App: it declares a ui:// resource that the host
// renders in a sandboxed iframe (an interactive, rotatable <model-viewer>).
// This module owns the resource URI, MIME type, the CSP the sandbox must grant
// (so the iframe can load model-viewer from the CDN and the GLB from R2 /
// three.ws), and reading the prebuilt HTML bundle.

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

export const UI_RESOURCE_URI = 'ui://threews-avatar/avatar.html';

// The MCP Apps MIME type (text/html;profile=mcp-app) — identifies an HTML
// payload as an interactive app resource per the MCP Apps spec.
export const UI_MIME_TYPE = 'text/html;profile=mcp-app';

// Origins the sandboxed iframe is allowed to reach. connectDomains → fetch/XHR
// (model-viewer fetches the GLB); resourceDomains → scripts/img/media/etc.
// (the model-viewer CDN script + GLB/textures). Wildcard subdomains are
// supported by the spec.
export const UI_CSP = {
	connectDomains: [
		'https://cdn.jsdelivr.net',
		'https://*.r2.dev',
		'https://three.ws',
		'https://*.three.ws',
	],
	resourceDomains: [
		'https://cdn.jsdelivr.net',
		'https://*.r2.dev',
		'https://three.ws',
		'https://*.three.ws',
		'https://fonts.gstatic.com',
	],
};

// The _meta.ui object placed on the UI resource (carries the CSP grant).
export const UI_RESOURCE_META = { ui: { csp: UI_CSP } };

// The _meta.ui object placed on the render_avatar tool (links it to the UI).
export const UI_TOOL_META = { ui: { resourceUri: UI_RESOURCE_URI } };

const here = dirname(fileURLToPath(import.meta.url));
let cachedHtml = null;

// Read the prebuilt, self-contained app HTML (app/build.mjs writes it here).
export function loadAppHtml() {
	if (cachedHtml == null) {
		cachedHtml = readFileSync(join(here, 'avatar-app.html'), 'utf8');
	}
	return cachedHtml;
}
