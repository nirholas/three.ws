// three.ws inside GitHub Copilot Chat: the @threews participant, the language
// model tools agent mode calls, and the MCP servers VS Code connects to.
//
// Only finalized VS Code APIs are used (chat participants, lm.registerTool,
// lm.registerMcpServerDefinitionProvider, all stable since 1.101). Editors built
// on VS Code that lack one of them still activate: each piece registers only
// when its API exists.

import * as vscode from 'vscode';
import { PARTICIPANT_ID, followupsFor, helpMarkdown, kindFromText, routeRequest, urlIn } from './chat-routing.js';
import { TOOL_SPECS } from './copilot-tools.js';
import { searchCatalog } from './catalog.js';
import { TOOLS, callTool, describeStatus } from './studio.js';
import { buildEmbedSnippet, resolveEmbedRelease } from './embed.js';
import { downloadModel } from './download.js';
import { activeViewer } from './active-panel.js';
import { uniqueName } from './naming.js';
import { MCP_PROVIDER_ID, serverList, validateApiKey } from './mcp-servers.js';

const ACCOUNT_KEY = 'threews3d.mcpAccount';
const SECRET_KEY = 'threews3d.apiKey';

/**
 * @param {vscode.ExtensionContext} context
 * @param {{ origin: () => string, links: import('./links.js').ModelLinks, output: vscode.OutputChannel }} host
 */
export function registerCopilot(context, host) {
	const disposables = [];
	if (typeof vscode.chat?.createChatParticipant === 'function') disposables.push(registerParticipant(context, host));
	if (typeof vscode.lm?.registerTool === 'function') disposables.push(...registerTools(host));
	disposables.push(...registerMcp(context, host));
	return vscode.Disposable.from(...disposables);
}

// ------------------------------------------------------------ chat participant

function registerParticipant(context, host) {
	const participant = vscode.chat.createChatParticipant(PARTICIPANT_ID, (request, chatContext, stream, token) =>
		handleChat(host, request, stream, token),
	);
	participant.iconPath = vscode.Uri.joinPath(context.extensionUri, 'media', 'icon.png');
	participant.followupProvider = { provideFollowups: (result) => followupsFor(result?.metadata || {}) };
	return participant;
}

/** One chat turn. Exported for the tests, which drive it with a recording stream. */
export async function handleChat(host, request, stream, token) {
	const route = routeRequest(request);
	const controller = new AbortController();
	if (token?.isCancellationRequested) controller.abort();
	const sub = token?.onCancellationRequested?.(() => controller.abort());
	const signal = controller.signal;
	try {
		switch (route.command) {
			case 'forge':
				return await chatForge(host, route, stream, signal);
			case 'find':
				return await chatFind(host, route, request, stream, signal);
			case 'rig':
				return await chatRig(host, route, request, stream, signal);
			case 'embed':
				return await chatEmbed(host, route, request, stream);
			default:
				stream.markdown(helpMarkdown());
				return { metadata: { command: 'help' } };
		}
	} catch (err) {
		const message = err?.message || String(err);
		if (signal.aborted || message === 'cancelled') {
			stream.markdown('\n\nStopped. Nothing was saved; ask again whenever you are ready.');
			return { metadata: { command: route.command, cancelled: true } };
		}
		host.output.appendLine(`@threews /${route.command} failed: ${message}`);
		return { errorDetails: { message: explain(route.command, message) }, metadata: { command: route.command, subject: route.subject, failed: true } };
	} finally {
		sub?.dispose?.();
	}
}

