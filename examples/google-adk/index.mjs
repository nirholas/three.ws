#!/usr/bin/env node
// A Google ADK agent that calls the free three.ws MCP server over MCPToolset.
//
//   node index.mjs --check    discover the tool catalog and run one real tool
//                             call against the live server (no model key needed)
//   node index.mjs            run a full LlmAgent conversation that picks the
//                             tool itself (needs a Gemini credential, see below)
//
// The MCP connection itself needs no key: https://three.ws/api/mcp-studio is
// the free, no-auth studio surface. Driving it through an actual LlmAgent
// conversation needs a Gemini credential, either GOOGLE_API_KEY (AI Studio) or
// GOOGLE_GENAI_USE_VERTEXAI=true with GOOGLE_CLOUD_PROJECT/GOOGLE_CLOUD_LOCATION
// and Application Default Credentials (Vertex AI). Without one, --check still
// proves the MCP wiring end to end: discovery plus one real tool call.

import { LlmAgent, MCPToolset, InMemoryRunner } from '@google/adk';

const MCP_URL = process.env.THREE_WS_MCP_URL || 'https://three.ws/api/mcp-studio';
const args = process.argv.slice(2);
const flags = new Set(args.filter((a) => a.startsWith('--')));
const prompt = args.filter((a) => !a.startsWith('--')).join(' ') || 'rig this GLB: https://three.ws/avatars/cesium-man.glb';

function hasGeminiCredential() {
	return Boolean(process.env.GOOGLE_API_KEY) || process.env.GOOGLE_GENAI_USE_VERTEXAI === 'true';
}

function buildAgent(toolset) {
	return new LlmAgent({
		model: 'gemini-flash-latest',
		name: 'three_ws_agent',
		instruction:
			'You help the user generate and rig 3D models and avatars with the ' +
			'three.ws studio tools. Call the tool that matches the request, then ' +
			'reply with the links it returns (viewer, GLB, pose studio).',
		tools: [toolset],
	});
}

// Proves the MCP wiring without a model: list the live tool catalog, then run
// one real, deterministic tool call (rigging a known public GLB) the same way
// MCPTool.runAsync does it internally.
async function check(toolset) {
	const tools = await toolset.getTools();
	const names = tools.map((t) => t.name);
	console.log(`server   ${MCP_URL}`);
	console.log(`tools    ${names.length}: ${names.join(', ')}`);

	const rig = tools.find((t) => t.name === 'rig_mesh');
	if (!rig) throw new Error('the server does not offer rig_mesh');

	const result = await rig.runAsync({
		args: { glb_url: 'https://three.ws/avatars/cesium-man.glb' },
		toolContext: {},
	});
	const text = result?.content?.[0]?.text || JSON.stringify(result);
	console.log('\nrig_mesh result:');
	console.log(text);
}

// Runs the agent through a real LlmAgent + InMemoryRunner conversation: the
// model itself decides which three.ws tool to call from the prompt.
async function converse(agent) {
	if (!hasGeminiCredential()) {
		throw new Error(
			'Set GOOGLE_API_KEY (https://aistudio.google.com/apikey), or GOOGLE_GENAI_USE_VERTEXAI=true ' +
				'with GOOGLE_CLOUD_PROJECT/GOOGLE_CLOUD_LOCATION and gcloud auth application-default login, ' +
				'to run a full agent conversation. Use --check to verify the MCP wiring without a model.',
		);
	}
	const runner = new InMemoryRunner({ agent });
	const session = await runner.sessionService.createSession({ appName: agent.name, userId: 'example-user' });
	for await (const event of runner.runAsync({
		userId: 'example-user',
		sessionId: session.id,
		newMessage: { role: 'user', parts: [{ text: prompt }] },
	})) {
		for (const part of event.content?.parts || []) {
			if (part.text) process.stdout.write(part.text);
			if (part.functionCall) console.log(`\n[tool call] ${part.functionCall.name}(${JSON.stringify(part.functionCall.args)})`);
			if (part.functionResponse) console.log(`[tool result] ${JSON.stringify(part.functionResponse.response).slice(0, 400)}`);
		}
	}
	console.log();
}

const toolset = new MCPToolset({ type: 'StreamableHTTPConnectionParams', url: MCP_URL });
try {
	if (flags.has('--check')) await check(toolset);
	else await converse(buildAgent(toolset));
} catch (err) {
	console.error(`error: ${err.message}`);
	process.exitCode = 1;
} finally {
	await toolset.close();
}
