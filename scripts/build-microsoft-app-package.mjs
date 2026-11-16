// scripts/build-microsoft-app-package.mjs
// Build the Microsoft 365 app package for the Partner Center offer type
// "Apps and Agents for M365 and Copilot" from integrations/microsoft/copilot-teams/.
//
//   npm run package:microsoft-app                   build dist/microsoft/three-ws-m365-app.zip
//   npm run package:microsoft-app -- --check        validate everything except the owner values
//   npm run package:microsoft-app -- --check --store  add the Teams Store and Copilot preflight
//                                                    (validation/rules.json, atk validate, live URLs);
//                                                    --offline skips the live checks
//   npm run package:microsoft-app -- --refresh-tools  rewrite mcptools.json from the live MCP endpoint
//   npm run package:microsoft-app -- --regen-icons    rewrite color.png and outline.png from public/logo.png
//
// Owner-only values come from the environment and are never defaulted:
//   MS_APP_ID          the app GUID Partner Center assigns to the offer
//   MS_DEVELOPER_NAME  the legal entity name (32 characters or fewer)
//   MS_KEYVAULT_URL    the Azure Key Vault URL that holds the OAuth client details
//   MS_TEAMS_BOT_APP_ID  the Azure Bot registration app id behind the Agents search command
//                        (the same value the API reads to verify Bot Framework tokens)
// The package also carries the "three.ws 3D Studio" declarative agent for Microsoft 365
// Copilot (declarativeAgent.json) and its plugin (ai-plugin.json, a RemoteMCPServer runtime
// pinned to the free studio tools in mcptools.json). Both are validated against the
// vendored schemas in schema/ (see schema/README.md) and Microsoft's documented limits.
// --check substitutes clearly marked check-only values so the structure, the schema,
// the icons and the tool file are still validated, and writes no zip.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import Ajv from 'ajv';
import addFormats from 'ajv-formats';
import { zipSync } from 'fflate';
import sharp from 'sharp';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const srcDir = join(root, 'integrations', 'microsoft', 'copilot-teams');
const outFile = join(root, 'dist', 'microsoft', 'three-ws-m365-app.zip');
const MCP_URL = 'https://three.ws/api/mcp-studio';
const LOGO = join(root, 'public', 'logo.png');

const OWNER_VARS = ['MS_APP_ID', 'MS_DEVELOPER_NAME', 'MS_KEYVAULT_URL', 'MS_TEAMS_BOT_APP_ID'];
const CHECK_ONLY = {
	MS_APP_ID: '00000000-0000-4000-8000-000000000000',
	MS_DEVELOPER_NAME: 'Check Only Developer',
	MS_KEYVAULT_URL: 'https://check-only.vault.azure.net/',
	MS_TEAMS_BOT_APP_ID: '00000000-0000-4000-8000-0000000000b0',
};
const GUID_RE = /^[0-9a-fA-F]{8}-([0-9a-fA-F]{4}-){3}[0-9a-fA-F]{12}$/;
const PACKAGE_FILES = ['manifest.json', 'declarativeAgent.json', 'ai-plugin.json', 'mcptools.json', 'intro.md', 'color.png', 'outline.png'];
const AGENT_FILE = 'declarativeAgent.json';
const PLUGIN_FILE = 'ai-plugin.json';

const read = (name) => readFileSync(join(srcDir, name));
const readText = (name) => readFileSync(join(srcDir, name), 'utf8');

/** Characters Microsoft rejects in the manifest and tool files, mapped to ASCII. */
const ASCII_MAP = new Map([
	['\u2014', ' - '],
	['\u2013', '-'],
	['\u2018', "'"],
	['\u2019', "'"],
	['\u201C', '"'],
	['\u201D', '"'],
	['\u2026', '...'],
	['\u00A0', ' '],
	['\u2192', '->'],
	['\u00D7', 'x'],
]);

export function toAscii(text) {
	let out = '';
	for (const ch of text) out += ASCII_MAP.get(ch) ?? ch;
	return out;
}

function nonAscii(text) {
	const hit = [...text].find((c) => c.charCodeAt(0) > 126 || (c.charCodeAt(0) < 32 && !'\n\r\t'.includes(c)));
	return hit ? `U+${hit.codePointAt(0).toString(16).toUpperCase().padStart(4, '0')}` : null;
}

