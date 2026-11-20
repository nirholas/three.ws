// integrations/dify/three_ws - the Dify plugin must carry a three.ws API key.
//
// Making or rigging a model on /api/mcp-studio needs an account
// (api/_mcp/creator-gate.js): an anonymous tools/call answers
// `sign_in_required`, and a bearer that does not verify gets HTTP 401. The
// plugin shipped as "No API key" with no provider credential, so every
// generation would fail for every Dify user once the gate is live. These pins
// keep the credential declared, sent, validated and described.

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const root = join(process.cwd(), 'integrations/dify/three_ws');
const read = (rel) => readFileSync(join(root, rel), 'utf8');

describe('Dify plugin: three.ws API key', () => {
	it('declares a required secret api_key credential that links to the key page', () => {
		const yaml = read('provider/three_ws.yaml');
		expect(yaml).toMatch(/credentials_for_provider:\s*\n\s+api_key:\s*\n\s+type: secret-input\s*\n\s+required: true/);
		expect(yaml).toContain('url: https://three.ws/dashboard/api-keys');
	});

	it('sends the key as a bearer on every studio call and maps sign_in_required to a fix', () => {
		const client = read('three_ws_client.py');
		expect(client).toContain('headers["Authorization"] = f"Bearer {key}"');
		expect(client).toMatch(/structured\.get\("status"\) == "sign_in_required"/);
		expect(client).toMatch(/status_code in \(401, 403\)/);
		expect(client).toMatch(/def run_generation\(name: str, arguments: dict\[str, Any\], api_key/);
		expect(client).toContain('call_tool("check_job", {"job_id": job_id}, api_key)');
	});

	it('reads the saved credential in the tools and validates it against the live server', () => {
		expect(read('tools/model_output.py')).toContain('run_generation(name, arguments, api_key_of(tool))');
		expect(read('tools/search_3d_assets.py')).toContain('api_key_of(self)');
		expect(read('provider/three_ws.py')).toContain('verify_api_key(credentials.get("api_key"))');
	});

	it('no longer tells anyone the plugin is anonymous', () => {
		for (const rel of ['manifest.yaml', 'provider/three_ws.yaml', 'README.md', 'PRIVACY.md', 'three_ws_client.py']) {
			const text = read(rel);
			expect(text, rel).not.toMatch(/No API key|asks for no API key|service is anonymous|server is anonymous/);
		}
	});
});
