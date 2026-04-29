// Library entry — imported by the CDN bundle <script type="module" src="agent-3d.js">.
// Registers the custom element and exposes public API classes for programmatic use.

import { Agent3DElement } from './element.js';
import { AgentStageElement } from './stage-element.js';

export { Agent3DElement, AgentStageElement };
export { Viewer } from './viewer.js';
export { Runtime } from './runtime/index.js';
export { SceneController } from './runtime/scene.js';
export { SkillRegistry, Skill } from './skills/index.js';
export { Memory } from './memory/index.js';
export { loadManifest, normalize, fetchRelative } from './manifest.js';
export { resolveURI, fetchWithFallback } from './ipfs.js';

// Re-export the side-effectful element import for users who import the whole bundle.
export const defineElement = (tag = 'agent-3d') => {
	if (!customElements.get(tag)) customElements.define(tag, Agent3DElement);
};

// The element also self-registers on import, but calling defineElement() with a
// custom tag lets consumers ship under their own brand.