/** Replace ${VAR} tokens in every string of a parsed manifest. */
function fill(node, values) {
	if (typeof node === 'string') return node.replace(/\$\{(\w+)\}/g, (m, k) => (k in values ? values[k] : m));
	if (Array.isArray(node)) return node.map((n) => fill(n, values));
	if (node && typeof node === 'object') return Object.fromEntries(Object.entries(node).map(([k, v]) => [k, fill(v, values)]));
	return node;
}

/** The owner values: from env, or the check-only set. Returns { values, missing }. */
export function resolveOwnerValues(env, { check }) {
	const missing = OWNER_VARS.filter((k) => !String(env[k] ?? '').trim());
	if (check) return { values: { ...CHECK_ONLY }, missing: [] };
	return { values: Object.fromEntries(OWNER_VARS.map((k) => [k, String(env[k] ?? '').trim()])), missing };
}

function loadVendoredSchema(file) {
	const schema = JSON.parse(readFileSync(join(srcDir, 'schema', file), 'utf8'));
	// The published schemas declare draft-04. Ajv 8 validates the same keywords under its
	// default dialect once the draft-04 meta-schema reference is dropped.
	delete schema.$schema;
	return schema;
}

export const loadSchema = () => loadVendoredSchema('MicrosoftTeams.schema.v1.30.json');

const compiled = new Map();
function validatorFor(file) {
	if (!compiled.has(file)) {
		const ajv = new Ajv({ strict: false, allErrors: true });
		addFormats(ajv);
		compiled.set(file, ajv.compile(loadVendoredSchema(file)));
	}
	return compiled.get(file);
}

function schemaProblems(file, doc, label) {
	const validate = validatorFor(file);
	if (validate(doc)) return [];
	return validate.errors.map((e) => `${label} schema: ${e.instancePath || '/'} ${e.message}`);
}

/** Build the filled manifest object and return it with every problem found. */
export function buildManifest(values) {
	const problems = [];
	const manifest = fill(JSON.parse(readText('manifest.template.json')), values);

	if (!GUID_RE.test(manifest.id)) problems.push(`MS_APP_ID must be a GUID, got "${manifest.id}"`);
	if (!values.MS_DEVELOPER_NAME || values.MS_DEVELOPER_NAME.length > 32) {
		problems.push('MS_DEVELOPER_NAME must be 1 to 32 characters (the manifest schema limit)');
	}
	if (!/^https:\/\/[^\s/]+\.vault\.azure\.net\/?$/i.test(values.MS_KEYVAULT_URL)) {
		problems.push('MS_KEYVAULT_URL must look like https://<vault-name>.vault.azure.net/');
	}
	if (!GUID_RE.test(values.MS_TEAMS_BOT_APP_ID || '')) problems.push(`MS_TEAMS_BOT_APP_ID must be a GUID, got "${values.MS_TEAMS_BOT_APP_ID}"`);
	if (values.MS_KEYVAULT_URL.length > 128) problems.push('MS_KEYVAULT_URL must be 128 characters or fewer (schema limit on referenceId)');

	problems.push(...schemaProblems('MicrosoftTeams.schema.v1.30.json', manifest, 'manifest'));
	problems.push(...checkMeetingStage(manifest));
	problems.push(...checkHosts(manifest));
	problems.push(...checkAgentReference(manifest));
	const bad = nonAscii(JSON.stringify(manifest));
	if (bad) problems.push(`manifest.json contains a non-ASCII character (${bad})`);
	return { manifest, problems };
}

// The Live Share review stage needs a meeting tab on both meeting surfaces and the
// four RSC permissions Live Share and shareAppContentToStage ask for.
// https://learn.microsoft.com/en-us/microsoftteams/platform/apps-in-teams-meetings/teams-live-share-overview
// https://learn.microsoft.com/en-us/microsoftteams/platform/apps-in-teams-meetings/build-apps-for-teams-meeting-stage
export const STAGE_TAB_ID = 'threews-review-stage';
export const STAGE_RSC = ['MeetingStage.Write.Chat', 'ChannelMeetingStage.Write.Group', 'LiveShareSession.ReadWrite.Chat', 'LiveShareSession.ReadWrite.Group'];

