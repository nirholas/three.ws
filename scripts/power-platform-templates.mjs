// scripts/power-platform-templates.mjs
// Static checks for the flow templates and the Copilot Studio sample that ship with the
// three.ws Power Platform connector (integrations/microsoft/power-platform-connector/templates/).
//
// A flow template is a Power Automate flow definition (Logic Apps workflow definition
// language) in <template>/workflow.json with a README.md beside it. The checks make sure a
// template can only call actions the connector has, with inputs the action declares, and
// only read response fields the action returns, so the templates cannot drift from
// apiDefinition.swagger.json. The Copilot Studio sample (copilot-studio/agent.json) is held
// to the same rule for the tools it adds.
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { buildRequest, operations } from './power-platform-contract.mjs';

export const LOGIC_APPS_SCHEMA = 'https://schema.management.azure.com/providers/Microsoft.Logic/schemas/2016-06-01/workflowdefinition.json#';
// Certified connectors are addressed as shared_<name>, the name derived from the title.
export const CONNECTOR_API = 'shared_threews3dstudio';
export const CONNECTOR_API_ID = `/providers/Microsoft.PowerApps/apis/${CONNECTOR_API}`;
export const COPILOT_DIR = 'copilot-studio';
const CONNECTION_TYPES = new Set(['OpenApiConnection', 'OpenApiConnectionWebhook']);
const AUTH_EXPRESSION = "@parameters('$authentication')";

function readJson(file, label, problems) {
	try {
		return JSON.parse(readFileSync(file, 'utf8'));
	} catch (err) {
		problems.push(`${label} is not valid JSON: ${err.message}`);
		return null;
	}
}

function badCharacter(text) {
	const m = /[^\x09\x0a\x0d\x20-\x7e]/.exec(text);
	return m ? `U+${m[0].codePointAt(0).toString(16).toUpperCase().padStart(4, '0')}` : null;
}

/** Every action in a scope, recursing into conditions, switches, loops and scopes. */
export function collectActions(scope, out = [], parent = 'root') {
	for (const [name, action] of Object.entries(scope || {})) {
		out.push({ name, action, parent, siblings: scope });
		collectActions(action.actions, out, name);
		collectActions(action.else?.actions, out, `${name}/else`);
		for (const c of Object.values(action.cases || {})) collectActions(c.actions, out, `${name}/case`);
		collectActions(action.default?.actions, out, `${name}/default`);
	}
	return out;
}

/** Map designer parameter keys (`body/prompt`, `q`) to the contract builder's input names. */
function connectorInputs(parameters) {
	return Object.fromEntries(Object.entries(parameters || {}).map(([k, v]) => [k.startsWith('body/') ? k.slice(5) : k, v]));
}

function responseFields(def, operationId) {
	const entry = operations(def).get(operationId);
	let schema = entry?.op.responses?.['200']?.schema;
	if (schema?.$ref) schema = def.definitions[schema.$ref.replace('#/definitions/', '')];
	return new Set(Object.keys(schema?.properties || {}));
}

function checkWorkflow(def, name, flow, problems) {
	const label = `templates/${name}/workflow.json`;
	const used = new Set();
	const props = flow?.properties;
	const definition = props?.definition;
	if (!props?.displayName) problems.push(`${label} has no properties.displayName`);
	if (!definition) {
		problems.push(`${label} has no properties.definition`);
		return used;
	}
	if (definition.$schema !== LOGIC_APPS_SCHEMA) problems.push(`${label} definition.$schema must be the Logic Apps workflow definition schema`);
	if (definition.contentVersion !== '1.0.0.0') problems.push(`${label} definition.contentVersion must be 1.0.0.0`);
	for (const p of ['$connections', '$authentication']) {
		if (!definition.parameters?.[p]) problems.push(`${label} definition.parameters is missing ${p}`);
	}
	const triggers = Object.entries(definition.triggers || {});
	if (triggers.length !== 1) problems.push(`${label} must have exactly one trigger (has ${triggers.length})`);
	const refs = props.connectionReferences || {};
	const actions = collectActions(definition.actions);
	const names = new Set([...triggers.map(([n]) => n), ...actions.map((a) => a.name)]);
	const variables = new Set(actions.filter((a) => a.action.type === 'InitializeVariable').flatMap((a) => (a.action.inputs?.variables || []).map((v) => v.name)));
	const threewsActions = new Map();

	for (const { name: actionName, action, siblings } of [...triggers.map(([n, a]) => ({ name: n, action: a, siblings: {} })), ...actions]) {
		const where = `${label} ${actionName}`;
		for (const after of Object.keys(action.runAfter || {})) {
			if (!(after in siblings)) problems.push(`${where} runs after "${after}", which is not an action in the same scope`);
		}
		if (!CONNECTION_TYPES.has(action.type)) continue;
		const host = action.inputs?.host || {};
		const ref = refs[host.connectionName];
		if (!ref) problems.push(`${where} uses connection "${host.connectionName}", which connectionReferences does not declare`);
		else if (!String(host.apiId || '').endsWith(`/${ref.api?.name}`)) problems.push(`${where} apiId ${host.apiId} does not match its connection reference api ${ref.api?.name}`);
		if (action.inputs?.authentication !== AUTH_EXPRESSION) problems.push(`${where} must authenticate with ${AUTH_EXPRESSION}`);
		if (host.apiId !== CONNECTOR_API_ID) continue;
		used.add(host.operationId);
		threewsActions.set(actionName, host.operationId);
		if (!operations(def).has(host.operationId)) {
			problems.push(`${where} calls ${host.operationId}, which the connector does not define`);
			continue;
		}
		try {
			buildRequest(def, host.operationId, connectorInputs(action.inputs.parameters), { expressions: true });
		} catch (err) {
			problems.push(`${where}: ${err.message}`);
		}
	}

	const text = JSON.stringify(definition);
	for (const [, fn, target] of text.matchAll(/\b(body|outputs|actions)\('([^']+)'\)/g)) {
		if (!names.has(target)) problems.push(`${label} reads ${fn}('${target}'), which is not an action or trigger in the flow`);
	}
	for (const [, target] of text.matchAll(/\bparameters\('([^']+)'\)/g)) {
		if (!definition.parameters?.[target]) problems.push(`${label} reads parameters('${target}'), which definition.parameters does not declare`);
	}
	for (const [, target] of text.matchAll(/\bvariables\('([^']+)'\)/g)) {
		if (!variables.has(target)) problems.push(`${label} reads variables('${target}'), which no Initialize variable action declares`);
	}
	for (const [, target, field] of text.matchAll(/\bbody\('([^']+)'\)\?\['([^']+)'\]/g)) {
		const op = threewsActions.get(target);
		if (op && !responseFields(def, op).has(field)) problems.push(`${label} reads body('${target}')?['${field}'], which ${op} does not return`);
	}
	for (const [pname, p] of Object.entries(definition.parameters || {})) {
		if (pname.startsWith('$')) continue;
		if (!p.metadata?.description) problems.push(`${label} parameter "${pname}" needs metadata.description telling the maker what to enter`);
	}
	return used;
}