async function chatForge(host, route, stream, signal) {
	const subject = route.subject;
	if (subject.length < 3) {
		stream.markdown('Describe the one object you want, for example `@threews /forge a low-poly brass lantern with amber glass`.');
		return { metadata: { command: 'help' } };
	}
	const tier = vscode.workspace.getConfiguration('threews3d').get('tier', 'draft');
	stream.progress(`Sending "${subject}" to the free three.ws text to 3D lane (${tier})`);
	const model = await callTool(host.origin(), TOOLS.model, { prompt: subject, tier }, { signal, onStatus: statusReporter(stream) });
	stream.markdown(`Your model of **${subject}** is ready.`);
	if (model.viewerUrl) stream.markdown(` [Open it in the browser](${model.viewerUrl}).`);
	modelButtons(stream, model.glbUrl, subject);
	return { metadata: { command: 'forge', glbUrl: model.glbUrl, subject } };
}

async function chatFind(host, route, request, stream, signal) {
	const subject = route.subject;
	if (!subject) {
		stream.markdown('What should I look for? For example `@threews /find wooden chair` or `@threews /find walk animation`.');
		return { metadata: { command: 'help' } };
	}
	const kind = kindFromText(request.prompt);
	stream.progress(`Searching the three.ws catalog for "${subject}"`);
	const found = await searchCatalog(host.origin(), { query: subject, kind, limit: 6 }, { signal });
	if (!found.items.length) {
		stream.markdown(`Nothing in the catalog matches **${subject}**${found.total ? ` (of ${found.total.toLocaleString('en-US')} assets)` : ''}. Try a broader word, or generate it.`);
		return { metadata: { command: 'find', subject, found: 0 } };
	}
	const heading = `${found.matched.toLocaleString('en-US')} match${found.matched === 1 ? '' : 'es'} for **${subject}**${found.relaxed ? ' (not every word matched)' : ''}:\n\n`;
	const rows = found.items.map((item) => {
		const view = item.viewerUrl ? ` [view](${item.viewerUrl})` : '';
		return `- **${item.title}**, ${item.kind}${item.license ? `, ${item.license}` : ''}${view}`;
	});
	stream.markdown(heading + rows.join('\n'));
	const first = found.items.find((item) => item.glbUrl && /\.(glb|gltf)(\?|$)/i.test(item.glbUrl));
	if (first) modelButtons(stream, first.glbUrl, first.title, ` "${first.title}"`);
	return { metadata: { command: 'find', subject, found: found.items.length, firstGlbUrl: first?.glbUrl } };
}

async function chatRig(host, route, request, stream, signal) {
	const source = sourceFor(host, request);
	if (!source.url) {
		stream.markdown(source.why);
		return { metadata: { command: 'rig', needsSource: true } };
	}
	stream.progress(`Rigging ${source.label} on the three.ws GPU worker`);
	const rigged = await callTool(host.origin(), TOOLS.rig, { glb_url: source.url }, { signal, onStatus: statusReporter(stream) });
	stream.markdown(`${capitalize(source.label)} now has a humanoid skeleton and skin weights.`);
	if (rigged.viewerUrl) stream.markdown(` [Pose it in the browser](${rigged.viewerUrl}).`);
	modelButtons(stream, rigged.glbUrl, `${source.stem || 'model'} rigged`);
	return { metadata: { command: 'rig', glbUrl: rigged.glbUrl } };
}

async function chatEmbed(host, route, request, stream) {
	const source = sourceFor(host, request);
	if (!source.url) {
		stream.markdown(source.why);
		return { metadata: { command: 'embed', needsSource: true } };
	}
	stream.progress('Resolving the current <agent-3d> release');
	const channel = vscode.workspace.getConfiguration('threews3d').get('embedChannel', 'pinned');
	const release = await resolveEmbedRelease(host.origin(), channel);
	const snippet = buildEmbedSnippet({ src: source.url, origin: host.origin(), ...release });
	const editor = vscode.window.activeTextEditor;
	if (editor) {
		const applied = await editor.edit((edit) => {
			for (const selection of editor.selections) edit.replace(selection, snippet);
		});
		const name = vscode.workspace.asRelativePath(editor.document.uri, false);
		stream.markdown(applied ? `Inserted the embed for ${source.label} into \`${name}\`:\n\n` : `\`${name}\` refused the edit (it may be read-only). Here is the snippet to paste:\n\n`);
	} else {
		stream.markdown('No file is open, so here is the snippet to paste:\n\n');
	}
	stream.markdown(`\`\`\`html\n${snippet}\n\`\`\``);
	return { metadata: { command: 'embed', glbUrl: source.url } };
}