export function checkMeetingStage(manifest) {
	const problems = [];
	const tab = (manifest.configurableTabs || []).find((t) => t.id === STAGE_TAB_ID);
	if (!tab) return [`configurableTabs needs the "${STAGE_TAB_ID}" meeting tab`];
	let url = null;
	try {
		url = new URL(tab.configurationUrl.replace('{theme}', 'default'));
	} catch {
		problems.push(`${STAGE_TAB_ID} configurationUrl is not a URL`);
	}
	if (url) {
		if (url.protocol !== 'https:' || url.pathname !== '/microsoft/teams-stage' || url.searchParams.get('view') !== 'config') {
			problems.push(`${STAGE_TAB_ID} configurationUrl must be https://<domain>/microsoft/teams-stage?view=config`);
		}
		if (!(manifest.validDomains || []).includes(url.hostname)) problems.push(`${STAGE_TAB_ID} configurationUrl host ${url.hostname} is not in validDomains`);
	}
	for (const ctx of ['meetingSidePanel', 'meetingStage']) {
		if (!tab.context?.includes(ctx)) problems.push(`${STAGE_TAB_ID} context needs ${ctx}`);
	}
	for (const surface of ['sidePanel', 'stage']) {
		if (!tab.meetingSurfaces?.includes(surface)) problems.push(`${STAGE_TAB_ID} meetingSurfaces needs ${surface}`);
	}
	if (!tab.scopes?.includes('groupChat')) problems.push(`${STAGE_TAB_ID} scopes need groupChat (meetings are group chats)`);
	const rsc = manifest.authorization?.permissions?.resourceSpecific || [];
	for (const name of STAGE_RSC) {
		if (!rsc.some((p) => p.name === name && p.type === 'Delegated')) problems.push(`authorization.permissions.resourceSpecific needs ${name} (Delegated)`);
	}
	return problems;
}

// Microsoft's documented limits for the declarative agent (schema 1.9) and its plugin
// (schema 2.4). The schemas encode some of them; the rest are "characters beyond N MAY be
// ignored" notes that would silently truncate copy, so they are enforced here as errors.
// https://learn.microsoft.com/en-us/microsoft-365-copilot/extensibility/declarative-agent-manifest-1.9
// https://learn.microsoft.com/en-us/microsoft-365-copilot/extensibility/plugin-manifest-2.4
export const AGENT_LIMITS = {
	version: 'v1.9',
	name: 100,
	description: 1000,
	instructions: 8000,
	starters: 12,
	disclaimer: 500,
	actions: 10,
};
export const PLUGIN_LIMITS = {
	version: 'v2.4',
	nameForHuman: 20,
	descriptionForHuman: 100,
	descriptionForModel: 2048,
};
export const AGENT_ID = 'threews-3d-studio';
export const STUDIO_TOOLS_FILE = 'mcptools.json';

const blank = (v) => typeof v !== 'string' || !v.trim();

function lengthProblem(label, value, max) {
	if (blank(value)) return [`${label} is required and must contain a non-whitespace character`];
	return value.length > max ? [`${label} is ${value.length} characters; Microsoft allows at most ${max}`] : [];
}

/** The app manifest must reference exactly the one declarative agent this package ships. */
export function checkAgentReference(manifest) {
	const agents = manifest.copilotAgents?.declarativeAgents;
	if (!Array.isArray(agents) || agents.length !== 1) return ['copilotAgents.declarativeAgents must reference the three.ws declarative agent'];
	const [ref] = agents;
	const problems = [];
	if (ref.id !== AGENT_ID) problems.push(`copilotAgents.declarativeAgents[0].id must be "${AGENT_ID}"`);
	if (ref.file !== AGENT_FILE) problems.push(`copilotAgents.declarativeAgents[0].file must be "${AGENT_FILE}"`);
	return problems;
}

/**
 * Validate a parsed declarative agent manifest against schema 1.9 and the documented limits.
 * `exists(file)` answers whether a file referenced by an action is in the package.
 */
