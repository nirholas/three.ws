#!/usr/bin/env node
// Emit every free-text field the OpenAI Plugin Directory submission form takes,
// and refuse to emit one that the portal would silently truncate.
//
//   node scripts/build-openai-portal-fields.mjs           # paste-ready output
//   node scripts/build-openai-portal-fields.mjs --check   # lengths only, exit 1 on overflow
//
// Why this exists. Version 1.0.0 was rejected twice. The second rejection is
// explained by the submission JSON the portal returned: every justification was
// cut at exactly 200 characters and every test-case expectation at 300, mid-word.
// The reviewer was asked to confirm our annotations do not misrepresent the
// tools, and was shown fragments ending "and the compute" and "the same o".
// The form gives no character counter and no warning, so the only defence is to
// measure before pasting. That is this file's whole job.
//
// Every justification is still derived from the annotation constants in
// api/_mcp-studio/tools.js and api/_mcp-studio/persona-tools.js. Shortening the
// prose must never soften the claim: if an annotation changes, change it there
// first, then re-derive here.

const LIMITS = { justification: 200, frame: 200, negative: 200, expected: 300, subtitle: 30 };

// The six generation tools carry identical annotations, so they share one set.
const GENERATION = {
	read_only: 'Runs a 3D generation and writes a new GLB file into our object storage, then returns that file\'s URL.',
	open_world: 'Publishes the generated GLB at a public URL anyone with the link can fetch, and relies on third-party inference providers to produce it.',
	destructive: 'Only adds a new file and never overwrites or deletes an existing one, so a model supplied as input is left unchanged.',
};

const JUSTIFICATIONS = {
	forge_free: GENERATION,
	text_to_avatar: GENERATION,
	mesh_forge: GENERATION,
	rig_mesh: GENERATION,
	forge_avatar: GENERATION,
	refine_model: GENERATION,
	check_job: {
		read_only: 'The first check that finds a job finished copies the model into our storage and records the creation, so the call writes rather than only reads.',
		open_world: 'Collects work from third-party inference providers and publishes the finished GLB at a public URL anyone with the link can fetch.',
		destructive: 'Only adds the finished model and never deletes or overwrites an earlier one.',
	},
	look_at_model: {
		read_only: 'Renders a model that already exists from several angles and returns the frames as images, storing nothing and changing nothing.',
		open_world: 'Fetches an arbitrary public GLB URL, so it reaches third-party hosts outside our own domain.',
		destructive: 'Only reads the supplied model in order to render it, and never modifies or deletes the source file.',
	},
	create_agent_persona: {
		read_only: 'Saves a new persona record and copies the model into our durable storage so the body outlives the source URL.',
		open_world: 'Fetches the GLB from a public URL outside our domain and republishes it from our storage at a public URL anyone with the link can fetch.',
		destructive: 'Only creates a new persona and never modifies or deletes an existing persona or model.',
	},
	get_agent_persona: {
		read_only: 'Looks up a stored persona by its id and returns that persona\'s configuration without creating or changing anything.',
		open_world: 'Reads only persona records held in our own private store and contacts no external system.',
		destructive: 'Only reads a persona record and never writes or removes anything.',
	},
	persona_say: {
		read_only: 'Increments the persona\'s turn counter in our own store while returning the render directive for this turn.',
		open_world: 'Acts only on a persona in our own private store and renders through our own embed, reaching no external system.',
		destructive: 'Only appends a turn and updates a counter, never deleting or overwriting the persona\'s configuration or model.',
	},
};

const FRAME_DOMAINS =
	'The persona tools render a live WebGL avatar that lip-syncs its reply. It is framed from https://three.ws, our verified domain and the same origin as this connector. No third-party content is framed.';

