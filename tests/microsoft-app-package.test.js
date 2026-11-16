import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { unzipSync } from 'fflate';
import { missingSequences } from '../scripts/microsoft-copilot-agent-proof.mjs';
import {
	AGENT_ID,
	AGENT_LIMITS,
	PLUGIN_LIMITS,
	assemble,
	buildManifest,
	checkAgentReference,
	checkDeclarativeAgent,
	checkPlugin,
	checkMeetingStage,
	checkTools,
	STAGE_RSC,
	STAGE_TAB_ID,
	main,
	parseRpcReply,
	resolveOwnerValues,
	toAscii,
	zipFiles,
} from '../scripts/build-microsoft-app-package.mjs';

const OWNER = {
	MS_APP_ID: '11111111-1111-4111-8111-111111111111',
	MS_DEVELOPER_NAME: 'Test Co',
	MS_KEYVAULT_URL: 'https://kv-test.vault.azure.net/',
	MS_TEAMS_BOT_APP_ID: '22222222-2222-4222-8222-222222222222',
};

describe('microsoft app package', () => {
	it('--check passes without the owner values', async () => {
		const quiet = console.log;
		console.log = () => {};
		try {
			expect(await main(['--check'], {})).toBe(0);
		} finally {
			console.log = quiet;
		}
	});

	it('names every missing owner variable and refuses to build', async () => {
		const err = console.error;
		const lines = [];
		console.error = (m) => lines.push(m);
		try {
			expect(await main([], { MS_APP_ID: OWNER.MS_APP_ID })).toBe(2);
		} finally {
			console.error = err;
		}
		expect(lines[0]).toContain('MS_DEVELOPER_NAME, MS_KEYVAULT_URL, MS_TEAMS_BOT_APP_ID');
		expect(lines[0]).not.toContain('MS_APP_ID,');
	});

	it('builds a schema-valid manifest carrying the live MCP connector', () => {
		const { manifest, problems } = buildManifest(OWNER);
		expect(problems).toEqual([]);
		expect(manifest.manifestVersion).toBe('1.30');
		const server = manifest.agentConnectors[0].toolSource.remoteMcpServer;
		expect(server.mcpServerUrl).toBe('https://three.ws/api/mcp-studio');
		expect(server.authorization).toEqual({ type: 'AzureKeyVault', referenceId: OWNER.MS_KEYVAULT_URL });
		expect(manifest.staticTabs[0].contentUrl).toBe('https://three.ws/viewer');
		expect(manifest.composeExtensions[0].botId).toBe(OWNER.MS_TEAMS_BOT_APP_ID);
	});

	it('carries the review stage meeting tab and the Live Share RSC permissions', () => {
		const { manifest } = buildManifest(OWNER);
		const tab = manifest.configurableTabs.find((t) => t.id === STAGE_TAB_ID);
		expect(tab.configurationUrl).toBe('https://three.ws/microsoft/teams-stage?view=config&theme={theme}');
		expect(tab.context).toEqual(expect.arrayContaining(['meetingSidePanel', 'meetingStage']));
		expect(tab.meetingSurfaces).toEqual(['sidePanel', 'stage']);
		expect(manifest.authorization.permissions.resourceSpecific.map((p) => p.name)).toEqual(STAGE_RSC);
		expect(checkMeetingStage(manifest)).toEqual([]);
	});

	it('names each missing meeting stage entry', () => {
		const { manifest } = buildManifest(OWNER);
		expect(checkMeetingStage({ ...manifest, configurableTabs: [] })).toEqual([`configurableTabs needs the "${STAGE_TAB_ID}" meeting tab`]);
		const tab = manifest.configurableTabs[0];
		const broken = {
			...manifest,
			validDomains: ['example.com'],
			configurableTabs: [{ ...tab, configurationUrl: 'https://three.ws/viewer', context: ['meetingChatTab'], meetingSurfaces: ['sidePanel'], scopes: ['team'] }],
			authorization: { permissions: { resourceSpecific: [{ name: 'MeetingStage.Write.Chat', type: 'Application' }] } },
		};
		const text = checkMeetingStage(broken).join('\n');
		expect(text).toContain('configurationUrl must be https://<domain>/microsoft/teams-stage?view=config');
		expect(text).toContain('host three.ws is not in validDomains');
		expect(text).toContain('context needs meetingSidePanel');
		expect(text).toContain('context needs meetingStage');
		expect(text).toContain('meetingSurfaces needs stage');
		expect(text).toContain('scopes need groupChat');
		for (const name of STAGE_RSC) expect(text).toContain(`needs ${name} (Delegated)`);
	});

	it('rejects a bad GUID, an over-long developer name and a non-vault URL', () => {
		const { problems } = buildManifest({ MS_APP_ID: 'nope', MS_DEVELOPER_NAME: 'x'.repeat(40), MS_KEYVAULT_URL: 'https://example.com/', MS_TEAMS_BOT_APP_ID: 'bot' });
		const text = problems.join('\n');
		expect(text).toContain('MS_APP_ID must be a GUID');
		expect(text).toContain('MS_TEAMS_BOT_APP_ID must be a GUID');
		expect(text).toContain('MS_DEVELOPER_NAME');
		expect(text).toContain('MS_KEYVAULT_URL must look like');
		expect(text).toContain('manifest schema');
	});

	it('resolveOwnerValues reports missing variables outside check mode only', () => {
		expect(resolveOwnerValues({}, { check: false }).missing).toHaveLength(4);
		expect(resolveOwnerValues({}, { check: true }).missing).toHaveLength(0);
	});

	it('assembles a zip with the seven package files and white-on-transparent icons', async () => {
		const { problems, files } = await assemble(OWNER);
		expect(problems).toEqual([]);
		const entries = unzipSync(new Uint8Array(zipFiles(files)));
		expect(Object.keys(entries).sort()).toEqual(['ai-plugin.json', 'color.png', 'declarativeAgent.json', 'intro.md', 'manifest.json', 'mcptools.json', 'outline.png']);
		const manifest = JSON.parse(Buffer.from(entries['manifest.json']).toString('utf8'));
		expect(manifest.id).toBe(OWNER.MS_APP_ID);
	});

	it('mcptools.json is ASCII and well formed', () => {
		expect(checkTools('{"tools":[]}')).not.toEqual([]);
		expect(checkTools('{"tools":[{"name":"a","description":"café","inputSchema":{}}]}').join()).toContain('non-ASCII');
		expect(checkTools('{"tools":[{"name":"a","description":"d","inputSchema":{}}]}')).toEqual([]);
	});

	it('maps typographic punctuation to ASCII', () => {
		expect(toAscii('a\u2014b\u2013c “q”…')).toBe('a - b-c "q"...');
	});

	it('parses plain JSON and SSE framed JSON-RPC replies', () => {
		const msg = { jsonrpc: '2.0', id: 1, result: { tools: [] } };
		expect(parseRpcReply(JSON.stringify(msg))).toEqual(msg);
		expect(parseRpcReply(`event: message\ndata: ${JSON.stringify(msg)}\n\n`)).toEqual(msg);
		expect(() => parseRpcReply('event: ping\n\n')).toThrow();
	});
});

