import {
	NodeConnectionTypes,
	NodeOperationError,
	sleep,
	type IDataObject,
	type IExecuteFunctions,
	type INodeExecutionData,
	type INodeType,
	type INodeTypeDescription,
} from 'n8n-workflow';
import {
	callMcpTool,
	ForgeFailure,
	normalizeBaseUrl,
	resolveForge,
	submitForge,
	viewerUrl,
	type HttpRequest,
	type Tier,
} from './forge';

export class ThreeWs implements INodeType {
	description: INodeTypeDescription = {
		displayName: 'three.ws',
		name: 'threeWs',
		icon: { light: 'file:threews.svg', dark: 'file:threews.dark.svg' },
		group: ['transform'],
		version: 1,
		subtitle: '={{$parameter["operation"]}}',
		description: 'Generate 3D models with three.ws Forge and call three.ws MCP studio tools',
		defaults: { name: 'three.ws' },
		inputs: [NodeConnectionTypes.Main],
		outputs: [NodeConnectionTypes.Main],
		usableAsTool: true,
		properties: [
			{
				displayName: 'Operation',
				name: 'operation',
				type: 'options',
				noDataExpression: true,
				options: [
					{
						name: 'Forge Text to 3D',
						value: 'forgeTextTo3d',
						description: 'Generate a textured GLB from a text prompt on the free Forge lane',
						action: 'Generate a 3D model from text',
					},
					{
						name: 'Call MCP Tool',
						value: 'callMcpTool',
						description: 'Call any tool on the three.ws MCP studio server',
						action: 'Call a three ws mcp tool',
					},
				],
				default: 'forgeTextTo3d',
			},
			{
				displayName: 'Prompt',
				name: 'prompt',
				type: 'string',
				typeOptions: { rows: 2 },
				default: '',
				required: true,
				placeholder: 'a small wooden chair',
				description: 'Describe one object',
				displayOptions: { show: { operation: ['forgeTextTo3d'] } },
			},
			{
				displayName: 'Quality Tier',
				name: 'tier',
				type: 'options',
				options: [
					{ name: 'Draft (Fast, Low Poly)', value: 'draft' },
					{ name: 'Standard (2K Textures)', value: 'standard' },
					{ name: 'High (Maximum Detail)', value: 'high' },
				],
				default: 'draft',
				displayOptions: { show: { operation: ['forgeTextTo3d'] } },
			},
			{
				displayName: 'Timeout (Seconds)',
				name: 'timeoutSeconds',
				type: 'number',
				typeOptions: { minValue: 30, maxValue: 900 },
				default: 300,
				description: 'How long to wait for the free lane before failing',
				displayOptions: { show: { operation: ['forgeTextTo3d'] } },
			},
			{
				displayName: 'Tool Name',
				name: 'toolName',
				type: 'string',
				default: 'search_catalog',
				required: true,
				description: 'An MCP tool exposed by three.ws, for example search_catalog, search_docs or forge_free',
				displayOptions: { show: { operation: ['callMcpTool'] } },
			},
			{
				displayName: 'Arguments (JSON)',
				name: 'toolArguments',
				type: 'json',
				default: '{}',
				description: 'Arguments object passed to the tool',
				displayOptions: { show: { operation: ['callMcpTool'] } },
			},
			{
				displayName: 'Options',
				name: 'options',
				type: 'collection',
				placeholder: 'Add Option',
				default: {},
				options: [
					{
						displayName: 'API Base URL',
						name: 'baseUrl',
						type: 'string',
						default: 'https://three.ws',
						description: 'Point the node at a self-hosted three.ws API',
					},
				],
			},
		],
	};

	async execute(this: IExecuteFunctions): Promise<INodeExecutionData[][]> {
		const items = this.getInputData();
		const out: INodeExecutionData[] = [];
		const operation = this.getNodeParameter('operation', 0) as string;
		const http: HttpRequest = async (options) =>
			this.helpers.httpRequest({
				method: options.method,
				url: options.url,
				headers: options.headers,
				body: options.body as IDataObject | undefined,
				json: options.json,
				timeout: options.timeout,
			});

		for (let i = 0; i < items.length; i++) {
			try {
				const options = this.getNodeParameter('options', i, {}) as { baseUrl?: string };
				const baseUrl = normalizeBaseUrl(options.baseUrl);

				if (operation === 'forgeTextTo3d') {
					const prompt = this.getNodeParameter('prompt', i) as string;
					const tier = this.getNodeParameter('tier', i) as Tier;
					const timeoutMs = (this.getNodeParameter('timeoutSeconds', i) as number) * 1000;
					const handle = `n8n-${this.getWorkflow().id ?? 'wf'}-${i}`;
					const submission = await submitForge(http, baseUrl, handle, prompt, tier);
					const job = await resolveForge(http, baseUrl, handle, submission, timeoutMs, sleep);
					out.push({
						json: {
							prompt,
							tier,
							glbUrl: job.glb_url,
							viewerUrl: viewerUrl(baseUrl, job.glb_url),
							backend: job.backend ?? submission.backend ?? null,
							previewImageUrl: job.preview_image_url ?? null,
						},
						pairedItem: { item: i },
					});
				} else {
					const tool = this.getNodeParameter('toolName', i) as string;
					const rawArgs = this.getNodeParameter('toolArguments', i) as string | IDataObject;
					const args = (typeof rawArgs === 'string' ? JSON.parse(rawArgs || '{}') : rawArgs) as Record<
						string,
						unknown
					>;
					const result = await callMcpTool(http, baseUrl, tool, args);
					const text = (result.content ?? [])
						.filter((c) => c.type === 'text' && c.text)
						.map((c) => c.text)
						.join('\n');
					out.push({
						json: {
							tool,
							isError: Boolean(result.isError),
							text,
							structuredContent: (result.structuredContent ?? null) as IDataObject | null,
						},
						pairedItem: { item: i },
					});
				}
			} catch (error) {
				const message = error instanceof ForgeFailure ? error.message : (error as Error).message;
				if (this.continueOnFail()) {
					out.push({ json: { error: message }, pairedItem: { item: i } });
					continue;
				}
				throw new NodeOperationError(this.getNode(), message, { itemIndex: i });
			}
		}
		return [out];
	}
}
