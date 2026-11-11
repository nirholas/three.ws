// Power Platform connector: the real definition, properties, icon and intro.md
// pass the Swagger schema and certification rules, and each rule catches the
// mistake it exists for.

import { describe, it, expect } from 'vitest';
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import sharp from 'sharp';
import { checkTemplates, collectActions, CONNECTOR_API_ID } from '../scripts/power-platform-templates.mjs';
import { buildRequest, validateResponse, toJsonSchema } from '../scripts/power-platform-contract.mjs';
import { prepareTemplate, workflowRow, loadTemplate } from '../scripts/import-power-platform-templates.mjs';
import {
	checkDefinition,
	buildProperties,
	checkIcon,
	resolveOwnerValue,
	assemble,
	main,
	loadPropertiesSchema,
	README_HEADINGS,
	CERTIFIED_NAME,
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

	it('assembles the certified-connectors folder with readme.md in the repository template layout', async () => {
		const { certified } = await assemble(CLIENT);
		expect(Object.keys(certified).sort()).toEqual(['apiDefinition.swagger.json', 'apiProperties.json', 'icon.png', 'readme.md']);
		const readme = certified['readme.md'].toString();
		expect(readme.startsWith(`# ${CERTIFIED_NAME}\n`)).toBe(true);
		const positions = README_HEADINGS.map((h) => readme.search(new RegExp(`^${h.replace(/[.]/g, '\\.')}$`, 'm')));
		expect(positions.every((p) => p >= 0)).toBe(true);
		expect([...positions].sort((a, b) => a - b)).toEqual(positions);
	});

	it('main exits 2 without the client id and 0 on --check', async () => {
		expect(await main([], {})).toBe(2);
		expect(await main(['--check'], {})).toBe(0);
	});
});

describe('certification metadata rules', () => {
	it('rejects a category outside the certified list', () => {
		const def = realDef();
		def['x-ms-connector-metadata'].find((m) => m.propertyName === 'Categories').propertyValue = 'AI;Gaming';
		expect(checkDefinition(def).problems.join()).toMatch(/category "Gaming" is not one of/);
	});

	it('rejects a schema on a non-2xx response and a fetch operation with a body', () => {
		const def = realDef();
		const get = def.paths['/api/agents'].get;
		get.responses['401'] = { description: 'Sign in first.', schema: { type: 'object', properties: {} } };
		get.parameters = [{ name: 'body', in: 'body', schema: { type: 'object', properties: { a: { type: 'string' } } } }];
		const text = checkDefinition(def).problems.join('\n');
		expect(text).toMatch(/401 must not declare a schema/);
		expect(text).toMatch(/BodyOrFormDataParameterInFetchOperationNotAllowed/);
	});

	it('rejects a $ref with siblings, an empty required array and dynamic values without parameters', () => {
		const def = realDef();
		def.paths['/api/agents'].get.responses['200'].schema.properties.agents.items = { $ref: '#/definitions/Agent', description: 'An agent.' };
		def.definitions.Agent.required = [];
		const body = def.paths['/api/agents/talk'].post.parameters.find((p) => p.in === 'body');
		delete body.schema.properties.agentId['x-ms-dynamic-values'].parameters;
		const text = checkDefinition(def).problems.join('\n');
		expect(text).toMatch(/AdditionalPropertyNotAllowedAdjacentToRef/);
		expect(text).toMatch(/RequiredPropertyArrayEmpty/);
		expect(text).toMatch(/needs a parameters object/);
	});

	it('rejects a parameter without x-ms-visibility', () => {
		const def = realDef();
		delete def.paths['/api/agents/public'].get.parameters.find((p) => p.name === 'q')['x-ms-visibility'];
		expect(checkDefinition(def).problems.join()).toMatch(/q needs x-ms-visibility/);
	});

	it('the filled properties pass the PowerPlatformConnectors paconn schema', () => {
		const { properties, problems } = buildProperties(CLIENT, realDef());
		expect(problems).toEqual([]);
		expect(properties.properties.connectionParameters.token.oAuthSettings.redirectMode).toBe('GlobalPerConnector');
		expect(loadPropertiesSchema()).toBeTruthy();
	});
});

describe('contract helpers', () => {
	const def = realDef();

	it('builds the request the connector sends, and refuses undeclared or missing inputs', () => {
		const req = buildRequest(def, 'SearchAgents', { q: 'robot', sort: 'newest', limit: 5 });
		expect(req).toEqual({ method: 'GET', url: 'https://three.ws/api/agents/public?q=robot&sort=newest&limit=5', body: undefined });
		expect(buildRequest(def, 'GenerateModel', { prompt: 'a lamp', tier: 'draft' }).body).toEqual({ prompt: 'a lamp', tier: 'draft' });
		expect(() => buildRequest(def, 'GenerateModel', { tier: 'draft' })).toThrow(/requires prompt/);
		expect(() => buildRequest(def, 'GenerateModel', { prompt: 'a lamp', size: 2 })).toThrow(/no input named size/);
		expect(() => buildRequest(def, 'GenerateModel', { prompt: 'a lamp', tier: 'ultra' })).toThrow(/must be one of/);
	});

	it('accepts a workflow expression for an enum input only when asked to', () => {
		const inputs = { prompt: 'a lamp', tier: "@parameters('Quality')" };
		expect(() => buildRequest(def, 'GenerateModel', inputs)).toThrow(/must be one of/);
		expect(buildRequest(def, 'GenerateModel', inputs, { expressions: true }).body.tier).toBe("@parameters('Quality')");
	});

	it('admits null only where the swagger marks a field x-nullable', () => {
		const agent = { id: 'a1', name: 'Ada', description: null, home_url: 'https://three.ws/a/a1', avatar_model_url: null, avatar_thumbnail_url: null, solana_address: null, chat_count: 0, created_at: '2026-11-11T00:00:00Z', updated_at: '2026-11-11T00:00:00Z', skills: [], is_registered: false };
		expect(validateResponse(def, 'ListMyAgents', 200, { agents: [agent] }).errors).toEqual([]);
		expect(validateResponse(def, 'ListMyAgents', 200, { agents: [{ ...agent, name: null }] }).errors.join()).toMatch(/name must be string/);
		expect(toJsonSchema(def, { $ref: '#/definitions/GenerationJob' }).properties.job.type).toEqual(['string', 'null']);
	});
});