export function checkDeclarativeAgent(agent, { exists = (f) => existsSync(join(srcDir, f)) } = {}) {
	const problems = schemaProblems('declarative-agent.schema.v1.9.json', agent, AGENT_FILE);
	if (agent.version !== AGENT_LIMITS.version) problems.push(`${AGENT_FILE} version must be "${AGENT_LIMITS.version}"`);
	problems.push(...lengthProblem(`${AGENT_FILE} name`, agent.name, AGENT_LIMITS.name));
	problems.push(...lengthProblem(`${AGENT_FILE} description`, agent.description, AGENT_LIMITS.description));
	problems.push(...lengthProblem(`${AGENT_FILE} instructions`, agent.instructions, AGENT_LIMITS.instructions));
	const starters = agent.conversation_starters ?? [];
	if (starters.length === 0) problems.push(`${AGENT_FILE} needs at least one conversation starter`);
	if (starters.length > AGENT_LIMITS.starters) problems.push(`${AGENT_FILE} has ${starters.length} conversation starters; Microsoft allows at most ${AGENT_LIMITS.starters}`);
	const titles = new Set();
	for (const [i, s] of starters.entries()) {
		if (blank(s.text)) problems.push(`${AGENT_FILE} conversation_starters[${i}] needs text`);
		if (blank(s.title)) problems.push(`${AGENT_FILE} conversation_starters[${i}] needs a title (shown on the starter card)`);
		else if (titles.has(s.title)) problems.push(`${AGENT_FILE} conversation starter title "${s.title}" is not unique`);
		titles.add(s.title);
	}
	if (agent.disclaimer) problems.push(...lengthProblem(`${AGENT_FILE} disclaimer.text`, agent.disclaimer.text, AGENT_LIMITS.disclaimer));
	const actions = agent.actions ?? [];
	if (actions.length === 0 || actions.length > AGENT_LIMITS.actions) problems.push(`${AGENT_FILE} needs 1 to ${AGENT_LIMITS.actions} actions`);
	for (const a of actions) {
		if (a.file && !exists(a.file)) problems.push(`${AGENT_FILE} action ${a.id} references ${a.file}, which is not in the source directory`);
	}
	const bad = nonAscii(JSON.stringify(agent));
	if (bad) problems.push(`${AGENT_FILE} contains a non-ASCII character (${bad})`);
	return problems;
}

/**
 * Validate a parsed plugin manifest against schema 2.4 and the documented limits, and
 * check that every pinned function is a real tool in the MCP tool description file.
 */
export function checkPlugin(plugin, toolNames, { exists = (f) => existsSync(join(srcDir, f)) } = {}) {
	const problems = schemaProblems('api-plugin.schema.v2.4.json', plugin, PLUGIN_FILE);
	if (plugin.schema_version !== PLUGIN_LIMITS.version) problems.push(`${PLUGIN_FILE} schema_version must be "${PLUGIN_LIMITS.version}"`);
	problems.push(...lengthProblem(`${PLUGIN_FILE} name_for_human`, plugin.name_for_human, PLUGIN_LIMITS.nameForHuman));
	problems.push(...lengthProblem(`${PLUGIN_FILE} description_for_human`, plugin.description_for_human, PLUGIN_LIMITS.descriptionForHuman));
	problems.push(...lengthProblem(`${PLUGIN_FILE} description_for_model`, plugin.description_for_model, PLUGIN_LIMITS.descriptionForModel));
	const runtimes = plugin.runtimes ?? [];
	const mcp = runtimes.filter((r) => r.type === 'RemoteMCPServer');
	if (mcp.length !== 1 || runtimes.length !== 1) return [...problems, `${PLUGIN_FILE} needs exactly one runtime, of type RemoteMCPServer`];
	const [runtime] = mcp;
	if (runtime.spec?.url !== MCP_URL) problems.push(`${PLUGIN_FILE} runtime url must be ${MCP_URL}`);
	const file = runtime.spec?.mcp_tool_description?.file;
	if (file !== STUDIO_TOOLS_FILE) problems.push(`${PLUGIN_FILE} runtime must pin tools from ${STUDIO_TOOLS_FILE}`);
	else if (!exists(file)) problems.push(`${PLUGIN_FILE} references ${file}, which is not in the source directory`);
	const functions = (plugin.functions ?? []).map((f) => f.name);
	const pinned = runtime.run_for_functions ?? [];
	if (functions.length === 0) problems.push(`${PLUGIN_FILE} must pin its tools (functions is empty, which means dynamic discovery)`);
	if (pinned.includes('*')) problems.push(`${PLUGIN_FILE} run_for_functions must list the pinned tools, not "*"`);
	if (new Set(functions).size !== functions.length) problems.push(`${PLUGIN_FILE} functions has a duplicate name`);
	const fnSet = new Set(functions);
	const pinSet = new Set(pinned);
	for (const f of functions) if (!pinSet.has(f)) problems.push(`${PLUGIN_FILE} function ${f} is missing from run_for_functions`);
	for (const f of pinned) if (f !== '*' && !fnSet.has(f)) problems.push(`${PLUGIN_FILE} run_for_functions names ${f}, which is not in functions`);
	for (const f of functions) if (!toolNames.has(f)) problems.push(`${PLUGIN_FILE} pins ${f}, which ${STUDIO_TOOLS_FILE} does not describe; run --refresh-tools or fix the name`);
	const bad = nonAscii(JSON.stringify(plugin));
	if (bad) problems.push(`${PLUGIN_FILE} contains a non-ASCII character (${bad})`);
	return problems;
}