function checkReadme(def, dir, label, used, problems) {
	const file = join(dir, 'README.md');
	if (!existsSync(file)) {
		problems.push(`${label} has no README.md`);
		return;
	}
	const readme = readFileSync(file, 'utf8');
	const bad = badCharacter(readme);
	if (bad) problems.push(`${label}/README.md contains a non-ASCII character (${bad})`);
	for (const op of used) {
		const summary = operations(def).get(op)?.op.summary;
		if (summary && !readme.includes(summary)) problems.push(`${label}/README.md does not name the "${summary}" action the template uses`);
	}
}

function checkCopilotStudio(def, dir, problems) {
	const label = `templates/${COPILOT_DIR}`;
	const used = new Set();
	const agent = readJson(join(dir, 'agent.json'), `${label}/agent.json`, problems);
	if (!agent) return used;
	for (const key of ['name', 'description', 'instructionsFile']) {
		if (!agent[key]) problems.push(`${label}/agent.json has no ${key}`);
	}
	if (agent.instructionsFile && !existsSync(join(dir, agent.instructionsFile))) problems.push(`${label}/agent.json points at ${agent.instructionsFile}, which does not exist`);
	const tools = new Map();
	for (const tool of agent.tools || []) {
		const where = `${label}/agent.json tool "${tool.name}"`;
		if (!operations(def).has(tool.operationId)) {
			problems.push(`${where} uses ${tool.operationId}, which the connector does not define`);
			continue;
		}
		if (!tool.description || tool.description.length < 40) problems.push(`${where} needs a description of 40+ characters, the orchestrator picks tools by it`);
		used.add(tool.operationId);
		tools.set(tool.name, tool.operationId);
		const sample = Object.fromEntries(Object.entries(tool.inputs || {}).map(([k, v]) => [k, v.value ?? '@dynamic']));
		try {
			buildRequest(def, tool.operationId, sample, { expressions: true });
		} catch (err) {
			if (!/requires /.test(err.message)) problems.push(`${where}: ${err.message}`);
		}
		for (const [k, v] of Object.entries(tool.inputs || {})) {
			if (!v.value && !v.description) problems.push(`${where} input ${k} needs a description or a fixed value`);
		}
	}
	if (!tools.size) problems.push(`${label}/agent.json adds no connector tools`);
	for (const t of agent.testPrompts || []) {
		if (!tools.has(t.expectTool)) problems.push(`${label}/agent.json test prompt "${t.prompt}" expects tool "${t.expectTool}", which the agent does not add`);
	}
	if (!(agent.testPrompts || []).length) problems.push(`${label}/agent.json has no testPrompts`);
	checkReadme(def, dir, label, used, problems);
	return used;
}

/**
 * Check every template under dir against the connector definition. Returns the problems
 * and, per template, the connector operations it calls.
 */
export function checkTemplates(def, dir) {
	const problems = [];
	const used = new Map();
	if (!existsSync(dir)) return { problems: ['templates/ does not exist'], used };
	for (const name of readdirSync(dir).sort()) {
		const sub = join(dir, name);
		if (!statSync(sub).isDirectory()) continue;
		if (name === COPILOT_DIR) {
			used.set(name, checkCopilotStudio(def, sub, problems));
			continue;
		}
		const file = join(sub, 'workflow.json');
		if (!existsSync(file)) {
			problems.push(`templates/${name} has no workflow.json`);
			continue;
		}
		const raw = readFileSync(file, 'utf8');
		const bad = badCharacter(raw);
		if (bad) problems.push(`templates/${name}/workflow.json contains a non-ASCII character (${bad})`);
		const flow = readJson(file, `templates/${name}/workflow.json`, problems);
		const ops = flow ? checkWorkflow(def, name, flow, problems) : new Set();
		if (flow && !ops.size) problems.push(`templates/${name}/workflow.json calls no three.ws action`);
		checkReadme(def, sub, `templates/${name}`, ops, problems);
		used.set(name, ops);
	}
	const flows = [...used.keys()].filter((n) => n !== COPILOT_DIR);
	if (flows.length < 3 || flows.length > 5) problems.push(`templates/ should hold 3 to 5 flow templates (has ${flows.length})`);
	return { problems, used };
}
