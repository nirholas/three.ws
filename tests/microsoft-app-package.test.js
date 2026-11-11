import { describe, expect, it } from 'vitest';
import { unzipSync } from 'fflate';
import {
	assemble,
	buildManifest,
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

	it('assembles a zip with the five package files and white-on-transparent icons', async () => {
		const { problems, files } = await assemble(OWNER);
		expect(problems).toEqual([]);
		const entries = unzipSync(new Uint8Array(zipFiles(files)));
		expect(Object.keys(entries).sort()).toEqual(['color.png', 'intro.md', 'manifest.json', 'mcptools.json', 'outline.png']);
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
