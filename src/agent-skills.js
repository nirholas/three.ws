/**
 * Agent Skills
 * ------------
 * Skills are the things an agent can DO — and crucially, the things you can SEE it doing.
 * Each skill is: instruction + animation hint + voice template + handler.
 *
 * Same primitive shape as Claude's skill system (skill.md) — because agents are just JSON.
 * What makes these different: when they execute, the avatar PERFORMS them.
 *
 * MCP-exposed skills are also available as tools via /api/mcp.
 */

import { ACTION_TYPES } from './agent-protocol.js';
import { MEMORY_TYPES } from './agent-memory.js';
import { registerPumpFunSkills } from './agent-skills-pumpfun.js';

/**
 * @typedef {Object} SkillContext
 * @property {import('./agent-protocol.js').AgentProtocol} protocol
 * @property {import('./agent-memory.js').AgentMemory}     memory
 * @property {import('./agent-identity.js').AgentIdentity} identity
 * @property {Object}  [viewer]   — Viewer instance if in browser
 * @property {boolean} isBrowser
 */

/**
 * @typedef {Object} SkillResult
 * @property {boolean} success
 * @property {string}  output      — text to speak / return
 * @property {number}  [sentiment] — -1..1
 * @property {Object}  [data]      — structured result data
 */

/**
 * @typedef {Object} SkillDef
 * @property {string}   name
 * @property {string}   description
 * @property {string}   instruction     — human-readable behaviour spec
 * @property {string}   animationHint   — gesture name hint for avatar
 * @property {string}   voicePattern    — template with {{vars}}
 * @property {boolean}  mcpExposed      — available via MCP tools/call
 * @property {Object}   [inputSchema]   — JSON Schema for args
 * @property {(args: Object, ctx: SkillContext) => Promise<SkillResult>} handler
 */

export class AgentSkills {
	/**
	 * @param {import('./agent-protocol.js').AgentProtocol} protocol
	 * @param {import('./agent-memory.js').AgentMemory}     memory
	 */
	constructor(protocol, memory) {
		this.protocol = protocol;
		this.memory = memory;
		this._skills = new Map();

		this._registerBuiltins();
		registerPumpFunSkills(this);
	}

	// ── Registry ──────────────────────────────────────────────────────────────

	/** @param {SkillDef} def */
	register(def) {
		this._skills.set(def.name, def);
	}

	/** @param {string} name */
	unregister(name) {
		this._skills.delete(name);
	}

	/** @returns {SkillDef | undefined} */
	get(name) {
		return this._skills.get(name);
	}

	/** @returns {SkillDef[]} */
	list() {
		return [...this._skills.values()];
	}

	/** Returns MCP-compatible tool definitions for exposed skills */
	toMcpTools() {
		return this.list()
			.filter((s) => s.mcpExposed)
			.map((s) => ({
				name: `skill_${s.name.replace(/-/g, '_')}`,
				description: s.description,
				inputSchema: s.inputSchema || { type: 'object', properties: {} },
			}));
	}

	// ── Execution ─────────────────────────────────────────────────────────────

	/**
	 * Perform a named skill — emits to protocol, executes handler.
	 * @param {string} name
	 * @param {Object} [args]
	 * @param {Partial<SkillContext>} [ctx]
	 * @returns {Promise<SkillResult>}
	 */
	async perform(name, args = {}, ctx = {}) {
		const skill = this._skills.get(name);
		if (!skill) {
			return { success: false, output: `Unknown skill: ${name}`, sentiment: -0.3 };
		}

		const fullCtx = {
			protocol: this.protocol,
			memory: this.memory,
			identity: ctx.identity || null,
			viewer:
				ctx.viewer || (typeof window !== 'undefined' ? window.VIEWER?.app?.viewer : null),
			isBrowser: typeof window !== 'undefined',
			...ctx,
		};

		// Announce the skill is starting
		this.protocol.emit({
			type: ACTION_TYPES.PERFORM_SKILL,
			payload: { skill: name, args, animationHint: skill.animationHint },
			agentId: fullCtx.identity?.id || 'default',
			sourceSkill: name,
		});

		try {
			const result = await skill.handler(args, fullCtx);
			this.protocol.emit({
				type: ACTION_TYPES.SKILL_DONE,
				payload: { skill: name, result },
				agentId: fullCtx.identity?.id || 'default',
				sourceSkill: name,
			});

			// Auto-speak the result if it has output text
			if (result.output && fullCtx.isBrowser) {
				this.protocol.emit({
					type: ACTION_TYPES.SPEAK,
					payload: { text: result.output, sentiment: result.sentiment ?? 0 },
					agentId: fullCtx.identity?.id || 'default',
					sourceSkill: name,
				});
			}

			return result;
		} catch (err) {
			const errResult = {
				success: false,
				output: `Skill failed: ${err.message}`,
				sentiment: -0.5,
			};
			this.protocol.emit({
				type: ACTION_TYPES.SKILL_ERROR,
				payload: { skill: name, error: err.message },
				agentId: fullCtx.identity?.id || 'default',
				sourceSkill: name,
			});
			return errResult;
		}
	}

