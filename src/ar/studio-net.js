// three.ws binding for the shared-room client. The room protocol, reconnect and
// timeout logic live in the 3d-ar-studio package (packages/ar-studio); this file
// only supplies what is specific to the hosted site: which Colyseus host to dial.
// Rooms run on the SAME server as /walk and /irl (a new room, not a new process).

import { StudioNet as PackageStudioNet } from '../../packages/ar-studio/src/studio/net.js';

// Resolve the Colyseus host the same way irl-net does.
function defaultServerUrl() {
	if (typeof window !== 'undefined') {
		if (window.STUDIO_SERVER_URL) return String(window.STUDIO_SERVER_URL).trim().replace(/\/$/, '');
		if (window.IRL_SERVER_URL) return String(window.IRL_SERVER_URL).trim().replace(/\/$/, '');
		if (window.WALK_SERVER_URL) return String(window.WALK_SERVER_URL).trim().replace(/\/$/, '');
	}
	if (typeof document !== 'undefined') {
		for (const name of ['studio-server', 'irl-server', 'walk-server']) {
			const v = document.querySelector(`meta[name="${name}"]`)?.getAttribute('content')?.trim();
			if (v) return v.replace(/\/$/, '');
		}
	}
	try {
		const envUrl = import.meta?.env?.VITE_IRL_SERVER_URL || import.meta?.env?.VITE_WALK_SERVER_URL;
		if (envUrl) return String(envUrl).trim().replace(/\/$/, '');
	} catch { /* import.meta.env is absent outside Vite */ }
	if (typeof location !== 'undefined') {
		const proto = location.protocol === 'https:' ? 'wss:' : 'ws:';
		const host = location.hostname;
		const fwd = host.match(/^(.*)-(\d+)\.(app\.github\.dev|githubpreview\.dev|gitpod\.io)$/);
		if (fwd) return `${proto}//${fwd[1]}-2567.${fwd[3]}`;
		let isProd = false;
		try { isProd = import.meta?.env?.PROD === true; } catch { /* import.meta.env is absent outside Vite */ }
		const isLocalHost = host === 'localhost' || host === '127.0.0.1';
		if (!isProd || isLocalHost) return `${proto}//${host}:2567`;
		return '';
	}
	return '';
}

export class StudioNet extends PackageStudioNet {
	/** @param {ConstructorParameters<typeof PackageStudioNet>[0]} [opts] */
	constructor(opts = {}) {
		super({ ...opts, url: opts.url ?? defaultServerUrl() });
	}
}