const TEST_CASES = [
	{
		scenario: 'Generate a 3D prop from a text description',
		prompt: 'Make a 3D model of a friendly round robot mascot, glossy white plastic.',
		tools: 'forge_free, then check_job if the first response returns status "pending"',
		expected:
			'An inline interactive 3D viewer with the textured model, plus Download, Spin, Recenter and Open in three.ws. It auto-rotates until dragged. Free, no account. Takes one to four minutes; past the inline wait it returns a job_id and check_job collects the finished model.',
	},
	{
		scenario: 'Generate a rigged, animation-ready character',
		prompt: 'Make a rigged, animation-ready knight character I can pose.',
		tools: 'forge_avatar, then check_job if it returns status "pending", then rig_mesh if the finished job was only the mesh',
		expected:
			'A GLB in the inline viewer with a humanoid skeleton and skin weights applied, so it can be posed. One call normally does mesh and rig; if it times out at the mesh stage the pending result says to finish with rig_mesh. A humanoid rig also plays an idle clip.',
	},
	{
		scenario: 'Iterate on a model by describing the change in words',
		prompt: "Now make that robot's shell matte instead of glossy.",
		tools: 'refine_model, then check_job if it returns status "pending"',
		expected:
			'Run immediately after test case 1, in the same conversation. Returns a new version anchored to the previous model rather than an unrelated regeneration, and replaces the GLB in the viewer. The earlier version stays reachable, so the change can be reverted.',
	},
	{
		scenario: 'Let the assistant see a 3D model and report on it',
		prompt:
			'Look at this 3D model and tell me what it is and whether it has any obvious defects: https://three.ws/cdn/objects/polyhaven/glb/ArmChair_01.glb',
		tools: 'look_at_model',
		expected:
			'Frames from several angles returned as MCP image content blocks, which the client renders into the conversation, plus geometry stats. The assistant describes the armchair from images it can actually see. Free, seconds not minutes. The URL is ours and needs no credentials.',
	},
	{
		scenario: 'Turn a generated model into a persistent agent body that speaks',
		prompt: 'Save that knight as a persistent agent body called Sir Gareth, then have him introduce himself.',
		tools: 'create_agent_persona, then persona_say',
		expected:
			'Run after test case 2, in the same conversation. An inline living-body widget framed from https://three.ws, in which the avatar lip-syncs the line with a matching expression and gesture. Returns a persona_id that get_agent_persona reloads in a fresh session.',
	},
];

const NEGATIVE_CASES = [
	{
		scenario:
			'The user wants a 2D image, not a 3D model. The wording nearly matches our main generation prompt, but this plugin only returns 3D GLB files, so image generation should handle it.',
		prompt: "Draw a cartoon robot mascot for my startup's landing page.",
		expected: 'The app should not be invoked, because it only produces 3D GLB models and the user asked for a 2D image.',
	},
	{
		scenario:
			'"Model" is a verb here, meaning a financial projection. Nothing 3D is involved, and no tool in this plugin operates on spreadsheets or forecasts.',
		prompt: 'Model out our Q3 revenue if we raise prices 20%.',
		expected: 'The app should not be invoked, because no tool here operates on spreadsheets, forecasts or financial data.',
	},
	{
		scenario:
			'The user asks how to do something in other software, not for work on a file. It says "rig" and "character", but rig_mesh needs the URL of an existing GLB and would return nothing they asked for.',
		prompt: 'How do I rig a humanoid character in Blender?',
		expected: 'The app should not be invoked, because the user wants an explanation of other software rather than work on a file.',
	},
];

const ANNOTATION_LABEL = { read_only: 'Read Only', open_world: 'Open World', destructive: 'Destructive' };

const violations = [];
function measure(label, text, limit) {
	// The portal counts characters, and a cut lands mid-word with no warning.
	if (text.length > limit) violations.push(`${label}: ${text.length} chars, over the ${limit} limit by ${text.length - limit}`);
	return text.length;
}

/**
 * The submission skill asks for one sentence per justification, and rejects a
 * justification that restates the annotation instead of describing behavior.
 */
function oneSentence(label, text) {
	const sentences = text.split(/\.\s+/).filter(Boolean).length;
	if (sentences > 1) violations.push(`${label}: ${sentences} sentences, the skill asks for one`);
	if (/^(readOnlyHint|openWorldHint|destructiveHint)\b/i.test(text) || /\bbecause the tool is\b/i.test(text)) {
		violations.push(`${label}: restates the annotation instead of describing the behavior`);
	}
}

for (const [tool, set] of Object.entries(JUSTIFICATIONS)) {
	for (const [kind, text] of Object.entries(set)) {
		measure(`${tool}.${kind}`, text, LIMITS.justification);
		oneSentence(`${tool}.${kind}`, text);
	}
}
measure('frame_domains', FRAME_DOMAINS, LIMITS.frame);
TEST_CASES.forEach((t, i) => measure(`test case ${i + 1} expected output`, t.expected, LIMITS.expected));
NEGATIVE_CASES.forEach((n, i) => measure(`negative case ${i + 1} scenario`, n.scenario, LIMITS.negative));

if (violations.length) {
	console.error('These fields would be silently truncated by the portal:\n');
	for (const v of violations) console.error(`  ${v}`);
	console.error('\nShorten them. A justification cut mid-word reads as no justification at all.');
	process.exit(1);
}

if (process.argv.includes('--check')) {
	const n = Object.values(JUSTIFICATIONS).reduce((a, s) => a + Object.keys(s).length, 0);
	console.log(`every portal field fits: ${n} justifications, 1 frame-domains explanation, ${TEST_CASES.length} test cases, ${NEGATIVE_CASES.length} negative cases.`);
	process.exit(0);
}

const bar = (n, limit) => `${String(n).padStart(3)}/${limit}`;