/**
 * Which hosted model /rig and /embed act on: a URL in the prompt, then a
 * #file reference this extension knows the URL of, then the active viewer.
 */
function sourceFor(host, request) {
	const inPrompt = urlIn(request.prompt);
	if (inPrompt) return { url: inPrompt, label: 'the model at that URL', stem: stemFromUrl(inPrompt) };
	const candidates = [];
	for (const ref of request.references || []) {
		const uri = ref?.value?.uri || ref?.value;
		if (uri instanceof vscode.Uri) candidates.push(uri);
	}
	const panel = activeViewer()?.threews;
	if (panel?.remoteUrl) return { url: panel.remoteUrl, label: 'the model in the viewer', stem: stemFromUrl(panel.remoteUrl) };
	if (panel?.resource) candidates.push(panel.resource);
	for (const uri of candidates) {
		const name = vscode.workspace.asRelativePath(uri, false);
		const url = host.links.get(uri);
		if (url) return { url, label: `\`${name}\``, stem: name.split('/').pop().replace(/\.(glb|gltf)$/i, '') };
		return {
			url: null,
			why:
				`\`${name}\` is only on your disk. The three.ws worker and the embed both fetch the model over https, so it needs a public URL first. ` +
				'Models you generate or save through three.ws remember theirs automatically. Otherwise host the file and run this again with its URL, e.g. `@threews /rig https://example.com/robot.glb`.',
		};
	}
	return {
		url: null,
		why: 'Which model? Paste its https URL (`@threews /rig https://example.com/robot.glb`), attach a GLB you generated with `#file`, or open one in the three.ws viewer first.',
	};
}

function modelButtons(stream, glbUrl, prompt, suffix = '') {
	stream.button({ command: 'threews3d.previewUrl', title: `Open${suffix} in the viewer`, arguments: [glbUrl] });
	stream.button({ command: 'threews3d.importGalleryItem', title: 'Save GLB to workspace', arguments: [{ glbUrl, prompt }] });
}

/** Honest queue status: the studio's own stage and ETA, plus a watch link once. */
function statusReporter(stream) {
	let linked = false;
	return (status) => {
		stream.progress(capitalize(describeStatus(status)));
		if (!linked && status.watchUrl) {
			linked = true;
			stream.markdown(`Still rendering on the GPU. [Watch it live](${status.watchUrl}) or wait here; I will post the model when it lands.\n\n`);
		}
	};
}

function explain(command, message) {
	const what = { forge: 'Generating the model', find: 'Searching the catalog', rig: 'Rigging the model', embed: 'Building the embed' }[command] || 'That request';
	let next = 'Try again in a moment.';
	if (/could not reach|did not answer|HTTP 5\d\d/i.test(message)) next = 'three.ws did not answer. Check your connection, or the threews3d.origin setting, and try again.';
	else if (/\b(quota|rate[- ]?limit(ed)?|limit reached|too many requests|429)\b/i.test(message)) next = 'The free lane is busy or your share is used up for now. Try again later, or use `/find` for a ready-made asset.';
	else if (/\b(refused|moderation|not allowed|content policy)\b/i.test(message)) next = 'Rephrase the request as one object, without names of real people or brands.';
	else if (/ten minutes/i.test(message)) next = 'The job keeps running on three.ws; open the link above to collect it.';
	return `${what} failed: ${message} ${next}`;
}

// ------------------------------------------------------- language model tools