describe('flow templates and Copilot Studio sample', () => {
	const def = realDef();
	const TEMPLATES = join(DIR, 'templates');

	it('every template passes the template checks', () => {
		const { problems, used } = checkTemplates(def, TEMPLATES);
		expect(problems).toEqual([]);
		expect([...used.keys()]).toEqual(['copilot-studio', 'daily-agent-digest', 'forms-response-to-3d-model-email', 'sharepoint-item-to-3d-model', 'teams-ask-your-agent']);
	});

	it('together the templates use every connector action, and the live suite calls each one', () => {
		const { used } = checkTemplates(def, TEMPLATES);
		const all = new Set([...used.values()].flatMap((s) => [...s]));
		expect([...all].sort()).toEqual(['GenerateModel', 'GetGenerationJob', 'ListMyAgents', 'SearchAgents', 'SendAgentMessage']);
		const live = readFileSync(join(process.cwd(), 'tests', 'microsoft-power-platform-connector-live.test.js'), 'utf8');
		for (const op of all) expect(live, `the live contract test must call ${op}`).toMatch(new RegExp(`invoke\\('${op}'`));
	});

	it('every literal input a template passes is valid against production rules', () => {
		for (const name of ['daily-agent-digest', 'sharepoint-item-to-3d-model']) {
			const flow = loadTemplate(name);
			for (const { action } of collectActions(flow.properties.definition.actions)) {
				if (action.inputs?.host?.apiId !== CONNECTOR_API_ID) continue;
				const literal = Object.fromEntries(Object.entries(action.inputs.parameters).filter(([, v]) => !String(v).startsWith('@')).map(([k, v]) => [k.replace(/^body\//, ''), v]));
				const required = { GenerateModel: { prompt: 'a lamp' }, GetGenerationJob: { job: 'j1' } }[action.inputs.host.operationId] || {};
				expect(() => buildRequest(def, action.inputs.host.operationId, { ...required, ...literal })).not.toThrow();
			}
		}
	});

	it('catches an unknown action, an undeclared input and a response field the action does not return', () => {
		const flow = loadTemplate('daily-agent-digest');
		const actions = flow.properties.definition.actions;
		actions.Search_public_agents.inputs.parameters.colour = 'red';
		actions.List_my_agents.inputs.host.operationId = 'ListAllAgents';
		actions.Email_the_digest.inputs.parameters['emailMessage/Subject'] = "@body('Search_public_agents')?['total']";
		const dir = join(process.cwd(), 'node_modules', '.cache', 'pp-template-test');
		rmSync(dir, { recursive: true, force: true });
		for (const name of ['a', 'b', 'c']) {
			mkdirSync(join(dir, name), { recursive: true });
			writeFileSync(join(dir, name, 'workflow.json'), JSON.stringify(flow));
			writeFileSync(join(dir, name, 'README.md'), 'Search public agents.');
		}
		const text = checkTemplates(def, dir).problems.join('\n');
		rmSync(dir, { recursive: true, force: true });
		expect(text).toMatch(/SearchAgents has no input named colour/);
		expect(text).toMatch(/calls ListAllAgents, which the connector does not define/);
		expect(text).toMatch(/body\('Search_public_agents'\)\?\['total'\], which SearchAgents does not return/);
	});
});

describe('template importer', () => {
	it('points the three.ws actions at the environment connector and fills parameter values', () => {
		const p = prepareTemplate(loadTemplate('daily-agent-digest'), {
			connectorApi: 'shared_threews-20studio-5f0a',
			values: { 'Digest recipient': 'ops@contoso.com' },
		});
		expect(p.missing).toEqual([]);
		const data = JSON.parse(p.clientdata);
		expect(data.schemaVersion).toBe('1.0.0.0');
		expect(data.properties.definition.parameters['Digest recipient'].defaultValue).toBe('ops@contoso.com');
		expect(data.properties.definition.actions.List_my_agents.inputs.host.apiId).toBe('/providers/Microsoft.PowerApps/apis/shared_threews-20studio-5f0a');
		expect(data.properties.connectionReferences.shared_threews3dstudio.api.name).toBe('shared_threews-20studio-5f0a');
		expect(p.refs.map((r) => r.logicalName).sort()).toEqual(['threews_office365', 'threews_threews3dstudio']);
		expect(workflowRow(p)).toMatchObject({ category: 5, type: 1, primaryentity: 'none', statecode: 0, name: 'three.ws: Daily agent digest by email' });
	});

	it('reports parameters left empty and rejects unknown names or disallowed values', () => {
		expect(prepareTemplate(loadTemplate('daily-agent-digest')).missing).toEqual(['Digest recipient']);
		expect(() => prepareTemplate(loadTemplate('daily-agent-digest'), { values: { Recipient: 'x' } })).toThrow(/no parameter named Recipient/);
		expect(() => prepareTemplate(loadTemplate('sharepoint-item-to-3d-model'), { values: { Quality: 'ultra' } })).toThrow(/must be one of/);
	});
});