	// ── Built-in Skills ───────────────────────────────────────────────────────

	_registerBuiltins() {
		// ── greet ──────────────────────────────────────────────────────────
		this.register({
			name: 'greet',
			description: 'Greet the user and introduce the agent',
			instruction: 'Say hello warmly, offer to help with 3D models or agent configuration',
			animationHint: 'wave',
			voicePattern: "Hey! I'm {{name}}, your three.ws. Drop a model or ask me anything.",
			mcpExposed: true,
			inputSchema: { type: 'object', properties: { userName: { type: 'string' } } },
			handler: async (args, ctx) => {
				const name = ctx.identity?.name || 'Agent';
				const userName = args.userName ? `, ${args.userName}` : '';
				return {
					success: true,
					output: `Hey${userName}! I'm ${name}. Drop a 3D model in or ask me anything — I can validate, present, and remember things about your work.`,
					sentiment: 0.8,
				};
			},
		});

		// ── present-model ─────────────────────────────────────────────────
		this.register({
			name: 'present-model',
			description: 'Narrate and present the currently loaded 3D model',
			instruction:
				'Look at the model, describe its properties, gestures toward interesting features',
			animationHint: 'present',
			voicePattern: 'This model has {{vertices}} vertices, {{materials}} materials.',
			mcpExposed: true,
			inputSchema: { type: 'object', properties: {} },
			handler: async (_args, ctx) => {
				const viewer = ctx.viewer;
				if (!viewer || !viewer.content) {
					return {
						success: false,
						output: 'No model loaded yet. Drop a glTF or GLB file to get started.',
						sentiment: -0.1,
					};
				}

				let verts = 0,
					meshes = 0,
					mats = new Set();
				viewer.content.traverse((node) => {
					if (node.isMesh) {
						meshes++;
						if (node.geometry?.attributes?.position) {
							verts += node.geometry.attributes.position.count;
						}
						if (node.material) {
							const m = Array.isArray(node.material)
								? node.material
								: [node.material];
							m.forEach((mat) => mats.add(mat.name || mat.uuid));
						}
					}
				});

				const clips = viewer.clips?.length || 0;
				const bones = (viewer.content.animations || []).length;
				const output = [
					`I'm looking at your model now.`,
					`It has ${verts.toLocaleString()} vertices across ${meshes} mesh${meshes !== 1 ? 'es' : ''},`,
					`${mats.size} material${mats.size !== 1 ? 's' : ''},`,
					clips
						? `and ${clips} animation clip${clips !== 1 ? 's' : ''}.`
						: 'with no animations.',
				].join(' ');

				// Look at model
				if (ctx.isBrowser) {
					ctx.protocol.emit({
						type: ACTION_TYPES.LOOK_AT,
						payload: { target: 'model' },
						agentId: ctx.identity?.id || 'default',
					});
				}

				return {
					success: true,
					output,
					sentiment: 0.4,
					data: { vertices: verts, meshes, materials: mats.size, clips },
				};
			},
		});

		// ── validate-model ────────────────────────────────────────────────
		this.register({
			name: 'validate-model',
			description: 'Run glTF validation and report results',
			instruction: 'Trigger the validator, summarise errors and warnings with empathy',
			animationHint: 'inspect',
			voicePattern: 'Validation found {{errors}} errors and {{warnings}} warnings.',
			mcpExposed: true,
			inputSchema: {
				type: 'object',
				properties: { url: { type: 'string', description: 'Model URL to validate' } },
			},
			handler: async (_args, ctx) => {
				const viewer = ctx.viewer;
				if (!viewer || !viewer.content) {
					return {
						success: false,
						output: "Load a model first and I'll validate it.",
						sentiment: -0.1,
					};
				}

				// The validator runs automatically after load — read the last result from the DOM
				const reportEl = document.querySelector('.validator-toggle');
				if (reportEl) {
					const text = reportEl.textContent?.trim();
					const hasErrors = reportEl.classList.contains('errors');
					return {
						success: !hasErrors,
						output: text
							? `Validation result: ${text}`
							: 'Validator is still running — check the bar at the bottom of the screen.',
						sentiment: hasErrors ? -0.5 : 0.6,
					};
				}

				return {
					success: true,
					output: 'The model loaded successfully. For detailed validation, check the bottom of the screen after loading.',
					sentiment: 0.3,
				};
			},
		});

		// ── remember ─────────────────────────────────────────────────────
		this.register({
			name: 'remember',
			description: 'Store a memory about the user, session, or project',
			instruction: 'Save important information for future conversations',
			animationHint: 'nod',
			voicePattern: "Got it. I'll remember that.",
			mcpExposed: true,
			inputSchema: {
				type: 'object',
				required: ['content'],
				properties: {
					content: { type: 'string', description: 'What to remember' },
					type: { type: 'string', enum: ['user', 'feedback', 'project', 'reference'] },
					tags: { type: 'array', items: { type: 'string' } },
				},
			},
			handler: async (args, ctx) => {
				if (!args.content) {
					return { success: false, output: 'What should I remember?', sentiment: 0 };
				}

				const id = ctx.memory?.add({
					type: args.type || MEMORY_TYPES.PROJECT,
					content: args.content,
					tags: args.tags || [],
				});

				if (ctx.isBrowser) {
					ctx.protocol.emit({
						type: ACTION_TYPES.REMEMBER,
						payload: { content: args.content, memoryId: id },
						agentId: ctx.identity?.id || 'default',
					});
				}

				return {
					success: true,
					output: `Got it — I'll remember that.`,
					sentiment: 0.5,
					data: { memoryId: id },
				};
			},
		});

		// ── think ─────────────────────────────────────────────────────────
		this.register({
			name: 'think',
			description: 'Retrieve relevant memories and reason about a question',
			instruction: 'Search memory, synthesise context, respond thoughtfully',
			animationHint: 'think',
			voicePattern: 'Let me think about that...',
			mcpExposed: false,
			inputSchema: {
				type: 'object',
				required: ['query'],
				properties: { query: { type: 'string' } },
			},
			handler: async (args, ctx) => {
				const query = args.query || '';
				const memories = ctx.memory?.query({ limit: 5 }) || [];

				if (!memories.length) {
					return {
						success: true,
						output: `I don't have any stored context yet. As we work together, I'll build up memory to give you better answers.`,
						sentiment: 0.1,
					};
				}

				const context = memories.map((m) => `- ${m.content}`).join('\n');
				return {
					success: true,
					output: `Based on what I remember: ${memories[0].content}`,
					sentiment: 0.3,
					data: { memories, context },
				};
			},
		});

		// ── sign-action ───────────────────────────────────────────────────
		this.register({
			name: 'sign-action',
			description: "Sign the most recent action with the agent's linked wallet",
			instruction: 'Use ERC-191 personal_sign to create a verifiable proof of the action',
			animationHint: 'sign',
			voicePattern: 'Signing action {{actionId}} with my wallet.',
			mcpExposed: true,
			inputSchema: {
				type: 'object',
				properties: { actionId: { type: 'string' } },
			},
			handler: async (args, ctx) => {
				if (!ctx.identity?.walletAddress) {
					return {
						success: false,
						output: 'No wallet linked. Connect a wallet first to sign actions.',
						sentiment: -0.2,
					};
				}

				if (!ctx.isBrowser || !window.ethereum) {
					return {
						success: false,
						output: 'No web3 wallet detected. Install MetaMask or a compatible wallet.',
						sentiment: -0.2,
					};
				}

				try {
					const { ethers } = await import('ethers');
					const provider = new ethers.BrowserProvider(window.ethereum);
					const signer = await provider.getSigner();
					const message = `Agent action: ${args.actionId || 'latest'} at ${Date.now()}`;
					const sig = await signer.signMessage(message);

					ctx.protocol.emit({
						type: ACTION_TYPES.SIGN,
						payload: { message, signature: sig, actionId: args.actionId },
						agentId: ctx.identity?.id || 'default',
					});

					return {
						success: true,
						output: `Action signed. Signature: ${sig.slice(0, 20)}…`,
						sentiment: 0.6,
						data: { signature: sig, message },
					};
				} catch (err) {
					return {
						success: false,
						output: `Signing failed: ${err.message}`,
						sentiment: -0.4,
					};
				}
			},
		});

		// ── help ──────────────────────────────────────────────────────────
		this.register({
			name: 'help',
			description: 'List available skills and controls',
			instruction: 'Summarise what the agent can do',
			animationHint: 'gesture',
			voicePattern: "Here's what I can do.",
			mcpExposed: false,
			handler: async (_args, _ctx) => {
				return {
					success: true,
					output: "I can present and validate 3D models, remember things about your work, sign actions with a wallet, and answer questions. Try dropping a GLB file in, or ask me to present what's loaded.",
					sentiment: 0.5,
				};
			},
		});
	}
}