function registerTools(host) {
	return TOOL_SPECS.map((spec) =>
		vscode.lm.registerTool(spec.name, {
			prepareInvocation(options) {
				const confirm = spec.confirm(options.input, toolDeps(host));
				return {
					invocationMessage: spec.progress(options.input),
					...(confirm ? { confirmationMessages: { title: confirm.title, message: new vscode.MarkdownString(confirm.message) } } : {}),
				};
			},
			async invoke(options, token) {
				const controller = new AbortController();
				const sub = token?.onCancellationRequested?.(() => controller.abort());
				try {
					const text = await spec.run(options.input, toolDeps(host), controller.signal);
					return new vscode.LanguageModelToolResult([new vscode.LanguageModelTextPart(text)]);
				} catch (err) {
					const message = err?.message || String(err);
					host.output.appendLine(`${spec.name} failed: ${message}`);
					throw new Error(`${spec.displayName} failed: ${message}`);
				} finally {
					sub?.dispose?.();
				}
			},
		}),
	);
}

/** Workspace access for the tools: everything stays inside the open folders. */
export function toolDeps(host) {
	const folders = vscode.workspace.workspaceFolders || [];
	return {
		origin: host.origin,
		hasWorkspace: folders.length > 0,
		async saveModel(glbUrl, prompt, signal) {
			const saved = await downloadModel(glbUrl, { prompt: prompt || undefined, token: tokenOf(signal) });
			await host.links.set(saved.uri, glbUrl, { prompt: prompt || null });
			return { path: vscode.workspace.asRelativePath(saved.uri, false) };
		},
		async readModel(given) {
			const uri = await workspaceModel(given);
			return { path: vscode.workspace.asRelativePath(uri, false), bytes: await vscode.workspace.fs.readFile(uri) };
		},
		async writeSibling(nextTo, stem, bytes) {
			const source = await workspaceModel(nextTo);
			const folder = vscode.Uri.joinPath(source, '..');
			const taken = await vscode.workspace.fs.readDirectory(folder).then(
				(entries) => new Set(entries.map(([name]) => name.toLowerCase())),
				() => new Set(),
			);
			const target = vscode.Uri.joinPath(folder, uniqueName(stem, '.glb', (name) => taken.has(name.toLowerCase())));
			await vscode.workspace.fs.writeFile(target, bytes);
			const url = host.links.get(source);
			if (url) host.output.appendLine(`optimized ${vscode.workspace.asRelativePath(source, false)} (hosted at ${url})`);
			return { path: vscode.workspace.asRelativePath(target, false) };
		},
	};
}

/** Resolve a path a model passed to a .glb/.gltf inside an open workspace folder. */
async function workspaceModel(given) {
	const raw = String(given || '').trim().replace(/\\/g, '/');
	if (!/\.(glb|gltf)$/i.test(raw)) throw new Error(`${raw || 'the path'} is not a .glb or .gltf file`);
	const folders = vscode.workspace.workspaceFolders || [];
	if (!folders.length) throw new Error('no folder is open in VS Code, so there is no workspace to read from');
	const segments = raw.split('/').filter((s) => s && s !== '.');
	if (segments.includes('..')) throw new Error('paths may not climb out of the workspace with ".."');
	const absolute = raw.startsWith('/') || /^[a-z]:\//i.test(raw);
	const candidates = absolute
		? folders.filter((f) => raw.toLowerCase().startsWith(f.uri.path.replace(/\/+$/, '').toLowerCase() + '/')).map((f) => vscode.Uri.joinPath(f.uri, raw.slice(f.uri.path.replace(/\/+$/, '').length)))
		: folders.flatMap((f) => [vscode.Uri.joinPath(f.uri, ...segments), segments[0] === f.name ? vscode.Uri.joinPath(f.uri, ...segments.slice(1)) : null]).filter(Boolean);
	if (!candidates.length) throw new Error(`${raw} is outside the open workspace folders`);
	for (const uri of candidates) {
		const exists = await vscode.workspace.fs.stat(uri).then(() => true, () => false);
		if (exists) return uri;
	}
	throw new Error(`${raw} does not exist in the workspace`);
}

