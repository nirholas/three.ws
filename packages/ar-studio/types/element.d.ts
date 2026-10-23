import type { ArStudio, StudioOptions } from './index';

export declare class ArStudioElement extends HTMLElement {
	studio: ArStudio | null;
	options(): StudioOptions;
}

/** Register `<ar-studio>`. Safe to call more than once. */
export declare function defineArStudio(tag?: string): void;
export default defineArStudio;
