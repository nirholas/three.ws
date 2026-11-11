// scripts/import-power-platform-templates.mjs
// Create the three.ws flow templates (integrations/microsoft/power-platform-connector/templates/)
// as cloud flows in a Power Platform environment, through the Dataverse Web API that
// Microsoft documents for working with cloud flows in code: a `workflows` row with
// category 5 and the flow JSON in `clientdata`, bound to `connectionreferences` rows.
//
//   DATAVERSE_TOKEN=$(az account get-access-token --resource https://<org>.crm.dynamics.com --query accessToken -o tsv) \
//     node scripts/import-power-platform-templates.mjs --env https://<org>.crm.dynamics.com --values values.json [--solution <uniquename>] [--dry-run]
//
// values.json:
//   {
//     "connectorApi": "shared_threews3dstudio",          the connector's API name in this environment
//     "connections": { "shared_teams": "<connection id>", ... },   one per connection reference the flows use
//     "templates": { "daily-agent-digest": { "Digest recipient": "you@contoso.com" }, ... }
//   }
// Before certification the connector is a custom connector, whose API name carries a suffix
// (shared_three-2ews-203d-20studio-5f...); copy it from the connector's details page.
// Connection ids are in the address bar of each connection under Data > Connections.
// Flows are created turned off, so you can review them before switching them on.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { CONNECTOR_DIR } from './power-platform-contract.mjs';
import { CONNECTOR_API } from './power-platform-templates.mjs';

const API_PREFIX = '/providers/Microsoft.PowerApps/apis/';

export function loadTemplate(name) {
	return JSON.parse(readFileSync(join(CONNECTOR_DIR, 'templates', name, 'workflow.json'), 'utf8'));
}

function walk(node, visit) {
	if (Array.isArray(node)) node.forEach((n) => walk(n, visit));
	else if (node && typeof node === 'object') {
		visit(node);
		Object.values(node).forEach((n) => walk(n, visit));
	}
}

/**
 * Turn a template into the clientdata of a workflows row: point the three.ws actions at
 * the connector's API name in this environment and write the maker's parameter values in
 * as defaults. Returns the connection references the flow needs and any parameter left
 * without a value.
 */
export function prepareTemplate(flow, { connectorApi = CONNECTOR_API, values = {} } = {}) {
	const copy = structuredClone(flow);
	const { definition, connectionReferences } = copy.properties;
	walk(definition, (node) => {
		if (node.apiId === `${API_PREFIX}${CONNECTOR_API}`) node.apiId = `${API_PREFIX}${connectorApi}`;
	});
	const refs = [];
	for (const [key, ref] of Object.entries(connectionReferences)) {
		if (ref.api.name === CONNECTOR_API) ref.api.name = connectorApi;
		refs.push({ key, logicalName: ref.connection.connectionReferenceLogicalName, api: ref.api.name });
	}
	const unknown = Object.keys(values).filter((k) => !definition.parameters[k] || k.startsWith('$'));
	if (unknown.length) throw new Error(`${copy.properties.displayName} has no parameter named ${unknown.join(', ')}`);
	const missing = [];
	for (const [name, p] of Object.entries(definition.parameters)) {
		if (name.startsWith('$')) continue;
		if (values[name] !== undefined) p.defaultValue = values[name];
		if (p.defaultValue === '' || p.defaultValue === undefined) missing.push(name);
		if (p.allowedValues && !p.allowedValues.includes(p.defaultValue)) throw new Error(`${name} must be one of ${p.allowedValues.join(', ')}`);
	}
	const clientdata = JSON.stringify({ properties: { connectionReferences, definition }, schemaVersion: copy.schemaVersion || '1.0.0.0' });
	return { name: copy.properties.displayName, description: copy.properties.description, clientdata, refs, missing };
}

/** The workflows row the Dataverse Web API takes for a cloud flow, created turned off. */
export function workflowRow(prepared) {
	return { category: 5, type: 1, primaryentity: 'none', name: prepared.name, description: prepared.description, clientdata: prepared.clientdata, statecode: 0 };
}

