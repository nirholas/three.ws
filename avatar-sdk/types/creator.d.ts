export interface AvatarCreatorOptions {
	/** DOM node to mount the modal in. Defaults to document.body. */
	container?: HTMLElement;
	/** Origin of the three.ws Studio iframe. Defaults to https://studio.three.ws. */
	studioUrl?: string;
	/** Edit-mode session URL (issued by three.ws via /api/avatars/:id/session). */
	avaturnSessionUrl?: string;
	/** Called with the GLB Blob when the user exports. */
	onExport?: (blob: Blob) => void | Promise<void>;
	/** Called when the user closes the modal without exporting. */
	onClose?: () => void;
}

export class AvatarCreator {
	constructor(opts?: AvatarCreatorOptions);
	open(): Promise<void>;
	close(): void;
	dispose(): void;
}

export interface SaveBlobOptions {
	bearerToken: string;
	apiOrigin?: string;
	name?: string;
	description?: string;
	tags?: string[];
	visibility?: 'public' | 'unlisted' | 'private';
	source?: string;
}

export function saveBlob(
	blob: Blob,
	opts: SaveBlobOptions,
): Promise<{ id: string; url: string; slug: string }>;
