// Executed inside the real VS Code extension host by test/electron/run.mjs.
// It must export run(); a rejected promise fails the run.

const assert = require('node:assert/strict');
const vscode = require('vscode');

const TOOLS = ['threews_generate_model', 'threews_check_job', 'threews_find_asset', 'threews_inspect_glb', 'threews_optimize_glb'];

async function check(name, fn) {
	try {
		await fn();
		console.log(`ok - ${name}`);
	} catch (err) {
		console.log(`not ok - ${name}`);
		throw err;
	}
}

exports.run = async function run() {
	const ext = vscode.extensions.getExtension('threews.vscode-3d');
	await check('the extension is installed and activates', async () => {
		assert.ok(ext, 'threews.vscode-3d is not loaded');
		await ext.activate();
		assert.equal(ext.isActive, true);
	});

	await check('vscode.lm lists all five tools with their schemas', async () => {
		const ours = vscode.lm.tools.filter((t) => TOOLS.includes(t.name));
		assert.deepEqual(ours.map((t) => t.name).sort(), [...TOOLS].sort());
		for (const tool of ours) {
			assert.equal(tool.inputSchema?.type, 'object', `${tool.name} schema`);
			assert.ok(tool.description.length > 80, `${tool.name} description`);
		}
	});

	await check('threews_find_asset runs through vscode.lm.invokeTool against the live catalog', async () => {
		const source = new vscode.CancellationTokenSource();
		const result = await vscode.lm.invokeTool('threews_find_asset', { input: { query: 'chair', limit: 2 }, toolInvocationToken: undefined }, source.token);
		const text = result.content.map((p) => p.value || '').join('');
		assert.match(text, /match(es)? for "chair"/, text);
		assert.match(text, /glb_url: https:\/\//, text);
		console.log(text.split('\n').slice(0, 3).map((l) => `    ${l}`).join('\n'));
	});

	await check('the chat, MCP and sign-in commands are registered', async () => {
		const commands = await vscode.commands.getCommands(true);
		for (const id of ['threews3d.signIn', 'threews3d.signOut', 'threews3d.previewUrl', 'threews3d.importGalleryItem']) {
			assert.ok(commands.includes(id), `${id} missing`);
		}
		assert.equal(typeof vscode.lm.registerMcpServerDefinitionProvider, 'function');
		assert.equal(typeof vscode.chat.createChatParticipant, 'function');
	});
};