function parseJsonFile(name, problems) {
	try {
		return JSON.parse(readText(name));
	} catch (err) {
		problems.push(`${name} is not valid JSON: ${err.message}`);
		return null;
	}
}

// Outlook and the Microsoft 365 app run the same package as Teams (manifest
// 1.13 or later). A capability a host cannot run is declared away with
// elementRelationshipSet, so every reference there must name a real element:
// bots by botId, staticTabs by entityId, composeExtensions and configurableTabs
// by id, and commandIds that exist. An action command that needs the bot (the
// live 3D card) must depend on it, so hosts without bots never show it. Search
// stays available in Outlook, which runs message extensions in compose only.
// https://learn.microsoft.com/en-us/microsoftteams/platform/m365-apps/teams-app-manifest-hosts
// https://learn.microsoft.com/en-us/microsoftteams/platform/m365-apps/extend-m365-teams-message-extension
export const HOST_MIN_MANIFEST = [1, 13];
export const BOT_DEPENDENT_COMMANDS = ['createModel', 'reportContent'];
export const OUTLOOK_DOMAINS_REQUIRED = ['three.ws', 'www.three.ws'];

function elementIds(manifest, name) {
	const list = manifest[name] || [];
	if (name === 'bots') return list.map((b) => b.botId);
	if (name === 'staticTabs') return list.map((t) => t.entityId);
	return list.map((e) => e.id).filter(Boolean);
}

function hostOf(url) {
	try {
		return new URL(url.replace(/\{[^}]+\}/g, 'x')).hostname;
	} catch {
		return null;
	}
}

export function checkHosts(manifest) {
	const problems = [];
	const [major, minor] = String(manifest.manifestVersion || '0').split('.').map(Number);
	if (major < HOST_MIN_MANIFEST[0] || (major === HOST_MIN_MANIFEST[0] && minor < HOST_MIN_MANIFEST[1])) {
		problems.push(`manifestVersion ${manifest.manifestVersion} runs only in Teams; Outlook and the Microsoft 365 app need ${HOST_MIN_MANIFEST.join('.')} or later`);
	}
	const domains = manifest.validDomains || [];
	for (const d of OUTLOOK_DOMAINS_REQUIRED) if (!domains.includes(d)) problems.push(`validDomains needs ${d}`);
	for (const tab of manifest.staticTabs || []) {
		const h = hostOf(tab.contentUrl || '');
		if (tab.contentUrl && !domains.includes(h)) problems.push(`staticTabs ${tab.entityId} contentUrl host ${h} is not in validDomains`);
	}
	const ext = manifest.composeExtensions || [];
	for (const e of ext) {
		for (const handler of e.messageHandlers || []) {
			for (const d of handler.value?.domains || []) if (!domains.includes(d)) problems.push(`link unfurl domain ${d} is not in validDomains`);
		}
		for (const c of e.commands || []) {
			if (c.type === 'query' && !(c.context || ['compose', 'commandBox']).includes('compose')) {
				problems.push(`search command ${c.id} needs the compose context, the only one Outlook runs`);
			}
		}
	}
	const deps = manifest.elementRelationshipSet?.oneWayDependencies || [];
	const mutual = (manifest.elementRelationshipSet?.mutualDependencies || []).flat();
	for (const ref of [...deps.flatMap((d) => [d.element, ...d.dependsOn]), ...mutual]) {
		if (!elementIds(manifest, ref.name).includes(ref.id)) {
			problems.push(`elementRelationshipSet names ${ref.name} "${ref.id}", which the manifest does not declare`);
			continue;
		}
		if (ref.commandIds && ref.name === 'composeExtensions') {
			const known = (ext.find((e) => e.id === ref.id)?.commands || []).map((c) => c.id);
			for (const id of ref.commandIds) if (!known.includes(id)) problems.push(`elementRelationshipSet names command ${id}, which ${ref.id} does not declare`);
		}
	}
	for (const cmd of BOT_DEPENDENT_COMMANDS) {
		const owner = ext.find((e) => (e.commands || []).some((c) => c.id === cmd));
		if (!owner) continue;
		const gated = deps.some((d) =>
			d.element.name === 'composeExtensions' && d.element.id === owner.id
			&& (!d.element.commandIds || d.element.commandIds.includes(cmd))
			&& d.dependsOn.some((t) => t.name === 'bots' && t.id === owner.botId));
		if (!gated) problems.push(`command ${cmd} needs the bot (its card updates live), so elementRelationshipSet must make it depend on bots "${owner.botId}"`);
	}
	return problems;
}

