// Built-in scene-tools — available to every agent without any skill installed.
// See specs/AGENT_MANIFEST.md § Built-in tools.

export const BUILTIN_TOOLS = [
	{
		name: 'wave',
		description: 'Wave at the user. Use for greetings, farewells, or acknowledgments.',
		input_schema: {
			type: 'object',
			properties: {
				duration_ms: { type: 'integer', minimum: 500, maximum: 5000, default: 1500 },
			},
		},
	},
	{
		name: 'lookAt',
		description: 'Direct the agent\'s gaze toward a target.',
		input_schema: {
			type: 'object',
			properties: {
				target: {
					type: 'string',
					enum: ['user', 'camera', 'center'],
					description: 'Where to look',
				},
			},
			required: ['target'],
		},
	},
	{
		name: 'play_clip',
		description: 'Play a named animation clip from the loaded body.',
		input_schema: {
			type: 'object',
			properties: {
				name: { type: 'string' },
				loop: { type: 'boolean', default: false },
				fade_ms: { type: 'integer', default: 200 },
			},
			required: ['name'],
		},
	},
	{
		name: 'setExpression',
		description: 'Set facial expression via morph target preset.',
		input_schema: {
			type: 'object',
			properties: {
				preset: { type: 'string', enum: ['neutral', 'happy', 'sad', 'surprised', 'confused', 'focused'] },
				intensity: { type: 'number', minimum: 0, maximum: 1, default: 1 },
			},
			required: ['preset'],
		},
	},
	{
		name: 'speak',
		description: 'Say something out loud via TTS. Use this instead of plain text when voice is on.',
		input_schema: {
			type: 'object',
			properties: { text: { type: 'string' } },
			required: ['text'],
		},
	},
	{
		name: 'remember',
		description: 'Save a durable memory about the user, a feedback rule, a project fact, or a reference.',
		input_schema: {
			type: 'object',
			properties: {
				key: { type: 'string', description: 'short snake_case filename, e.g. "user_role"' },
				name: { type: 'string' },
				description: { type: 'string' },
				type: { type: 'string', enum: ['user', 'feedback', 'project', 'reference'] },
				body: { type: 'string' },
			},
			required: ['key', 'name', 'description', 'type', 'body'],
		},
	},
];

// Stage-scoped tools — appended to an agent's tool list only when Runtime is
// attached to an <agent-stage>. See specs/STAGE_SPEC.md.
export const STAGE_TOOLS = [
	{
		name: 'observe_agents',
		description: 'List the other agents currently sharing this stage, with their names and positions.',
		input_schema: { type: 'object', properties: {} },
	},
	{
		name: 'say_to_agent',
		description:
			'Send a message to another agent on the same stage. The target agent will receive it as a user turn and reply in their own chat chrome.',
		input_schema: {
			type: 'object',
			properties: {
				agentId: { type: 'string', description: 'Target agent id as returned by observe_agents.' },
				text: { type: 'string' },
			},
			required: ['agentId', 'text'],
		},
	},
];

export const BUILTIN_HANDLERS = {
	async wave(args, ctx) {
		const dur = args.duration_ms || 1500;
		await ctx.viewer.playAnimationByHint?.('wave', { duration: dur });
		ctx.memory.note('waved', { duration_ms: dur });
		return { ok: true };
	},

	async lookAt(args, ctx) {
		const target = args.target || 'user';
		ctx.viewer.lookAt?.(target);
		return { ok: true, target };
	},

	async play_clip(args, ctx) {
		const { name, loop = false, fade_ms = 200 } = args;
		const played = ctx.viewer.playClipByName?.(name, { loop, fade_ms });
		if (!played) return { ok: false, error: `No clip named "${name}"` };
		return { ok: true, name };
	},

	async setExpression(args, ctx) {
		const { preset, intensity = 1 } = args;
		ctx.viewer.setExpression?.(preset, intensity);
		return { ok: true, preset };
	},

	async speak(args, ctx) {
		await ctx.speak(args.text);
		return { ok: true };
	},

	async remember(args, ctx) {
		const { key, name, description, type, body } = args;
		ctx.memory.write(key, { name, description, type, body });
		return { ok: true, saved: key };
	},

	async observe_agents(args, ctx) {
		if (!ctx.stage) return { ok: false, error: 'not on a stage' };
		const others = ctx.stage
			.getAgents()
			.filter((a) => a.agentId !== ctx.agentId)
			.map(({ agentId, name, position }) => ({ agentId, name, position }));
		return { ok: true, agents: others };
	},

	async say_to_agent(args, ctx) {
		if (!ctx.stage) return { ok: false, error: 'not on a stage' };
		const { agentId, text } = args;
		if (!agentId || !text) return { ok: false, error: 'agentId and text required' };
		const from = ctx.agentId || 'anon';
		ctx.stage.broadcast(from, { kind: 'direct', to: agentId, text });
		return ctx.stage.routeMessage(from, agentId, text);
	},
};
