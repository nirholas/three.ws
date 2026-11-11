import { describe, expect, it } from 'vitest';
import {
	MAX_LINK_LENGTH,
	MAX_PROMPT_LENGTH,
	PROTOCOL_SCHEME,
	parseThreewsLink,
} from '../src/pwa/protocol-link.js';

const UUID = '3f2b8c1e-5d4a-4e6f-9a1b-2c3d4e5f6a7b';

function ok(raw) {
	const res = parseThreewsLink(raw);
	expect(res.ok, `${raw} should parse, got ${JSON.stringify(res)}`).toBe(true);
	return res;
}

function bad(raw) {
	const res = parseThreewsLink(raw);
	expect(res.ok, `${String(raw).slice(0, 80)} should be rejected`).toBe(false);
	expect(typeof res.message).toBe('string');
	expect(res.message.length).toBeGreaterThan(10);
	return res;
}

describe('parseThreewsLink: valid links', () => {
	it('exports the registered scheme', () => {
		expect(PROTOCOL_SCHEME).toBe('web+threews');
	});

	it('routes an agent link to the agent page', () => {
		expect(ok(`web+threews://agent/${UUID}`)).toMatchObject({ kind: 'agent', id: UUID, target: `/agents/${UUID}` });
	});

	it('accepts an agent slug', () => {
		expect(ok('web+threews://agent/cz-bot_2').target).toBe('/agents/cz-bot_2');
	});

	it('routes a model link to the model page', () => {
		expect(ok(`web+threews://model/${UUID}`)).toMatchObject({ kind: 'model', target: `/m/${UUID}` });
	});

	it('routes a forge link with a prompt into the forge prefilled', () => {
		const res = ok('web+threews://forge?prompt=a%20brass%20robot%20owl');
		expect(res).toMatchObject({ kind: 'forge', prompt: 'a brass robot owl' });
		expect(res.target).toBe('/forge?prompt=a+brass+robot+owl');
	});

	it('opens the forge empty when no prompt is given', () => {
		expect(ok('web+threews://forge').target).toBe('/forge');
		expect(ok('web+threews://forge?prompt=%20%20').target).toBe('/forge');
	});

	it('is case-insensitive on the scheme and route, tolerates a trailing slash and the no-slash form', () => {
		expect(ok(`WEB+THREEWS://Agent/${UUID}/`).target).toBe(`/agents/${UUID}`);
		expect(ok(`web+threews:agent/${UUID}`).target).toBe(`/agents/${UUID}`);
	});

	it('accepts the link URL-encoded once more, the way Chromium substitutes %s', () => {
		expect(ok(encodeURIComponent(`web+threews://model/${UUID}`)).target).toBe(`/m/${UUID}`);
	});

	it('keeps prompt text exactly, including characters that look like markup', () => {
		const res = ok(`web+threews://forge?prompt=${encodeURIComponent('<b>sword</b> & shield')}`);
		expect(res.prompt).toBe('<b>sword</b> & shield');
		expect(new URL(res.target, 'https://three.ws').searchParams.get('prompt')).toBe('<b>sword</b> & shield');
	});
});

describe('parseThreewsLink: hostile and malformed input', () => {
	it('rejects missing or non-string input', () => {
		expect(bad(undefined).error).toBe('empty');
		expect(bad('').error).toBe('empty');
		expect(bad(42).error).toBe('empty');
	});

	it('rejects other schemes, including script URLs', () => {
		expect(bad('javascript:alert(1)').error).toBe('wrong_scheme');
		expect(bad('JaVaScRiPt://agent/x').error).toBe('wrong_scheme');
		expect(bad('data:text/html,<script>alert(1)</script>').error).toBe('wrong_scheme');
		expect(bad('https://evil.example/agent/x').error).toBe('wrong_scheme');
		expect(bad('web+threewsx://agent/x').error).toBe('wrong_scheme');
	});

	it('never produces a target that leaves the origin', () => {
		for (const raw of [
			'web+threews:////evil.example',
			'web+threews://agent//evil.example',
			'web+threews://agent/%2F%2Fevil.example',
			'web+threews://agent/\\\\evil.example',
		]) {
			bad(raw);
		}
	});

	it('rejects path traversal in raw and encoded form', () => {
		expect(bad('web+threews://agent/../admin').error).toBe('bad_id');
		expect(bad('web+threews://agent/%2e%2e%2fadmin').error).toBe('bad_id');
		expect(bad('web+threews://model/..%252f..%252fapi').error).toBe('bad_id');
		expect(bad('web+threews://agent/abc/../../etc').error).toBe('bad_path');
	});

	it('rejects a model id that is not a UUID', () => {
		expect(bad('web+threews://model/not-a-uuid').error).toBe('bad_id');
	});

	it('rejects an overlong id and an overlong link', () => {
		expect(bad(`web+threews://agent/${'a'.repeat(129)}`).error).toBe('bad_id');
		expect(bad(`web+threews://forge?prompt=${'a'.repeat(MAX_LINK_LENGTH)}`).error).toBe('too_long');
	});

	it('rejects an overlong prompt instead of silently cutting it', () => {
		const res = bad(`web+threews://forge?prompt=${'b'.repeat(MAX_PROMPT_LENGTH + 1)}`);
		expect(res.error).toBe('prompt_too_long');
		ok(`web+threews://forge?prompt=${'b'.repeat(MAX_PROMPT_LENGTH)}`);
	});

	it('rejects control characters and malformed percent-encoding', () => {
		expect(bad('web+threews://forge?prompt=hi%00there').error).toBe('bad_prompt');
		expect(bad('web+threews://agent/abc%0d%0aSet-Cookie').error).toBe('bad_id');
		expect(bad('web+threews://forge?prompt=%E0%A4%A').error).toBe('bad_encoding');
	});

	it('rejects unknown routes and extra path segments', () => {
		expect(bad('web+threews://wallet/send').error).toBe('unknown_route');
		expect(bad('web+threews://').error).toBe('unknown_route');
		expect(bad(`web+threews://agent/${UUID}/withdraw`).error).toBe('bad_path');
		expect(bad('web+threews://agent').error).toBe('bad_id');
	});
});