const SRC = new URL('../integrations/microsoft/copilot-teams/', import.meta.url);
const readJson = (name) => JSON.parse(readFileSync(new URL(name, SRC), 'utf8'));
const TOOL_NAMES = new Set(readJson('mcptools.json').tools.map((t) => t.name));
const inPackage = () => true;

describe('microsoft 365 copilot declarative agent', () => {
	const agent = readJson('declarativeAgent.json');
	const plugin = readJson('ai-plugin.json');

	it('the app manifest references the declarative agent', () => {
		const { manifest, problems } = buildManifest(OWNER);
		expect(problems).toEqual([]);
		expect(manifest.copilotAgents.declarativeAgents).toEqual([{ id: AGENT_ID, file: 'declarativeAgent.json' }]);
		expect(checkAgentReference({ ...manifest, copilotAgents: undefined })).toEqual(['copilotAgents.declarativeAgents must reference the three.ws declarative agent']);
	});

	it('the shipped agent and plugin pass schema 1.9, schema 2.4 and every documented limit', () => {
		expect(checkDeclarativeAgent(agent)).toEqual([]);
		expect(checkPlugin(plugin, TOOL_NAMES)).toEqual([]);
		expect(agent.conversation_starters.length).toBeLessThanOrEqual(AGENT_LIMITS.starters);
	});

	it('fails an instruction over 8000 characters', () => {
		const long = { ...agent, instructions: 'x'.repeat(AGENT_LIMITS.instructions + 1) };
		const text = checkDeclarativeAgent(long, { exists: inPackage }).join('\n');
		expect(text).toContain(`instructions is ${AGENT_LIMITS.instructions + 1} characters; Microsoft allows at most ${AGENT_LIMITS.instructions}`);
		expect(text).toContain('declarativeAgent.json schema: /instructions');
	});

	it('fails more than 12 starters, a duplicate starter title and over-long name, description and disclaimer', () => {
		const starters = Array.from({ length: AGENT_LIMITS.starters + 1 }, (_, i) => ({ title: i === 1 ? 'S0' : `S${i}`, text: 'Make a chair' }));
		const bad = {
			...agent,
			name: 'n'.repeat(AGENT_LIMITS.name + 1),
			description: 'd'.repeat(AGENT_LIMITS.description + 1),
			disclaimer: { text: 'z'.repeat(AGENT_LIMITS.disclaimer + 1) },
			conversation_starters: starters,
		};
		const text = checkDeclarativeAgent(bad, { exists: inPackage }).join('\n');
		expect(text).toContain(`${AGENT_LIMITS.starters + 1} conversation starters; Microsoft allows at most ${AGENT_LIMITS.starters}`);
		expect(text).toContain('title "S0" is not unique');
		expect(text).toContain(`name is ${AGENT_LIMITS.name + 1} characters`);
		expect(text).toContain(`description is ${AGENT_LIMITS.description + 1} characters`);
		expect(text).toContain(`disclaimer.text is ${AGENT_LIMITS.disclaimer + 1} characters`);
	});

	it('fails a missing action file, a wrong schema version, an unknown property and non-ASCII text', () => {
		const bad = { ...agent, version: 'v1.6', extra: true, description: 'caf\u00e9', actions: [{ id: 'a', file: 'missing.json' }] };
		const text = checkDeclarativeAgent(bad, { exists: (f) => f !== 'missing.json' }).join('\n');
		expect(text).toContain('version must be "v1.9"');
		expect(text).toContain('action a references missing.json');
		expect(text).toContain('non-ASCII character (U+00E9)');
		expect(text).toMatch(/declarativeAgent\.json schema: \/ must NOT have additional properties|declarativeAgent\.json schema: \/ property name must be valid/);
	});

	it('pins only real studio tools on one RemoteMCPServer runtime', () => {
		const runtime = plugin.runtimes[0];
		expect(runtime.type).toBe('RemoteMCPServer');
		expect(runtime.auth).toEqual({ type: 'None' });
		expect(runtime.spec).toEqual({ url: 'https://three.ws/api/mcp-studio', mcp_tool_description: { file: 'mcptools.json' } });
		expect(runtime.run_for_functions).toEqual(plugin.functions.map((f) => f.name));
		for (const name of runtime.run_for_functions) expect(TOOL_NAMES.has(name)).toBe(true);
	});

	it('fails an unknown pinned tool, dynamic discovery, a mismatched run_for_functions and over-long plugin copy', () => {
		const runtime = plugin.runtimes[0];
		const unknown = { ...plugin, functions: [...plugin.functions, { name: 'no_such_tool' }], runtimes: [{ ...runtime, run_for_functions: [...runtime.run_for_functions, 'no_such_tool'] }] };
		expect(checkPlugin(unknown, TOOL_NAMES, { exists: inPackage }).join('\n')).toContain('pins no_such_tool, which mcptools.json does not describe');
		const dynamic = { ...plugin, functions: [], runtimes: [{ ...runtime, run_for_functions: ['*'] }] };
		const dynText = checkPlugin(dynamic, TOOL_NAMES, { exists: inPackage }).join('\n');
		expect(dynText).toContain('must pin its tools');
		expect(dynText).toContain('not "*"');
		const mismatch = { ...plugin, runtimes: [{ ...runtime, run_for_functions: runtime.run_for_functions.slice(1) }] };
		expect(checkPlugin(mismatch, TOOL_NAMES, { exists: inPackage }).join('\n')).toContain(`function ${plugin.functions[0].name} is missing from run_for_functions`);
		const wordy = { ...plugin, name_for_human: 'n'.repeat(PLUGIN_LIMITS.nameForHuman + 1), description_for_human: 'd'.repeat(PLUGIN_LIMITS.descriptionForHuman + 1), description_for_model: 'm'.repeat(PLUGIN_LIMITS.descriptionForModel + 1) };
		const wordyText = checkPlugin(wordy, TOOL_NAMES, { exists: inPackage }).join('\n');
		expect(wordyText).toContain(`name_for_human is ${PLUGIN_LIMITS.nameForHuman + 1} characters`);
		expect(wordyText).toContain(`description_for_human is ${PLUGIN_LIMITS.descriptionForHuman + 1} characters`);
		expect(wordyText).toContain(`description_for_model is ${PLUGIN_LIMITS.descriptionForModel + 1} characters`);
	});

	it('fails a runtime that points at another server or an OpenAPI runtime', () => {
		const runtime = plugin.runtimes[0];
		const elsewhere = { ...plugin, runtimes: [{ ...runtime, spec: { ...runtime.spec, url: 'https://example.com/mcp' } }] };
		expect(checkPlugin(elsewhere, TOOL_NAMES, { exists: inPackage }).join('\n')).toContain('runtime url must be https://three.ws/api/mcp-studio');
		const openapi = { ...plugin, runtimes: [{ type: 'OpenApi', auth: { type: 'None' }, spec: { url: 'https://three.ws/openapi.json' } }] };
		expect(checkPlugin(openapi, TOOL_NAMES, { exists: inPackage }).join('\n')).toContain('exactly one runtime, of type RemoteMCPServer');
	});

	it('has a production proof sequence for every conversation starter', () => {
		expect(missingSequences()).toEqual([]);
		expect(missingSequences({ conversation_starters: [{ title: 'Unproven starter' }] })).toEqual(['Unproven starter']);
	});
});
