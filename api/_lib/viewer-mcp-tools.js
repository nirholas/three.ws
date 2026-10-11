// The viewer-control tools POST /api/chat/mcp serves over MCP.
//
// A call does not touch a browser: the server answers with an "action intent"
// ({ action, input, resource }) that the MCP client relays to the live three.ws
// viewer it is embedded with (the LobeHub plugin's postMessage bridge). So the
// hints describe the effect of the relayed intent on that viewer: setters change
// what the viewer shows and are safe to repeat, and only loadModel reaches
// outside three.ws, because the viewer fetches the URL it is given.
//
// Kept apart from the handler so the MCP census (api/_lib/mcp-census.js) can
// count these tools without importing the handler's auth graph.

const toggle = (what) => ({
	type: 'object',
	properties: { value: { type: 'boolean', description: `true to turn ${what} on, false to turn it off.` } },
	required: ['value'],
});

// A setter: changes what the viewer shows, reversibly, with no effect outside it.
const SETTER = Object.freeze({ readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false });
// A reader: reports on the viewer and changes nothing.
const READER = Object.freeze({ readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false });

export const VIEWER_TOOLS = Object.freeze([
	{
		name: 'setWireframe',
		title: 'Toggle wireframe',
		description:
			'Toggle wireframe rendering on the currently loaded model. Use this when the user wants to see the mesh topology or check polygon density.',
		inputSchema: toggle('wireframe rendering'),
		annotations: { title: 'Toggle wireframe', ...SETTER },
	},
	{
		name: 'setSkeleton',
		title: 'Toggle skeleton helper',
		description:
			'Toggle the skeleton helper for rigged models. Use this when the user asks whether a model is rigged or wants to see its bones.',
		inputSchema: toggle('the skeleton helper'),
		annotations: { title: 'Toggle skeleton helper', ...SETTER },
	},
	{
		name: 'setGrid',
		title: 'Toggle grid',
		description:
			'Toggle the reference grid and axes helper. Use this when the user needs a sense of scale or orientation for the model.',
		inputSchema: toggle('the grid and axes'),
		annotations: { title: 'Toggle grid', ...SETTER },
	},
	{
		name: 'setAutoRotate',
		title: 'Toggle auto-rotate',
		description:
			'Toggle camera auto-rotation around the model. Use this to show a model from every side, or to stop the motion before a screenshot.',
		inputSchema: toggle('auto-rotation'),
		annotations: { title: 'Toggle auto-rotate', ...SETTER },
	},
	{
		name: 'setBgColor',
		title: 'Set background color',
		description:
			'Set the viewer background color (CSS hex like "#001133"). Use this when the user wants a specific backdrop, for contrast or to match a brand.',
		inputSchema: {
			type: 'object',
			properties: {
				value: { type: 'string', pattern: '^#[0-9a-fA-F]{3,8}$', description: 'A CSS hex color, e.g. "#001133".' },
			},
			required: ['value'],
		},
		annotations: { title: 'Set background color', ...SETTER },
	},
	{
		name: 'setTransparentBg',
		title: 'Toggle transparent background',
		description:
			'Toggle transparent background. Use this before a screenshot that will be composited over other content.',
		inputSchema: toggle('the transparent background'),
		annotations: { title: 'Toggle transparent background', ...SETTER },
	},
	{
		name: 'setEnvironment',
		title: 'Set lighting environment',
		description:
			'Change the HDRI lighting. Known values: "None", "Neutral", "Venice Sunset", "Footprint Court (HDR Labs)". Use this when the user wants to see how materials react to different light.',
		inputSchema: {
			type: 'object',
			properties: {
				value: {
					type: 'string',
					description: 'The environment name: "None", "Neutral", "Venice Sunset" or "Footprint Court (HDR Labs)".',
				},
			},
			required: ['value'],
		},
		annotations: { title: 'Set lighting environment', ...SETTER },
	},
	{
		name: 'takeScreenshot',
		title: 'Take screenshot',
		description: 'Capture a PNG screenshot of the viewport. Use this when the user wants an image of the model as it looks now.',
		inputSchema: { type: 'object', properties: {} },
		annotations: { title: 'Take screenshot', ...READER },
	},
	{
		name: 'loadModel',
		title: 'Load model',
		description:
			'Load a glTF or GLB model by URL, replacing the model on screen. Use this when the user gives a model link or asks to view a different model.',
		inputSchema: {
			type: 'object',
			properties: { url: { type: 'string', format: 'uri', description: 'http(s) URL of a .gltf or .glb file.' } },
			required: ['url'],
		},
		annotations: { title: 'Load model', ...SETTER, openWorldHint: true },
	},
	{
		name: 'runValidation',
		title: 'Validate model',
		description:
			'Run glTF validation on the loaded model. Use this when a model renders wrong or before publishing it, to list spec errors and warnings.',
		inputSchema: { type: 'object', properties: {} },
		annotations: { title: 'Validate model', ...READER },
	},
	{
		name: 'showMaterialEditor',
		title: 'Open material editor',
		description: 'Open the material editor panel in the viewer. Use this when the user wants to adjust colors, roughness or metalness by hand.',
		inputSchema: { type: 'object', properties: {} },
		annotations: { title: 'Open material editor', ...SETTER },
	},
]);
