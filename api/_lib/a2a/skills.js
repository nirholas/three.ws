// The skills the three.ws A2A endpoint (POST /api/agents/a2a-paid) routes.
//
// Single source of truth for two consumers that used to disagree: the agent
// card generators (scripts/build-discovery-cards.mjs for the public card,
// scripts/build-marketplace-agent-card.mjs for the Google Cloud Marketplace
// card) copy their skill entries from here, and the endpoint dispatches on these
// ids. A card skill that is not in this list is a skill no client can reach,
// which is exactly what the old card advertised for six of its ten entries.
//
// Pure data, no imports: the build scripts load it without pulling in the
// server's runtime dependencies.
//
// Fields beyond the A2A AgentSkill shape (stripped before a card is written):
//   pricing      'free' runs without payment; 'x402' answers the first call with
//                the a2a-x402 payment-required task and runs after settlement.
//   marketplace  offered on the Marketplace card (3D skills only).
//   generated    the public-card description is written by the discovery
//                generator from live data, so the entry here only routes it.

export const A2A_SKILLS = [
	{
		id: 'generate-3d-model',
		name: 'Generate a 3D Model',
		description:
			'Turn a short text description of one object or character into a textured 3D model (GLB). ' +
			'The task is created in the working state and completes with the GLB, a browser viewer link ' +
			'and an augmented-reality link; poll it with GetTask (tasks/get on 0.3). Free, no account needed.',
		tags: ['3d', 'generation', 'text-to-3d', 'glb', 'gltf'],
		examples: [
			'Generate a 3D model of a small ceramic robot figurine',
			'Make a low-poly wooden treasure chest',
		],
		inputModes: ['text/plain', 'application/json'],
		outputModes: ['application/json', 'model/gltf-binary'],
		pricing: 'free',
		marketplace: true,
	},
	{
		id: 'validate-model',
		name: 'Validate and Inspect a glTF/GLB Model',
		description:
			'Fetch a public glTF or GLB model, run the Khronos glTF-Validator on it, and return the ' +
			'error, warning, info and hint counts, structural stats (vertices, triangles, meshes, ' +
			'materials, textures, animations, skins, extensions) and prioritized optimization ' +
			'recommendations. Free, no account needed.',
		tags: ['3d', 'gltf', 'glb', 'validation', 'inspect', 'optimization'],
		examples: [
			'Validate https://three.ws/avatars/default.glb',
			'Is this GLB spec-compliant? https://three.ws/avatars/default.glb',
		],
		inputModes: ['text/plain', 'application/json'],
		outputModes: ['application/json'],
		pricing: 'free',
		marketplace: true,
	},
	{
		id: 'search-avatars',
		name: 'Search Public 3D Avatars',
		description:
			'Search the public three.ws gallery of 3D avatars and characters by keyword or tag. Returns ' +
			'each match with its name, description, tags, GLB URL and page link. Up to 10 results ' +
			'anonymously, up to 50 with a bearer API key.',
		tags: ['3d', 'avatar', 'character', 'search', 'gallery'],
		examples: ['Find avatars matching robot', 'Search the gallery for a knight character'],
		inputModes: ['text/plain', 'application/json'],
		outputModes: ['application/json'],
		pricing: 'free',
		marketplace: true,
	},
	{
		id: 'inspect-glb-a2a',
		name: 'Inspect glTF/GLB (A2A, pay per call)',
		description:
			'Pay-per-call glTF/GLB inspector over the a2a-x402 extension. Activate the extension with ' +
			'the A2A-Extensions header: the first call returns the payment requirements, and the retry ' +
			'with a signed payment payload settles and returns the glTF-Transform inspection report as ' +
			'a task artifact.',
		tags: ['3d', 'gltf', 'glb', 'inspect', 'a2a', 'x402', 'paid'],
		examples: ['Inspect https://three.ws/avatars/default.glb (A2A x402)', 'Vet this GLB before I mint it'],
		inputModes: ['application/json', 'text/plain'],
		outputModes: ['application/json'],
		pricing: 'x402',
		marketplace: false,
	},
	{
		id: 'x402-service-catalog',
		name: 'Paid x402 Service Catalog',
		description:
			'Summary of the live pay-per-call x402 service catalog by category, with the machine-readable ' +
			'discovery document URL.',
		tags: ['x402', 'paid', 'catalog', 'discovery'],
		examples: ['List the paid service categories'],
		inputModes: ['text/plain', 'application/json'],
		outputModes: ['application/json'],
		pricing: 'free',
		marketplace: false,
		generated: true,
	},
];

export const A2A_SKILL_IDS = A2A_SKILLS.map((s) => s.id);

const CARD_FIELDS = ['id', 'name', 'description', 'tags', 'examples', 'inputModes', 'outputModes'];

/** The A2A AgentSkill projection of a registry entry (routing fields dropped). */
export function cardSkill(entry) {
	const out = {};
	for (const k of CARD_FIELDS) if (entry[k] !== undefined) out[k] = entry[k];
	return out;
}

export function skillById(id) {
	return A2A_SKILLS.find((s) => s.id === id) || null;
}