if (!process.argv.includes('--json')) {
	console.log('# OpenAI Plugin Directory: every field, paste-ready\n');
	console.log('Each block is under the portal\'s silent limit. Do not edit them longer without re-running this script.\n');
	console.log('## MCP tab: tool justifications\n');
	for (const [tool, set] of Object.entries(JUSTIFICATIONS)) {
		console.log(`### ${tool}\n`);
		for (const kind of ['read_only', 'open_world', 'destructive']) {
			console.log(`**${ANNOTATION_LABEL[kind]}**  (${bar(set[kind].length, LIMITS.justification)})`);
			console.log('```');
			console.log(set[kind]);
			console.log('```\n');
		}
	}
	console.log(`## MCP tab: Frame Domains  (${bar(FRAME_DOMAINS.length, LIMITS.frame)})\n`);
	console.log('```');
	console.log(FRAME_DOMAINS);
	console.log('```\n');

	console.log('## Testing tab: test cases\n');
	TEST_CASES.forEach((t, i) => {
		console.log(`### Test Case ${i + 1}\n`);
		console.log(`**Scenario**\n\`\`\`\n${t.scenario}\n\`\`\`\n`);
		console.log(`**User prompt**\n\`\`\`\n${t.prompt}\n\`\`\`\n`);
		console.log(`**Tool triggered**\n\`\`\`\n${t.tools}\n\`\`\`\n`);
		console.log(`**Expected output**  (${bar(t.expected.length, LIMITS.expected)})\n\`\`\`\n${t.expected}\n\`\`\`\n`);
	});

	console.log('## Testing tab: negative cases\n');
	NEGATIVE_CASES.forEach((n, i) => {
		console.log(`### Negative Test Case ${i + 1}\n`);
		console.log(`**Scenario**  (${bar(n.scenario.length, LIMITS.negative)})\n\`\`\`\n${n.scenario}\n\`\`\`\n`);
		console.log(`**User prompt**\n\`\`\`\n${n.prompt}\n\`\`\`\n`);
	});
}

// The upload the portal's Info, MCP and Testing tabs read, per the openai/plugins
// chatgpt-app-submission skill. Writing it is strictly better than typing the
// same values into form boxes that truncate without saying so.
const APP_INFO = {
	// Matches the GPT Store listing and the package, which is the inconsistency
	// the earlier submissions carried: the portal header said "3D AI Studio"
	// while the stored display_name said this.
	display_name: 'three.ws 3D Studio',
	subtitle: 'Create 3D models from text',
	description:
		'Describe any object or character and three.ws 3D Studio builds a real, textured 3D model, then shows it in an interactive viewer inside the conversation. Eleven tools cover the path from idea to asset: generate a model from text or a reference image, generate an avatar, auto-rig a static model so it can be animated, refine a model by describing a change, and inspect a finished model from several angles. Every result downloads as a standard GLB that opens in Blender, Unity, Unreal, three.js, or any glTF pipeline. No account, no API key, no payment.',
	// The skill's enum has no "creativity", so the closest true member is used.
	category: 'DESIGN',
};

measure('app_info.subtitle', APP_INFO.subtitle, LIMITS.subtitle);

