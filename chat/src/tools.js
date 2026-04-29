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