export function checkTools(text) {
	const problems = [];
	let doc;
	try {
		doc = JSON.parse(text);
	} catch (err) {
		return [`mcptools.json is not valid JSON: ${err.message}`];
	}
	if (!Array.isArray(doc.tools) || doc.tools.length === 0) problems.push('mcptools.json needs a non-empty "tools" array');
	const seen = new Set();
	for (const t of doc.tools ?? []) {
		if (!t.name || !t.description || typeof t.inputSchema !== 'object') problems.push(`tool ${t.name || '(unnamed)'} needs name, description and inputSchema`);
		if (seen.has(t.name)) problems.push(`duplicate tool name ${t.name}`);
		seen.add(t.name);
	}
	const bad = nonAscii(text);
	if (bad) problems.push(`mcptools.json contains a non-ASCII character (${bad}); run --refresh-tools`);
	return problems;
}

async function checkIcons() {
	const problems = [];
	for (const [file, size] of [['color.png', 192], ['outline.png', 32]]) {
		if (!existsSync(join(srcDir, file))) {
			problems.push(`${file} is missing; run --regen-icons`);
			continue;
		}
		const meta = await sharp(read(file)).metadata();
		if (meta.format !== 'png' || meta.width !== size || meta.height !== size) {
			problems.push(`${file} must be a ${size}x${size} PNG, got ${meta.width}x${meta.height} ${meta.format}`);
		}
	}
	if (existsSync(join(srcDir, 'outline.png'))) {
		const { data, info } = await sharp(read('outline.png')).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
		let opaque = 0;
		let notWhite = 0;
		for (let i = 0; i < data.length; i += info.channels) {
			if (data[i + 3] > 0) {
				opaque++;
				if (data[i] < 250 || data[i + 1] < 250 || data[i + 2] < 250) notWhite++;
			}
		}
		if (opaque === 0) problems.push('outline.png is fully transparent');
		if (notWhite > 0) problems.push('outline.png must be white on transparent');
		if (opaque === info.width * info.height) problems.push('outline.png has no transparent pixels');
	}
	return problems;
}

/** Validate everything and return { problems, files } without touching the disk. */
export async function assemble(values) {
	const { manifest, problems } = buildManifest(values);
	const toolsText = readText('mcptools.json');
	problems.push(...checkTools(toolsText));
	const agent = parseJsonFile(AGENT_FILE, problems);
	if (agent) problems.push(...checkDeclarativeAgent(agent));
	const plugin = parseJsonFile(PLUGIN_FILE, problems);
	if (plugin) {
		let toolNames = new Set();
		try {
			toolNames = new Set(JSON.parse(toolsText).tools.map((t) => t.name));
		} catch {
			// checkTools has already reported the broken tool file.
		}
		problems.push(...checkPlugin(plugin, toolNames));
	}
	problems.push(...(await checkIcons()));
	for (const ref of [manifest.icons?.color, manifest.icons?.outline, manifest.agentConnectors?.[0]?.toolSource?.remoteMcpServer?.mcpToolDescription?.file]) {
		if (ref && !existsSync(join(srcDir, ref))) problems.push(`manifest references ${ref}, which is not in the source directory`);
	}
	const bad = nonAscii(readText('intro.md'));
	if (bad) problems.push(`intro.md contains a non-ASCII character (${bad})`);
	const files = {
		'manifest.json': Buffer.from(`${JSON.stringify(manifest, null, 2)}\n`),
		'declarativeAgent.json': read(AGENT_FILE),
		'ai-plugin.json': read(PLUGIN_FILE),
		'mcptools.json': read('mcptools.json'),
		'intro.md': read('intro.md'),
		'color.png': existsSync(join(srcDir, 'color.png')) ? read('color.png') : Buffer.alloc(0),
		'outline.png': existsSync(join(srcDir, 'outline.png')) ? read('outline.png') : Buffer.alloc(0),
	};
	return { problems, files };
}

