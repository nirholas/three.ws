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
	read_only: 'False because the call writes. Each invocation runs a generation and stores a new GLB in our object storage, then returns its URL. That stored file is a real side effect of the call.',
	open_world: 'True because generation runs on third-party inference providers, not a dataset we own. The same prompt can legitimately return a different mesh, so the result is not a closed, predictable domain.',
	destructive: 'False because the tool only adds. It writes a new GLB and never modifies or deletes anything. Given an existing model it reads the source and emits a separate file, leaving the original intact.',
};

const JUSTIFICATIONS = {
	forge_free: GENERATION,
	text_to_avatar: GENERATION,
	mesh_forge: GENERATION,
	rig_mesh: GENERATION,
	forge_avatar: GENERATION,
	refine_model: GENERATION,
	check_job: {
		read_only: 'True because it only looks up an existing job by its id and reports that job\'s state. It creates nothing and changes nothing.',
		open_world: 'True because the job it reports on is running on external inference providers, so the status reflects third-party systems outside our control rather than a closed internal dataset.',
		destructive: 'False because it reads job state only. Nothing is written, modified or removed by the call.',
	},
	look_at_model: {
		read_only: 'True because it renders views of a model that already exists and returns those frames as images. It stores no new asset and modifies nothing.',
		open_world: 'True because it accepts any public GLB URL, so it fetches from hosts outside our own domain and its result depends entirely on that external resource.',
		destructive: 'False because it only reads the supplied model in order to render it. The source file is never modified or deleted.',
	},
	create_agent_persona: {
		read_only: 'False because it saves a new persona record and copies the model into durable storage so the body outlives the source URL. That stored record is a real side effect.',
		open_world: 'True because creating the persona calls external model and speech providers, and it accepts a model URL that may be hosted outside our own domain.',
		destructive: 'False because it only creates. Existing personas and existing models are never modified or deleted.',
	},
	get_agent_persona: {
		read_only: 'True because it is a pure lookup. It reads an existing persona by its id and returns that persona\'s configuration. Nothing is created or changed.',
		open_world: 'False because it reads only persona records we store ourselves. No external provider is contacted, and the result is fully determined by data we already hold.',
		destructive: 'False because it is a read-only lookup. Nothing is written or removed.',
	},
	persona_say: {
		read_only: 'False because it increments the persona\'s turn counter, which is a write to our stored state, alongside returning the render directive for this turn.',
		open_world: 'False because it acts only on a persona we already store and renders through our own embed. It does not reach outside our own systems.',
		destructive: 'False because it appends a turn and updates a counter. It never deletes or overwrites the persona\'s configuration or its model.',
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
		tools: 'forge_avatar, then check_job if the first response returns status "pending"',
		expected:
			'A rigged GLB in the same inline viewer, with a humanoid skeleton and skin weights already applied, so an idle animation plays rather than the model standing in a bind pose. One call performs both the mesh generation and the rig.',
	},
	{
		scenario: 'Iterate on a model by describing the change in words',
		prompt: "Now make that robot's shell matte instead of glossy.",
		tools: 'refine_model',
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
	},
	{
		scenario:
			'"Model" is a verb here, meaning a financial projection. Nothing 3D is involved, and no tool in this plugin operates on spreadsheets or forecasts.',
		prompt: 'Model out our Q3 revenue if we raise prices 20%.',
	},
	{
		scenario:
			'The user asks how to do something in other software, not for work on a file. It says "rig" and "character", but rig_mesh needs the URL of an existing GLB and would return nothing they asked for.',
		prompt: 'How do I rig a humanoid character in Blender?',
	},
];

const ANNOTATION_LABEL = { read_only: 'Read Only', open_world: 'Open World', destructive: 'Destructive' };

const violations = [];
function measure(label, text, limit) {
	// The portal counts characters, and a cut lands mid-word with no warning.
	if (text.length > limit) violations.push(`${label}: ${text.length} chars, over the ${limit} limit by ${text.length - limit}`);
	return text.length;
}

for (const [tool, set] of Object.entries(JUSTIFICATIONS)) {
	for (const [kind, text] of Object.entries(set)) measure(`${tool}.${kind}`, text, LIMITS.justification);
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