if (process.argv.includes('--json')) {
	const { writeFileSync } = await import('node:fs');
	const CONNECTOR = process.env.OPENAI_CONNECTOR_URL || 'https://three.ws/api/mcp-studio';

	// Read the annotations off the running connector rather than restating them
	// here. A justification is only true of the annotation actually served, and
	// the whole point of this field is that the two agree.
	const res = await fetch(CONNECTOR, {
		method: 'POST',
		headers: {
			'content-type': 'application/json',
			accept: 'application/json, text/event-stream',
			'mcp-protocol-version': '2025-06-18',
		},
		body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list', params: {} }),
		signal: AbortSignal.timeout(30_000),
	});
	if (!res.ok) throw new Error(`${CONNECTOR} answered ${res.status}`);
	const served = JSON.parse((await res.text()).trim().split('\n').filter(Boolean).pop().replace(/^data:\s*/, '')).result.tools;

	// The reviewer scans the DEPLOYED server, so the JSON has to describe that.
	// But a local source fix that has not shipped yet would make this file
	// disagree with their scan, which is the same misrepresentation the
	// justifications exist to prevent. Refuse to generate until they match.
	// TOOL_CATALOG / PERSONA_TOOL_CATALOG are the served descriptor arrays; the
	// TOOLS maps beside them are name-keyed handler tables, not descriptors.
	const { TOOL_CATALOG } = await import('../api/_mcp-studio/tools.js');
	const { PERSONA_TOOL_CATALOG } = await import('../api/_mcp-studio/persona-tools.js');
	const local = new Map(
		[...TOOL_CATALOG, ...PERSONA_TOOL_CATALOG].map((t) => [t.name, t.annotations || {}]),
	);
	if (local.size !== served.length) {
		console.error(`this checkout declares ${local.size} tool descriptors but ${CONNECTOR} serves ${served.length}`);
		process.exit(1);
	}
	const drift = [];
	for (const tool of served) {
		const mine = local.get(tool.name);
		if (!mine) continue;
		for (const hint of ['readOnlyHint', 'openWorldHint', 'destructiveHint', 'idempotentHint']) {
			if (mine[hint] !== (tool.annotations || {})[hint]) {
				drift.push(`${tool.name}.${hint}: this checkout says ${mine[hint]}, ${CONNECTOR} serves ${(tool.annotations || {})[hint]}`);
			}
		}
	}
	// --pending-deploy: describe the annotations THIS CHECKOUT declares, for the
	// window where the fix is built and deploying but production still serves the
	// old values. The file is correct the moment that deploy lands, which is why
	// the warning below says to hold the Submit click rather than the upload.
	const pendingDeploy = process.argv.includes('--pending-deploy');
	if (drift.length && !pendingDeploy) {
		console.error('This checkout and the deployed connector disagree about tool annotations:\n');
		for (const d of drift) console.error(`  ${d}`);
		console.error('\nThe reviewer scans the deployed server, so deploy this checkout before generating');
		console.error('the submission JSON. Shipping it now would hand them a file that contradicts their own scan.');
		console.error('If that deploy is in flight right now, pass --pending-deploy to describe this checkout instead.');
		process.exit(1);
	}

	const problems = [];
	const tools = {};
	for (const tool of served) {
		const set = JUSTIFICATIONS[tool.name];
		if (!set) {
			problems.push(`${tool.name} is served but has no justifications here`);
			continue;
		}
		// Source wins only while a deploy is in flight; otherwise the served
		// annotations are the truth the reviewer will scan.
		const a = (pendingDeploy ? local.get(tool.name) : tool.annotations) || {};
		for (const hint of ['readOnlyHint', 'openWorldHint', 'destructiveHint']) {
			if (typeof a[hint] !== 'boolean') problems.push(`${tool.name}.${hint} is not set explicitly, which is a submission blocker`);
		}
		tools[tool.name] = {
			annotations: {
				readOnlyHint: a.readOnlyHint,
				openWorldHint: a.openWorldHint,
				destructiveHint: a.destructiveHint,
			},
			justifications: {
				read_only_justification: set.read_only,
				open_world_justification: set.open_world,
				destructive_justification: set.destructive,
			},
		};
		if (!tool.outputSchema) problems.push(`${tool.name} declares no outputSchema (a warning, not a blocker)`);
	}
	for (const name of Object.keys(JUSTIFICATIONS)) {
		if (!served.some((t) => t.name === name)) problems.push(`${name} has justifications here but is not served`);
	}

	const doc = {
		$schema: 'https://developers.openai.com/apps-sdk/schemas/chatgpt-app-submission.v1.json',
		schema_version: 1,
		app_info: APP_INFO,
		tools,
		test_cases: TEST_CASES.map((t) => ({
			description: t.scenario,
			user_prompt: t.prompt,
			file_attachment_urls: null,
			tools_triggered: t.tools,
			expected_output: t.expected,
			expected_output_url: null,
		})),
		negative_test_cases: NEGATIVE_CASES.map((n) => ({
			description: n.scenario,
			user_prompt: n.prompt,
			file_attachment_urls: null,
			tools_triggered: null,
			expected_output: n.expected,
			expected_output_url: null,
		})),
	};

	// Canonical copy sits with the rest of the submission package so the record
	// survives the session; the root copy exists only because the portal's upload
	// box takes a file the owner has to reach for in the editor.
	const serialized = JSON.stringify(doc, null, 2) + '\n';
	const canonical = 'prompts/store-submissions/_generated/chatgpt-app-submission.json';
	writeFileSync(canonical, serialized);
	writeFileSync('chatgpt-app-submission.json', serialized);
	console.log(`wrote ${canonical}`);
	if (pendingDeploy && drift.length) {
		console.log('\n  NOTE: generated from THIS CHECKOUT, not the deployed server, which still serves:');
		for (const d of drift) console.log(`    ${d}`);
		console.log('  Upload the file now if you like, but do not hit Submit until that deploy is live,');
		console.log('  or the reviewer\'s scan and this file will disagree.');
	}
	console.log(`  and ./chatgpt-app-submission.json to upload: ${Object.keys(tools).length} tools, ${doc.test_cases.length} test cases, ${doc.negative_test_cases.length} negative cases.`);
	if (problems.length) {
		console.log('\nReview findings:');
		for (const p of problems) console.log(`  ${p}`);
	}
	process.exit(0);
}