export function zipFiles(files) {
	const entries = {};
	for (const name of PACKAGE_FILES) entries[name] = [new Uint8Array(files[name]), { level: 9, mtime: new Date('2026-01-01T00:00:00Z') }];
	return Buffer.from(zipSync(entries));
}

/** Parse a JSON-RPC reply that is either plain JSON or one or more SSE `data:` frames. */
export function parseRpcReply(body) {
	const trimmed = body.trim();
	if (trimmed.startsWith('{')) return JSON.parse(trimmed);
	const frames = trimmed.split(/\r?\n\r?\n/).map((f) =>
		f
			.split(/\r?\n/)
			.filter((l) => l.startsWith('data:'))
			.map((l) => l.slice(5).trimStart())
			.join('\n'),
	);
	for (const f of frames) {
		if (f.startsWith('{')) {
			const msg = JSON.parse(f);
			if (msg.result || msg.error) return msg;
		}
	}
	throw new Error('No JSON-RPC result in the response');
}

async function refreshTools() {
	const res = await fetch(MCP_URL, {
		method: 'POST',
		headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream' },
		body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list' }),
	});
	if (!res.ok) throw new Error(`${MCP_URL} answered HTTP ${res.status}`);
	const msg = parseRpcReply(await res.text());
	if (msg.error) throw new Error(`tools/list failed: ${msg.error.message}`);
	const tools = msg.result?.tools;
	if (!Array.isArray(tools) || !tools.length) throw new Error('tools/list returned no tools');
	const ascii = JSON.parse(toAscii(JSON.stringify({ tools })));
	const text = `${JSON.stringify(ascii, null, 2)}\n`;
	const problems = checkTools(text);
	if (problems.length) throw new Error(problems.join('\n'));
	writeFileSync(join(srcDir, 'mcptools.json'), text);
	console.log(`mcptools.json rewritten from ${MCP_URL}: ${ascii.tools.length} tools`);
}

async function regenIcons() {
	const trimmed = await sharp(LOGO).trim().png().toBuffer();
	const glyph = (size, pad) =>
		sharp(trimmed).resize(size - pad * 2, size - pad * 2, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } }).png().toBuffer();

	const colorGlyph = await glyph(192, 16);
	await sharp({ create: { width: 192, height: 192, channels: 4, background: '#080814' } })
		.composite([{ input: colorGlyph, gravity: 'center' }])
		.png()
		.toFile(join(srcDir, 'color.png'));

	const canvas = await sharp({ create: { width: 32, height: 32, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } } })
		.composite([{ input: await glyph(32, 3), gravity: 'center' }])
		.png()
		.toBuffer();
	const alpha = await sharp(canvas).extractChannel(3).raw().toBuffer();
	await sharp({ create: { width: 32, height: 32, channels: 3, background: '#ffffff' } })
		.joinChannel(alpha, { raw: { width: 32, height: 32, channels: 1 } })
		.png()
		.toFile(join(srcDir, 'outline.png'));
	console.log('color.png (192x192) and outline.png (32x32) rewritten from public/logo.png');
}

/**
 * The Teams Store and Copilot validation preflight (--store): every preflight rule in
 * validation/rules.json, Microsoft's CLI validator, and (unless --offline) the live URL,
 * TLS, frame-ancestors, MCP and response-time checks. Prints one line per rule.
 */
