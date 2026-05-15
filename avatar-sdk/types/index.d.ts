// Type declarations for @three-ws/avatar. The runtime is implemented in
// JavaScript and ships as a self-contained ES module that side-effectfully
// registers the <agent-3d> custom element on import.

export {};

declare global {
	interface HTMLElementTagNameMap {
		'agent-3d': Agent3DElement;
		'agent-stage': AgentStageElement;
	}
}

/**
 * The `<agent-3d>` web component renders a 3D avatar with a built-in chat /
 * voice loop, emotion morphs, and lipsync. Most apps will use it declaratively
 * in HTML; instances can also be created via `document.createElement`.
 */
export class Agent3DElement extends HTMLElement {
	/** Avatar UUID (server-resolved). Setting this loads the GLB + animations. */
	avatarId?: string;
	/** Direct GLB URL. Use this OR `avatarId`, not both. */
	src?: string;
	/** Optional iOS Quick Look USDZ URL for AR. */
	iosSrc?: string;
	/** Hide the dev/debug GUI. */
	kiosk?: boolean;

	/** Trigger a one-shot gesture animation by name (idle, wave, nod, …). */
	playGesture(name: string, opts?: { loop?: boolean }): void;
	/** Drive a single morph target by name. */
	setMorph(name: string, weight: number): void;
}

export class AgentStageElement extends HTMLElement {}

export class Viewer {}
export class Runtime {}
export class SceneController {}
export class Memory {}
export class Skill {}
export class SkillRegistry {}

export function defineElement(tag?: string): void;
