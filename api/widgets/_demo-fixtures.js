/**
 * Demo widget fixtures
 * --------------------
 * IDs prefixed with `wdgt_demo_` resolve to these baked-in fixtures so the
 * /widgets gallery, /w/<id> share pages, and "Open in Studio" template flow
 * all work without seeding a real DB row. Keep ids in sync with
 * /public/widgets-gallery/showcase.json.
 *
 * Avatar files served from /public — no R2 round-trip, no auth.
 */

const CZ = '/avatars/cz.glb';
const SOLDIER = '/animations/soldier.glb';
const ROBOT = '/animations/robotexpressive.glb';

function fixture({ id, type, name, config, modelUrl }) {
	return {
		id,
		user_id: null,
		avatar_id: null,
		type,
		name,
		config,
		is_public: true,
		view_count: 0,
		created_at: '2025-01-01T00:00:00Z',
		updated_at: '2025-01-01T00:00:00Z',
		avatar: {
			id: null,
			name: 'Demo avatar',
			thumbnail_url: null,
			model_url: modelUrl,
			visibility: 'public',
		},
	};
}

export const DEMO_WIDGETS = {
	wdgt_demo_turntab: fixture({
		id: 'wdgt_demo_turntab',
		type: 'turntable',
		name: 'Turntable Showcase',
		modelUrl: CZ,
		config: {
			background: '#0a0a0a',
			accent: '#8b5cf6',
			caption: '',
			showControls: false,
			autoRotate: true,
			rotationSpeed: 0.8,
			envPreset: 'neutral',
		},
	}),

	wdgt_demo_animgal: fixture({
		id: 'wdgt_demo_animgal',
		type: 'animation-gallery',
		name: 'Animation Gallery',
		modelUrl: ROBOT,
		config: {
			background: '#0a0a0a',
			accent: '#8b5cf6',
			caption: '',
			showControls: false,
			autoRotate: false,
			envPreset: 'neutral',
			defaultClip: 'Jump',
			loopAll: false,
			showClipPicker: true,
		},
	}),

	wdgt_demo_talking: fixture({
		id: 'wdgt_demo_talking',
		type: 'talking-agent',
		name: 'Talking Agent',
		modelUrl: CZ,
		config: {
			background: '#0a0a0a',
			accent: '#8b5cf6',
			caption: '',
			showControls: false,
			autoRotate: false,
			envPreset: 'neutral',
			greeting: 'Hi! What would you like to know?',
			brain: 'none',
			proxyURL: '',
		},
	}),

	wdgt_demo_passprt: fixture({
		id: 'wdgt_demo_passprt',
		type: 'passport',
		name: 'ERC-8004 Passport',
		modelUrl: CZ,
		config: {
			background: '#0a0a0a',
			accent: '#8b5cf6',
			caption: '',
			showControls: false,
			autoRotate: true,
			rotationSpeed: 0.6,
			envPreset: 'neutral',
			chain: 'base-sepolia',
			agentId: null,
			wallet: null,
			showReputation: true,
			showRecentFeedback: true,
			layout: 'portrait',
		},
	}),

	wdgt_demo_hotspot: fixture({
		id: 'wdgt_demo_hotspot',
		type: 'hotspot-tour',
		name: 'Hotspot Tour',
		modelUrl: SOLDIER,
		config: {
			background: '#0a0a0a',
			accent: '#8b5cf6',
			caption: '',
			showControls: false,
			autoRotate: false,
			envPreset: 'neutral',
			hotspots: [],
		},
	}),
};

export function isDemoWidgetId(id) {
	return typeof id === 'string' && id.startsWith('wdgt_demo_');
}

export function getDemoWidget(id) {
	return DEMO_WIDGETS[id] || null;
}
