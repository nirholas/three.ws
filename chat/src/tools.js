export const defaultToolSchema = [
	{
		name: 'Client-side',
		schema: [
			{
				clientDefinition: {
					id: '95c15b96-7bba-44e7-98a7-ffe268b884c5',
					name: 'Artifact',
					description: 'Displays the provided HTML content as a webpage to the user.',
					arguments: [
						{
							name: 'htmlContent',
							type: 'string',
							description: 'The HTML content to be displayed as a webpage',
						},
					],
					body: "return { contentType: 'text/html' };",
				},
				type: 'function',
				function: {
					name: 'Artifact',
					description: 'Displays the provided HTML content as a webpage to the user.',
					parameters: {
						type: 'object',
						properties: {
							htmlContent: {
								type: 'string',
								description: 'The HTML content to be displayed as a webpage',
							},
						},
						required: ['htmlContent'],
					},
				},
			},
			{
				clientDefinition: {
					id: '1407c581-fab6-4dd5-995a-d53ba05ec6e8',
					name: 'JavaScript',
					description: 'Evaluates JavaScript code and returns the result, including console output',
					arguments: [
						{
							name: 'code',
							type: 'string',
							description:
								'The JavaScript code to be evaluated. To return a value, you must use the return statement.',
						},
					],
					body: "let consoleOutput = [];\nconst originalConsoleLog = console.log;\nconsole.log = (...args) => {\n  consoleOutput.push(args.map(arg => JSON.stringify(arg)).join(' '));\n  originalConsoleLog.apply(console, args);\n};\n\ntry {\n  let result = eval(`(() => { ${args.code} })()`);\n  return JSON.stringify({\n    result: result,\n    consoleOutput: consoleOutput\n  }, null, 2);\n} catch (error) {\n  return JSON.stringify({\n    error: error.message,\n    consoleOutput: consoleOutput\n  }, null, 2);\n} finally {\n  console.log = originalConsoleLog;\n}",
				},
				type: 'function',
				function: {
					name: 'JavaScript',
					description: 'Evaluates JavaScript code and returns the result, including console output',
					parameters: {
						type: 'object',
						properties: {
							code: {
								type: 'string',
								description:
									'The JavaScript code to be evaluated. To return a value, you must use the return statement.',
							},
						},
						required: ['code'],
					},
				},
			},
			{
				clientDefinition: {
					id: '5b9b21b8-c8f2-40df-aea7-9634dec55b6b',
					name: 'Choice',
					description:
						'Prompts the user to select one of the given options. Use this when you need the user to choose between different options.',
					arguments: [
						{
							name: 'choices',
							type: 'string_array',
							description: 'The options the user can choose from.',
						},
						{
							name: 'question',
							type: 'string',
							description: 'What you are asking the user.',
						},
					],
					body: 'return await choose(args.question, args.choices);',
				},
				type: 'function',
				function: {
					name: 'Choice',
					description:
						'Prompts the user to select one of the given options. Use this when you need the user to choose between different options.',
					parameters: {
						type: 'object',
						properties: {
							choices: {
								type: 'array',
								items: {
									type: 'string',
								},
								description: 'The options the user can choose from.',
							},
							question: {
								type: 'string',
								description: 'What you are asking the user.',
							},
						},
						required: ['choices', 'question'],
					},
				},
			},
		],
	},
];

export const agentToolSchema = {
	name: '3D Agent',
	schema: [
		{
			clientDefinition: {
				id: 'agent-wave-a1b2c3',
				name: 'agent_wave',
				description: 'Makes the 3D avatar wave at the user.',
				arguments: [],
				body: 'if (window.__threewsAgent) window.__threewsAgent.wave(); return "waved";',
			},
			type: 'function',
			function: {
				name: 'agent_wave',
				description: 'Wave the 3D avatar at the user. Use to greet or celebrate.',
				parameters: { type: 'object', properties: {} },
			},
		},
		{
			clientDefinition: {
				id: 'agent-express-d4e5f6',
				name: 'agent_express',
				description: 'Express an emotion on the 3D avatar.',
				arguments: [
					{ name: 'trigger', type: 'string', description: 'celebration | concern | curiosity | empathy | patience' },
				],
				body: 'if (window.__threewsAgent) window.__threewsAgent.expressEmotion(args.trigger); return "expressed: " + args.trigger;',
			},
			type: 'function',
			function: {
				name: 'agent_express',
				description: 'Make the 3D avatar express an emotion. Use to show enthusiasm, empathy, or concern.',
				parameters: {
					type: 'object',
					properties: {
						trigger: {
							type: 'string',
							enum: ['celebration', 'concern', 'curiosity', 'empathy', 'patience'],
							description: 'The emotion to express.',
						},
					},
					required: ['trigger'],
				},
			},
		},
		{
			clientDefinition: {
				id: 'agent-speak-g7h8i9',
				name: 'agent_speak',
				description: 'Trigger the avatar talking animation for a given text.',
				arguments: [{ name: 'text', type: 'string', description: 'Text to animate talking for' }],
				body: 'if (window.__threewsAgent) window.__threewsAgent.speak(args.text); return "speaking";',
			},
			type: 'function',
			function: {
				name: 'agent_speak',
				description: 'Trigger the 3D avatar talking animation. Useful for emphasis on a key statement.',
				parameters: {
					type: 'object',
					properties: {
						text: { type: 'string', description: 'The text being spoken (used to calculate animation duration).' },
					},
					required: ['text'],
				},
			},
		},
	],
};