function tokenOf(signal) {
	return {
		get isCancellationRequested() {
			return Boolean(signal?.aborted);
		},
		onCancellationRequested(fn) {
			signal?.addEventListener('abort', fn, { once: true });
			return { dispose: () => signal?.removeEventListener('abort', fn) };
		},
	};
}

// ------------------------------------------------------------------ MCP servers

function registerMcp(context, host) {
	const changed = new vscode.EventEmitter();
	const out = [changed];
	const version = String(context.extension?.packageJSON?.version || '');

	const account = async () => {
		const mode = context.globalState?.get(ACCOUNT_KEY);
		if (mode === 'oauth') return { mode: 'oauth' };
		if (mode === 'key') {
			const key = await context.secrets?.get(SECRET_KEY);
			return key ? { mode: 'key', key } : null;
		}
		return null;
	};

	if (typeof vscode.lm?.registerMcpServerDefinitionProvider === 'function') {
		out.push(
			vscode.lm.registerMcpServerDefinitionProvider(MCP_PROVIDER_ID, {
				onDidChangeMcpServerDefinitions: changed.event,
				async provideMcpServerDefinitions() {
					const specs = serverList({ origin: host.origin(), account: await account(), version });
					return specs.map((s) => new vscode.McpHttpServerDefinition(s.label, vscode.Uri.parse(s.uri), s.headers, s.version || undefined));
				},
				resolveMcpServerDefinition: (server) => server,
			}),
		);
	}

	out.push(
		vscode.commands.registerCommand('threews3d.signIn', async () => {
			const pick = await vscode.window.showQuickPick(
				[
					{ label: 'Sign in with your browser', description: 'VS Code runs the three.ws OAuth sign-in the first time a tool needs it', mode: 'oauth' },
					{ label: 'Paste an API key', description: 'An sk_live_ key from three.ws/dashboard/api, kept in VS Code secret storage', mode: 'key' },
				],
				{ title: 'Connect your three.ws account to Copilot', placeHolder: 'How should VS Code authenticate to the three.ws account MCP server?' },
			);
			if (!pick) return;
			if (pick.mode === 'key') {
				const key = await vscode.window.showInputBox({
					title: 'three.ws API key',
					prompt: 'Create one at three.ws/dashboard/api. It is checked against three.ws before it is stored.',
					password: true,
					ignoreFocusOut: true,
					placeHolder: 'sk_live_...',
				});
				if (!key) return;
				const check = await validateApiKey(host.origin(), key);
				if (!check.ok) {
					vscode.window.showErrorMessage(`three.ws 3D: ${check.message}`);
					return;
				}
				await context.secrets.store(SECRET_KEY, key.trim());
				await context.globalState.update(ACCOUNT_KEY, 'key');
				vscode.window.showInformationMessage(`three.ws 3D: ${check.message}. The "three.ws account" MCP server is now available in Copilot agent mode.`);
			} else {
				await context.secrets?.delete(SECRET_KEY);
				await context.globalState.update(ACCOUNT_KEY, 'oauth');
				vscode.window.showInformationMessage('three.ws 3D: the "three.ws account" MCP server is registered. VS Code opens the three.ws sign-in when it first connects.');
			}
			changed.fire();
		}),
		vscode.commands.registerCommand('threews3d.signOut', async () => {
			await context.secrets?.delete(SECRET_KEY);
			await context.globalState.update(ACCOUNT_KEY, undefined);
			changed.fire();
			vscode.window.showInformationMessage('three.ws 3D: signed out. Only the free three.ws Studio MCP server stays registered.');
		}),
		vscode.workspace.onDidChangeConfiguration((e) => {
			if (e.affectsConfiguration('threews3d.origin')) changed.fire();
		}),
	);
	return out;
}

function stemFromUrl(url) {
	try {
		return decodeURIComponent(new URL(url).pathname.split('/').pop() || '').replace(/\.(glb|gltf)$/i, '') || null;
	} catch {
		return null;
	}
}

function capitalize(s) {
	return s ? s[0].toUpperCase() + s.slice(1) : s;
}
