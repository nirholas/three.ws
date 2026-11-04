// Power Platform connector: the real definition, properties, icon and intro.md
// pass the Swagger schema and certification rules, and each rule catches the
// mistake it exists for.

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import sharp from 'sharp';
import {
	checkDefinition,
	buildProperties,
	checkIcon,
	resolveOwnerValue,
	assemble,
	main,
} from '../scripts/build-power-platform-connector.mjs';

const DIR = join(process.cwd(), 'integrations', 'microsoft', 'power-platform-connector');
const realDef = () => JSON.parse(readFileSync(join(DIR, 'apiDefinition.swagger.json'), 'utf8'));
const CLIENT = { PP_OAUTH_CLIENT_ID: 'mcp_realclientid1234' };

describe('apiDefinition.swagger.json', () => {
	it('passes the Swagger 2.0 schema and every certification rule', () => {
		const { problems, operationIds } = checkDefinition(realDef());
		expect(problems).toEqual([]);
		expect([...operationIds.keys()].sort()).toEqual([
			'GenerateModel',
			'GetGenerationJob',
			'ListMyAgents',
			'SearchAgents',
			'SendAgentMessage',
		]);
	});

	it('rejects a title with a banned word or over 30 characters', () => {
		const def = realDef();
		def.info.title = 'three.ws 3D Studio Connector';
		expect(checkDefinition(def).problems.join()).toMatch(/must not contain "Connector"/);
		def.info.title = 'three.ws generates 3D models fast';
		expect(checkDefinition(def).problems.join()).toMatch(/1 to 30 characters/);
	});

	it('rejects a description that names a Microsoft product', () => {
		const def = realDef();
		def.info.description = `${def.info.description} Works in Power Automate.`;
		expect(checkDefinition(def).problems.join()).toMatch(/info.description names the product/);
	});

	it('rejects summaries with punctuation or over 80 characters', () => {
		const def = realDef();
		def.paths['/api/agents/talk'].post.summary = 'Talk to an agent: get a reply';
		expect(checkDefinition(def).problems.join()).toMatch(/summary/);
	});

	it('rejects a default response and a 2xx without a schema', () => {
		const def = realDef();
		const op = def.paths['/api/agents'].get;
		op.responses.default = { description: 'Error.' };
		op.responses['200'] = { description: 'The agents.' };
		const text = checkDefinition(def).problems.join('\n');
		expect(text).toMatch(/must not use a default response/);
		expect(text).toMatch(/needs an exact response schema/);
	});

	it('rejects a dangling $ref and a dynamic-values link to an unknown operation', () => {
		const def = realDef();
		const body = def.paths['/api/agents/talk'].post.parameters.find((p) => p.in === 'body');
		body.schema.properties.agentId['x-ms-dynamic-values'].operationId = 'ListAgentsGone';
		def.paths['/api/agents'].get.responses['200'].schema = { $ref: '#/definitions/Missing' };
		const text = checkDefinition(def).problems.join('\n');
		expect(text).toMatch(/unknown operation ListAgentsGone/);
		expect(text).toMatch(/\$ref #\/definitions\/Missing does not resolve/);
	});

	it('rejects a non-production host or http scheme', () => {
		const def = realDef();
		def.host = 'localhost:3000';
		def.schemes = ['http', 'https'];
		const text = checkDefinition(def).problems.join('\n');
		expect(text).toMatch(/production host/);
		expect(text).toMatch(/exactly \["https"\]/);
	});
});

describe('apiProperties', () => {
	it('fills the client id and keeps the S256 PKCE templates three.ws requires', () => {
		const { properties, problems } = buildProperties(CLIENT, realDef());
		expect(problems).toEqual([]);
		const oauth = properties.properties.connectionParameters.token.oAuthSettings;
		expect(oauth.clientId).toBe(CLIENT.PP_OAUTH_CLIENT_ID);
		expect(oauth.identityProvider).toBe('oauth2generic');
		expect(oauth.redirectMode).toBe('GlobalPerConnector');
		expect(oauth.customParameters.authorizationUrlQueryStringTemplate.value).toContain('code_challenge_method=S256');
		expect(oauth.customParameters.tokenBodyTemplate.value).toContain('code_verifier={CodeVerifier}');
		expect(oauth.scopes.sort()).toEqual(['agents:read', 'offline_access', 'profile']);
	});

	it('rejects a placeholder client id', () => {
		const { problems } = buildProperties({ PP_OAUTH_CLIENT_ID: 'x' }, realDef());
		expect(problems.join()).toMatch(/must be the client_id/);
	});

	it('rejects scopes that drift from the definition', () => {
		const def = realDef();
		def.securityDefinitions['oauth2-auth'].scopes['agents:write'] = 'Change your agents.';
		def.security[0]['oauth2-auth'].push('agents:write');
		expect(buildProperties(CLIENT, def).problems.join()).toMatch(/must match the definition's security scopes/);
	});
});

describe('icon', () => {
	const brand = JSON.parse(readFileSync(join(DIR, 'apiProperties.template.json'), 'utf8')).properties.iconBrandColor;

	it('the shipped icon passes', async () => {
		expect(await checkIcon(readFileSync(join(DIR, 'icon.png')), brand)).toEqual([]);
	});

	it('catches a transparent, oversized icon on the wrong background', async () => {
		const bad = await sharp({ create: { width: 300, height: 300, channels: 4, background: { r: 255, g: 255, b: 255, alpha: 0.5 } } })
			.png()
			.toBuffer();
		const text = (await checkIcon(bad, brand)).join('\n');
		expect(text).toMatch(/100 to 230 px/);
		expect(text).toMatch(/fully opaque/);
		expect(text).toMatch(/must match iconBrandColor/);
	});

	it('catches a glyph that fills more than 70% of the canvas', async () => {
		const glyph = await sharp({ create: { width: 180, height: 180, channels: 3, background: '#ffffff' } }).png().toBuffer();
		const icon = await sharp({ create: { width: 200, height: 200, channels: 3, background: brand } })
			.composite([{ input: glyph, gravity: 'center' }])
			.png()
			.toBuffer();
		expect((await checkIcon(icon, brand)).join()).toMatch(/must stay within 70%/);
	});
});

describe('build', () => {
	it('--check uses the check-only client id; a real build needs PP_OAUTH_CLIENT_ID', () => {
		expect(resolveOwnerValue({}, { check: true }).missing).toBe(false);
		expect(resolveOwnerValue({}, { check: false }).missing).toBe(true);
		expect(resolveOwnerValue(CLIENT, { check: false }).values).toEqual(CLIENT);
	});

	it('assembles the four files paconn and pac connector take, with intro.md covering every action', async () => {
		const { problems, files, operations } = await assemble(CLIENT);
		expect(problems).toEqual([]);
		expect(operations).toBe(5);
		expect(Object.keys(files).sort()).toEqual(['apiDefinition.swagger.json', 'apiProperties.json', 'icon.png', 'intro.md']);
	});

	it('main exits 2 without the client id and 0 on --check', async () => {
		expect(await main([], {})).toBe(2);
		expect(await main(['--check'], {})).toBe(0);
	});
});
