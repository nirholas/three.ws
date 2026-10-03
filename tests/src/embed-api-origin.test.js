// src/shared/embed-api-origin.js decides where every API request of an
// <agent-3d> goes. The bug it exists to prevent: on example.com a site-absolute
// path asked example.com for the agent, 404'd, and the embed fell back to a
// default body named "Agent".
import { describe, it, expect } from 'vitest';
import {
	DEFAULT_API_ORIGIN,
	apiOriginFromScriptURL,
	resolveApiBase,
	isPageOrigin,
	credentialsFor,
	apiURL,
} from '../../src/shared/embed-api-origin.js';

describe('apiOriginFromScriptURL', () => {
	it('is the origin that served the script', () => {
		expect(apiOriginFromScriptURL('https://three.ws/agent-3d/1/agent-3d.js')).toBe('https://three.ws');
		expect(apiOriginFromScriptURL('http://localhost:3000/src/element.js')).toBe('http://localhost:3000');
	});

	it('maps a public npm CDN to three.ws, since those hosts serve no API', () => {
		expect(apiOriginFromScriptURL('https://unpkg.com/three.ws@0.2.0/agent-3d.umd.cjs')).toBe(DEFAULT_API_ORIGIN);
		expect(apiOriginFromScriptURL('https://cdn.jsdelivr.net/npm/three.ws/agent-3d.js')).toBe(DEFAULT_API_ORIGIN);
		expect(apiOriginFromScriptURL('https://esm.sh/three.ws')).toBe(DEFAULT_API_ORIGIN);
	});

	it('yields nothing for a URL with no http(s) origin, so the caller falls through', () => {
		expect(apiOriginFromScriptURL('blob:https://example.com/1234')).toBe('');
		expect(apiOriginFromScriptURL('file:///repo/src/element.js')).toBe('');
		expect(apiOriginFromScriptURL('')).toBe('');
		expect(apiOriginFromScriptURL(undefined)).toBe('');
	});
});

describe('resolveApiBase', () => {
	const page = 'https://bookshop.example';

	it('prefers the script origin over the host page origin', () => {
		expect(resolveApiBase({ scriptOrigin: 'https://three.ws', pageOrigin: page })).toBe('https://three.ws');
	});

	it('lets an api-base attribute override both, without a trailing slash', () => {
		expect(
			resolveApiBase({ attr: 'https://agents.bookshop.example/', scriptOrigin: 'https://three.ws', pageOrigin: page }),
		).toBe('https://agents.bookshop.example');
		expect(
			resolveApiBase({ attr: ' https://edge.example/three/ ', scriptOrigin: 'https://three.ws', pageOrigin: page }),
		).toBe('https://edge.example/three');
	});

	it('resolves a relative api-base against the page', () => {
		expect(resolveApiBase({ attr: '/backend', scriptOrigin: '', pageOrigin: page })).toBe(`${page}/backend`);
	});

	it('ignores an api-base that is not an http(s) URL', () => {
		expect(
			resolveApiBase({ attr: 'javascript:alert(1)', scriptOrigin: 'https://three.ws', pageOrigin: page }),
		).toBe('https://three.ws');
	});

	it('falls back to the page origin only when nothing else is known', () => {
		expect(resolveApiBase({ scriptOrigin: '', pageOrigin: page })).toBe(page);
	});
});

describe('credentials', () => {
	it('sends cookies only to the page origin itself', () => {
		expect(isPageOrigin('https://three.ws', 'https://three.ws')).toBe(true);
		expect(credentialsFor('https://three.ws', 'https://three.ws')).toBe('include');
		expect(isPageOrigin('https://three.ws', 'https://bookshop.example')).toBe(false);
		expect(credentialsFor('https://three.ws', 'https://bookshop.example')).toBe('omit');
	});

	it('treats an empty base as relative, i.e. the page origin', () => {
		expect(isPageOrigin('', 'https://three.ws')).toBe(true);
		expect(apiURL('', '/api/x')).toBe('/api/x');
		expect(apiURL('https://three.ws', '/api/x')).toBe('https://three.ws/api/x');
	});
});