async function storePreflight(files, env, { check, offline }) {
	const store = await import('./lib/microsoft-store-validation.mjs');
	const { APP_NAME } = await import('../api/_lib/teams-bot-welcome.js');
	const manifest = JSON.parse(files['manifest.json']);
	const intro = files['intro.md'].toString('utf8');
	const tools = JSON.parse(files['mcptools.json']);
	const agent = JSON.parse(files[AGENT_FILE]);
	const plugin = JSON.parse(files[PLUGIN_FILE]);
	const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
	const problems = [
		...store.checkName(manifest, intro, { botName: APP_NAME }),
		...store.checkDescriptions(manifest, intro),
		...store.checkCopilotText({ manifest, tools, agent, plugin }),
		...store.checkTeamsJs(pkg),
		...(await store.checkColorIcon(files['color.png'])),
		...store.checkListingLinks(manifest, intro),
		...store.checkValidDomains(manifest),
		...store.checkBot(manifest),
	];
	const notes = [];
	const developer = store.checkDeveloperName(manifest, env, { check });
	problems.push(...developer.problems);
	const skipped = [];
	if (developer.note) {
		notes.push(developer.note);
		skipped.push('developer.publisher-name');
	}
	const cli = store.atkValidate(files, { env });
	problems.push(...cli.problems);
	if (!cli.problems.length) notes.push(`atk validate: ${cli.output.split('\n').filter(Boolean).pop() ?? 'passed'}`);
	if (offline) {
		skipped.push('copilot.https-no-redirect', 'copilot.frame-ancestors', 'links.https-200', 'response.time');
		notes.push('live checks skipped (--offline)');
	} else {
		const live = await store.checkLive(manifest, intro);
		problems.push(...live.problems);
		notes.push(...live.notes.map((n) => `response time ${n}`));
	}
	const { rules } = store.loadRules();
	console.log(`Store preflight (${rules.filter((r) => r.check.type === 'preflight').length} preflight rules of ${rules.length}):`);
	for (const line of store.summarize(rules, problems, { skipped })) console.log(`  ${line}`);
	for (const n of notes) console.log(`  note: ${n}`);
	return problems.length === 0;
}

export async function main(argv = process.argv.slice(2), env = process.env) {
	if (argv.includes('--refresh-tools')) return refreshTools();
	if (argv.includes('--regen-icons')) return regenIcons();

	const check = argv.includes('--check');
	const { values, missing } = resolveOwnerValues(env, { check });
	if (missing.length) {
		console.error(`Missing owner-only environment variable${missing.length > 1 ? 's' : ''}: ${missing.join(', ')}.`);
		console.error('MS_APP_ID is the app GUID from Partner Center, MS_DEVELOPER_NAME the legal entity name (32 characters or fewer),');
		console.error('MS_KEYVAULT_URL the Azure Key Vault URL, MS_TEAMS_BOT_APP_ID the Azure Bot app id. Run with --check to validate everything else without them.');
		return 2;
	}
	const { problems, files } = await assemble(values);
	if (problems.length) {
		console.error(`Package is not valid:\n- ${problems.join('\n- ')}`);
		return 1;
	}
	if (argv.includes('--store')) {
		const ok = await storePreflight(files, env, { check, offline: argv.includes('--offline') });
		if (!ok) return 1;
	}
	if (check) {
		const agent = JSON.parse(files[AGENT_FILE]);
		const plugin = JSON.parse(files[PLUGIN_FILE]);
		console.log(
			`OK: manifest, schema v1.30, ${JSON.parse(files['mcptools.json']).tools.length} tools, meeting stage tab and RSC, Teams, Outlook and Microsoft 365 app host declarations, ` +
				`declarative agent "${agent.name}" (schema ${agent.version}, ${agent.instructions.length}/${AGENT_LIMITS.instructions} instruction characters, ` +
				`${agent.conversation_starters.length} starters), plugin schema ${plugin.schema_version} pinning ${plugin.functions.length} tools, ` +
				'icons and ASCII checks pass (owner values not checked).',
		);
		return 0;
	}
	mkdirSync(dirname(outFile), { recursive: true });
	const zip = zipFiles(files);
	writeFileSync(outFile, zip);
	console.log(`Wrote ${outFile} (${zip.length} bytes)`);
	return 0;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
	main().then(
		(code) => process.exit(code ?? 0),
		(err) => {
			console.error(err.message);
			process.exit(1);
		},
	);
}