async function dataverse(env, token, path, { method = 'GET', body, solution } = {}) {
	const res = await fetch(`${env}/api/data/v9.2/${path}`, {
		method,
		headers: {
			authorization: `Bearer ${token}`,
			accept: 'application/json',
			'odata-version': '4.0',
			'odata-maxversion': '4.0',
			...(body ? { 'content-type': 'application/json' } : {}),
			...(solution ? { 'MSCRM.SolutionUniqueName': solution } : {}),
			prefer: 'return=representation',
		},
		body: body ? JSON.stringify(body) : undefined,
	});
	const text = await res.text();
	if (!res.ok) throw new Error(`${method} ${path} failed with ${res.status}: ${text.slice(0, 500)}`);
	return text ? JSON.parse(text) : {};
}

async function ensureConnectionReference(env, token, ref, connectionId, solution) {
	const filter = encodeURIComponent(`connectionreferencelogicalname eq '${ref.logicalName}'`);
	const found = await dataverse(env, token, `connectionreferences?$select=connectionreferenceid,connectionid&$filter=${filter}`);
	if (found.value?.length) return { created: false, id: found.value[0].connectionreferenceid };
	const row = await dataverse(env, token, 'connectionreferences', {
		method: 'POST',
		solution,
		body: {
			connectionreferencelogicalname: ref.logicalName,
			connectionreferencedisplayname: `three.ws templates: ${ref.api}`,
			connectorid: `${API_PREFIX}${ref.api}`,
			connectionid: connectionId,
		},
	});
	return { created: true, id: row.connectionreferenceid };
}

function arg(argv, name) {
	const i = argv.indexOf(name);
	return i === -1 ? undefined : argv[i + 1];
}

export async function main(argv = process.argv.slice(2), env = process.env) {
	const envUrl = String(arg(argv, '--env') || '').replace(/\/$/, '');
	const valuesFile = arg(argv, '--values');
	const solution = arg(argv, '--solution');
	const dryRun = argv.includes('--dry-run');
	if (!/^https:\/\/[^/]+\.dynamics\.com$/.test(envUrl) || !valuesFile) {
		console.error('Usage: node scripts/import-power-platform-templates.mjs --env https://<org>.crm.dynamics.com --values values.json [--solution <uniquename>] [--dry-run]');
		return 2;
	}
	const token = env.DATAVERSE_TOKEN;
	if (!token && !dryRun) {
		console.error('DATAVERSE_TOKEN is not set. Get one with: az account get-access-token --resource <env url> --query accessToken -o tsv');
		return 2;
	}
	const config = JSON.parse(readFileSync(valuesFile, 'utf8'));
	const prepared = Object.entries(config.templates || {}).map(([name, values]) => prepareTemplate(loadTemplate(name), { connectorApi: config.connectorApi, values }));
	if (!prepared.length) {
		console.error('values.json lists no templates. Add a "templates" entry per template folder name.');
		return 2;
	}
	const problems = [];
	for (const p of prepared) {
		if (p.missing.length) problems.push(`${p.name}: no value for ${p.missing.join(', ')}`);
		for (const r of p.refs) if (!config.connections?.[r.key]) problems.push(`${p.name}: no connection id for ${r.key} in "connections"`);
	}
	if (problems.length) {
		console.error(`Cannot import:\n- ${problems.join('\n- ')}`);
		return 1;
	}
	for (const p of prepared) {
		if (dryRun) {
			console.log(`[dry run] ${p.name}: connection references ${p.refs.map((r) => r.logicalName).join(', ')}; workflows row of ${p.clientdata.length} bytes`);
			continue;
		}
		for (const r of p.refs) {
			const { created } = await ensureConnectionReference(envUrl, token, r, config.connections[r.key], solution);
			console.log(`${created ? 'Created' : 'Reusing'} connection reference ${r.logicalName}`);
		}
		const row = await dataverse(envUrl, token, 'workflows', { method: 'POST', body: workflowRow(p), solution });
		console.log(`Created "${p.name}" (workflow ${row.workflowid}), turned off. Open it in Power Automate, review it, and turn it on.`);
	}
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
